# League Recap Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the per-member recap card in the league lobby with a league-wide daily bulletin (radio host voice, top/bottom performers), move the personal recap to My Team page, and generate a draft-day roast when the commissioner starts the draft.

**Architecture:** New `LeagueRecap` DB model stores one bulletin per league per day. `generateLeagueRecap()` is called by the existing `generate-recaps` cron after per-member recaps. `generateDraftDayBulletin()` is called inline when the draft PATCH action=`start` fires. A new `GET /api/leagues/[id]/league-recap` endpoint serves the latest bulletin to the lobby.

**Tech Stack:** Prisma 7, Anthropic SDK (`claude-sonnet-4-6`), Next.js App Router, Vitest

---

## File Map

| File | Action |
|---|---|
| `prisma/schema.prisma` | Add `LeagueRecap` model + relation on `League` |
| `lib/recap-service.ts` | Add `buildLeagueRecapPrompt`, `buildDraftDayPrompt`, `generateLeagueRecap`, `generateDraftDayBulletin` |
| `__tests__/lib/recap-service.test.ts` | Add tests for new prompt builders |
| `app/api/leagues/[id]/league-recap/route.ts` | New GET endpoint |
| `app/api/cron/generate-recaps/route.ts` | Call `generateLeagueRecap` per active league |
| `app/api/leagues/[id]/draft/route.ts` | Call `generateDraftDayBulletin` on action=`start` |
| `app/(app)/league/[id]/page.tsx` | Swap personal recap card for League Bulletin |
| `app/(app)/league/[id]/team/page.tsx` | Add personal recap card, remove modal + 📰 stat card |

---

### Task 1: Schema — Add LeagueRecap model

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model**

In `prisma/schema.prisma`, add after the `MemberDailyScore` model:

```prisma
model LeagueRecap {
  id         String   @id @default(uuid())
  leagueId   String   @map("league_id")
  recapDate  DateTime @db.Date @map("recap_date")
  content    String
  createdAt  DateTime @default(now()) @map("created_at")

  league League @relation(fields: [leagueId], references: [id])

  @@unique([leagueId, recapDate])
  @@map("league_recaps")
}
```

Also add `leagueRecaps LeagueRecap[]` to the `League` model relations block (after the existing `recaps Recap[]` line).

- [ ] **Step 2: Generate and run migration**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz
npx prisma migrate dev --name add_league_recap
```

Expected: migration file created in `prisma/migrations/`, Prisma client regenerated.

- [ ] **Step 3: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add LeagueRecap model"
```

---

### Task 2: Prompt builders + tests

**Files:**
- Modify: `lib/recap-service.ts`
- Modify: `__tests__/lib/recap-service.test.ts`

- [ ] **Step 1: Write failing tests**

Add to `__tests__/lib/recap-service.test.ts`:

```typescript
import { buildLeagueRecapPrompt, buildDraftDayPrompt } from '../../lib/recap-service'

describe('buildLeagueRecapPrompt', () => {
  const dailyScores = [
    { teamName: 'GrindersUnited', fpts: 18.4 },
    { teamName: 'BobsTeam', fpts: 14.2 },
    { teamName: 'IceQueenFC', fpts: 1.8 },
  ]
  const standings = [
    { rank: 1, teamName: 'GrindersUnited', userName: 'mike', totalScore: 222.6 },
    { rank: 2, teamName: 'BobsTeam', userName: 'bob', totalScore: 218.4 },
    { rank: 3, teamName: 'IceQueenFC', userName: 'sarah', totalScore: 190.0 },
  ]

  it('includes all team names from daily scores', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('GrindersUnited')
    expect(prompt).toContain('BobsTeam')
    expect(prompt).toContain('IceQueenFC')
  })

  it('includes fpts values', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('18.4')
    expect(prompt).toContain('1.8')
  })

  it('includes current standings', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('222.6')
    expect(prompt).toContain('218.4')
  })

  it('includes league name', () => {
    const prompt = buildLeagueRecapPrompt({ leagueName: 'Champs Pool', dailyScores, standings })
    expect(prompt).toContain('Champs Pool')
  })
})

describe('buildDraftDayPrompt', () => {
  it('includes all team names', () => {
    const prompt = buildDraftDayPrompt({
      leagueName: 'Champs Pool',
      teams: ['GrindersUnited', 'IceQueenFC', 'BobsTeam'],
    })
    expect(prompt).toContain('GrindersUnited')
    expect(prompt).toContain('IceQueenFC')
    expect(prompt).toContain('BobsTeam')
  })

  it('includes league name', () => {
    const prompt = buildDraftDayPrompt({ leagueName: 'Champs Pool', teams: ['A', 'B'] })
    expect(prompt).toContain('Champs Pool')
  })

  it('numbers teams in order', () => {
    const prompt = buildDraftDayPrompt({ leagueName: 'Test', teams: ['Alpha', 'Beta', 'Gamma'] })
    expect(prompt).toContain('1.')
    expect(prompt).toContain('2.')
    expect(prompt).toContain('3.')
  })
})
```

- [ ] **Step 2: Run tests — verify they fail**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz
npx vitest run __tests__/lib/recap-service.test.ts
```

Expected: FAIL — `buildLeagueRecapPrompt` and `buildDraftDayPrompt` not found.

- [ ] **Step 3: Add types and functions to recap-service.ts**

Add after the existing `RecapGenerationResult` interface:

```typescript
export interface DailyScore {
  teamName: string
  fpts: number
}

export interface LeagueRecapPromptInput {
  leagueName: string
  dailyScores: DailyScore[]   // sorted best to worst
  standings: StandingEntry[]
}

export interface DraftDayPromptInput {
  leagueName: string
  teams: string[]   // in draft order
}
```

Add after `buildRecapPrompt`:

```typescript
/** Build the prompt for the league-wide daily bulletin. */
export function buildLeagueRecapPrompt(input: LeagueRecapPromptInput): string {
  let prompt = `League: ${input.leagueName}\n\nYesterday's scores (best to worst):\n`
  for (const s of input.dailyScores) {
    prompt += `- ${s.teamName}: ${s.fpts.toFixed(1)} pts\n`
  }
  prompt += '\nCurrent standings:\n'
  for (const s of input.standings) {
    prompt += `${s.rank}. ${s.teamName} — ${s.totalScore.toFixed(1)} total pts\n`
  }
  return prompt
}

/** Build the prompt for the draft-day bulletin. */
export function buildDraftDayPrompt(input: DraftDayPromptInput): string {
  let prompt = `League: ${input.leagueName}\n\nTeams in draft order:\n`
  input.teams.forEach((t, i) => {
    prompt += `${i + 1}. ${t}\n`
  })
  return prompt
}
```

- [ ] **Step 4: Run tests — verify they pass**

```bash
npx vitest run __tests__/lib/recap-service.test.ts
```

Expected: all tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/recap-service.ts __tests__/lib/recap-service.test.ts
git commit -m "feat(recap): add league recap and draft day prompt builders"
```

---

### Task 3: generateLeagueRecap + generateDraftDayBulletin

**Files:**
- Modify: `lib/recap-service.ts`

- [ ] **Step 1: Add constants and helpers**

Add near the top of `lib/recap-service.ts` (after the existing `SYSTEM_PROMPT` constant):

```typescript
const LEAGUE_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show. You are loud, funny, and ruthless. You celebrate winners by name, and you roast the worst performers specifically and mercilessly — use their actual team name, their actual point total from yesterday, and make it sting. Keep it playful, never mean-spirited. 2–3 paragraphs, under 200 words.`

const DRAFT_DAY_SYSTEM_PROMPT = `You are the host of a fantasy hockey radio show on draft day. You are loud, funny, and ruthless. Riff on the team names — find the humor, the hubris, the delusion. Build anticipation for the pool. Keep it under 150 words, punchy, one paragraph. No filler. End with a hype line to kick things off.`

/** Generic Claude call — allows custom system prompt and token limit. */
async function callClaude(systemPrompt: string, userPrompt: string, maxTokens: number): Promise<string> {
  const client = new Anthropic()
  const response = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  })
  const block = response.content[0]
  if (block.type !== 'text') throw new Error('Unexpected response type from Claude API')
  return block.text
}
```

- [ ] **Step 2: Refactor generateRecapText to use callClaude**

Replace the body of `generateRecapText`:

```typescript
export async function generateRecapText(userPrompt: string): Promise<string> {
  return callClaude(SYSTEM_PROMPT, userPrompt, 400)
}
```

- [ ] **Step 3: Add generateLeagueRecap**

Add after `generateLeagueRecaps`:

```typescript
/** Generate the league-wide daily bulletin and store it. Skips if no games yesterday. */
export async function generateLeagueRecap(leagueId: string): Promise<void> {
  const yesterday = new Date()
  yesterday.setUTCDate(yesterday.getUTCDate() - 1)
  const yesterdayStr = yesterday.toISOString().split('T')[0]
  const yesterdayDate = new Date(yesterdayStr)

  // Skip if no daily scores exist for yesterday
  const scoreCount = await prisma.memberDailyScore.count({
    where: { member: { leagueId }, gameDate: yesterdayDate },
  })
  if (scoreCount === 0) return

  // Skip if already generated today
  const todayStr = new Date().toISOString().split('T')[0]
  const todayDate = new Date(todayStr)
  const existing = await prisma.leagueRecap.findUnique({
    where: { leagueId_recapDate: { leagueId, recapDate: todayDate } },
  })
  if (existing) return

  const league = await prisma.league.findUnique({ where: { id: leagueId }, select: { name: true } })
  if (!league) return

  const [dailyScoreRows, memberRows] = await Promise.all([
    prisma.memberDailyScore.findMany({
      where: { member: { leagueId }, gameDate: yesterdayDate },
      include: { member: { select: { teamName: true } } },
      orderBy: { fpts: 'desc' },
    }),
    prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: { totalScore: 'desc' },
      select: { teamName: true, totalScore: true },
    }),
  ])

  const dailyScores: DailyScore[] = dailyScoreRows.map(r => ({
    teamName: r.member.teamName,
    fpts: Number(r.fpts),
  }))

  const standings: StandingEntry[] = memberRows.map((m, i) => ({
    rank: i + 1,
    teamName: m.teamName,
    userName: '',
    totalScore: Number(m.totalScore),
  }))

  const userPrompt = buildLeagueRecapPrompt({ leagueName: league.name, dailyScores, standings })
  const content = await callClaude(LEAGUE_SYSTEM_PROMPT, userPrompt, 500)

  await prisma.leagueRecap.create({
    data: { leagueId, recapDate: todayDate, content },
  })
}
```

- [ ] **Step 4: Add generateDraftDayBulletin**

Add after `generateLeagueRecap`:

```typescript
/** Generate a draft-day roast bulletin when the draft goes live. */
export async function generateDraftDayBulletin(leagueId: string): Promise<void> {
  const todayStr = new Date().toISOString().split('T')[0]
  const todayDate = new Date(todayStr)

  // Skip if already generated today (idempotent)
  const existing = await prisma.leagueRecap.findUnique({
    where: { leagueId_recapDate: { leagueId, recapDate: todayDate } },
  })
  if (existing) return

  const league = await prisma.league.findUnique({
    where: { id: leagueId },
    select: { name: true },
  })
  if (!league) return

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    orderBy: { draftPosition: 'asc' },
    select: { teamName: true },
  })

  const teams = members.map(m => m.teamName)
  const userPrompt = buildDraftDayPrompt({ leagueName: league.name, teams })
  const content = await callClaude(DRAFT_DAY_SYSTEM_PROMPT, userPrompt, 350)

  await prisma.leagueRecap.create({
    data: { leagueId, recapDate: todayDate, content },
  })
}
```

- [ ] **Step 5: Verify tests still pass**

```bash
npx vitest run __tests__/lib/recap-service.test.ts
```

Expected: all PASS.

- [ ] **Step 6: Commit**

```bash
git add lib/recap-service.ts
git commit -m "feat(recap): add generateLeagueRecap and generateDraftDayBulletin"
```

---

### Task 4: GET /api/leagues/[id]/league-recap

**Files:**
- Create: `app/api/leagues/[id]/league-recap/route.ts`

- [ ] **Step 1: Create the route**

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

    const recap = await prisma.leagueRecap.findFirst({
      where: { leagueId },
      orderBy: { recapDate: 'desc' },
    })

    return NextResponse.json({ recap: recap ?? null })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/league-recap error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/\[id\]/league-recap/route.ts
git commit -m "feat(api): add GET /api/leagues/[id]/league-recap endpoint"
```

---

### Task 5: Wire cron + draft start

**Files:**
- Modify: `app/api/cron/generate-recaps/route.ts`
- Modify: `app/api/leagues/[id]/draft/route.ts`

- [ ] **Step 1: Update generate-recaps cron**

In `app/api/cron/generate-recaps/route.ts`, update the import and the loop body:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateLeagueRecaps, generateLeagueRecap } from '@/lib/recap-service'

export async function POST(request: NextRequest) {
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
      // Generate league-wide bulletin after per-member recaps
      try {
        await generateLeagueRecap(league.id)
      } catch (err) {
        result.errors.push(`League recap failed: ${err}`)
      }
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

- [ ] **Step 2: Update draft PATCH to call generateDraftDayBulletin on start**

In `app/api/leagues/[id]/draft/route.ts`, add the import at the top:

```typescript
import { generateDraftDayBulletin } from '@/lib/recap-service'
```

In the `action === 'start'` block, after the league status update (the `if (!draft.isMock)` line), add a fire-and-forget call:

```typescript
      // Transition league to draft status
      if (!draft.isMock) {
        await prisma.league.update({ where: { id: leagueId }, data: { status: 'draft' } })
        // Generate draft-day bulletin (non-blocking — don't fail the draft start if this errors)
        generateDraftDayBulletin(leagueId).catch(err =>
          console.error('Draft day bulletin error:', err)
        )
      }
      return NextResponse.json({ draft: updated })
```

- [ ] **Step 3: Commit**

```bash
git add app/api/cron/generate-recaps/route.ts app/api/leagues/\[id\]/draft/route.ts
git commit -m "feat(cron): wire generateLeagueRecap into cron and draft start"
```

---

### Task 6: Lobby UI — League Bulletin card

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Add leagueRecap state and fetch**

In `page.tsx`, add a new state variable after the existing `recap` state:

```typescript
const [leagueRecap, setLeagueRecap] = useState<{ id: string; recapDate: string; content: string; createdAt: string } | null>(null)
```

In the `load` function, replace the existing recap fetch block:

```typescript
        // Fetch league bulletin (shown in lobby for draft/active/complete leagues)
        const leagueRecapRes = await fetch(`/api/leagues/${id}/league-recap`, { headers })
        if (leagueRecapRes.ok) {
          const leagueRecapData = await leagueRecapRes.json()
          setLeagueRecap(leagueRecapData.recap)
        }
```

Remove the old personal recap fetch (the `fetch('/api/leagues/${id}/recaps')` call and the `setRecap` call). Also remove the `recap` and `recapExpanded` state declarations and the `RecapCard` UI block.

- [ ] **Step 2: Replace the Morning Recap card with League Bulletin**

Find the existing `{/* Morning Recap card */}` block (approximately lines 279-312) and replace it entirely with:

```tsx
      {/* League Bulletin */}
      {leagueRecap && (league.status === 'draft' || league.status === 'active' || league.status === 'complete') && (
        <div className="bg-[#fff7ed] rounded-xl border border-[#fed7aa] p-4 mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[9px] font-black tracking-[2px] uppercase text-[#f97316]">📣 League Bulletin</span>
            <span className="text-[9px] text-[#fb923c] font-semibold">
              {league.status === 'draft'
                ? `Draft Day · ${new Date(leagueRecap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`
                : new Date(leagueRecap.recapDate).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })
              }
            </span>
          </div>
          <p className="text-sm leading-relaxed text-[#431407]">{leagueRecap.content}</p>
        </div>
      )}
```

- [ ] **Step 3: Verify the lobby compiles**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz
npx tsc --noEmit
```

Fix any type errors before continuing.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/league/\[id\]/page.tsx
git commit -m "feat(lobby): replace personal recap with League Bulletin card"
```

---

### Task 7: My Team UI — personal recap card

**Files:**
- Modify: `app/(app)/league/[id]/team/page.tsx`

- [ ] **Step 1: Add recap card above the header**

The recap is already fetched (line ~113). Add a recap card between the header and the stat cards row. Replace the existing `{/* Stat cards */}` section with:

```tsx
      {/* Personal recap card */}
      {recap && (
        <div className="bg-[#f8f8f8] rounded-xl p-4 mb-4 border border-[#eeeeee]">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <span className="text-[9px] font-black tracking-[2px] uppercase text-[#98989e]">Morning Recap</span>
              <span className="text-[9px] text-[#98989e]">
                {new Date(recap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
              </span>
            </div>
            {recap.standingChange !== 0 && (
              <span className={`text-[9px] font-bold px-2 py-0.5 rounded ${
                recap.standingChange > 0 ? 'bg-green-100 text-[#2db944]' : 'bg-red-50 text-[#c8102e]'
              }`}>
                {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
              </span>
            )}
          </div>
          <p className="text-sm text-[#121212] leading-relaxed">{recap.content}</p>
        </div>
      )}

      {/* Stat cards */}
```

- [ ] **Step 2: Remove the 📰 stat card and its modal**

Change the stat cards grid from 3 columns to 2 (remove the recap stat card):

```tsx
      {/* Stat cards */}
      <div className="grid grid-cols-2 gap-1.5 mb-4">
        <StatCard value={rank ? `${rank}${ordinal(rank)}` : '—'} label="Standing" />
        <StatCard
          value={ydTotal !== null ? fmtFpts(ydTotal) : '—'}
          label="Yesterday"
          tone={ydTotal !== null && ydTotal > 0 ? 'positive' : 'default'}
        />
      </div>
```

Delete the entire `{/* Recap modal */}` block (lines ~271-303) and the `recapOpen` state and `setRecapOpen` usage.

- [ ] **Step 3: Clean up unused state**

Remove `const [recapOpen, setRecapOpen] = useState(false)` — it's no longer needed.

- [ ] **Step 4: Verify the page compiles**

```bash
npx tsc --noEmit
```

Fix any type errors.

- [ ] **Step 5: Commit**

```bash
git add app/\(app\)/league/\[id\]/team/page.tsx
git commit -m "feat(my-team): add personal recap card, remove modal"
```
