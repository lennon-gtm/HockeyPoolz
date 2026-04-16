# Scoring Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the scoring pipeline — NHL stat syncing, score calculation, team elimination, standings UI, and player detail views — so that after a draft completes, participants see live-updating scores and standings throughout the playoffs.

**Architecture:** A `StatsService` module handles all NHL API communication. A Vercel cron hits `/api/cron/sync-stats` twice daily (6am + 11am UTC), which syncs game stats, detects eliminations, and recalculates scores. Standings and player detail are served via API routes and rendered in client-side pages. Eliminated players are skipped during sync to reduce API load.

**Tech Stack:** Next.js 16.2.2 App Router, Prisma v7 with PrismaPg adapter, Neon PostgreSQL, NHL unofficial API (`api-web.nhle.com/v1`), Vitest

---

## Codebase Context

Before reading this plan, know that:
- Auth: every protected route calls `getBearerToken(request.headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`
- `lib/auth.ts` exports `verifyIdToken`, `getBearerToken`, `AuthError`
- `lib/prisma.ts` exports `prisma` (singleton PrismaClient with PrismaPg adapter)
- All API routes are in `app/api/`, all pages in `app/(app)/` (auth-protected) or `app/(auth)/` (public)
- Pages use `'use client'`, `use(params)` for dynamic route params, `useEffect` for data fetching
- Tests use Vitest: `describe`, `it`, `expect` — run with `npm run test:run`
- Prisma schema is at `prisma/schema.prisma`. Migrations: `npx prisma migrate dev --name <name>` (local), `DATABASE_URL=$DIRECT_URL npx prisma migrate deploy` (Neon production)
- The `DIRECT_URL` env var holds the non-pooled Neon connection string for migrations
- `proxy.ts` has a `PUBLIC_PATHS` array for unauthenticated routes
- Draft completion already sets `league.status = 'active'` (in `app/api/leagues/[id]/draft/pick/route.ts`)
- The scoring settings API already exists at `app/api/leagues/[id]/scoring/route.ts` with GET/PUT
- The scoring settings page at `app/(app)/league/[id]/settings/page.tsx` uses slider inputs
- NHL API base URL: `https://api-web.nhle.com/v1`

## File Structure

**New files:**
- `lib/stats-service.ts` — all NHL API integration, score calculation, elimination detection
- `__tests__/lib/stats-service.test.ts` — unit tests for score calculation and elimination filtering
- `app/api/cron/sync-stats/route.ts` — cron endpoint orchestrating the full sync pipeline
- `app/api/leagues/[id]/standings/route.ts` — standings with roster breakdown
- `app/api/leagues/[id]/players/[playerId]/route.ts` — player game log with weighted scores
- `app/api/admin/teams/[teamId]/eliminate/route.ts` — manual elimination fallback
- `app/(app)/league/[id]/standings/page.tsx` — full standings page
- `app/(app)/league/[id]/players/[playerId]/page.tsx` — player detail page

**Modified files:**
- `prisma/schema.prisma` — expand `ScoringSettings` (9 new fields) + `PlayerGameStats` (9 new fields)
- `app/api/leagues/[id]/scoring/route.ts` — add new fields to `allowedFields`
- `app/(app)/league/[id]/settings/page.tsx` — add new scoring categories to UI
- `app/(app)/league/[id]/page.tsx` — add standings summary when league status is `active`
- `vercel.json` — update cron schedules
- `proxy.ts` — add `/api/cron/` and `/api/admin/` to public paths (cron uses CRON_SECRET, admin uses its own auth)

---

## Task 1: Schema Migration — Expand ScoringSettings and PlayerGameStats

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add 9 new fields to ScoringSettings model**

In `prisma/schema.prisma`, add these fields to the `ScoringSettings` model after the existing `shutouts` field:

```prisma
  hits              Decimal @default(0.0) @db.Decimal(5, 2)
  blockedShots      Decimal @default(0.0) @db.Decimal(5, 2) @map("blocked_shots")
  powerPlayGoals    Decimal @default(0.5) @db.Decimal(5, 2) @map("power_play_goals")
  powerPlayPoints   Decimal @default(0.0) @db.Decimal(5, 2) @map("power_play_points")
  shorthandedGoals  Decimal @default(0.0) @db.Decimal(5, 2) @map("shorthanded_goals")
  shorthandedPoints Decimal @default(0.0) @db.Decimal(5, 2) @map("shorthanded_points")
  gameWinningGoals  Decimal @default(1.0) @db.Decimal(5, 2) @map("game_winning_goals")
  overtimeGoals     Decimal @default(1.0) @db.Decimal(5, 2) @map("overtime_goals")
  goalsAgainst      Decimal @default(0.0) @db.Decimal(5, 2) @map("goals_against")
```

- [ ] **Step 2: Add 9 new fields to PlayerGameStats model**

In `prisma/schema.prisma`, add these fields to the `PlayerGameStats` model after the existing `shutouts` field:

```prisma
  hits              Int      @default(0)
  blockedShots      Int      @default(0) @map("blocked_shots")
  powerPlayGoals    Int      @default(0) @map("power_play_goals")
  powerPlayPoints   Int      @default(0) @map("power_play_points")
  shorthandedGoals  Int      @default(0) @map("shorthanded_goals")
  shorthandedPoints Int      @default(0) @map("shorthanded_points")
  gameWinningGoals  Int      @default(0) @map("game_winning_goals")
  overtimeGoals     Int      @default(0) @map("overtime_goals")
  savePct           Decimal  @default(0) @db.Decimal(5, 4) @map("save_pct")
```

- [ ] **Step 3: Run the migration**

Run: `npx prisma migrate dev --name expand-scoring-and-stats`

Expected: Migration created successfully, Prisma Client regenerated.

- [ ] **Step 4: Verify by running existing tests**

Run: `npm run test:run`

Expected: All existing tests pass (schema changes are additive, no breaking changes).

- [ ] **Step 5: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: expand scoring settings and player game stats with 18 new fields"
```

---

## Task 2: Score Calculation — Pure Functions and Tests

**Files:**
- Create: `lib/stats-service.ts`
- Create: `__tests__/lib/stats-service.test.ts`

- [ ] **Step 1: Write the failing tests for score calculation**

Create `__tests__/lib/stats-service.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { calculatePlayerScore, calculateMemberScore } from '../../lib/stats-service'

const DEFAULT_WEIGHTS = {
  goals: 2.0, assists: 1.5, plusMinus: 0.5, pim: 0.0, shots: 0.1,
  hits: 0.0, blockedShots: 0.0, powerPlayGoals: 0.5, powerPlayPoints: 0.0,
  shorthandedGoals: 0.0, shorthandedPoints: 0.0, gameWinningGoals: 1.0,
  overtimeGoals: 1.0, goalieWins: 3.0, goalieSaves: 0.2, shutouts: 5.0,
  goalsAgainst: 0.0,
}

describe('calculatePlayerScore', () => {
  it('calculates weighted score for a skater game', () => {
    const gameStats = {
      goals: 2, assists: 1, plusMinus: 1, pim: 2, shots: 5,
      hits: 3, blockedShots: 1, powerPlayGoals: 1, powerPlayPoints: 1,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 1,
      overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
      goalsAgainst: 0,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // goals: 2*2.0=4.0, assists: 1*1.5=1.5, plusMinus: 1*0.5=0.5,
    // pim: 2*0.0=0, shots: 5*0.1=0.5, ppGoals: 1*0.5=0.5, gwg: 1*1.0=1.0
    expect(score).toBeCloseTo(8.0)
  })

  it('calculates weighted score for a goalie game', () => {
    const gameStats = {
      goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
      hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
      overtimeGoals: 0, goalieWins: 1, goalieSaves: 30, shutouts: 1,
      goalsAgainst: 0,
    }
    const score = calculatePlayerScore(gameStats, DEFAULT_WEIGHTS)
    // wins: 1*3.0=3.0, saves: 30*0.2=6.0, shutouts: 1*5.0=5.0
    expect(score).toBeCloseTo(14.0)
  })

  it('subtracts goalsAgainst when weight is set', () => {
    const gameStats = {
      goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
      hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
      shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
      overtimeGoals: 0, goalieWins: 1, goalieSaves: 25, shutouts: 0,
      goalsAgainst: 3,
    }
    const weights = { ...DEFAULT_WEIGHTS, goalsAgainst: 1.0 }
    const score = calculatePlayerScore(gameStats, weights)
    // wins: 3.0, saves: 5.0, goalsAgainst: -3*1.0=-3.0
    expect(score).toBeCloseTo(5.0)
  })

  it('returns zero when all weights are zero', () => {
    const gameStats = {
      goals: 5, assists: 3, plusMinus: 2, pim: 4, shots: 10,
      hits: 5, blockedShots: 2, powerPlayGoals: 2, powerPlayPoints: 3,
      shorthandedGoals: 1, shorthandedPoints: 1, gameWinningGoals: 1,
      overtimeGoals: 1, goalieWins: 0, goalieSaves: 0, shutouts: 0,
      goalsAgainst: 0,
    }
    const zeroWeights = Object.fromEntries(
      Object.keys(DEFAULT_WEIGHTS).map(k => [k, 0])
    ) as typeof DEFAULT_WEIGHTS
    expect(calculatePlayerScore(gameStats, zeroWeights)).toBe(0)
  })
})

describe('calculateMemberScore', () => {
  it('sums scores across multiple games for multiple players', () => {
    const playerGames = [
      // Player A game 1
      { goals: 1, assists: 0, plusMinus: 0, pim: 0, shots: 3,
        hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
        overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
        goalsAgainst: 0 },
      // Player A game 2
      { goals: 0, assists: 2, plusMinus: 1, pim: 0, shots: 2,
        hits: 0, blockedShots: 0, powerPlayGoals: 0, powerPlayPoints: 0,
        shorthandedGoals: 0, shorthandedPoints: 0, gameWinningGoals: 0,
        overtimeGoals: 0, goalieWins: 0, goalieSaves: 0, shutouts: 0,
        goalsAgainst: 0 },
    ]
    const total = calculateMemberScore(playerGames, DEFAULT_WEIGHTS)
    // Game 1: 1*2.0 + 3*0.1 = 2.3
    // Game 2: 2*1.5 + 1*0.5 + 2*0.1 = 3.7
    expect(total).toBeCloseTo(6.0)
  })

  it('returns zero for empty game list', () => {
    expect(calculateMemberScore([], DEFAULT_WEIGHTS)).toBe(0)
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:run -- __tests__/lib/stats-service.test.ts`

Expected: FAIL — `calculatePlayerScore` and `calculateMemberScore` not found.

- [ ] **Step 3: Implement the score calculation functions**

Create `lib/stats-service.ts`:

```typescript
/**
 * StatsService — all NHL API integration and score calculation.
 * No other file should call the NHL API directly.
 */

const NHL_API_BASE = 'https://api-web.nhle.com/v1'

// --- Types ---

export interface GameStats {
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  overtimeGoals: number
  goalieWins: number
  goalieSaves: number
  shutouts: number
  goalsAgainst: number
}

export interface ScoringWeights {
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  overtimeGoals: number
  goalieWins: number
  goalieSaves: number
  shutouts: number
  goalsAgainst: number
}

export interface SyncResult {
  gamesProcessed: number
  playersUpdated: number
  errors: string[]
}

// --- Pure scoring functions ---

/** Calculate the weighted score for a single player's single game. */
export function calculatePlayerScore(stats: GameStats, weights: ScoringWeights): number {
  return (
    stats.goals * weights.goals +
    stats.assists * weights.assists +
    stats.plusMinus * weights.plusMinus +
    stats.pim * weights.pim +
    stats.shots * weights.shots +
    stats.hits * weights.hits +
    stats.blockedShots * weights.blockedShots +
    stats.powerPlayGoals * weights.powerPlayGoals +
    stats.powerPlayPoints * weights.powerPlayPoints +
    stats.shorthandedGoals * weights.shorthandedGoals +
    stats.shorthandedPoints * weights.shorthandedPoints +
    stats.gameWinningGoals * weights.gameWinningGoals +
    stats.overtimeGoals * weights.overtimeGoals +
    stats.goalieWins * weights.goalieWins +
    stats.goalieSaves * weights.goalieSaves +
    stats.shutouts * weights.shutouts -
    stats.goalsAgainst * weights.goalsAgainst
  )
}

/** Sum weighted scores across all game stat rows for a member's roster. */
export function calculateMemberScore(games: GameStats[], weights: ScoringWeights): number {
  return games.reduce((total, game) => total + calculatePlayerScore(game, weights), 0)
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:run -- __tests__/lib/stats-service.test.ts`

Expected: All 6 tests PASS.

- [ ] **Step 5: Commit**

```bash
git add lib/stats-service.ts __tests__/lib/stats-service.test.ts
git commit -m "feat: add score calculation pure functions with tests"
```

---

## Task 3: NHL API Fetch Functions

**Files:**
- Modify: `lib/stats-service.ts`

- [ ] **Step 1: Add the NHL API fetch functions**

Append to `lib/stats-service.ts` after the pure scoring functions:

```typescript
// --- NHL API fetch functions ---

interface NhlGameSummary {
  id: number
  gameType: number
  gameState: string
  awayTeam: { abbrev: string; score: number }
  homeTeam: { abbrev: string; score: number }
}

interface NhlBoxScorePlayer {
  playerId: number
  goals: number
  assists: number
  plusMinus: number
  pim: number
  sog: number
  hits: number
  blockedShots: number
  powerPlayGoals: number
  decision?: string   // goalies: "W" or "L"
  saves?: number      // goalies
  goalsAgainst?: number // goalies
  savePctg?: number   // goalies
  starter?: boolean   // goalies
}

interface NhlGameLogEntry {
  gameId: number
  gameDate: string
  goals: number
  assists: number
  plusMinus: number
  pim: number
  shots: number
  powerPlayGoals: number
  powerPlayPoints: number
  shorthandedGoals: number
  shorthandedPoints: number
  gameWinningGoals: number
  otGoals: number
  // Goalie-specific
  shotsAgainst?: number
  goalsAgainst?: number
  shutouts?: number
  decision?: string
}

/** Fetch completed playoff games for a given date. */
export async function fetchCompletedPlayoffGames(date: string): Promise<NhlGameSummary[]> {
  const res = await fetch(`${NHL_API_BASE}/score/${date}`)
  if (!res.ok) throw new Error(`NHL API /score/${date} returned ${res.status}`)
  const data = await res.json()
  return (data.games ?? []).filter(
    (g: NhlGameSummary) => g.gameType === 3 && g.gameState === 'OFF'
  )
}

/** Fetch box score for a single game. Returns all players with their stats. */
export async function fetchBoxScore(gameId: number): Promise<{
  skaters: NhlBoxScorePlayer[]
  goalies: NhlBoxScorePlayer[]
}> {
  const res = await fetch(`${NHL_API_BASE}/gamecenter/${gameId}/boxscore`)
  if (!res.ok) throw new Error(`NHL API boxscore/${gameId} returned ${res.status}`)
  const data = await res.json()

  const stats = data.playerByGameStats
  const skaters: NhlBoxScorePlayer[] = []
  const goalies: NhlBoxScorePlayer[] = []

  for (const side of ['awayTeam', 'homeTeam']) {
    const team = stats?.[side]
    if (!team) continue
    for (const group of ['forwards', 'defense']) {
      for (const p of team[group] ?? []) {
        skaters.push(p)
      }
    }
    for (const p of team.goalies ?? []) {
      goalies.push(p)
    }
  }

  return { skaters, goalies }
}

/** Fetch a player's playoff game log for extended stats. */
export async function fetchPlayerGameLog(playerId: number, season: string = '20252026'): Promise<NhlGameLogEntry[]> {
  const res = await fetch(`${NHL_API_BASE}/player/${playerId}/game-log/${season}/3`)
  if (!res.ok) throw new Error(`NHL API game-log/${playerId} returned ${res.status}`)
  const data = await res.json()
  return data.gameLog ?? []
}

/** Fetch playoff bracket to detect eliminated teams. */
export async function fetchPlayoffBracket(year: number = 2026): Promise<{ losingTeamId: number; losingTeamAbbrev: string }[]> {
  const res = await fetch(`${NHL_API_BASE}/playoff-bracket/${year}`)
  if (!res.ok) throw new Error(`NHL API playoff-bracket/${year} returned ${res.status}`)
  const data = await res.json()

  const eliminated: { losingTeamId: number; losingTeamAbbrev: string }[] = []
  for (const series of data.series ?? []) {
    if (series.losingTeamId) {
      // The losing team could be top or bottom seed
      const loser = series.topSeedTeam?.id === series.losingTeamId
        ? series.topSeedTeam
        : series.bottomSeedTeam
      eliminated.push({
        losingTeamId: series.losingTeamId,
        losingTeamAbbrev: loser?.abbrev ?? 'UNK',
      })
    }
  }
  return eliminated
}

/** Fetch current roster for a team. */
export async function fetchTeamRoster(teamAbbrev: string): Promise<{
  id: number; firstName: string; lastName: string; positionCode: string; headshot: string
}[]> {
  const res = await fetch(`${NHL_API_BASE}/roster/${teamAbbrev}/current`)
  if (!res.ok) throw new Error(`NHL API roster/${teamAbbrev} returned ${res.status}`)
  const data = await res.json()

  const players: { id: number; firstName: string; lastName: string; positionCode: string; headshot: string }[] = []
  for (const group of ['forwards', 'defensemen', 'goalies']) {
    for (const p of data[group] ?? []) {
      players.push({
        id: p.id,
        firstName: p.firstName?.default ?? p.firstName ?? '',
        lastName: p.lastName?.default ?? p.lastName ?? '',
        positionCode: p.positionCode,
        headshot: p.headshot ?? '',
      })
    }
  }
  return players
}
```

- [ ] **Step 2: Commit**

```bash
git add lib/stats-service.ts
git commit -m "feat: add NHL API fetch functions for stats, bracket, and rosters"
```

---

## Task 4: Database Sync Functions

**Files:**
- Modify: `lib/stats-service.ts`

- [ ] **Step 1: Add the database sync orchestration functions**

Append to `lib/stats-service.ts`:

```typescript
import { prisma } from './prisma'

// --- Database sync functions ---

/** Map NHL API position code to Prisma Position enum. */
function mapPosition(code: string): 'C' | 'LW' | 'RW' | 'D' | 'G' {
  const map: Record<string, 'C' | 'LW' | 'RW' | 'D' | 'G'> = {
    C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G',
  }
  return map[code] ?? 'C'
}

/** Sync rosters for all non-eliminated teams. */
export async function syncRosters(): Promise<{ teamsUpdated: number; playersUpserted: number }> {
  const teams = await prisma.nhlTeam.findMany({
    where: { eliminatedAt: null },
    select: { id: true, abbreviation: true },
  })

  let playersUpserted = 0
  for (const team of teams) {
    try {
      const roster = await fetchTeamRoster(team.abbreviation)
      for (const p of roster) {
        await prisma.nhlPlayer.upsert({
          where: { id: p.id },
          update: {
            name: `${p.firstName} ${p.lastName}`,
            position: mapPosition(p.positionCode),
            headshotUrl: p.headshot || null,
            teamId: team.id,
            isActive: true,
          },
          create: {
            id: p.id,
            teamId: team.id,
            name: `${p.firstName} ${p.lastName}`,
            position: mapPosition(p.positionCode),
            headshotUrl: p.headshot || null,
            isActive: true,
          },
        })
        playersUpserted++
      }
    } catch (err) {
      console.error(`Failed to sync roster for ${team.abbreviation}:`, err)
    }
  }

  return { teamsUpdated: teams.length, playersUpserted }
}

/** Get all drafted player IDs across active leagues, excluding eliminated teams. */
async function getDraftedPlayerIds(): Promise<Set<number>> {
  const picks = await prisma.draftPick.findMany({
    where: {
      draft: { league: { status: 'active' } },
      player: { team: { eliminatedAt: null } },
    },
    select: { playerId: true },
    distinct: ['playerId'],
  })
  return new Set(picks.map(p => p.playerId))
}

/** Sync game stats for a given date. */
export async function syncGameStats(date: string): Promise<SyncResult> {
  const result: SyncResult = { gamesProcessed: 0, playersUpdated: 0, errors: [] }

  let games: NhlGameSummary[]
  try {
    games = await fetchCompletedPlayoffGames(date)
  } catch (err) {
    result.errors.push(`Failed to fetch games for ${date}: ${err}`)
    return result
  }

  const draftedPlayerIds = await getDraftedPlayerIds()

  for (const game of games) {
    try {
      const { skaters, goalies } = await fetchBoxScore(game.id)

      // Upsert skater stats from box score
      for (const s of skaters) {
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: s.playerId, gameId: String(game.id) } },
          update: {
            goals: s.goals ?? 0,
            assists: s.assists ?? 0,
            plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0,
            shots: s.sog ?? 0,
            hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0,
            powerPlayGoals: s.powerPlayGoals ?? 0,
          },
          create: {
            playerId: s.playerId,
            gameId: String(game.id),
            gameDate: new Date(date),
            goals: s.goals ?? 0,
            assists: s.assists ?? 0,
            plusMinus: s.plusMinus ?? 0,
            pim: s.pim ?? 0,
            shots: s.sog ?? 0,
            hits: s.hits ?? 0,
            blockedShots: s.blockedShots ?? 0,
            powerPlayGoals: s.powerPlayGoals ?? 0,
          },
        })
        result.playersUpdated++
      }

      // Upsert goalie stats from box score
      for (const g of goalies) {
        await prisma.playerGameStats.upsert({
          where: { playerId_gameId: { playerId: g.playerId, gameId: String(game.id) } },
          update: {
            goalieWins: g.decision === 'W' ? 1 : 0,
            goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
          create: {
            playerId: g.playerId,
            gameId: String(game.id),
            gameDate: new Date(date),
            goalieWins: g.decision === 'W' ? 1 : 0,
            goalieSaves: g.saves ?? 0,
            goalsAgainst: g.goalsAgainst ?? 0,
            shutouts: (g.goalsAgainst === 0 && g.starter) ? 1 : 0,
            savePct: g.savePctg ? Number(g.savePctg) : 0,
          },
        })
        result.playersUpdated++
      }

      result.gamesProcessed++
    } catch (err) {
      result.errors.push(`Failed to process game ${game.id}: ${err}`)
    }
  }

  // Fetch extended stats from player game logs for drafted players only
  for (const playerId of draftedPlayerIds) {
    try {
      const gameLog = await fetchPlayerGameLog(playerId)
      for (const entry of gameLog) {
        // Only update rows that already exist from box score processing
        const existing = await prisma.playerGameStats.findUnique({
          where: { playerId_gameId: { playerId, gameId: String(entry.gameId) } },
        })
        if (existing) {
          await prisma.playerGameStats.update({
            where: { playerId_gameId: { playerId, gameId: String(entry.gameId) } },
            data: {
              powerPlayPoints: entry.powerPlayPoints ?? 0,
              shorthandedGoals: entry.shorthandedGoals ?? 0,
              shorthandedPoints: entry.shorthandedPoints ?? 0,
              gameWinningGoals: entry.gameWinningGoals ?? 0,
              overtimeGoals: entry.otGoals ?? 0,
              // Also update shutouts from game log (more reliable than derivation)
              ...(entry.shutouts !== undefined ? { shutouts: entry.shutouts } : {}),
            },
          })
        }
      }
    } catch (err) {
      result.errors.push(`Failed to fetch game log for player ${playerId}: ${err}`)
    }
  }

  return result
}

/** Check the playoff bracket and mark eliminated teams. */
export async function checkEliminations(): Promise<string[]> {
  const bracket = await fetchPlayoffBracket()
  const newlyEliminated: string[] = []

  for (const entry of bracket) {
    // Find team by matching the NHL API team ID — nhl_teams uses abbreviation as id
    const team = await prisma.nhlTeam.findFirst({
      where: {
        abbreviation: entry.losingTeamAbbrev,
        eliminatedAt: null,
      },
    })
    if (team) {
      await prisma.nhlTeam.update({
        where: { id: team.id },
        data: { eliminatedAt: new Date() },
      })
      newlyEliminated.push(team.abbreviation)
    }
  }

  return newlyEliminated
}

/** Recalculate scores for all members in a league. */
export async function recalculateScores(leagueId: string): Promise<void> {
  const settings = await prisma.scoringSettings.findUnique({ where: { leagueId } })
  if (!settings) return

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

  const members = await prisma.leagueMember.findMany({
    where: { leagueId },
    include: {
      draftPicks: {
        include: {
          player: {
            include: { team: { select: { eliminatedAt: true } } },
          },
        },
      },
    },
  })

  for (const member of members) {
    const allGameStats: GameStats[] = []

    for (const pick of member.draftPicks) {
      const eliminatedAt = pick.player.team.eliminatedAt
      const gameStats = await prisma.playerGameStats.findMany({
        where: {
          playerId: pick.playerId,
          // Only count games before elimination
          ...(eliminatedAt ? { gameDate: { lte: eliminatedAt } } : {}),
        },
      })

      for (const gs of gameStats) {
        allGameStats.push({
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

    const totalScore = calculateMemberScore(allGameStats, weights)

    await prisma.leagueMember.update({
      where: { id: member.id },
      data: {
        totalScore,
        scoreLastCalculatedAt: new Date(),
      },
    })
  }
}
```

- [ ] **Step 2: Move the prisma import to the top of the file**

The `import { prisma } from './prisma'` line needs to be at the top of the file, alongside any other imports. Move it to line 7 (after the module docstring comment).

- [ ] **Step 3: Run all tests**

Run: `npm run test:run`

Expected: All tests pass (the sync functions use prisma but the tests only test pure functions).

- [ ] **Step 4: Commit**

```bash
git add lib/stats-service.ts
git commit -m "feat: add NHL API sync, elimination detection, and score recalculation"
```

---

## Task 5: Cron Sync Endpoint

**Files:**
- Create: `app/api/cron/sync-stats/route.ts`
- Modify: `vercel.json`
- Modify: `proxy.ts`

- [ ] **Step 1: Create the cron sync route**

Create `app/api/cron/sync-stats/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { syncRosters, syncGameStats, checkEliminations, recalculateScores } from '@/lib/stats-service'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest) {
  // Verify cron secret
  const authHeader = request.headers.get('authorization')
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  try {
    // Sync dates: yesterday and today (UTC)
    const now = new Date()
    const yesterday = new Date(now)
    yesterday.setUTCDate(yesterday.getUTCDate() - 1)

    const formatDate = (d: Date) => d.toISOString().split('T')[0]
    const dates = [formatDate(yesterday), formatDate(now)]

    // 1. Refresh rosters for non-eliminated teams
    const rosterResult = await syncRosters()

    // 2. Sync game stats for both dates
    const statsResults = []
    for (const date of dates) {
      const result = await syncGameStats(date)
      statsResults.push({ date, ...result })
    }

    // 3. Check for newly eliminated teams
    const newEliminations = await checkEliminations()

    // 4. Recalculate scores for all active leagues
    const activeLeagues = await prisma.league.findMany({
      where: { status: 'active' },
      select: { id: true },
    })
    for (const league of activeLeagues) {
      await recalculateScores(league.id)
    }

    return NextResponse.json({
      success: true,
      rosters: rosterResult,
      stats: statsResults,
      eliminations: newEliminations,
      leaguesScored: activeLeagues.length,
    })
  } catch (error) {
    console.error('Cron sync-stats error:', error)
    return NextResponse.json({ error: 'Sync failed', details: String(error) }, { status: 500 })
  }
}
```

- [ ] **Step 2: Update vercel.json cron schedules**

Replace the contents of `vercel.json`:

```json
{
  "crons": [
    { "path": "/api/cron/sync-stats", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-stats", "schedule": "0 11 * * *" },
    { "path": "/api/cron/generate-recaps", "schedule": "30 11 * * *" }
  ]
}
```

- [ ] **Step 3: Add cron and admin paths to proxy.ts**

In `proxy.ts`, add `/api/cron/` and `/api/admin/` to the `PUBLIC_PATHS` array. These routes handle their own auth (CRON_SECRET and isPlatformAdmin respectively), so they should bypass the Firebase token check:

```typescript
const PUBLIC_PATHS = ['/login', '/join', '/api/auth/me', '/api/nhl-teams', '/api/cron/', '/api/admin/']
```

Note: The proxy checks `pathname.startsWith(path)` for each public path, so `/api/cron/` will match `/api/cron/sync-stats`. Verify this is how the proxy matches — if it uses exact match, use the full path instead.

- [ ] **Step 4: Commit**

```bash
git add app/api/cron/sync-stats/route.ts vercel.json proxy.ts
git commit -m "feat: add cron sync-stats endpoint with dual daily schedule"
```

---

## Task 6: Admin Elimination Fallback Endpoint

**Files:**
- Create: `app/api/admin/teams/[teamId]/eliminate/route.ts`

- [ ] **Step 1: Create the admin elimination route**

Create `app/api/admin/teams/[teamId]/eliminate/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(request: NextRequest, { params }: { params: Promise<{ teamId: string }> }) {
  try {
    const { teamId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user?.isPlatformAdmin) {
      return NextResponse.json({ error: 'Admin access required' }, { status: 403 })
    }

    const body = await request.json()
    const eliminatedAt = body.eliminatedAt ? new Date(body.eliminatedAt) : null

    const team = await prisma.nhlTeam.update({
      where: { id: teamId },
      data: { eliminatedAt },
    })

    return NextResponse.json({
      team: { id: team.id, abbreviation: team.abbreviation, eliminatedAt: team.eliminatedAt },
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/admin/teams/[teamId]/eliminate error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/admin/teams/[teamId]/eliminate/route.ts
git commit -m "feat: add admin endpoint for manual team elimination"
```

---

## Task 7: Update Scoring Settings API and UI

**Files:**
- Modify: `app/api/leagues/[id]/scoring/route.ts`
- Modify: `app/(app)/league/[id]/settings/page.tsx`

- [ ] **Step 1: Expand allowedFields in the scoring API**

In `app/api/leagues/[id]/scoring/route.ts`, replace the `allowedFields` array:

```typescript
    const allowedFields = [
      'goals', 'assists', 'plusMinus', 'pim', 'shots',
      'goalieWins', 'goalieSaves', 'shutouts',
      'hits', 'blockedShots', 'powerPlayGoals', 'powerPlayPoints',
      'shorthandedGoals', 'shorthandedPoints', 'gameWinningGoals',
      'overtimeGoals', 'goalsAgainst',
    ]
```

- [ ] **Step 2: Update the scoring settings page with new categories**

In `app/(app)/league/[id]/settings/page.tsx`, replace the `ScoringSettings` interface and `FIELD_LABELS`:

```typescript
interface ScoringSettings {
  goals: number; assists: number; plusMinus: number; pim: number
  shots: number; goalieWins: number; goalieSaves: number; shutouts: number
  hits: number; blockedShots: number; powerPlayGoals: number; powerPlayPoints: number
  shorthandedGoals: number; shorthandedPoints: number; gameWinningGoals: number
  overtimeGoals: number; goalsAgainst: number
}

const SKATER_LABELS: Record<string, string> = {
  goals: 'Goals', assists: 'Assists', plusMinus: '+/-', pim: 'Penalty Minutes',
  shots: 'Shots on Goal', hits: 'Hits', blockedShots: 'Blocked Shots',
  powerPlayGoals: 'Power Play Goals', powerPlayPoints: 'Power Play Points',
  shorthandedGoals: 'Shorthanded Goals', shorthandedPoints: 'Shorthanded Points',
  gameWinningGoals: 'Game-Winning Goals', overtimeGoals: 'Overtime Goals',
}

const GOALIE_LABELS: Record<string, string> = {
  goalieWins: 'Wins', goalieSaves: 'Saves', shutouts: 'Shutouts',
  goalsAgainst: 'Goals Against (penalty)',
}
```

Then replace the slider rendering section (the `Object.keys(FIELD_LABELS)` map) with two sections:

```tsx
      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Skater Categories</p>
      {Object.entries(SKATER_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold">{label}</label>
            <span className="text-sm font-bold text-orange-500">{Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts</span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            className="w-full accent-orange-500"
          />
        </div>
      ))}

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 mt-8">Goalie Categories</p>
      {Object.entries(GOALIE_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold">{label}</label>
            <span className="text-sm font-bold text-orange-500">{Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts</span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            className="w-full accent-orange-500"
          />
        </div>
      ))}
```

- [ ] **Step 3: Run all tests**

Run: `npm run test:run`

Expected: All tests pass.

- [ ] **Step 4: Commit**

```bash
git add app/api/leagues/[id]/scoring/route.ts app/(app)/league/[id]/settings/page.tsx
git commit -m "feat: expand scoring settings to 17 configurable categories"
```

---

## Task 8: Standings API Endpoint

**Files:**
- Create: `app/api/leagues/[id]/standings/route.ts`

- [ ] **Step 1: Create the standings route**

Create `app/api/leagues/[id]/standings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Verify membership
    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

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

    const members = await prisma.leagueMember.findMany({
      where: { leagueId: id },
      include: {
        user: { select: { displayName: true } },
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
      orderBy: { totalScore: 'desc' },
    })

    const standings = members.map((member, index) => {
      const players = member.draftPicks.map(pick => {
        const isEliminated = pick.player.team.eliminatedAt !== null
        const eligibleStats = pick.player.gameStats.filter(gs =>
          !pick.player.team.eliminatedAt || gs.gameDate <= pick.player.team.eliminatedAt
        )

        // Aggregate stats across all games
        const totals: Record<string, number> = {}
        const statFields = [
          'goals', 'assists', 'plusMinus', 'pim', 'shots', 'hits', 'blockedShots',
          'powerPlayGoals', 'powerPlayPoints', 'shorthandedGoals', 'shorthandedPoints',
          'gameWinningGoals', 'overtimeGoals', 'goalieWins', 'goalieSaves', 'shutouts', 'goalsAgainst',
        ]
        for (const field of statFields) {
          totals[field] = eligibleStats.reduce((sum, gs) => sum + (gs[field as keyof typeof gs] as number ?? 0), 0)
        }

        const totalPoints = eligibleStats.reduce(
          (sum, gs) => sum + calculatePlayerScore({
            goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
            pim: gs.pim, shots: gs.shots, hits: gs.hits,
            blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
            powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
            shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
            overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
            goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
            goalsAgainst: gs.goalsAgainst,
          }, weights),
          0
        )

        return {
          playerId: pick.player.id,
          name: pick.player.name,
          position: pick.player.position,
          teamAbbrev: pick.player.team.abbreviation,
          headshotUrl: pick.player.headshotUrl,
          totalPoints: Math.round(totalPoints * 100) / 100,
          isEliminated,
          stats: totals,
        }
      })

      return {
        rank: index + 1,
        memberId: member.id,
        teamName: member.teamName,
        teamIcon: member.teamIcon,
        userName: member.user.displayName,
        totalScore: Number(member.totalScore),
        scoreLastCalculatedAt: member.scoreLastCalculatedAt,
        players,
      }
    })

    return NextResponse.json({ standings, scoringSettings: settings })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/standings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/[id]/standings/route.ts
git commit -m "feat: add standings API with player roster breakdown"
```

---

## Task 9: Player Detail API Endpoint

**Files:**
- Create: `app/api/leagues/[id]/players/[playerId]/route.ts`

- [ ] **Step 1: Create the player detail route**

Create `app/api/leagues/[id]/players/[playerId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { calculatePlayerScore, type ScoringWeights } from '@/lib/stats-service'

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const { id, playerId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const membership = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: id, userId: user.id } },
    })
    if (!membership) return NextResponse.json({ error: 'Not a league member' }, { status: 403 })

    const playerIdNum = parseInt(playerId, 10)
    if (isNaN(playerIdNum)) return NextResponse.json({ error: 'Invalid player ID' }, { status: 400 })

    const player = await prisma.nhlPlayer.findUnique({
      where: { id: playerIdNum },
      include: {
        team: { select: { id: true, abbreviation: true, name: true, eliminatedAt: true } },
        gameStats: { orderBy: { gameDate: 'desc' } },
      },
    })
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

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

    const eligibleStats = player.gameStats.filter(gs =>
      !player.team.eliminatedAt || gs.gameDate <= player.team.eliminatedAt
    )

    // Build totals
    const statFields = [
      'goals', 'assists', 'plusMinus', 'pim', 'shots', 'hits', 'blockedShots',
      'powerPlayGoals', 'powerPlayPoints', 'shorthandedGoals', 'shorthandedPoints',
      'gameWinningGoals', 'overtimeGoals', 'goalieWins', 'goalieSaves', 'shutouts', 'goalsAgainst',
    ] as const
    const totals: Record<string, number> = {}
    for (const field of statFields) {
      totals[field] = eligibleStats.reduce((sum, gs) => sum + (gs[field] as number ?? 0), 0)
    }

    const weightedTotal = eligibleStats.reduce((sum, gs) => {
      const gameStats = {
        goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
        pim: gs.pim, shots: gs.shots, hits: gs.hits,
        blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
        powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
        shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
        overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
        goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
        goalsAgainst: gs.goalsAgainst,
      }
      return sum + calculatePlayerScore(gameStats, weights)
    }, 0)

    const gameLog = eligibleStats.map(gs => {
      const gameStats = {
        goals: gs.goals, assists: gs.assists, plusMinus: gs.plusMinus,
        pim: gs.pim, shots: gs.shots, hits: gs.hits,
        blockedShots: gs.blockedShots, powerPlayGoals: gs.powerPlayGoals,
        powerPlayPoints: gs.powerPlayPoints, shorthandedGoals: gs.shorthandedGoals,
        shorthandedPoints: gs.shorthandedPoints, gameWinningGoals: gs.gameWinningGoals,
        overtimeGoals: gs.overtimeGoals, goalieWins: gs.goalieWins,
        goalieSaves: gs.goalieSaves, shutouts: gs.shutouts,
        goalsAgainst: gs.goalsAgainst,
      }
      return {
        gameId: gs.gameId,
        gameDate: gs.gameDate.toISOString().split('T')[0],
        stats: gameStats,
        weightedScore: Math.round(calculatePlayerScore(gameStats, weights) * 100) / 100,
      }
    })

    return NextResponse.json({
      player: {
        id: player.id,
        name: player.name,
        position: player.position,
        team: {
          abbreviation: player.team.abbreviation,
          name: player.team.name,
          isEliminated: player.team.eliminatedAt !== null,
        },
        headshotUrl: player.headshotUrl,
        totals: { ...totals, weightedTotal: Math.round(weightedTotal * 100) / 100 },
        gameLog,
      },
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/players/[playerId] error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/[id]/players/[playerId]/route.ts
git commit -m "feat: add player detail API with game log and weighted scores"
```

---

## Task 10: Full Standings Page UI

**Files:**
- Create: `app/(app)/league/[id]/standings/page.tsx`

- [ ] **Step 1: Create the standings page**

Create `app/(app)/league/[id]/standings/page.tsx`:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface PlayerStanding {
  playerId: number; name: string; position: string; teamAbbrev: string
  headshotUrl: string | null; totalPoints: number; isEliminated: boolean
  stats: Record<string, number>
}
interface MemberStanding {
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; scoreLastCalculatedAt: string | null
  players: PlayerStanding[]
}
interface ScoringSettings {
  [key: string]: number
}

export default function StandingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [standings, setStandings] = useState<MemberStanding[]>([])
  const [scoringSettings, setScoringSettings] = useState<ScoringSettings | null>(null)
  const [expandedMember, setExpandedMember] = useState<string | null>(null)
  const [showSettings, setShowSettings] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in.'); return }
        const res = await fetch(`/api/leagues/${id}/standings`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setError('Failed to load standings.'); return }
        const data = await res.json()
        setStandings(data.standings)
        setScoringSettings(data.scoringSettings)
      } catch {
        setError('Failed to load standings.')
      }
    }
    load()
  }, [id])

  const lastUpdated = standings[0]?.scoreLastCalculatedAt
    ? new Date(standings[0].scoreLastCalculatedAt).toLocaleString()
    : null

  const SETTING_LABELS: Record<string, string> = {
    goals: 'Goals', assists: 'Assists', plusMinus: '+/-', pim: 'PIM',
    shots: 'Shots', hits: 'Hits', blockedShots: 'Blocked Shots',
    powerPlayGoals: 'PP Goals', powerPlayPoints: 'PP Points',
    shorthandedGoals: 'SH Goals', shorthandedPoints: 'SH Points',
    gameWinningGoals: 'GWG', overtimeGoals: 'OT Goals',
    goalieWins: 'Wins', goalieSaves: 'Saves', shutouts: 'Shutouts',
    goalsAgainst: 'GA (penalty)',
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-2xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">
        ← Back
      </button>
      <h1 className="text-2xl font-black tracking-widest mb-1">Standings</h1>
      {lastUpdated && (
        <p className="text-xs text-gray-400 mb-6">Last updated: {lastUpdated}</p>
      )}
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Scoring settings collapsible */}
      {scoringSettings && (
        <div className="mb-6">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="text-xs text-orange-500 font-bold hover:text-orange-700"
          >
            {showSettings ? 'Hide' : 'Show'} Scoring Weights
          </button>
          {showSettings && (
            <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600 bg-gray-50 rounded-lg p-3">
              {Object.entries(SETTING_LABELS).map(([key, label]) => {
                const val = Number(scoringSettings[key] ?? 0)
                if (val === 0) return null
                return (
                  <div key={key} className="flex justify-between">
                    <span>{label}</span>
                    <span className="font-bold text-orange-500">{val.toFixed(1)}</span>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* Leaderboard */}
      {standings.map(member => (
        <div key={member.memberId} className="border-b border-gray-100">
          <button
            onClick={() => setExpandedMember(expandedMember === member.memberId ? null : member.memberId)}
            className="w-full flex items-center gap-3 p-4 hover:bg-gray-50 transition text-left"
          >
            <span className="text-lg font-black text-gray-300 w-8 text-right">{member.rank}</span>
            <span className="text-2xl">{member.teamIcon ?? '🏒'}</span>
            <div className="flex-1">
              <p className="font-bold text-sm">{member.teamName}</p>
              <p className="text-xs text-gray-400">{member.userName}</p>
            </div>
            <span className="text-lg font-black text-orange-500">{member.totalScore.toFixed(1)}</span>
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
                    <span className={`text-sm font-bold ${player.isEliminated ? 'text-gray-400' : 'text-orange-500'}`}>
                      {player.totalPoints.toFixed(1)}
                    </span>
                  </Link>
                ))}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/league/[id]/standings/page.tsx
git commit -m "feat: add full standings page with expandable rosters"
```

---

## Task 11: Player Detail Page UI

**Files:**
- Create: `app/(app)/league/[id]/players/[playerId]/page.tsx`

- [ ] **Step 1: Create the player detail page**

Create `app/(app)/league/[id]/players/[playerId]/page.tsx`:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'

interface GameLogEntry {
  gameId: string; gameDate: string
  stats: Record<string, number>
  weightedScore: number
}
interface PlayerDetail {
  id: number; name: string; position: string
  team: { abbreviation: string; name: string; isEliminated: boolean }
  headshotUrl: string | null
  totals: Record<string, number> & { weightedTotal: number }
  gameLog: GameLogEntry[]
}

const SKATER_STAT_COLS = [
  { key: 'goals', label: 'G' }, { key: 'assists', label: 'A' },
  { key: 'plusMinus', label: '+/-' }, { key: 'pim', label: 'PIM' },
  { key: 'shots', label: 'SOG' }, { key: 'hits', label: 'HIT' },
  { key: 'blockedShots', label: 'BLK' },
  { key: 'powerPlayGoals', label: 'PPG' }, { key: 'powerPlayPoints', label: 'PPP' },
  { key: 'shorthandedGoals', label: 'SHG' }, { key: 'gameWinningGoals', label: 'GWG' },
  { key: 'overtimeGoals', label: 'OTG' },
]

const GOALIE_STAT_COLS = [
  { key: 'goalieWins', label: 'W' }, { key: 'goalieSaves', label: 'SV' },
  { key: 'goalsAgainst', label: 'GA' }, { key: 'shutouts', label: 'SO' },
]

export default function PlayerDetailPage({ params }: { params: Promise<{ id: string; playerId: string }> }) {
  const { id, playerId } = use(params)
  const router = useRouter()
  const [player, setPlayer] = useState<PlayerDetail | null>(null)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in.'); return }
        const res = await fetch(`/api/leagues/${id}/players/${playerId}`, {
          headers: { Authorization: `Bearer ${token}` },
        })
        if (!res.ok) { setError('Failed to load player.'); return }
        const data = await res.json()
        setPlayer(data.player)
      } catch {
        setError('Failed to load player.')
      }
    }
    load()
  }, [id, playerId])

  if (!player) return <div className="p-6 text-gray-400 text-sm">Loading...</div>

  const isGoalie = player.position === 'G'
  const statCols = isGoalie ? GOALIE_STAT_COLS : SKATER_STAT_COLS

  return (
    <div className="min-h-screen bg-white p-6 max-w-3xl mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">
        ← Back
      </button>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Player header */}
      <div className="flex items-center gap-4 mb-6">
        {player.headshotUrl ? (
          <img src={player.headshotUrl} alt="" className="w-16 h-16 rounded-full bg-gray-100" />
        ) : (
          <div className="w-16 h-16 rounded-full bg-gray-200" />
        )}
        <div>
          <h1 className={`text-2xl font-black ${player.team.isEliminated ? 'text-gray-400' : ''}`}>
            {player.name}
          </h1>
          <p className="text-sm text-gray-500">
            {player.position} · {player.team.name} ({player.team.abbreviation})
            {player.team.isEliminated && (
              <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded font-bold">ELIMINATED</span>
            )}
          </p>
        </div>
        <div className="ml-auto text-right">
          <p className="text-3xl font-black text-orange-500">{player.totals.weightedTotal.toFixed(1)}</p>
          <p className="text-xs text-gray-400">Total Points</p>
        </div>
      </div>

      {/* Season totals */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {statCols.map(({ key, label }) => (
          <div key={key} className="bg-gray-50 rounded-lg p-3 text-center">
            <p className="text-xs text-gray-400 font-bold">{label}</p>
            <p className="text-lg font-black">{player.totals[key] ?? 0}</p>
          </div>
        ))}
      </div>

      {/* Game log table */}
      <h2 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Game Log</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b-2 border-gray-200">
              <th className="text-left py-2 pr-4 font-bold text-gray-400">Date</th>
              {statCols.map(({ label }) => (
                <th key={label} className="text-center py-2 px-2 font-bold text-gray-400">{label}</th>
              ))}
              <th className="text-right py-2 pl-4 font-bold text-orange-400">PTS</th>
            </tr>
          </thead>
          <tbody>
            {player.gameLog.map(game => (
              <tr key={game.gameId} className="border-b border-gray-100 hover:bg-gray-50">
                <td className="py-2 pr-4 text-gray-600">{game.gameDate}</td>
                {statCols.map(({ key }) => (
                  <td key={key} className="text-center py-2 px-2">
                    {game.stats[key] ?? 0}
                  </td>
                ))}
                <td className="text-right py-2 pl-4 font-bold text-orange-500">
                  {game.weightedScore.toFixed(1)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/(app)/league/[id]/players/[playerId]/page.tsx
git commit -m "feat: add player detail page with game log and weighted scores"
```

---

## Task 12: Lobby Standings Summary

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Add standings summary to the lobby page**

In `app/(app)/league/[id]/page.tsx`, add a new state and fetch for standings. Add after the existing state declarations (around line 30):

```typescript
  const [standings, setStandings] = useState<{ rank: number; memberId: string; teamName: string; teamIcon: string | null; userName: string; totalScore: number }[]>([])
```

Inside the existing `useEffect` `load()` function, after the draft fetch (around line 60), add:

```typescript
      // Fetch standings if league is active
      if (leagueRes.ok) {
        const leagueData = await leagueRes.json()
        setLeague(leagueData.league)
        if (leagueData.league.status === 'active' || leagueData.league.status === 'complete') {
          const standingsRes = await fetch(`/api/leagues/${id}/standings`, { headers })
          if (standingsRes.ok) {
            const standingsData = await standingsRes.json()
            setStandings(standingsData.standings)
          }
        }
      }
```

Note: Remove the duplicate `setLeague` call from the existing code — the league data is now set inside the active check block.

- [ ] **Step 2: Add the standings card to the JSX**

In the JSX, add a standings section before the existing members list section (`{league.status !== 'setup' && ...}`). Replace that entire block with:

```tsx
      {/* Standings summary (active/complete phase) */}
      {(league.status === 'active' || league.status === 'complete') && standings.length > 0 && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Standings</p>
            <Link href={`/league/${id}/standings`} className="text-xs text-orange-500 font-bold hover:text-orange-700">
              View Full Standings →
            </Link>
          </div>
          {standings.map(s => (
            <div key={s.memberId} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-sm font-black text-gray-400 w-6 text-right">{s.rank}</span>
              <span className="text-xl">{s.teamIcon ?? '🏒'}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{s.teamName}</p>
                <p className="text-xs text-gray-400">{s.userName}</p>
              </div>
              <span className="text-sm font-bold text-orange-500">{s.totalScore.toFixed(1)}</span>
            </div>
          ))}
        </div>
      )}

      {/* Members list (draft phase only) */}
      {league.status === 'draft' && (
        <>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">Teams ({league.members.length})</p>
          {sortedMembers.map(m => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-2xl">{m.teamIcon ?? '🏒'}</span>
              <div>
                <p className="font-semibold text-sm">{m.teamName}</p>
                <p className="text-xs text-gray-400">{m.user.displayName}</p>
              </div>
            </div>
          ))}
        </>
      )}
```

- [ ] **Step 3: Run the dev server and verify visually**

Run: `npm run dev`

Navigate to a league lobby. If the league status is `setup` or `draft`, the page should look the same as before. If it were `active`, the standings summary would appear.

- [ ] **Step 4: Commit**

```bash
git add app/(app)/league/[id]/page.tsx
git commit -m "feat: add standings summary to league lobby for active leagues"
```

---

## Task 13: Run Full Test Suite and Verify

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run: `npm run test:run`

Expected: All tests pass.

- [ ] **Step 2: Run the dev server and verify no build errors**

Run: `npm run build`

Expected: Build completes with no errors.

- [ ] **Step 3: Commit any fixes if needed**

If there are type errors or build issues, fix them and commit:

```bash
git add -A
git commit -m "fix: resolve build errors from scoring core implementation"
```

---
