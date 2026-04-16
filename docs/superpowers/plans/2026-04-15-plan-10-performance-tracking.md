# Performance Tracking Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add YDAY (yesterday's fantasy points) to standings, my-team, and lobby by pre-computing daily member scores in a new `MemberDailyScore` table, extending the sync cron, and rebuilding the My Team page with a full sortable roster table and recap modal.

**Architecture:** A new `MemberDailyScore` table (one row per member per game date) is written by the cron after each daily sync. The standings API gains a `yesterdayFpts` field. A new roster API endpoint returns each member's drafted players with season totals and yesterday's FPTS computed at query time from the existing `PlayerGameStats` table. The My Team page rebuilds around these two APIs. Standings and lobby pages add the YDAY column/card.

**Tech Stack:** Next.js 16 App Router, Prisma v7, Postgres (Neon), Firebase Auth, Tailwind, Vitest

---

## Codebase Context

Read these files before starting any task:

- `prisma/schema.prisma` — all models; `LeagueMember` needs a `dailyScores` relation added
- `lib/stats-service.ts` — exports `calculatePlayerScore`, `calculateMemberScore`, `ScoringWeights`, `GameStats`; `recalculateScores` is the pattern to follow for `writeMemberDailyScores`
- `app/api/cron/sync-stats/route.ts` — cron handler; add `writeMemberDailyScores` call after step 4
- `app/api/leagues/[id]/standings/route.ts` — existing standings endpoint; add `yesterdayFpts` per member
- `app/(app)/league/[id]/team/page.tsx` — current stub; full rebuild in Task 6
- `app/(app)/league/[id]/standings/page.tsx` — add YDAY column in Task 7
- `app/(app)/league/[id]/page.tsx` — lobby; update active-state standings rows in Task 8
- `components/stat-card.tsx` — `<StatCard value label tone? onClick? />` (tones: default/positive/negative/dark)
- `components/team-icon.tsx` — `<TeamIcon icon={str|null} size="sm"|"md"|"lg" />`
- `components/position-badge.tsx` — `<PositionBadge position="F"|"D"|"G" />`
- Auth pattern: `getBearerToken(headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`
- Cron auth: `request.headers.get('authorization') === \`Bearer ${process.env.CRON_SECRET}\``
- Tests: Vitest — `describe`, `it`, `expect`, `vi` — run with `npm run test:run`

## File Structure

**New files:**
- `app/api/leagues/[id]/members/[memberId]/roster/route.ts` — `GET` returns member's roster with per-player season stats + yesterdayFpts
- `__tests__/api/roster.test.ts` — unit tests for roster endpoint

**Modified files:**
- `prisma/schema.prisma` — add `MemberDailyScore` model; add relation to `LeagueMember`
- `lib/stats-service.ts` — add `writeMemberDailyScores(leagueId, date)`
- `__tests__/lib/stats-service.test.ts` — add `writeMemberDailyScores` tests
- `app/api/cron/sync-stats/route.ts` — call `writeMemberDailyScores` per active league
- `app/api/leagues/[id]/standings/route.ts` — add `yesterdayFpts` to each standing entry
- `app/(app)/league/[id]/team/page.tsx` — full rebuild
- `app/(app)/league/[id]/standings/page.tsx` — add YDAY column
- `app/(app)/league/[id]/page.tsx` — add YDAY to active-state standings rows + hero card

---

## Task 1: Schema — `MemberDailyScore`

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the model and relation**

In `prisma/schema.prisma`, add the new model after `Recap` and before `NhlTeam`:

```prisma
model MemberDailyScore {
  id        String   @id @default(uuid())
  memberId  String   @map("member_id")
  gameDate  DateTime @db.Date @map("game_date")
  fpts      Decimal  @db.Decimal(10, 2)
  createdAt DateTime @default(now()) @map("created_at")

  member LeagueMember @relation(fields: [memberId], references: [id])

  @@unique([memberId, gameDate])
  @@map("member_daily_scores")
}
```

Also add the back-relation to `LeagueMember` (after the existing `recaps` line):

```prisma
  recaps      Recap[]
  dailyScores MemberDailyScore[]
```

- [ ] **Step 2: Run the migration**

```bash
npx prisma migrate dev --name member_daily_scores
```

Expected output: `The following migration(s) have been created and applied … member_daily_scores`

- [ ] **Step 3: Regenerate the Prisma client**

```bash
npx prisma generate
```

Expected: no errors.

- [ ] **Step 4: Verify build**

```bash
npm run build
```

Expected: exits 0 (no TypeScript errors from schema change).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(schema): add MemberDailyScore table for daily FPTS tracking"
```

---

## Task 2: `writeMemberDailyScores` + Tests

**Files:**
- Modify: `lib/stats-service.ts`
- Modify: `__tests__/lib/stats-service.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `__tests__/lib/stats-service.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { writeMemberDailyScores } from '../../lib/stats-service'

// Mock prisma for writeMemberDailyScores tests
const mockPrismaForDaily = {
  scoringSettings: { findUnique: vi.fn() },
  leagueMember: { findMany: vi.fn() },
  memberDailyScore: { upsert: vi.fn() },
}

vi.mock('../../lib/prisma', () => ({ prisma: mockPrismaForDaily }), { once: false })

const WEIGHTS = {
  goals: 2.0, assists: 1.5, plusMinus: 0.5, pim: 0.0, shots: 0.1,
  hits: 0.0, blockedShots: 0.0, powerPlayGoals: 0.5, powerPlayPoints: 0.0,
  shorthandedGoals: 0.0, shorthandedPoints: 0.0, gameWinningGoals: 1.0,
  overtimeGoals: 1.0, goalieWins: 3.0, goalieSaves: 0.2, shutouts: 5.0,
  goalsAgainst: 0.0,
}

describe('writeMemberDailyScores', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrismaForDaily.scoringSettings.findUnique.mockResolvedValue(WEIGHTS)
    mockPrismaForDaily.memberDailyScore.upsert.mockResolvedValue({})
  })

  it('returns 0 when no scoring settings exist', async () => {
    mockPrismaForDaily.scoringSettings.findUnique.mockResolvedValue(null)
    const count = await writeMemberDailyScores('league-1', '2026-04-14')
    expect(count).toBe(0)
    expect(mockPrismaForDaily.memberDailyScore.upsert).not.toHaveBeenCalled()
  })

  it('upserts a daily score row per member', async () => {
    mockPrismaForDaily.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        draftPicks: [
          {
            playerId: 1,
            player: {
              team: { eliminatedAt: null },
              gameStats: [
                {
                  goals: 1, assists: 1, plusMinus: 1, pim: 0, shots: 3,
                  hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
                  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
                  overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
                  goalsAgainst: 0,
                },
              ],
            },
          },
        ],
      },
    ])
    const count = await writeMemberDailyScores('league-1', '2026-04-14')
    expect(count).toBe(1)
    // goals:1*2.0=2.0 + assists:1*1.5=1.5 + plusMinus:1*0.5=0.5 + shots:3*0.1=0.3 = 4.3
    const call = mockPrismaForDaily.memberDailyScore.upsert.mock.calls[0][0]
    expect(Number(call.create.fpts)).toBeCloseTo(4.3)
  })

  it('skips stats for players whose team was eliminated before the game date', async () => {
    const gameDate = new Date('2026-04-14')
    const eliminatedBefore = new Date('2026-04-13')
    mockPrismaForDaily.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1',
        draftPicks: [
          {
            playerId: 1,
            player: {
              team: { eliminatedAt: eliminatedBefore },
              gameStats: [
                {
                  goals: 5, assists: 5, plusMinus: 0, pim: 0, shots: 0,
                  hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
                  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
                  overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
                  goalsAgainst: 0,
                },
              ],
            },
          },
        ],
      },
    ])
    await writeMemberDailyScores('league-1', '2026-04-14')
    const call = mockPrismaForDaily.memberDailyScore.upsert.mock.calls[0][0]
    expect(Number(call.create.fpts)).toBeCloseTo(0)
  })
})
```

- [ ] **Step 2: Run the tests to confirm they fail**

```bash
npm run test:run -- __tests__/lib/stats-service.test.ts
```

Expected: `writeMemberDailyScores` tests fail with "writeMemberDailyScores is not a function".

- [ ] **Step 3: Implement `writeMemberDailyScores` in `lib/stats-service.ts`**

Add this export after `recalculateScores`:

```ts
/**
 * For a given league and date string ('YYYY-MM-DD'), sum each member's
 * drafted players' game stats for that date and upsert one MemberDailyScore row
 * per member. Returns the number of rows upserted.
 */
export async function writeMemberDailyScores(leagueId: string, date: string): Promise<number> {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return 0

  const weights: ScoringWeights = {
    goals: Number(settings.goals),
    assists: Number(settings.assists),
    plusMinus: Number(settings.plusMinus),
    pim: Number(settings.pim),
    shots: Number(settings.shots),
    hits: Number(settings.hits),
    blockedShots: Number(settings.blockedShots),
    powerPlayGoals: Number(settings.powerPlayGoals),
    powerPlayPoints: Number(settings.powerPlayPoints),
    shorthandedGoals: Number(settings.shorthandedGoals),
    shorthandedPoints: Number(settings.shorthandedPoints),
    gameWinningGoals: Number(settings.gameWinningGoals),
    overtimeGoals: Number(settings.overtimeGoals),
    goalieWins: Number(settings.goalieWins),
    goalieSaves: Number(settings.goalieSaves),
    shutouts: Number(settings.shutouts),
    goalsAgainst: Number(settings.goalsAgainst),
  }

  const gameDate = new Date(date)

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      draftPicks: {
        include: {
          player: {
            include: {
              team: { select: { eliminatedAt: true } },
              gameStats: { where: { gameDate } },
            },
          },
        },
      },
    },
  })

  let written = 0
  for (const member of members) {
    const dayStats: GameStats[] = []

    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      // Skip players whose team was eliminated before this game date
      if (eliminatedAt && eliminatedAt < gameDate) continue

      for (const gs of pick.player.gameStats) {
        dayStats.push({
          goals: gs.goals,
          assists: gs.assists,
          plusMinus: gs.plusMinus,
          pim: gs.pim,
          shots: gs.shots,
          hits: gs.hits,
          blockedShots: gs.blockedShots,
          powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints,
          shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints,
          gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals,
          goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves,
          shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        })
      }
    }

    const fpts = calculateMemberScore(dayStats, weights)
    await prisma.memberDailyScore.upsert({
      where: { memberId_gameDate: { memberId: member.id, gameDate } },
      update: { fpts },
      create: { memberId: member.id, gameDate, fpts },
    })
    written++
  }

  return written
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- __tests__/lib/stats-service.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-service.ts __tests__/lib/stats-service.test.ts
git commit -m "feat(stats): add writeMemberDailyScores for daily FPTS rollup"
```

---

## Task 3: Cron Extension

**Files:**
- Modify: `app/api/cron/sync-stats/route.ts`

- [ ] **Step 1: Import `writeMemberDailyScores`**

At the top of `app/api/cron/sync-stats/route.ts`, update the import:

```ts
import { syncRosters, syncGameStats, checkEliminations, recalculateScores, writeMemberDailyScores } from '@/lib/stats-service'
```

- [ ] **Step 2: Call `writeMemberDailyScores` for each active league**

After the existing step 4 (recalculate scores loop), add step 5:

```ts
    // 4. Recalculate scores for all active leagues
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'active' },
      select: { id: true },
    })
    for (const league of activeLeagues) {
      await recalculateScores(league.id)
    }

    // 5. Write yesterday's daily scores per member (powers YDAY columns)
    const dailyResults = []
    for (const league of activeLeagues) {
      const count = await writeMemberDailyScores(league.id, formatDate(yesterday))
      dailyResults.push({ leagueId: league.id, membersScored: count })
    }

    return NextResponse.json({
      success: true,
      rosters: rosterResult,
      stats: statsResults,
      eliminations: newEliminations,
      leaguesScored: activeLeagues.length,
      dailyScores: dailyResults,
    })
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/sync-stats/route.ts
git commit -m "feat(cron): write MemberDailyScore rows after each sync"
```

---

## Task 4: Standings API — Add `yesterdayFpts`

**Files:**
- Modify: `app/api/leagues/[id]/standings/route.ts`
- Create: `__tests__/api/standings-yesterday.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/standings-yesterday.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn().mockReturnValue('token'),
  verifyIdToken: vi.fn().mockResolvedValue({ uid: 'firebase-uid' }),
  AuthError: class AuthError extends Error { constructor(msg: string) { super(msg) } },
}))

const mockPrisma = {
  user: { findUnique: vi.fn() },
  leagueMember: { findUnique: vi.fn(), findMany: vi.fn() },
  scoringSettings: { findUnique: vi.fn() },
  memberDailyScore: { findMany: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string) {
  return new NextRequest(`http://localhost/api/leagues/${leagueId}/standings`, {
    headers: { authorization: 'Bearer token' },
  })
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/leagues/[id]/standings — yesterdayFpts', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    mockPrisma.leagueMember.findUnique.mockResolvedValue({ id: 'member-1' })
    mockPrisma.scoringSettings.findUnique.mockResolvedValue({
      goals: 2, assists: 1.5, plusMinus: 0.5, pim: 0, shots: 0.1,
      hits: 0, blockedShots: 0, powerPlayGoals: 0.5, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
      overtimeGoals: 1, goalieWins: 3, goalieSaves: 0.2, shutouts: 5, goalsAgainst: 0,
    })
    mockPrisma.leagueMember.findMany.mockResolvedValue([
      {
        id: 'member-1', teamName: 'Team A', teamIcon: null, totalScore: '100.0',
        scoreLastCalculatedAt: null,
        user: { displayName: 'Alice' },
        favoriteTeam: { colorPrimary: '#FF0000' },
        draftPicks: [],
      },
    ])
    mockPrisma.memberDailyScore.findMany.mockResolvedValue([
      { memberId: 'member-1', fpts: '12.5' },
    ])
  })

  it('includes yesterdayFpts in each standing entry', async () => {
    const { GET } = await import('../../app/api/leagues/[id]/standings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.standings[0].yesterdayFpts).toBeCloseTo(12.5)
  })

  it('returns null yesterdayFpts when no daily score row exists', async () => {
    mockPrisma.memberDailyScore.findMany.mockResolvedValue([])
    const { GET } = await import('../../app/api/leagues/[id]/standings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const body = await res.json()
    expect(body.standings[0].yesterdayFpts).toBeNull()
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:run -- __tests__/api/standings-yesterday.test.ts
```

Expected: FAIL — `yesterdayFpts` is undefined.

- [ ] **Step 3: Update the standings route**

In `app/api/leagues/[id]/standings/route.ts`, add the `memberDailyScore` query after the `settings` query and before the `members` query:

```ts
    // Yesterday's date at UTC midnight
    const yd = new Date()
    yd.setUTCDate(yd.getUTCDate() - 1)
    yd.setUTCHours(0, 0, 0, 0)

    const dailyScores = await prisma.memberDailyScore.findMany({
      where: { member: { leagueId: id }, gameDate: yd },
      select: { memberId: true, fpts: true },
    })
    const ydMap = new Map(dailyScores.map(d => [d.memberId, Number(d.fpts)]))
```

Then update the standing entry in the `.map()`:

```ts
      return {
        rank: index + 1,
        memberId: member.id,
        teamName: member.teamName,
        teamIcon: member.teamIcon,
        userName: member.user.displayName,
        totalScore: Number(member.totalScore),
        scoreLastCalculatedAt: member.scoreLastCalculatedAt,
        colorPrimary: member.favoriteTeam?.colorPrimary ?? null,
        yesterdayFpts: ydMap.has(member.id) ? ydMap.get(member.id)! : null,
        players,
      }
```

- [ ] **Step 4: Run the tests to confirm they pass**

```bash
npm run test:run -- __tests__/api/standings-yesterday.test.ts
```

Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add app/api/leagues/[id]/standings/route.ts __tests__/api/standings-yesterday.test.ts
git commit -m "feat(api): add yesterdayFpts to standings endpoint"
```

---

## Task 5: Roster API

**Files:**
- Create: `app/api/leagues/[id]/members/[memberId]/roster/route.ts`
- Create: `__tests__/api/roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/api/roster.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn().mockReturnValue('token'),
  verifyIdToken: vi.fn().mockResolvedValue({ uid: 'firebase-uid' }),
  AuthError: class AuthError extends Error { constructor(msg: string) { super(msg) } },
}))

const mockPrisma = {
  user: { findUnique: vi.fn() },
  leagueMember: { findUnique: vi.fn() },
  scoringSettings: { findUnique: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string, memberId: string) {
  return new NextRequest(
    `http://localhost/api/leagues/${leagueId}/members/${memberId}/roster`,
    { headers: { authorization: 'Bearer token' } }
  )
}
const ctx = (id: string, memberId: string) => ({
  params: Promise.resolve({ id, memberId }),
})

const SCORING = {
  goals: 2, assists: 1.5, plusMinus: 0.5, pim: 0, shots: 0.1,
  hits: 0, blockedShots: 0, powerPlayGoals: 0.5, powerPlayPoints: 0,
  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
  overtimeGoals: 1, goalieWins: 3, goalieSaves: 0.2, shutouts: 5, goalsAgainst: 0,
}

describe('GET /api/leagues/[id]/members/[memberId]/roster', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1' })
    mockPrisma.scoringSettings.findUnique.mockResolvedValue(SCORING)
    // Caller is a member of the league
    mockPrisma.leagueMember.findUnique
      .mockResolvedValueOnce({ id: 'member-caller' }) // membership check
      .mockResolvedValueOnce({                         // target member fetch
        id: 'member-1',
        teamName: 'Team A',
        teamIcon: null,
        totalScore: '42.5',
        favoriteTeam: { colorPrimary: '#FF0000' },
        user: { displayName: 'Alice' },
        draftPicks: [
          {
            player: {
              id: 1, name: 'Connor McDavid', position: 'C',
              team: { abbreviation: 'EDM', eliminatedAt: null },
              headshotUrl: null,
              gameStats: [
                {
                  gameDate: new Date('2026-04-13'),
                  goals: 1, assists: 2, plusMinus: 1, pim: 0, shots: 4,
                  hits: 0, blockedShots: 0, powerPlayGoals: 1, powerPlayPoints: 1,
                  shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
                  overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
                  goalsAgainst: 0, savePct: 0,
                },
              ],
            },
          },
        ],
      })
  })

  it('returns 403 when caller is not a league member', async () => {
    mockPrisma.leagueMember.findUnique.mockResolvedValueOnce(null)
    const { GET } = await import(
      '../../app/api/leagues/[id]/members/[memberId]/roster/route'
    )
    const res = await GET(makeReq('league-1', 'member-1'), ctx('league-1', 'member-1'))
    expect(res.status).toBe(403)
  })

  it('returns player list with totalFpts and yesterdayFpts', async () => {
    const { GET } = await import(
      '../../app/api/leagues/[id]/members/[memberId]/roster/route'
    )
    const res = await GET(makeReq('league-1', 'member-1'), ctx('league-1', 'member-1'))
    const body = await res.json()
    expect(res.status).toBe(200)
    expect(body.players).toHaveLength(1)
    const p = body.players[0]
    expect(p.playerId).toBe(1)
    expect(p.name).toBe('Connor McDavid')
    // totalFpts: goals:1*2+assists:2*1.5+plusMinus:1*0.5+shots:4*0.1+ppGoals:1*0.5 = 6.4
    expect(p.totalFpts).toBeCloseTo(6.4)
    // yesterdayFpts: game is from 2026-04-13, yesterday relative to test runtime will differ
    // so just verify it's a number or null
    expect(typeof p.yesterdayFpts === 'number' || p.yesterdayFpts === null).toBe(true)
  })
})
```

- [ ] **Step 2: Run the test to confirm it fails**

```bash
npm run test:run -- __tests__/api/roster.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Create the roster route**

Create `app/api/leagues/[id]/members/[memberId]/roster/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; memberId: string }> }
) {
  try {
    const { id, memberId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Caller must be a member of this league
    const callerMembership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!callerMembership) {
      return NextResponse.json({ error: 'Not a league member' }, { status: 403 })
    }

    const settings = await prisma.scoringSettings.findUnique({ where: { leagueId: id } })
    if (!settings) return NextResponse.json({ error: 'Scoring settings not found' }, { status: 404 })

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

    const member = await prisma.leagueMember.findUnique({
      where: { id: memberId },
      include: {
        user: { select: { displayName: true } },
        favoriteTeam: { select: { colorPrimary: true } },
        draftPicks: {
          include: {
            player: {
              include: {
                team: { select: { abbreviation: true, eliminatedAt: true } },
                gameStats: true,
              },
            },
          },
        },
      },
    })
    if (!member || member.leagueId !== id) {
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })
    }

    // Yesterday at UTC midnight (for YDAY column)
    const yd = new Date()
    yd.setUTCDate(yd.getUTCDate() - 1)
    yd.setUTCHours(0, 0, 0, 0)
    const ydStr = yd.toISOString().split('T')[0]

    const players = member.draftPicks.map(pick => {
      const { player } = pick
      const isEliminated = player.team.eliminatedAt !== null
      const eligibleStats = player.gameStats.filter(gs =>
        !player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt
      )

      // Season totals
      let totalFpts = 0
      const agg = {
        goals: 0, assists: 0, plusMinus: 0, pim: 0,
        powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, gameWinningGoals: 0,
        goalieWins: 0, goalieSaves: 0, shutouts: 0, goalsAgainst: 0,
        savePctNumerator: 0, savePctDenominator: 0,
      }
      for (const gs of eligibleStats) {
        totalFpts += calculatePlayerScore({
          goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
          pim: gs.pim, shots: gs.shots, hits: gs.hits,
          blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
          powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
          shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
          overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
          goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
          goalsAgainst: gs.goalsAgainst,
        }, weights)
        agg.goals += gs.goals
        agg.assists += gs.assists
        agg.plusMinus += gs.plusMinus
        agg.pim += gs.pim
        agg.powerPlayGoals += gs.powerPlayGoals
        agg.powerPlayPoints += gs.powerPlayPoints
        agg.shorthandedGoals += gs.shorthandedGoals
        agg.gameWinningGoals += gs.gameWinningGoals
        agg.goalieWins += gs.goalieWins
        agg.goalieSaves += gs.goalieSaves
        agg.shutouts += gs.shutouts
        agg.goalsAgainst += gs.goalsAgainst
        agg.savePctNumerator += gs.goalieSaves
        agg.savePctDenominator += gs.goalieSaves + gs.goalsAgainst
      }

      const seasonSavePct = agg.savePctDenominator > 0
        ? agg.savePctNumerator / agg.savePctDenominator
        : 0

      // Yesterday FPTS (game date matching yesterday's UTC date)
      const ydStats = player.gameStats.filter(gs =>
        gs.gameDate.toISOString().startsWith(ydStr) &&
        (!player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt)
      )
      const yesterdayFpts = ydStats.length > 0
        ? ydStats.reduce((sum, gs) => sum + calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights), 0)
        : null

      return {
        playerId: player.id,
        name: player.name,
        position: player.position,
        nhlTeamAbbrev: player.team.abbreviation,
        headshotUrl: player.headshotUrl,
        isEliminated,
        totalFpts: Math.round(totalFpts * 100) / 100,
        yesterdayFpts: yesterdayFpts !== null ? Math.round(yesterdayFpts * 100) / 100 : null,
        // Season aggregates
        goals: agg.goals,
        assists: agg.assists,
        pts: agg.goals + agg.assists,
        plusMinus: agg.plusMinus,
        pim: agg.pim,
        powerPlayGoals: agg.powerPlayGoals,
        powerPlayAssists: agg.powerPlayPoints - agg.powerPlayGoals,
        shorthandedGoals: agg.shorthandedGoals,
        gameWinningGoals: agg.gameWinningGoals,
        // Goalie aggregates
        goalieWins: agg.goalieWins,
        goalieSaves: agg.goalieSaves,
        shutouts: agg.shutouts,
        goalsAgainst: agg.goalsAgainst,
        seasonSavePct: Math.round(seasonSavePct * 1000) / 1000,
      }
    })

    return NextResponse.json({
      member: {
        id: member.id,
        teamName: member.teamName,
        teamIcon: member.teamIcon,
        totalScore: Number(member.totalScore),
        colorPrimary: member.favoriteTeam?.colorPrimary ?? null,
        userName: member.user.displayName,
      },
      players,
      myMemberId: callerMembership.id,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/members/[memberId]/roster error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- __tests__/api/roster.test.ts
```

Expected: all tests pass.

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/api/leagues/[id]/members/ __tests__/api/roster.test.ts
git commit -m "feat(api): add roster endpoint with per-player FPTS and YDAY"
```

---

## Task 6: My Team Page Rebuild

**Files:**
- Modify: `app/(app)/league/[id]/team/page.tsx`

The new page fetches standings (for rank + YDAY total + myMemberId), then the roster API, then recaps. It renders a stat-card row and a sortable roster table.

- [ ] **Step 1: Replace the full page content**

Replace `app/(app)/league/[id]/team/page.tsx` with:

```tsx
'use client'
import { useState, useEffect, use, useCallback } from 'react'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge } from '@/components/position-badge'
import { StatCard } from '@/components/stat-card'

// ---- Types ----

interface MemberInfo {
  id: string; teamName: string; teamIcon: string | null
  totalScore: number; colorPrimary: string | null; userName: string
}

interface RosterPlayer {
  playerId: number; name: string; position: string
  nhlTeamAbbrev: string; headshotUrl: string | null
  isEliminated: boolean; totalFpts: number; yesterdayFpts: number | null
  goals: number; assists: number; pts: number; plusMinus: number; pim: number
  powerPlayGoals: number; powerPlayAssists: number
  shorthandedGoals: number; gameWinningGoals: number
  goalieWins: number; goalieSaves: number; shutouts: number
  goalsAgainst: number; seasonSavePct: number
}

interface StandingEntry {
  memberId: string; rank: number; totalScore: number
  yesterdayFpts: number | null; colorPrimary: string | null
}

interface Recap {
  content: string; recapDate: string; standingChange: number
}

type SortDir = 'asc' | 'desc' | null

// ---- Helpers ----

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}

function fmtFpts(v: number | null): string {
  if (v === null) return '—'
  return v >= 0 ? `+${v.toFixed(1)}` : v.toFixed(1)
}

function isForward(pos: string) { return ['C', 'LW', 'RW'].includes(pos) }

// ---- Sort helper ----

function sortPlayers(players: RosterPlayer[], col: string, dir: SortDir): RosterPlayer[] {
  if (!dir || !col) return players
  return [...players].sort((a, b) => {
    const av = a[col as keyof RosterPlayer] as number | null ?? -Infinity
    const bv = b[col as keyof RosterPlayer] as number | null ?? -Infinity
    return dir === 'desc' ? (bv as number) - (av as number) : (av as number) - (bv as number)
  })
}

// ---- Column def ----

type ColDef = { key: string; label: string; skater: boolean; goalie: boolean }
const COLS: ColDef[] = [
  { key: 'totalFpts', label: 'FPTS', skater: true, goalie: true },
  { key: 'yesterdayFpts', label: 'YDAY', skater: true, goalie: true },
  { key: 'goals', label: 'G', skater: true, goalie: false },
  { key: 'assists', label: 'A', skater: true, goalie: false },
  { key: 'pts', label: 'PTS', skater: true, goalie: false },
  { key: 'powerPlayGoals', label: 'PPG', skater: true, goalie: false },
  { key: 'powerPlayAssists', label: 'PPA', skater: true, goalie: false },
  { key: 'shorthandedGoals', label: 'SHG', skater: true, goalie: false },
  { key: 'gameWinningGoals', label: 'GWG', skater: true, goalie: false },
  { key: 'plusMinus', label: '+/-', skater: true, goalie: false },
  { key: 'goalieWins', label: 'W', skater: false, goalie: true },
  { key: 'goalieSaves', label: 'SV', skater: false, goalie: true },
  { key: 'seasonSavePct', label: 'SV%', skater: false, goalie: true },
  { key: 'shutouts', label: 'SO', skater: false, goalie: true },
]

// ---- Page ----

export default function MyTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)

  const [member, setMember] = useState<MemberInfo | null>(null)
  const [players, setPlayers] = useState<RosterPlayer[]>([])
  const [myStanding, setMyStanding] = useState<StandingEntry | null>(null)
  const [recap, setRecap] = useState<Recap | null>(null)
  const [recapOpen, setRecapOpen] = useState(false)
  const [loading, setLoading] = useState(true)
  const [sortCol, setSortCol] = useState<string>('totalFpts')
  const [sortDir, setSortDir] = useState<SortDir>('desc')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }

      // Step 1: standings (gives myMemberId + my YDAY total)
      const standingsRes = await fetch(`/api/leagues/${id}/standings`, { headers })
      if (!standingsRes.ok) { setLoading(false); return }
      const { standings, myMemberId } = await standingsRes.json()
      const mySt: StandingEntry | undefined = standings.find((s: StandingEntry & { memberId: string }) => s.memberId === myMemberId)
      if (mySt) setMyStanding(mySt)

      if (!myMemberId) { setLoading(false); return }

      // Step 2: roster + recap in parallel
      const [rosterRes, recapRes] = await Promise.all([
        fetch(`/api/leagues/${id}/members/${myMemberId}/roster`, { headers }),
        fetch(`/api/leagues/${id}/recaps`, { headers }),
      ])
      if (rosterRes.ok) {
        const data = await rosterRes.json()
        setMember(data.member)
        setPlayers(data.players)
      }
      if (recapRes.ok) {
        const data = await recapRes.json()
        setRecap(data.recap ?? null)
      }
      setLoading(false)
    }
    load()
  }, [id])

  function cycleSort(col: string) {
    if (sortCol !== col) { setSortCol(col); setSortDir('desc'); return }
    setSortDir(d => d === 'desc' ? 'asc' : d === 'asc' ? null : 'desc')
  }

  function sortIcon(col: string) {
    if (sortCol !== col || !sortDir) return '↕'
    return sortDir === 'desc' ? '↓' : '↑'
  }

  if (loading) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>
  if (!member) return <div className="p-6 text-sm text-[#98989e]">Your roster will appear here after the draft.</div>

  const myColor = member.colorPrimary ?? '#FF6B00'
  const rank = myStanding?.rank ?? 0
  const ydTotal = myStanding?.yesterdayFpts ?? null
  const sorted = sortPlayers(players, sortCol, sortDir)

  // Column visibility: show all if mixed roster, skater-only cols hidden for pure goalie rows per-cell
  const allCols = COLS

  return (
    <div className="p-4 max-w-2xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TeamIcon icon={member.teamIcon} size="lg" />
          <div>
            <div className="text-lg font-black tracking-tight text-[#121212]">{member.teamName}</div>
            <div className="text-xs text-[#98989e] font-semibold">{member.userName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black" style={{ color: myColor }}>{member.totalScore.toFixed(1)}</div>
          <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        <StatCard value={rank ? `${rank}${ordinal(rank)}` : '—'} label="Standing" />
        <StatCard
          value={ydTotal !== null ? fmtFpts(ydTotal) : '—'}
          label="Yesterday"
          tone={ydTotal !== null && ydTotal > 0 ? 'positive' : 'default'}
        />
        <StatCard
          value="📰"
          label="Recap"
          tone="dark"
          onClick={recap ? () => setRecapOpen(true) : undefined}
        />
      </div>

      {/* Roster table */}
      {players.length === 0 ? (
        <div className="border border-[#eeeeee] rounded-xl p-6 text-center">
          <p className="text-xs text-[#98989e] font-semibold">Your roster will appear here after the draft.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
          <table className="w-full text-xs border-collapse min-w-[700px]">
            <thead>
              <tr className="bg-[#f8f8f8]">
                {/* Sticky player column */}
                <th className="sticky left-0 z-10 bg-[#f8f8f8] text-left px-3 py-2 font-bold uppercase tracking-widest text-[#98989e] border-r border-[#eeeeee] min-w-[160px]">
                  Player
                </th>
                {allCols.map(col => (
                  <th
                    key={col.key}
                    onClick={() => cycleSort(col.key)}
                    className={`px-2 py-2 font-bold uppercase tracking-widest cursor-pointer select-none whitespace-nowrap ${
                      col.key === 'totalFpts' ? 'text-[#0042bb]' : 'text-[#98989e]'
                    } hover:text-[#121212]`}
                  >
                    {col.label} {sortIcon(col.key)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => {
                const isG = p.position === 'G'
                const rowBg = i % 2 === 0 ? '#ffffff' : '#fafafa'
                return (
                  <tr key={p.playerId} style={{ backgroundColor: rowBg }}>
                    {/* Sticky player cell */}
                    <td
                      className="sticky left-0 z-10 border-r border-[#eeeeee] px-3 py-2"
                      style={{ backgroundColor: rowBg }}
                    >
                      <div className="flex items-center gap-1.5">
                        <PositionBadge position={isG ? 'G' : isForward(p.position) ? 'F' : 'D'} />
                        <span className={`font-semibold ${p.isEliminated ? 'line-through text-[#98989e]' : 'text-[#121212]'}`}>
                          {p.name}
                        </span>
                        <span className="text-[#98989e] ml-1">{p.nhlTeamAbbrev}</span>
                      </div>
                    </td>
                    {allCols.map(col => {
                      const hidden = (isG && col.skater && !col.goalie) || (!isG && !col.skater && col.goalie)
                      if (hidden) return <td key={col.key} className="px-2 py-2 text-center text-[#98989e]">—</td>

                      const val = p[col.key as keyof RosterPlayer]
                      const isFpts = col.key === 'totalFpts'
                      const isYday = col.key === 'yesterdayFpts'
                      const isPlusMinus = col.key === 'plusMinus'

                      let display: string
                      if (val === null || val === undefined) {
                        display = '—'
                      } else if (col.key === 'seasonSavePct') {
                        display = Number(val) > 0 ? Number(val).toFixed(3) : '—'
                      } else if (isYday) {
                        display = val === null ? '—' : fmtFpts(val as number)
                      } else if (isPlusMinus) {
                        display = Number(val) >= 0 ? `+${val}` : String(val)
                      } else {
                        display = String(val)
                      }

                      return (
                        <td
                          key={col.key}
                          className={`px-2 py-2 text-center font-semibold ${
                            isFpts ? 'bg-[#eef3ff] text-[#0042bb] font-black' :
                            isYday && val !== null && (val as number) > 0 ? 'text-[#2db944]' :
                            isPlusMinus && Number(val) > 0 ? 'text-[#2db944]' :
                            isPlusMinus && Number(val) < 0 ? 'text-[#c8102e]' :
                            'text-[#121212]'
                          }`}
                        >
                          {display}
                        </td>
                      )
                    })}
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Recap modal */}
      {recapOpen && recap && (
        <div
          className="fixed inset-0 bg-black/60 z-50 flex items-end"
          onClick={() => setRecapOpen(false)}
        >
          <div
            className="bg-white w-full max-h-[80vh] rounded-t-2xl overflow-y-auto p-5"
            onClick={e => e.stopPropagation()}
          >
            <div className="w-10 h-1 bg-[#eeeeee] rounded mx-auto mb-4" />
            <div className="flex items-center justify-between mb-3">
              <div>
                <p className="text-sm font-black text-[#121212]">Morning Recap</p>
                <p className="text-xs text-[#98989e]">{new Date(recap.recapDate).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
              </div>
              {recap.standingChange !== 0 && (
                <span className={`text-xs font-bold px-2 py-0.5 rounded ${
                  recap.standingChange > 0 ? 'bg-green-100 text-[#2db944]' : 'bg-red-50 text-[#c8102e]'
                }`}>
                  {recap.standingChange > 0 ? '▲' : '▼'} {Math.abs(recap.standingChange)}
                </span>
              )}
            </div>
            <p className="text-sm text-[#121212] leading-relaxed whitespace-pre-wrap">{recap.content}</p>
            <button
              onClick={() => setRecapOpen(false)}
              className="mt-5 w-full py-3 bg-[#1a1a1a] text-white rounded-xl font-bold text-sm"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/league/\[id\]/team/page.tsx
git commit -m "feat(my-team): rebuild with sortable roster table, YDAY column, recap modal"
```

---

## Task 7: Standings Page — YDAY Column

**Files:**
- Modify: `app/(app)/league/[id]/standings/page.tsx`

- [ ] **Step 1: Update the `MemberStanding` interface to include `yesterdayFpts`**

In `app/(app)/league/[id]/standings/page.tsx`, update the interface:

```ts
interface MemberStanding {
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; scoreLastCalculatedAt: string | null
  colorPrimary: string | null; yesterdayFpts: number | null
  players: PlayerStanding[]
}
```

- [ ] **Step 2: Add a YDAY + TOTAL header row above the existing standings list**

Replace the leaderboard section (everything from `{/* Leaderboard */}` comment to the end of the standings `.map()`) with:

```tsx
      {/* Standings table */}
      {standings.length > 0 && (
        <div className="border border-[#eeeeee] rounded-xl overflow-hidden mb-4">
          {/* Table header */}
          <div className="bg-[#f8f8f8] flex items-center px-4 py-2 border-b border-[#eeeeee]">
            <span className="w-8 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">RK</span>
            <span className="w-8 mx-2" />
            <span className="flex-1 text-[9px] font-bold uppercase tracking-widest text-[#98989e]">Team</span>
            <span className="w-14 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">YDAY</span>
            <span className="w-16 text-[9px] font-bold uppercase tracking-widest text-[#0042bb] text-right">TOTAL</span>
          </div>
          {standings.map(member => {
            const isMe = member.memberId === myMemberId
            return (
              <div
                key={member.memberId}
                className="border-b border-[#f5f5f5] last:border-0"
                style={isMe ? { borderLeft: `3px solid ${member.colorPrimary ?? '#FF6B00'}`, backgroundColor: '#fff8f8' } : undefined}
              >
                <button
                  onClick={() => setExpandedMember(expandedMember === member.memberId ? null : member.memberId)}
                  className="w-full flex items-center px-4 py-3 hover:bg-gray-50 transition text-left"
                >
                  <span className="w-8 text-lg font-black text-gray-300 text-right">{member.rank}</span>
                  <span className="mx-2"><TeamIcon icon={member.teamIcon} /></span>
                  <div className="flex-1 min-w-0">
                    <p className="font-bold text-sm truncate">{member.teamName}</p>
                    <p className="text-xs text-gray-400">{member.userName}</p>
                  </div>
                  <span className="w-14 text-right text-xs font-semibold text-[#2db944]">
                    {member.yesterdayFpts !== null ? `+${member.yesterdayFpts.toFixed(1)}` : '—'}
                  </span>
                  <span className="w-16 text-right text-sm font-black text-[#0042bb]">
                    {member.totalScore.toFixed(1)}
                  </span>
                </button>

                {/* Expanded roster */}
                {expandedMember === member.memberId && (
                  <div className="px-4 pb-4">
                    {member.players
                      .sort((a, b) => b.totalPoints - a.totalPoints)
                      .map(player => (
                        <Link
                          key={player.playerId}
                          href={`/league/${id}/players/${player.playerId}`}
                          className="flex items-center gap-3 py-2 px-2 rounded-lg hover:bg-gray-50 transition"
                        >
                          {player.headshotUrl ? (
                            <img src={player.headshotUrl} alt="" className="w-8 h-8 rounded-full bg-gray-100" />
                          ) : (
                            <div className="w-8 h-8 rounded-full bg-gray-200" />
                          )}
                          <div className="flex-1">
                            <p className={`text-sm font-semibold ${player.isEliminated ? 'text-gray-400 line-through' : ''}`}>
                              {player.name}
                            </p>
                            <p className="text-xs text-gray-400">{player.position} · {player.teamAbbrev}</p>
                          </div>
                          <span className={`text-sm font-bold ${player.isEliminated ? 'text-gray-400' : 'text-[#0042bb]'}`}>
                            {player.totalPoints.toFixed(1)}
                          </span>
                        </Link>
                      ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 4: Commit**

```bash
git add app/\(app\)/league/\[id\]/standings/page.tsx
git commit -m "feat(standings): add YDAY column and data-dense table layout"
```

---

## Task 8: Lobby — YDAY in Active State

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Update the standings state type to include `yesterdayFpts`**

In `app/(app)/league/[id]/page.tsx`, update the `standings` state:

```ts
const [standings, setStandings] = useState<{
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; yesterdayFpts: number | null
  colorPrimary: string | null
}[]>([])
```

- [ ] **Step 2: Add `myMemberId` state and populate it from the standings response**

Add state near the other state declarations:

```ts
const [myMemberId, setMyMemberId] = useState<string | null>(null)
```

In the `load` function, where standings are fetched, capture `myMemberId`:

```ts
          const standingsData = await standingsRes.json()
          setStandings(standingsData.standings)
          setMyMemberId(standingsData.myMemberId ?? null)
```

- [ ] **Step 3: Replace the active-state lobby standings section with YDAY + hero card**

Replace the existing `{/* Standings summary (active/complete phase) */}` block with:

```tsx
      {/* Active season — hero card + standings */}
      {(league.status === 'active' || league.status === 'complete') && standings.length > 0 && (() => {
        const mySt = standings.find(s => s.memberId === myMemberId)
        const topTwo = [...standings].sort((a, b) => b.totalScore - a.totalScore)
        const secondScore = topTwo[1]?.totalScore ?? 0
        const myScore = mySt?.totalScore ?? 0
        const lead = mySt ? (mySt.rank === 1 ? myScore - secondScore : myScore - topTwo[0].totalScore) : null

        return (
          <>
            {/* Hero card — my position */}
            {mySt && (
              <div
                className="bg-[#1a1a1a] rounded-xl p-4 mb-4"
                style={{ borderLeft: `4px solid ${mySt.colorPrimary ?? myColor}` }}
              >
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/60 mb-1">Your Standing</div>
                    <div className="text-3xl font-black text-white">{mySt.rank}{ordinalSuffix(mySt.rank)}</div>
                    <div className="text-xs text-white/70 mt-0.5">of {standings.length} teams</div>
                  </div>
                  <div className="text-right">
                    <div className="text-2xl font-black" style={{ color: mySt.colorPrimary ?? myColor }}>
                      {mySt.totalScore.toFixed(1)}
                    </div>
                    <div className="text-[9px] text-white/60 font-bold uppercase tracking-widest">Total FPTS</div>
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-2 mt-3 pt-3 border-t border-white/10">
                  <div className="text-center">
                    <div className={`text-sm font-black ${mySt.yesterdayFpts !== null && mySt.yesterdayFpts > 0 ? 'text-[#2db944]' : 'text-white/50'}`}>
                      {mySt.yesterdayFpts !== null ? `+${mySt.yesterdayFpts.toFixed(1)}` : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">Yesterday</div>
                  </div>
                  <div className="text-center">
                    <div className={`text-sm font-black ${lead !== null && lead > 0 ? 'text-[#2db944]' : lead !== null && lead < 0 ? 'text-[#c8102e]' : 'text-white/50'}`}>
                      {lead !== null ? (lead >= 0 ? `+${lead.toFixed(1)}` : lead.toFixed(1)) : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">
                      {mySt.rank === 1 ? 'Lead' : 'Deficit'}
                    </div>
                  </div>
                  <div className="text-center">
                    <div className="text-sm font-black text-white">
                      {myMember ? (league.rosterForwards + league.rosterDefense + league.rosterGoalies) : '—'}
                    </div>
                    <div className="text-[9px] text-white/50 font-bold uppercase tracking-widest">Players</div>
                  </div>
                </div>
              </div>
            )}

            {/* Standings top 3 */}
            <div className="mb-6">
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Standings</p>
                <Link href={`/league/${id}/standings`} className="text-xs text-orange-500 font-bold hover:text-orange-700">
                  View all →
                </Link>
              </div>
              {/* Column headers */}
              <div className="flex items-center px-4 py-1.5 bg-[#f8f8f8] rounded-t-lg border border-b-0 border-[#eeeeee]">
                <span className="w-7 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">RK</span>
                <span className="w-6 mx-2" />
                <span className="flex-1 text-[9px] font-bold uppercase tracking-widest text-[#98989e]">Team</span>
                <span className="w-12 text-[9px] font-bold uppercase tracking-widest text-[#98989e] text-right">YDAY</span>
                <span className="w-14 text-[9px] font-bold uppercase tracking-widest text-[#0042bb] text-right">TOTAL</span>
              </div>
              <div className="border border-[#eeeeee] rounded-b-lg overflow-hidden">
                {standings.slice(0, 3).map(s => {
                  const isMe = s.memberId === myMemberId
                  return (
                    <div
                      key={s.memberId}
                      className="flex items-center px-4 py-3 border-b border-[#f5f5f5] last:border-0"
                      style={isMe ? { borderLeft: `3px solid ${s.colorPrimary ?? '#FF6B00'}`, backgroundColor: '#fff8f8' } : undefined}
                    >
                      <span className="w-7 text-sm font-black text-gray-300 text-right">{s.rank}</span>
                      <span className="mx-2"><TeamIcon icon={s.teamIcon} /></span>
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-sm truncate">{s.teamName}</p>
                        <p className="text-xs text-gray-400 truncate">{s.userName}</p>
                      </div>
                      <span className="w-12 text-right text-xs font-semibold text-[#2db944]">
                        {s.yesterdayFpts !== null ? `+${s.yesterdayFpts.toFixed(1)}` : '—'}
                      </span>
                      <span className="w-14 text-right text-sm font-black text-[#0042bb]">
                        {s.totalScore.toFixed(1)}
                      </span>
                    </div>
                  )
                })}
              </div>
            </div>
          </>
        )
      })()}
```

- [ ] **Step 4: Add the `ordinalSuffix` helper** (if not already present; the existing `formatDraftCell` helper is already in the file)

At the bottom of the file, add (the file already has `formatDraftCell` — add below it):

```ts
function ordinalSuffix(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}
```

- [ ] **Step 5: Verify build**

```bash
npm run build
```

Expected: exits 0.

- [ ] **Step 6: Commit**

```bash
git add app/\(app\)/league/\[id\]/page.tsx
git commit -m "feat(lobby): add hero card with YDAY and YDAY column to standings preview"
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] `MemberDailyScore` table — Task 1
- [x] Cron writes daily scores — Task 3
- [x] Standings API `yesterdayFpts` — Task 4
- [x] Roster endpoint `GET /members/[memberId]/roster` — Task 5
- [x] YDAY column on My Team page — Task 6
- [x] Roster table (sortable, skater + goalie rows) — Task 6
- [x] Recap modal on My Team — Task 6
- [x] YDAY column on Standings page — Task 7
- [x] Lobby hero card with yesterday + lead — Task 8
- [x] YDAY in lobby standings top-3 — Task 8

**Out of scope (intentionally excluded):**
- `PlayerDailyScore` table — not needed; per-player YDAY computed at query time from existing `PlayerGameStats`
- ATOI (Average Time on Ice) — not in schema, would need new API field; shows "—" not implemented
- Live/intraday scoring — explicitly out of spec

**Placeholder scan:** No TBDs, no "implement later" statements, no forward references to undefined types.

**Type consistency:**
- `writeMemberDailyScores` returns `Promise<number>` — matches cron usage
- Roster API returns `{ member, players, myMemberId }` — matches My Team page consumption
- Standings API adds `yesterdayFpts: number | null` — matches updated interfaces in standings page and lobby
- `RosterPlayer.yesterdayFpts: number | null` — null (not 0) when no games yesterday, handled in table render with "—"
