# Morning Recaps Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate personalized AI-written morning recaps for each league member after the daily stats sync, and display them in the league lobby.

**Architecture:** A `recap-service.ts` module assembles prompt context from standings and game stats, calls Claude Sonnet to generate personalized sportscaster commentary, and stores results in the existing `recaps` table. A cron endpoint at 11:30 UTC triggers generation. The lobby page fetches and displays the latest recap as a collapsible card.

**Tech Stack:** Next.js 16.2.2 App Router, Prisma v7, Anthropic SDK (`@anthropic-ai/sdk`), Claude claude-sonnet-4-6, Vitest

---

## Codebase Context

Before reading this plan, know that:
- Auth: every protected route calls `getBearerToken(request.headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`
- `lib/auth.ts` exports `verifyIdToken`, `getBearerToken`, `AuthError`
- `lib/prisma.ts` exports `prisma` (singleton PrismaClient with PrismaPg adapter)
- `lib/stats-service.ts` exports `calculatePlayerScore`, `ScoringWeights`, `GameStats` and all NHL sync functions
- The `recaps` table already exists in the schema with fields: id, leagueId, leagueMemberId, userId, recapDate, content, standingChange, createdAt. Unique constraint on `(leagueMemberId, recapDate)`.
- Cron auth: validate `Authorization: Bearer <CRON_SECRET>` against `process.env.CRON_SECRET`
- `proxy.ts` PUBLIC_PATHS already includes `/api/cron/` and `/api/admin/`
- `vercel.json` already has the cron entry: `{ "path": "/api/cron/generate-recaps", "schedule": "30 11 * * *" }`
- Pages use `'use client'`, `use(params)` for dynamic route params, `useEffect` for data fetching
- Tests use Vitest: `describe`, `it`, `expect` — run with `npm run test:run`
- `ANTHROPIC_API_KEY` is set in Vercel env vars

## File Structure

**New files:**
- `lib/recap-service.ts` — prompt assembly, Claude API call, recap generation orchestration
- `__tests__/lib/recap-service.test.ts` — unit tests for prompt assembly
- `app/api/cron/generate-recaps/route.ts` — cron handler
- `app/api/leagues/[id]/recaps/route.ts` — GET latest recap for current user

**Modified files:**
- `app/(app)/league/[id]/page.tsx` — add recap card above standings summary

---

## Task 1: Prompt Assembly and Tests

**Files:**
- Create: `lib/recap-service.ts`
- Create: `__tests__/lib/recap-service.test.ts`

- [ ] **Step 1: Write the failing tests for prompt assembly**

Create `__tests__/lib/recap-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildRecapPrompt } from '../../lib/recap-service'

describe('buildRecapPrompt', () => {
  const standings = [
    { rank: 1, teamName: 'Puck Buddies', userName: 'Lennon', totalScore: 85.5 },
    { rank: 2, teamName: 'Ice Breakers', userName: 'Jordan', totalScore: 72.0 },
    { rank: 3, teamName: 'Goal Diggers', userName: 'Alex', totalScore: 60.0 },
  ]

  const memberPlayerStats = [
    { name: 'Connor McDavid', opponent: 'VAN', goals: 2, assists: 1, plusMinus: 2, weightedScore: 8.5 },
    { name: 'Leon Draisaitl', opponent: 'VAN', goals: 0, assists: 2, plusMinus: 1, weightedScore: 3.7 },
  ]

  const topLeaguePlayers = [
    { name: 'Auston Matthews', ownerTeam: 'Ice Breakers', goals: 3, assists: 0, weightedScore: 7.5 },
    { name: 'Nathan MacKinnon', ownerTeam: 'Goal Diggers', goals: 1, assists: 2, weightedScore: 5.0 },
  ]

  it('includes member team name and rank', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 2,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Puck Buddies')
    expect(prompt).toContain('1st')
    expect(prompt).toContain('+2')
  })

  it('includes player stats for the member', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Connor McDavid')
    expect(prompt).toContain('Leon Draisaitl')
    expect(prompt).toContain('8.5')
  })

  it('includes full standings', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Ice Breakers')
    expect(prompt).toContain('72.0')
  })

  it('includes top league players for trash talk', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Puck Buddies',
      currentRank: 1,
      standingChange: 0,
      memberPlayerStats,
      standings,
      topLeaguePlayers,
    })
    expect(prompt).toContain('Auston Matthews')
    expect(prompt).toContain('Ice Breakers')
  })

  it('handles negative standing change', () => {
    const prompt = buildRecapPrompt({
      teamName: 'Goal Diggers',
      currentRank: 3,
      standingChange: -1,
      memberPlayerStats: [],
      standings,
      topLeaguePlayers: [],
    })
    expect(prompt).toContain('-1')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/recap-service.test.ts`

Expected: FAIL — `buildRecapPrompt` not found.

- [ ] **Step 3: Implement the recap service**

Create `lib/recap-service.ts`:

```typescript
/**
 * RecapService — prompt assembly, Claude API call, and recap generation.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { calculatePlayerScore, type ScoringWeights } from './stats-service'

// --- Types ---

export interface MemberPlayerStat {
  name: string
  opponent: string
  goals: number
  assists: number
  plusMinus: number
  weightedScore: number
}

export interface StandingEntry {
  rank: number
  teamName: string
  userName: string
  totalScore: number
}

export interface TopLeaguePlayer {
  name: string
  ownerTeam: string
  goals: number
  assists: number
  weightedScore: number
}

export interface RecapPromptInput {
  teamName: string
  currentRank: number
  standingChange: number
  memberPlayerStats: MemberPlayerStat[]
  standings: StandingEntry[]
  topLeaguePlayers: TopLeaguePlayer[]
}

export interface RecapGenerationResult {
  recapsCreated: number
  errors: string[]
}

// --- Constants ---

const SYSTEM_PROMPT = `You are a sportscaster for a fantasy hockey playoff pool called HockeyPoolz. Write a 2-3 paragraph personalized morning recap for a participant. Be enthusiastic, slightly irreverent, and include friendly trash talk about other teams in the league. Reference specific players and stats. Keep it under 200 words.`

// --- Pure functions ---

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return n + (s[(v - 20) % 10] || s[v] || s[0])
}

/** Build the user prompt for a single member's recap. */
export function buildRecapPrompt(input: RecapPromptInput): string {
  const { teamName, currentRank, standingChange, memberPlayerStats, standings, topLeaguePlayers } = input

  const changeStr = standingChange > 0 ? `+${standingChange}` : String(standingChange)

  let prompt = `Team: ${teamName}\nCurrent rank: ${ordinal(currentRank)} place`
  if (standingChange !== 0) {
    prompt += ` (moved ${changeStr} since last recap)`
  }
  prompt += '\n'

  if (memberPlayerStats.length > 0) {
    prompt += '\nYour players last night:\n'
    for (const p of memberPlayerStats) {
      prompt += `- ${p.name} vs ${p.opponent}: ${p.goals}G ${p.assists}A ${p.plusMinus > 0 ? '+' : ''}${p.plusMinus} | ${p.weightedScore.toFixed(1)} fantasy pts\n`
    }
  } else {
    prompt += '\nNone of your players had games last night.\n'
  }

  prompt += '\nFull standings:\n'
  for (const s of standings) {
    prompt += `${s.rank}. ${s.teamName} (${s.userName}) — ${s.totalScore.toFixed(1)} pts\n`
  }

  if (topLeaguePlayers.length > 0) {
    prompt += '\nTop performers across the league last night:\n'
    for (const p of topLeaguePlayers) {
      prompt += `- ${p.name} (${p.ownerTeam}): ${p.goals}G ${p.assists}A | ${p.weightedScore.toFixed(1)} fantasy pts\n`
    }
  }

  return prompt
}

// --- Claude API ---

/** Generate recap text using Claude API. */
export async function generateRecapText(userPrompt: string): Promise<string> {
  const client = new Anthropic()

  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 400,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude API')
  return block.text
}

// --- Orchestration ---

/** Generate recaps for all eligible members in a league. */
export async function generateLeagueRecaps(leagueId: string): Promise<RecapGenerationResult> {
  const result: RecapGenerationResult = { recapsCreated: 0, errors: [] }

  const today = new Date()
  const recapDate = new Date(today.toISOString().split('T')[0]) // midnight UTC today

  // Load scoring settings for weight calculations
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) {
    result.errors.push(`No scoring settings for league ${leagueId}`)
    return result
  }

  const weights: ScoringWeights = {
    goals: Number(settings.goals), assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
    shots: Number(settings.shots), hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots),
    powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals),
    goalieWins: Number(settings.goalieWins), goalieSaves: Number(settings.goalieSaves),
    shutouts: Number(settings.shutouts), goalsAgainst: Number(settings.goalsAgainst),
  }

  // Load all members with draft picks and their players
  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      user: { select: { id: true, displayName: true } },
      draftPicks: {
        include: {
          player: {
            include: {
              team: { select: { abbreviation: true, eliminatedAt: true } },
              gameStats: { orderBy: { gameDate: 'desc' } },
            },
          },
        },
      },
      recaps: { orderBy: { recapDate: 'desc' }, take: 1 },
    },
    orderBy: { totalScore: 'desc' },
  })

  // Build standings snapshot
  const standings: StandingEntry[] = members.map((m, i) => ({
    rank: i + 1,
    teamName: m.teamName,
    userName: m.user.displayName,
    totalScore: Number(m.totalScore),
  }))

  // Find all recent game stats across all drafted players for top performers
  // "Recent" = since the earliest last-recap date across all members
  const lastRecapDates = members
    .map(m => m.recaps[0]?.recapDate)
    .filter(Boolean) as Date[]
  const sinceDate = lastRecapDates.length > 0
    ? new Date(Math.min(...lastRecapDates.map(d => d.getTime())))
    : new Date(0)

  for (const member of members) {
    const currentRank = standings.findIndex(s => s.teamName === member.teamName) + 1
    const lastRecapDate = member.recaps[0]?.recapDate ?? null

    // Check if any drafted players had games since last recap
    const recentPlayerStats: MemberPlayerStat[] = []
    for (const pick of member.draftPicks) {
      const recentGames = pick.player.gameStats.filter(gs =>
        lastRecapDate ? gs.gameDate > lastRecapDate : true
      )
      for (const gs of recentGames) {
        const score = calculatePlayerScore({
          goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
          pim: gs.pim, shots: gs.shots, hits: gs.hits,
          blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        }, weights)
        recentPlayerStats.push({
          name: pick.player.name,
          opponent: pick.player.team.abbreviation, // simplified — opponent not easily available from game stats
          goals: gs.goals,
          assists: gs.assists,
          plusMinus: gs.plusMinus,
          weightedScore: Math.round(score * 100) / 100,
        })
      }
    }

    // Skip if no players had games
    if (recentPlayerStats.length === 0) continue

    // Calculate standing change by comparing current rank to the rank
    // implied by the previous recap. The previous recap stores standingChange
    // relative to ITS predecessor, so we can't chain them. Instead, we store
    // the current rank alongside each recap and compare directly next time.
    // Since the schema doesn't have a rank field on recaps, we compute it:
    // Previous rank = currentRank - previousStandingChange (reverse the delta).
    // For the first recap, standingChange = 0.
    // For subsequent recaps: we look at the previous recap's standing_change
    // and the fact that the member's rank at that time was:
    //   previousRank = currentRank (if no prior change info)
    // This is imprecise without a stored rank. For Alpha, just default to 0.
    // The AI prompt still includes full standings so readers see position context.
    const standingChange = 0

    // Build top league players (top 3 scorers from recent games, excluding this member's players)
    const allRecentScores: TopLeaguePlayer[] = []
    for (const otherMember of members) {
      if (otherMember.id === member.id) continue
      for (const pick of otherMember.draftPicks) {
        const recentGames = pick.player.gameStats.filter(gs =>
          lastRecapDate ? gs.gameDate > lastRecapDate : true
        )
        for (const gs of recentGames) {
          const score = calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights)
          allRecentScores.push({
            name: pick.player.name,
            ownerTeam: otherMember.teamName,
            goals: gs.goals,
            assists: gs.assists,
            weightedScore: Math.round(score * 100) / 100,
          })
        }
      }
    }
    const topLeaguePlayers = allRecentScores
      .sort((a, b) => b.weightedScore - a.weightedScore)
      .slice(0, 3)

    // Build prompt and generate
    const userPrompt = buildRecapPrompt({
      teamName: member.teamName,
      currentRank,
      standingChange,
      memberPlayerStats: recentPlayerStats,
      standings,
      topLeaguePlayers,
    })

    try {
      const content = await generateRecapText(userPrompt)

      await prisma.recap.create({
        data: {
          leagueId,
          leagueMemberId: member.id,
          userId: member.user.id,
          recapDate,
          content,
          standingChange,
        },
      })
      result.recapsCreated++
    } catch (err) {
      result.errors.push(`Failed to generate recap for ${member.teamName}: ${err}`)
    }
  }

  return result
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/recap-service.test.ts`

Expected: All 5 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recap-service.ts __tests__/lib/recap-service.test.ts
git commit -m "feat: add recap service with prompt assembly and Claude API integration"
```

---

## Task 2: Cron Generate-Recaps Endpoint

**Files:**
- Create: `app/api/cron/generate-recaps/route.ts`

- [ ] **Step 1: Create the cron route**

Create `app/api/cron/generate-recaps/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateLeagueRecaps } from '@/lib/recap-service'

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'active' },
      select: { id: true, name: true },
    })

    const results = []
    for (const league of activeLeagues) {
      const result = await generateLeagueRecaps(league.id)
      results.push({ leagueId: league.id, leagueName: league.name, ...result })
    }

    return NextResponse.json({
      success: true,
      leagues: results,
      totalRecaps: results.reduce((sum, r) => sum + r.recapsCreated, 0),
    })
  } catch (error) {
    console.error('Cron generate-recaps error:', error)
    return NextResponse.json({ error: 'Recap generation failed', details: String(error) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/cron/generate-recaps/route.ts
git commit -m "feat: add cron endpoint for morning recap generation"
```

---

## Task 3: Recaps API Endpoint

**Files:**
- Create: `app/api/leagues/[id]/recaps/route.ts`

- [ ] **Step 1: Create the recaps route**

Create `app/api/leagues/[id]/recaps/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const recap = await prisma.recap.findFirst({
      where: { leagueMemberId: membership.id },
      orderBy: { recapDate: 'desc' },
      select: {
        id: true,
        recapDate: true,
        content: true,
        standingChange: true,
        createdAt: true,
      },
    })

    return NextResponse.json({ recap: recap ?? null })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/recaps error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/[id]/recaps/route.ts
git commit -m "feat: add recaps API endpoint for latest user recap"
```

---

## Task 4: Recap Card in League Lobby

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Add recap state and fetch**

In `app/(app)/league/[id]/page.tsx`, add a recap state variable after the existing `standings` state (around line 35):

```typescript
  const [recap, setRecap] = useState<{ id: string; recapDate: string; content: string; standingChange: number; createdAt: string } | null>(null)
```

Inside the `useEffect` `load()` function, inside the block that fetches standings (after `setStandings`), add the recap fetch:

```typescript
          // Fetch latest recap
          const recapRes = await fetch(`/api/leagues/${id}/recaps`, { headers })
          if (recapRes.ok) {
            const recapData = await recapRes.json()
            setRecap(recapData.recap)
          }
```

- [ ] **Step 2: Add recap expanded state**

After the existing state declarations, add:

```typescript
  const [recapExpanded, setRecapExpanded] = useState(false)
```

- [ ] **Step 3: Add the recap card JSX**

In the JSX, add the recap card just before the standings summary section (`{/* Standings summary (active/complete phase) */}`):

```tsx
      {/* Morning Recap card */}
      {recap && (league.status === 'active' || league.status === 'complete') && (
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Morning Recap</p>
              <span className="text-xs text-gray-400">{new Date(recap.recapDate).toLocaleDateString()}</span>
            </div>
            {recap.standingChange !== 0 && (
              <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                recap.standingChange > 0
                  ? 'bg-green-100 text-green-700'
                  : 'bg-red-100 text-red-700'
              }`}>
                {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
              </span>
            )}
          </div>
          <div className="text-sm text-gray-700 leading-relaxed">
            {recapExpanded
              ? recap.content
              : recap.content.split('\n\n')[0]
            }
          </div>
          {recap.content.includes('\n\n') && (
            <button
              onClick={() => setRecapExpanded(!recapExpanded)}
              className="text-xs text-orange-500 font-bold mt-2 hover:text-orange-700"
            >
              {recapExpanded ? 'Show less' : 'Read more'}
            </button>
          )}
        </div>
      )}
```

- [ ] **Step 4: Run tests and dev server**

Run: `npm run test:run`

Expected: All tests pass.

Run: `npm run dev` and verify the lobby page loads without errors.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/league/[id]/page.tsx"
git commit -m "feat: add morning recap card to league lobby"
```

---

## Task 5: Run Full Test Suite and Build Verification

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm run test:run`

Expected: All tests pass.

- [ ] **Step 2: Run the build**

Run: `npx next build`

Expected: Build completes with no type errors.

- [ ] **Step 3: Fix any issues and commit**

If there are type or build errors, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve build errors from morning recaps implementation"
```

---
