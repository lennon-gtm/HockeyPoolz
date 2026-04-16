# Scores Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a `/league/[id]/scores` page showing yesterday's NHL game results with a radio host-style callout per game — game narrative + which league member cashed in most (the "benefactor").

**Architecture:** New `LeagueGameSummary` DB model stores one AI-generated callout per league per NHL game per day. `generateLeagueScoreSummaries(leagueId, date)` in `lib/scores-service.ts` fetches results from NHL API, finds the per-game fantasy benefactor from `PlayerGameStats`, and calls Claude once per game. The `generate-recaps` cron calls this after league recaps. A new `GET /api/leagues/[id]/scores` endpoint serves the results. The UI page is a new route.

**Tech Stack:** Prisma 7, Anthropic SDK (`claude-sonnet-4-6`), Next.js App Router, Vitest, NHL Stats API (`api-web.nhle.com/v1`)

---

## File Map

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `LeagueGameSummary` model + relation on `League` |
| `lib/scores-service.ts` | New — NHL API fetch, benefactor calc, prompt assembly, generation |
| `__tests__/lib/scores-service.test.ts` | New — prompt builder + benefactor calc tests |
| `app/api/leagues/[id]/scores/route.ts` | New GET endpoint |
| `app/api/cron/generate-recaps/route.ts` | Call `generateLeagueScoreSummaries` per active league |
| `app/(app)/league/[id]/scores/page.tsx` | New scores page UI |

---

### Task 1: Schema — Add LeagueGameSummary model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, add after the `LeagueRecap` model (added in Plan 13):

```prisma
model LeagueGameSummary {
  id           String   @id @default(uuid())
  leagueId     String   @map("league_id")
  gameId       String   @map("game_id")
  gameDate     DateTime @db.Date @map("game_date")
  homeTeamId   String   @map("home_team_id")
  awayTeamId   String   @map("away_team_id")
  homeScore    Int      @map("home_score")
  awayScore    Int      @map("away_score")
  gameState    String   @map("game_state")
  seriesStatus String?  @map("series_status")
  articleUrl   String?  @map("article_url")
  content      String
  createdAt    DateTime @default(now()) @map("created_at")

  league League @relation(fields: [leagueId], references: [id])

  @@unique([leagueId, gameId])
  @@map("league_game_summaries")
}
```

Also add `gameSummaries LeagueGameSummary[]` to the `League` model relations block.

- [ ] **Step 2: Run migration**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz
npx prisma migrate dev --name add_league_game_summary
```

Expected: migration created, client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add LeagueGameSummary model"
```

---

### Task 2: scores-service.ts — types, helpers, and tests

**Files:**
- Create: `lib/scores-service.ts`
- Create: `__tests__/lib/scores-service.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/lib/scores-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { buildGameSummaryPrompt, findBenefactor } from '../../lib/scores-service'

describe('buildGameSummaryPrompt', () => {
  it('includes both team names and score', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: 'COL leads 2-1',
      articleHeadline: 'Makar scores twice in Avs win',
      articleExcerpt: 'Nathan MacKinnon added two assists.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Cale Makar: 2G 1A (12.4 pts)'] },
    })
    expect(prompt).toContain('DAL')
    expect(prompt).toContain('COL')
    expect(prompt).toContain('4')
    expect(prompt).toContain('2')
  })

  it('includes series status', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: 'COL leads 2-1',
      articleHeadline: 'Makar scores twice',
      articleExcerpt: 'Colorado wins.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: [] },
    })
    expect(prompt).toContain('COL leads 2-1')
  })

  it('includes benefactor team name and fpts', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: null,
      articleHeadline: 'Avs win',
      articleExcerpt: 'Good game.',
      benefactor: { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Makar: 12.4 pts'] },
    })
    expect(prompt).toContain('BobsTeam')
    expect(prompt).toContain('14.2')
  })

  it('handles null benefactor gracefully', () => {
    const prompt = buildGameSummaryPrompt({
      awayTeam: 'DAL', homeTeam: 'COL',
      awayScore: 2, homeScore: 4,
      gameState: 'FINAL', seriesStatus: null,
      articleHeadline: 'Avs win',
      articleExcerpt: 'Good game.',
      benefactor: null,
    })
    expect(prompt).toContain('DAL')
    expect(prompt).not.toContain('undefined')
  })
})

describe('findBenefactor', () => {
  it('returns member with highest total fpts for that game', () => {
    const memberScores = [
      { teamName: 'BobsTeam', fpts: 14.2, topPlayers: ['Makar: 12.4 pts'] },
      { teamName: 'PuckDaddyFC', fpts: 5.1, topPlayers: ['Rantanen: 5.1 pts'] },
    ]
    const result = findBenefactor(memberScores)
    expect(result?.teamName).toBe('BobsTeam')
    expect(result?.fpts).toBe(14.2)
  })

  it('returns null for empty array', () => {
    expect(findBenefactor([])).toBeNull()
  })

  it('returns null if all members scored 0', () => {
    const memberScores = [
      { teamName: 'BobsTeam', fpts: 0, topPlayers: [] },
    ]
    expect(findBenefactor(memberScores)).toBeNull()
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
npx vitest run __tests__/lib/scores-service.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create lib/scores-service.ts with types and pure functions**

```typescript
/**
 * ScoresService — NHL game results, benefactor calculation, AI callout generation.
 */

import Anthropic from '@anthropic-ai/sdk'
import { prisma } from './prisma'
import { calculatePlayerScore, type ScoringWeights } from './stats-service'

// --- Types ---

export interface GameSummaryPromptInput {
  awayTeam: string
  homeTeam: string
  awayScore: number
  homeScore: number
  gameState: string
  seriesStatus: string | null
  articleHeadline: string
  articleExcerpt: string
  benefactor: BenefactorEntry | null
}

export interface BenefactorEntry {
  teamName: string
  fpts: number
  topPlayers: string[]   // e.g. ["Cale Makar: 2G 1A (12.4 pts)"]
}

export interface MemberGameScore {
  teamName: string
  fpts: number
  topPlayers: string[]
}

// --- Pure functions ---

/** Find the league member who scored the most from a single game. Returns null if no one scored. */
export function findBenefactor(memberScores: MemberGameScore[]): BenefactorEntry | null {
  if (memberScores.length === 0) return null
  const best = memberScores.reduce((a, b) => b.fpts > a.fpts ? b : a)
  if (best.fpts <= 0) return null
  return best
}

/** Build the per-game Claude prompt. */
export function buildGameSummaryPrompt(input: GameSummaryPromptInput): string {
  const { awayTeam, homeTeam, awayScore, homeScore, gameState, seriesStatus, articleHeadline, articleExcerpt, benefactor } = input

  const scoreLine = `${awayTeam} ${awayScore} @ ${homeTeam} ${homeScore} (${gameState}${seriesStatus ? ` — ${seriesStatus}` : ''})`

  let prompt = `Game: ${scoreLine}\n`
  prompt += `Article: ${articleHeadline}. ${articleExcerpt}\n`

  if (benefactor) {
    prompt += `\nLeague fantasy winner: ${benefactor.teamName} — ${benefactor.fpts.toFixed(1)} pts`
    if (benefactor.topPlayers.length > 0) {
      prompt += ` (${benefactor.topPlayers.join(', ')})`
    }
  } else {
    prompt += '\nNo league members had players in this game.'
  }

  return prompt
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run __tests__/lib/scores-service.test.ts
```

Expected: all PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/scores-service.ts __tests__/lib/scores-service.test.ts
git commit -m "feat(scores): add scores-service with prompt builder and benefactor logic"
```

---

### Task 3: generateLeagueScoreSummaries

**Files:**
- Modify: `lib/scores-service.ts`

- [ ] **Step 1: Add NHL API fetch helpers and generation orchestrator**

Add to the bottom of `lib/scores-service.ts`:

```typescript
// --- Constants ---

const NHL_API = 'https://api-web.nhle.com/v1'

const GAME_SUMMARY_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show — loud, punchy, and fun. Write up to 4 sentences about this game. Give the game real color: the result, the momentum, a key moment or turning point, series context if relevant. End with a callout of the fantasy winner from this league — their team name, point total, and the player who delivered. More detail is better. Use the same voice throughout — enthusiastic, specific, a little bit of edge. No filler. No "In conclusion." Just the take.`

// --- NHL API ---

interface NhlGame {
  id: number
  gameState: string   // "OFF", "FINAL", "LIVE", etc.
  homeTeam: { abbrev: string; score?: number }
  awayTeam: { abbrev: string; score?: number }
  seriesStatus?: { seriesAbbrev?: string; round?: number; topSeedTeamAbbrev?: string; topSeedWins?: number; bottomSeedWins?: number }
  gameScheduleState?: string
}

interface NhlStoryBlock {
  type: string
  content?: string
}

async function fetchYesterdayGames(date: string): Promise<NhlGame[]> {
  const res = await fetch(`${NHL_API}/score/${date}`)
  if (!res.ok) return []
  const data = await res.json()
  return data.games ?? []
}

async function fetchGameStory(gameId: number): Promise<{ headline: string; excerpt: string; url: string | null }> {
  try {
    const res = await fetch(`${NHL_API}/gamecenter/${gameId}/story`)
    if (!res.ok) return { headline: '', excerpt: '', url: null }
    const data = await res.json()
    // story endpoint returns editorialTrays or similar — extract headline and first paragraph
    const headline = data.summary?.headline ?? data.headline ?? ''
    // Find first text paragraph
    const blocks: NhlStoryBlock[] = data.summary?.items?.[0]?.content ?? data.items ?? []
    const excerpt = blocks
      .filter((b: NhlStoryBlock) => b.type === 'paragraph' || b.type === 'text')
      .slice(0, 2)
      .map((b: NhlStoryBlock) => b.content ?? '')
      .join(' ')
      .slice(0, 500)
    const url = data.summary?.url ?? data.url ?? null
    return { headline, excerpt, url }
  } catch {
    return { headline: '', excerpt: '', url: null }
  }
}

function formatSeriesStatus(game: NhlGame): string | null {
  const s = game.seriesStatus
  if (!s) return null
  const top = s.topSeedTeamAbbrev ?? ''
  const topW = s.topSeedWins ?? 0
  const botW = s.bottomSeedWins ?? 0
  if (topW === botW) return `Series tied ${topW}-${botW}`
  const leader = topW > botW ? top : (game.homeTeam.abbrev === top ? game.awayTeam.abbrev : game.homeTeam.abbrev)
  const wins = Math.max(topW, botW)
  const losses = Math.min(topW, botW)
  return `${leader} leads ${wins}-${losses}`
}

// --- Benefactor calculation ---

async function calcMemberScores(
  leagueId: string,
  nhlGameId: number,
  weights: ScoringWeights
): Promise<MemberGameScore[]> {
  const gameId = `po-${nhlGameId}`

  const picks = await prisma.draftPick.findMany({
    where: { leagueMember: { leagueId } },
    include: {
      leagueMember: { select: { teamName: true } },
      player: {
        include: {
          gameStats: { where: { gameId } },
        },
      },
    },
  })

  const memberMap = new Map<string, MemberGameScore>()

  for (const pick of picks) {
    const stats = pick.player.gameStats[0]
    if (!stats) continue

    const fpts = calculatePlayerScore({
      goals: stats.goals, assists: stats.assists, plusMinus: stats.plusMinus,
      pim: stats.pim, shots: stats.shots, hits: stats.hits,
      blockedShots: stats.blockedShots, powerPlayGoals: stats.powerPlayGoals,
      powerPlayPoints: stats.powerPlayPoints, shorthandedGoals: stats.shorthandedGoals,
      shorthandedPoints: stats.shorthandedPoints, gameWinningGoals: stats.gameWinningGoals,
      overtimeGoals: stats.overtimeGoals, goalieWins: stats.goalieWins,
      goalieSaves: stats.goalieSaves, shutouts: stats.shutouts, goalsAgainst: stats.goalsAgainst,
    }, weights)

    if (fpts <= 0) continue

    const teamName = pick.leagueMember.teamName
    const existing = memberMap.get(teamName)
    const playerLine = `${pick.player.name}: ${stats.goals}G ${stats.assists}A (${fpts.toFixed(1)} pts)`

    if (existing) {
      existing.fpts = Math.round((existing.fpts + fpts) * 100) / 100
      existing.topPlayers.push(playerLine)
    } else {
      memberMap.set(teamName, { teamName, fpts: Math.round(fpts * 100) / 100, topPlayers: [playerLine] })
    }
  }

  return Array.from(memberMap.values())
}

// --- Orchestration ---

/** Generate AI callouts for all completed games from yesterday. One record per league per game. */
export async function generateLeagueScoreSummaries(leagueId: string, date: string): Promise<void> {
  const games = await fetchYesterdayGames(date)
  const completedGames = games.filter(g =>
    g.gameState === 'OFF' || g.gameState === 'FINAL' || g.gameState === 'OFFICIAL'
  )
  if (completedGames.length === 0) return

  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return

  const weights: ScoringWeights = {
    goals: Number(settings.goals), assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus), pim: Number(settings.pim),
    shots: Number(settings.shots), hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots), powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints), shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints), gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals), goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves), shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const client = new Anthropic()
  const gameDate = new Date(date)

  for (const game of completedGames) {
    // Skip if already generated
    const existingKey = `po-${game.id}`
    const exists = await prisma.leagueGameSummary.findUnique({
      where: { leagueId_gameId: { leagueId, gameId: existingKey } },
    })
    if (exists) continue

    const [story, memberScores] = await Promise.all([
      fetchGameStory(game.id),
      calcMemberScores(leagueId, game.id, weights),
    ])

    const benefactor = findBenefactor(memberScores)
    const seriesStatus = formatSeriesStatus(game)

    const userPrompt = buildGameSummaryPrompt({
      awayTeam: game.awayTeam.abbrev,
      homeTeam: game.homeTeam.abbrev,
      awayScore: game.awayTeam.score ?? 0,
      homeScore: game.homeTeam.score ?? 0,
      gameState: game.gameState,
      seriesStatus,
      articleHeadline: story.headline,
      articleExcerpt: story.excerpt,
      benefactor,
    })

    try {
      const response = await client.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 250,
        system: GAME_SUMMARY_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      })
      const block = response.content[0]
      if (block.type !== 'text') continue
      const content = block.text

      await prisma.leagueGameSummary.create({
        data: {
          leagueId,
          gameId: existingKey,
          gameDate,
          homeTeamId: game.homeTeam.abbrev,
          awayTeamId: game.awayTeam.abbrev,
          homeScore: game.homeTeam.score ?? 0,
          awayScore: game.awayTeam.score ?? 0,
          gameState: game.gameState,
          seriesStatus,
          articleUrl: story.url,
          content,
        },
      })
    } catch (err) {
      console.error(`Failed to generate summary for game ${game.id}:`, err)
    }

    // Small delay to avoid NHL API rate limiting
    await new Promise(r => setTimeout(r, 200))
  }
}
```

- [ ] **Step 2: Verify tests still pass**

```bash
npx vitest run __tests__/lib/scores-service.test.ts
```

Expected: all PASS.

- [ ] **Step 3: Commit**

```bash
git add lib/scores-service.ts
git commit -m "feat(scores): add generateLeagueScoreSummaries orchestrator"
```

---

### Task 4: API endpoint + cron wiring

**Files:**
- Create: `app/api/leagues/[id]/scores/route.ts`
- Modify: `app/api/cron/generate-recaps/route.ts`

- [ ] **Step 1: Create GET /api/leagues/[id]/scores**

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const yesterday = new Date()
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)
    const yesterdayDate = new Date(yesterday.toISOString().split('T')[0])

    const games = await prisma.leagueGameSummary.findMany({
      where: { leagueId, gameDate: yesterdayDate },
      orderBy: [{ homeScore: 'desc' }, { awayScore: 'desc' }],
    })

    return NextResponse.json({ games })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/scores error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Wire into generate-recaps cron**

In `app/api/cron/generate-recaps/route.ts`, add the import:

```typescript
import { generateLeagueScoreSummaries } from '@/lib/scores-service'
```

In the loop body, after the `generateLeagueRecap` call block, add:

```typescript
      // Generate yesterday's game summaries
      const yesterday = new Date()
      yesterday.setUTCDate(yesterday.getUTCDate() - 1)
      const yesterdayStr = yesterday.toISOString().split('T')[0]
      try {
        await generateLeagueScoreSummaries(league.id, yesterdayStr)
      } catch (err) {
        result.errors.push(`Scores summary failed: ${err}`)
      }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/leagues/\[id\]/scores/route.ts app/api/cron/generate-recaps/route.ts
git commit -m "feat(scores): add GET /api/leagues/[id]/scores and wire cron"
```

---

### Task 5: Scores page UI

**Files:**
- Create: `app/(app)/league/[id]/scores/page.tsx`

- [ ] **Step 1: Create the page**

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'

interface GameSummary {
  id: string
  gameId: string
  gameDate: string
  homeTeamId: string
  awayTeamId: string
  homeScore: number
  awayScore: number
  gameState: string
  seriesStatus: string | null
  articleUrl: string | null
  content: string
}

export default function ScoresPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [games, setGames] = useState<GameSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [date, setDate] = useState('')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setLoading(false); return }
      const res = await fetch(`/api/leagues/${id}/scores`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setGames(data.games ?? [])
        if (data.games?.length > 0) {
          setDate(new Date(data.games[0].gameDate).toLocaleDateString('en-US', {
            weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
          }))
        }
      }
      setLoading(false)
    }
    load()
  }, [id])

  if (loading) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>

  return (
    <div className="p-4 max-w-xl mx-auto">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-[10px] font-black tracking-[2px] uppercase text-[#121212]">Yesterday&apos;s Games</h2>
        {date && <span className="text-[10px] text-[#98989e] font-semibold">{date}</span>}
      </div>

      {games.length === 0 ? (
        <div className="border border-[#eeeeee] rounded-xl p-8 text-center">
          <p className="text-sm text-[#98989e]">No games yesterday.</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          {games.map(game => {
            const homeWon = game.homeScore > game.awayScore
            return (
              <div key={game.id} className="bg-white rounded-2xl border border-[#eeeeee] overflow-hidden">
                {/* Score header */}
                <div className="px-4 pt-4 pb-3 border-b border-[#f2f2f2]">
                  <div className="flex items-center justify-between mb-2.5">
                    {/* Away team */}
                    <div className="flex items-center gap-2 flex-1">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://assets.nhle.com/logos/nhl/svg/${game.awayTeamId}_light.svg`}
                        alt={game.awayTeamId}
                        className="w-9 h-9 object-contain"
                      />
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#121212]">{game.awayTeamId}</span>
                    </div>
                    {/* Score */}
                    <div className="flex items-center gap-2 px-2">
                      <span className={`text-2xl font-black leading-none ${!homeWon ? 'text-[#121212]' : 'text-[#c8c8c8]'}`}>
                        {game.awayScore}
                      </span>
                      <span className="text-base text-[#d8d8d8] font-light">–</span>
                      <span className={`text-2xl font-black leading-none ${homeWon ? 'text-[#121212]' : 'text-[#c8c8c8]'}`}>
                        {game.homeScore}
                      </span>
                    </div>
                    {/* Home team */}
                    <div className="flex items-center gap-2 flex-1 flex-row-reverse">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={`https://assets.nhle.com/logos/nhl/svg/${game.homeTeamId}_light.svg`}
                        alt={game.homeTeamId}
                        className="w-9 h-9 object-contain"
                      />
                      <span className="text-[11px] font-black uppercase tracking-wide text-[#121212]">{game.homeTeamId}</span>
                    </div>
                  </div>
                  {/* Badges */}
                  <div className="flex items-center justify-center gap-2">
                    <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#f0f0f0] text-[#515151]">
                      {game.gameState === 'OFF' || game.gameState === 'OFFICIAL' ? 'Final' : game.gameState}
                    </span>
                    {game.seriesStatus && (
                      <span className="text-[9px] font-bold uppercase tracking-wide px-2 py-0.5 rounded-full bg-[#eef3ff] text-[#0042bb]">
                        {game.seriesStatus}
                      </span>
                    )}
                  </div>
                </div>

                {/* Commentary */}
                <div className="px-4 py-3 border-b border-[#f2f2f2]">
                  <p className="text-[13px] leading-relaxed text-[#2a2a2a]">{game.content}</p>
                </div>

                {/* Footer */}
                {game.articleUrl && (
                  <div className="px-4 py-2.5">
                    <a
                      href={game.articleUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-[10px] font-bold text-[#0042bb] hover:underline"
                    >
                      Read full recap →
                    </a>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify TypeScript**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/league/\[id\]/scores/page.tsx
git commit -m "feat(scores): add /league/[id]/scores page UI"
```
