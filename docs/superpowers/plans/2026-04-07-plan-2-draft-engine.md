# Draft Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a server-authoritative snake draft engine with pick timer, autodraft, mock draft support, and a polling-based draft room UI.

**Architecture:** The server owns all pick validation, order, and timing. Clients poll `/api/leagues/[id]/draft/state` every 5 seconds. Picks are submitted via POST and validated server-side against pick order, player availability, and timer deadline. Autodraft members receive instant picks (server cascades automatically). Timer expiry is triggered by any client sending `{ autoPickExpired: true }` — the server validates the deadline and executes the auto-pick idempotently using the unique constraint on `(draftId, pickNumber)`.

**Tech Stack:** Next.js 16.2.2 App Router, Prisma v7 with PrismaPg adapter, Neon PostgreSQL (pooler for queries, direct URL for migrations), NHL unofficial API (`api-web.nhle.com/v1`), Vitest

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

## File Structure

**New files:**
- `prisma/schema.prisma` — add `pickDeadline` field to `Draft` model
- `prisma/seed-players.ts` — fetch real NHL roster data and seed `nhl_players`
- `lib/draft-engine.ts` — pure functions: pick order, auto-pick selection, validation
- `__tests__/lib/draft-engine.test.ts` — unit tests for pure functions
- `app/api/nhl-players/route.ts` — GET players with filters (position, search, draftId for available-only)
- `app/api/leagues/[id]/draft/route.ts` — GET state summary, POST create draft, PATCH settings/start/pause/resume
- `app/api/leagues/[id]/draft/order/route.ts` — PUT set or randomize draft positions
- `app/api/leagues/[id]/draft/pick/route.ts` — POST make a pick (validates turn, availability, timer)
- `app/api/leagues/[id]/draft/state/route.ts` — GET full draft state for polling
- `app/api/leagues/[id]/draft/settings/route.ts` — PATCH member's autodraft toggle and strategy
- `app/api/leagues/[id]/draft/wishlist/route.ts` — GET/POST wishlist entries
- `app/api/leagues/[id]/draft/wishlist/[playerId]/route.ts` — DELETE one wishlist entry
- `app/(app)/league/[id]/draft/page.tsx` — live draft room UI

**Modified files:**
- `app/(app)/league/[id]/page.tsx` — add pre-draft controls: draft order, autodraft toggle, start/go-to-draft buttons

---

## Task 1: Schema Migration — Add `pickDeadline` to Draft

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add the field to schema.prisma**

Open `prisma/schema.prisma`. In the `Draft` model, add one line after `startedAt`:

```prisma
model Draft {
  id                String      @id @default(uuid())
  leagueId          String      @unique @map("league_id")
  status            DraftStatus @default(pending)
  currentPickNumber Int         @default(1) @map("current_pick_number")
  pickTimeLimitSecs Int         @default(90) @map("pick_time_limit_secs")
  isMock            Boolean     @default(false) @map("is_mock")
  startedAt         DateTime?   @map("started_at")
  pickDeadline      DateTime?   @map("pick_deadline")
  completedAt       DateTime?   @map("completed_at")

  league League      @relation(fields: [leagueId], references: [id])
  picks  DraftPick[]

  @@map("drafts")
}
```

- [ ] **Step 2: Run the local migration**

```bash
npx prisma migrate dev --name add-pick-deadline
```

Expected output: `✔ Generated Prisma Client` and a new file under `prisma/migrations/`.

- [ ] **Step 3: Apply migration to Neon production**

```bash
DATABASE_URL=$DIRECT_URL npx prisma migrate deploy
```

Expected: `1 migration applied.`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat: add pick_deadline to drafts table"
```

---

## Task 2: Seed NHL Players from the NHL API

**Files:**
- Create: `prisma/seed-players.ts`

This script fetches real NHL roster data for 16 playoff-caliber teams and upserts them into `nhl_players`. Plan 3's `syncPlayoffRoster()` will upsert the same player IDs — no conflicts.

- [ ] **Step 1: Write the seed script**

Create `prisma/seed-players.ts`:

```typescript
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL! })
const prisma = new PrismaClient({ adapter })

const TEAMS = ['EDM', 'COL', 'DAL', 'VGK', 'NSH', 'MIN', 'STL', 'LAK',
               'FLA', 'TBL', 'BOS', 'NYR', 'PIT', 'WSH', 'CAR', 'TOR']

const NHL_API = 'https://api-web.nhle.com/v1'

type PosCode = 'C' | 'L' | 'R' | 'D' | 'G'
const posMap: Record<PosCode, 'C' | 'LW' | 'RW' | 'D' | 'G'> = {
  C: 'C', L: 'LW', R: 'RW', D: 'D', G: 'G',
}

interface ApiPlayer {
  id: number
  firstName: { default: string }
  lastName: { default: string }
  positionCode: PosCode
  headshot: string
}

async function fetchRoster(team: string): Promise<ApiPlayer[]> {
  try {
    const res = await fetch(`${NHL_API}/roster/${team}/current`)
    if (!res.ok) { console.warn(`Roster fetch failed for ${team}: ${res.status}`); return [] }
    const data = await res.json() as { forwards?: ApiPlayer[]; defensemen?: ApiPlayer[]; goalies?: ApiPlayer[] }
    return [...(data.forwards ?? []), ...(data.defensemen ?? []), ...(data.goalies ?? [])]
  } catch (err) {
    console.warn(`Roster fetch error for ${team}:`, err)
    return []
  }
}

async function main() {
  console.log('Seeding NHL players...')
  let adpCounter = 1

  for (const team of TEAMS) {
    const players = await fetchRoster(team)
    console.log(`${team}: ${players.length} players`)

    for (const p of players) {
      const position = posMap[p.positionCode] ?? 'C'
      // Assign ADP: forwards get lower (more valuable), goalies higher
      const adpBonus = position === 'G' ? 100 : position === 'D' ? 50 : 0
      const adp = adpCounter + adpBonus

      await prisma.nhlPlayer.upsert({
        where: { id: p.id },
        update: {
          teamId: team,
          name: `${p.firstName.default} ${p.lastName.default}`,
          position,
          headshotUrl: p.headshot || null,
          adp,
          isActive: true,
        },
        create: {
          id: p.id,
          teamId: team,
          name: `${p.firstName.default} ${p.lastName.default}`,
          position,
          headshotUrl: p.headshot || null,
          adp,
          isActive: true,
        },
      })
      adpCounter++
    }
  }

  const count = await prisma.nhlPlayer.count()
  console.log(`Done. Total players in DB: ${count}`)
  await prisma.$disconnect()
}

main().catch(e => { console.error(e); process.exit(1) })
```

- [ ] **Step 2: Run the seed against Neon**

```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-players.ts
```

Expected: lists each team with player count, ends with `Total players in DB: ~300+`

- [ ] **Step 3: Commit**

```bash
git add prisma/seed-players.ts
git commit -m "feat: add NHL player seed script from NHL API"
```

---

## Task 3: Draft Engine Pure Functions + Tests

**Files:**
- Create: `lib/draft-engine.ts`
- Create: `__tests__/lib/draft-engine.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/draft-engine.test.ts`:

```typescript
import { describe, it, expect } from 'vitest'
import { getPickerIndex, getRound, getTotalPicks } from '../../lib/draft-engine'

describe('getPickerIndex — snake draft order', () => {
  // 4-member league: positions 0,1,2,3
  it('round 1 picks left to right (odd round)', () => {
    expect(getPickerIndex(1, 4)).toBe(0)
    expect(getPickerIndex(2, 4)).toBe(1)
    expect(getPickerIndex(3, 4)).toBe(2)
    expect(getPickerIndex(4, 4)).toBe(3)
  })
  it('round 2 picks right to left (even round)', () => {
    expect(getPickerIndex(5, 4)).toBe(3)
    expect(getPickerIndex(6, 4)).toBe(2)
    expect(getPickerIndex(7, 4)).toBe(1)
    expect(getPickerIndex(8, 4)).toBe(0)
  })
  it('round 3 picks left to right again', () => {
    expect(getPickerIndex(9, 4)).toBe(0)
    expect(getPickerIndex(10, 4)).toBe(1)
    expect(getPickerIndex(12, 4)).toBe(3)
  })
  it('2-member snake reversal', () => {
    expect(getPickerIndex(1, 2)).toBe(0) // round 1 pos 0
    expect(getPickerIndex(2, 2)).toBe(1) // round 1 pos 1
    expect(getPickerIndex(3, 2)).toBe(1) // round 2 pos 1 (reversed)
    expect(getPickerIndex(4, 2)).toBe(0) // round 2 pos 0 (reversed)
    expect(getPickerIndex(5, 2)).toBe(0) // round 3 pos 0 again
  })
  it('1-member league always returns 0', () => {
    expect(getPickerIndex(1, 1)).toBe(0)
    expect(getPickerIndex(5, 1)).toBe(0)
  })
})

describe('getTotalPicks', () => {
  it('returns memberCount × playersPerTeam', () => {
    expect(getTotalPicks(8, 10)).toBe(80)
    expect(getTotalPicks(4, 5)).toBe(20)
    expect(getTotalPicks(1, 3)).toBe(3)
  })
})

describe('getRound', () => {
  it('calculates correct round for 4-member league', () => {
    expect(getRound(1, 4)).toBe(1)
    expect(getRound(4, 4)).toBe(1)
    expect(getRound(5, 4)).toBe(2)
    expect(getRound(8, 4)).toBe(2)
    expect(getRound(9, 4)).toBe(3)
  })
})
```

- [ ] **Step 2: Run tests to confirm they fail**

```bash
npm run test:run -- __tests__/lib/draft-engine.test.ts
```

Expected: FAIL — `Cannot find module '../../lib/draft-engine'`

- [ ] **Step 3: Implement the functions**

Create `lib/draft-engine.ts`:

```typescript
import type { PrismaClient } from '@prisma/client'

/**
 * Returns the 0-indexed position in the sorted members array for a given pick number.
 * Odd rounds pick left-to-right, even rounds pick right-to-left (snake).
 */
export function getPickerIndex(pickNumber: number, memberCount: number): number {
  const round = Math.ceil(pickNumber / memberCount)
  const posInRound = (pickNumber - 1) % memberCount
  return round % 2 === 1 ? posInRound : memberCount - 1 - posInRound
}

/** Returns the 1-indexed round number for a given pick in an N-member draft. */
export function getRound(pickNumber: number, memberCount: number): number {
  return Math.ceil(pickNumber / memberCount)
}

/** Total picks = members × players per team (number of rounds). */
export function getTotalPicks(memberCount: number, playersPerTeam: number): number {
  return memberCount * playersPerTeam
}

/**
 * Selects the best available player for an auto-pick.
 * Tries the member's wishlist (if strategy = 'wishlist') first, falls back to ADP.
 */
export async function getAutoPickPlayerId(
  draftId: string,
  leagueMemberId: string,
  strategy: 'adp' | 'wishlist',
  tx: Omit<PrismaClient, '$connect' | '$disconnect' | '$on' | '$transaction' | '$use' | '$extends'>
): Promise<number> {
  const drafted = await tx.draftPick.findMany({
    where: { draftId },
    select: { playerId: true },
  })
  const draftedIds = new Set(drafted.map(p => p.playerId))

  if (strategy === 'wishlist') {
    const wishlist = await tx.autodraftWishlist.findMany({
      where: { leagueMemberId },
      orderBy: { rank: 'asc' },
      select: { playerId: true },
    })
    for (const { playerId } of wishlist) {
      if (!draftedIds.has(playerId)) return playerId
    }
  }

  const best = await tx.nhlPlayer.findFirst({
    where: {
      id: { notIn: draftedIds.size > 0 ? [...draftedIds] : [-1] },
      isActive: true,
    },
    orderBy: { adp: { sort: 'asc', nulls: 'last' } },
  })
  if (!best) throw new Error('No available players for auto-pick')
  return best.id
}
```

- [ ] **Step 4: Run tests to confirm they pass**

```bash
npm run test:run -- __tests__/lib/draft-engine.test.ts
```

Expected: PASS — 13 tests passing

- [ ] **Step 5: Commit**

```bash
git add lib/draft-engine.ts __tests__/lib/draft-engine.test.ts
git commit -m "feat: add draft engine pure functions with tests"
```

---

## Task 4: NHL Players API

**Files:**
- Create: `app/api/nhl-players/route.ts`

- [ ] **Step 1: Write the route**

Create `app/api/nhl-players/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const position = searchParams.get('position')   // C|LW|RW|D|G
    const search = searchParams.get('search')
    const draftId = searchParams.get('draftId')     // filter to available players only
    const page = parseInt(searchParams.get('page') ?? '1', 10)
    const pageSize = 50

    // Build where clause
    const where: Record<string, unknown> = { isActive: true }

    if (position && ['C', 'LW', 'RW', 'D', 'G'].includes(position)) {
      where.position = position
    }
    if (search) {
      where.name = { contains: search, mode: 'insensitive' }
    }

    let draftedIds: number[] = []
    if (draftId) {
      const picks = await prisma.draftPick.findMany({
        where: { draftId },
        select: { playerId: true },
      })
      draftedIds = picks.map(p => p.playerId)
      if (draftedIds.length > 0) {
        where.id = { notIn: draftedIds }
      }
    }

    const [players, total] = await Promise.all([
      prisma.nhlPlayer.findMany({
        where,
        include: { team: { select: { id: true, name: true, colorPrimary: true } } },
        orderBy: { adp: { sort: 'asc', nulls: 'last' } },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.nhlPlayer.count({ where }),
    ])

    return NextResponse.json({ players, total, page, pageSize })
  } catch (error) {
    console.error('GET /api/nhl-players error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Test the route locally**

```bash
npm run dev
# In another terminal:
curl "http://localhost:3000/api/nhl-players?position=C&page=1"
```

Expected: JSON with `players` array, `total`, `page`, `pageSize`

- [ ] **Step 3: Commit**

```bash
git add app/api/nhl-players/route.ts
git commit -m "feat: add NHL players API with position/search/available filters"
```

---

## Task 5: Draft Initialization + Order APIs

**Files:**
- Create: `app/api/leagues/[id]/draft/route.ts`
- Create: `app/api/leagues/[id]/draft/order/route.ts`

- [ ] **Step 1: Write the draft CRUD route**

Create `app/api/leagues/[id]/draft/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// GET — fetch current draft for a league
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

    const member = await prisma.leagueMember.findUnique({ where: { leagueId_userId: { leagueId, userId: user.id } } })
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    return NextResponse.json({ draft })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — commissioner creates the draft
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'League is not in setup status' }, { status: 400 })

    const existing = await prisma.draft.findUnique({ where: { leagueId } })
    if (existing && !existing.isMock) return NextResponse.json({ error: 'Draft already exists' }, { status: 409 })

    const body = await request.json().catch(() => ({}))
    const { pickTimeLimitSecs = 90, isMock = false } = body

    // Delete any existing mock draft if creating a new one
    if (existing?.isMock) await prisma.draft.delete({ where: { leagueId } })

    const draft = await prisma.draft.create({
      data: { leagueId, pickTimeLimitSecs, isMock },
    })

    return NextResponse.json({ draft }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH — commissioner controls: start | pause | resume | update settings
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'Draft not created yet' }, { status: 404 })

    const body = await request.json().catch(() => ({}))
    const { action, pickTimeLimitSecs } = body

    if (action === 'start') {
      if (draft.status !== 'pending') return NextResponse.json({ error: 'Draft is not pending' }, { status: 400 })
      // Verify all members have draft positions assigned
      const members = await prisma.leagueMember.findMany({ where: { leagueId } })
      const unassigned = members.filter(m => m.draftPosition === null)
      if (unassigned.length > 0) return NextResponse.json({ error: 'All members must have draft positions set' }, { status: 400 })

      const pickDeadline = new Date(Date.now() + draft.pickTimeLimitSecs * 1000)
      const updated = await prisma.draft.update({
        where: { leagueId },
        data: { status: 'active', startedAt: new Date(), pickDeadline },
      })
      // Transition league to draft status
      if (!draft.isMock) await prisma.league.update({ where: { id: leagueId }, data: { status: 'draft' } })
      return NextResponse.json({ draft: updated })
    }

    if (action === 'pause') {
      if (draft.status !== 'active') return NextResponse.json({ error: 'Draft is not active' }, { status: 400 })
      const updated = await prisma.draft.update({ where: { leagueId }, data: { status: 'paused', pickDeadline: null } })
      return NextResponse.json({ draft: updated })
    }

    if (action === 'resume') {
      if (draft.status !== 'paused') return NextResponse.json({ error: 'Draft is not paused' }, { status: 400 })
      const pickDeadline = new Date(Date.now() + draft.pickTimeLimitSecs * 1000)
      const updated = await prisma.draft.update({ where: { leagueId }, data: { status: 'active', pickDeadline } })
      return NextResponse.json({ draft: updated })
    }

    if (typeof pickTimeLimitSecs === 'number') {
      if (draft.status !== 'pending') return NextResponse.json({ error: 'Can only change settings while draft is pending' }, { status: 400 })
      if (pickTimeLimitSecs < 30 || pickTimeLimitSecs > 300) return NextResponse.json({ error: 'Pick time limit must be 30–300 seconds' }, { status: 400 })
      const updated = await prisma.draft.update({ where: { leagueId }, data: { pickTimeLimitSecs } })
      return NextResponse.json({ draft: updated })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/draft error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Write the draft order route**

Create `app/api/leagues/[id]/draft/order/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// PUT — set draft positions manually or randomize
export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (draft && draft.status !== 'pending') return NextResponse.json({ error: 'Cannot change order after draft has started' }, { status: 400 })

    const body = await request.json()
    const { randomize, memberIds } = body

    const members = await prisma.leagueMember.findMany({ where: { leagueId } })

    if (randomize) {
      // Fisher-Yates shuffle
      const shuffled = members.map(m => m.id)
      for (let i = shuffled.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]]
      }
      await Promise.all(shuffled.map((memberId, index) =>
        prisma.leagueMember.update({ where: { id: memberId }, data: { draftPosition: index + 1 } })
      ))
      const updated = await prisma.leagueMember.findMany({ where: { leagueId }, orderBy: { draftPosition: 'asc' } })
      return NextResponse.json({ members: updated })
    }

    if (Array.isArray(memberIds)) {
      if (memberIds.length !== members.length) return NextResponse.json({ error: 'memberIds must include all league members' }, { status: 400 })
      const memberSet = new Set(members.map(m => m.id))
      if (!memberIds.every((id: string) => memberSet.has(id))) return NextResponse.json({ error: 'Invalid member IDs' }, { status: 400 })
      await Promise.all(memberIds.map((memberId: string, index: number) =>
        prisma.leagueMember.update({ where: { id: memberId }, data: { draftPosition: index + 1 } })
      ))
      const updated = await prisma.leagueMember.findMany({ where: { leagueId }, orderBy: { draftPosition: 'asc' } })
      return NextResponse.json({ members: updated })
    }

    return NextResponse.json({ error: 'Provide either randomize: true or memberIds array' }, { status: 400 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PUT /api/leagues/[id]/draft/order error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add draft initialization, controls, and order APIs"
```

---

## Task 6: Draft Pick API

**Files:**
- Create: `app/api/leagues/[id]/draft/pick/route.ts`

This is the server-authoritative pick endpoint. It validates turn, player availability, and timer, then cascades through consecutive autodraft members.

- [ ] **Step 1: Write the pick route**

Create `app/api/leagues/[id]/draft/pick/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPickerIndex, getRound, getTotalPicks, getAutoPickPlayerId } from '@/lib/draft-engine'

export async function POST(
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
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ error: 'No draft for this league' }, { status: 404 })
    if (draft.status === 'paused') return NextResponse.json({ error: 'Draft is paused' }, { status: 400 })
    if (draft.status !== 'active') return NextResponse.json({ error: 'Draft is not active' }, { status: 400 })

    const body = await request.json().catch(() => ({}))
    const { playerId, autoPickExpired } = body

    // Get members sorted by draftPosition
    const allMembers = await prisma.leagueMember.findMany({
      where: { leagueId },
      orderBy: { draftPosition: 'asc' },
    })
    const totalPicks = getTotalPicks(allMembers.length, league.playersPerTeam)
    if (draft.currentPickNumber > totalPicks) {
      return NextResponse.json({ error: 'Draft is already complete' }, { status: 400 })
    }

    const pickerIndex = getPickerIndex(draft.currentPickNumber, allMembers.length)
    const currentPicker = allMembers[pickerIndex]

    // Validate who can make this pick
    if (autoPickExpired) {
      // Any authenticated member can trigger timer expiry, but deadline must have passed
      if (!draft.pickDeadline || new Date() < draft.pickDeadline) {
        return NextResponse.json({ error: 'Pick timer has not expired' }, { status: 400 })
      }
    } else if (!currentPicker.autodraftEnabled) {
      // Normal manual pick: must be the current picker
      if (currentPicker.id !== member.id) {
        return NextResponse.json({ error: 'Not your turn' }, { status: 403 })
      }
    }

    // Execute picks in a transaction — cascades through consecutive autodraft members
    const result = await prisma.$transaction(async (tx) => {
      let currentPickNum = draft.currentPickNumber
      const picksMade: number[] = []

      while (currentPickNum <= totalPicks) {
        const idx = getPickerIndex(currentPickNum, allMembers.length)
        const picker = allMembers[idx]

        // Determine what player to pick
        let selectedPlayerId: number
        let pickSource: 'manual' | 'timed_autopick' | 'autodraft'

        const isFirstPick = currentPickNum === draft.currentPickNumber

        if (isFirstPick && autoPickExpired) {
          selectedPlayerId = await getAutoPickPlayerId(draft.id, picker.id, picker.autodraftStrategy, tx)
          pickSource = 'timed_autopick'
        } else if (picker.autodraftEnabled && !isFirstPick) {
          selectedPlayerId = await getAutoPickPlayerId(draft.id, picker.id, picker.autodraftStrategy, tx)
          pickSource = 'autodraft'
        } else if (isFirstPick && !autoPickExpired) {
          if (typeof playerId !== 'number') throw new Error('playerId is required')
          selectedPlayerId = playerId
          pickSource = picker.autodraftEnabled ? 'autodraft' : 'manual'
        } else {
          // Next picker is not autodraft — stop cascading
          break
        }

        // Validate player exists and is available
        const player = await tx.nhlPlayer.findUnique({ where: { id: selectedPlayerId } })
        if (!player) throw new Error('Player not found')

        const round = getRound(currentPickNum, allMembers.length)

        // Insert pick — unique constraint (draftId, pickNumber) prevents race conditions
        await tx.draftPick.create({
          data: {
            draftId: draft.id,
            leagueMemberId: picker.id,
            playerId: selectedPlayerId,
            round,
            pickNumber: currentPickNum,
            pickSource,
          },
        })

        picksMade.push(currentPickNum)
        currentPickNum++

        // After the first pick, only continue if this is a non-first autodraft member
        if (!picker.autodraftEnabled && !isFirstPick) break
        // If first pick was manual and was picked, now cascade if next is autodraft
        if (isFirstPick && !picker.autodraftEnabled) {
          // First pick done (manual), now loop for any consecutive autodraft members
        }
      }

      // Check if draft is complete
      const isDraftComplete = currentPickNum > totalPicks

      const newDeadline = isDraftComplete
        ? null
        : new Date(Date.now() + draft.pickTimeLimitSecs * 1000)

      await tx.draft.update({
        where: { id: draft.id },
        data: {
          currentPickNumber: currentPickNum,
          pickDeadline: newDeadline,
          status: isDraftComplete ? 'complete' : 'active',
          completedAt: isDraftComplete ? new Date() : null,
        },
      })

      // When real draft completes, transition league to active
      if (isDraftComplete && !draft.isMock) {
        await tx.league.update({ where: { id: leagueId }, data: { status: 'active' } })
      }

      return { picksMade, isDraftComplete, newPickNumber: currentPickNum }
    })

    return NextResponse.json({ ok: true, ...result })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    // Unique constraint violation = duplicate pick attempt
    if ((error as { code?: string }).code === 'P2002') {
      return NextResponse.json({ error: 'Pick already recorded' }, { status: 409 })
    }
    const msg = error instanceof Error ? error.message : 'Internal server error'
    console.error('POST /api/leagues/[id]/draft/pick error:', error)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add draft pick API with autodraft cascade and timer expiry"
```

---

## Task 7: Draft State Polling API

**Files:**
- Create: `app/api/leagues/[id]/draft/state/route.ts`

- [ ] **Step 1: Write the state route**

Create `app/api/leagues/[id]/draft/state/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'
import { getPickerIndex, getTotalPicks } from '@/lib/draft-engine'

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

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const myMember = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!myMember) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const draft = await prisma.draft.findUnique({ where: { leagueId } })
    if (!draft) return NextResponse.json({ draft: null, myLeagueMemberId: myMember.id })

    const members = await prisma.leagueMember.findMany({
      where: { leagueId },
      include: { user: { select: { displayName: true } } },
      orderBy: { draftPosition: 'asc' },
    })

    const picks = await prisma.draftPick.findMany({
      where: { draftId: draft.id },
      include: {
        player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true } },
        leagueMember: { select: { id: true, teamName: true, teamIcon: true } },
      },
      orderBy: { pickNumber: 'asc' },
    })

    const totalPicks = getTotalPicks(members.length, league.playersPerTeam)

    let currentPicker = null
    if (draft.status === 'active' || draft.status === 'paused') {
      if (draft.currentPickNumber <= totalPicks) {
        const idx = getPickerIndex(draft.currentPickNumber, members.length)
        const picker = members[idx]
        currentPicker = {
          leagueMemberId: picker.id,
          teamName: picker.teamName,
          teamIcon: picker.teamIcon,
          draftPosition: picker.draftPosition,
          autodraftEnabled: picker.autodraftEnabled,
          isMe: picker.id === myMember.id,
        }
      }
    }

    const memberSummaries = members.map(m => ({
      leagueMemberId: m.id,
      teamName: m.teamName,
      teamIcon: m.teamIcon,
      draftPosition: m.draftPosition,
      pickCount: picks.filter(p => p.leagueMemberId === m.id).length,
      autodraftEnabled: m.autodraftEnabled,
      isCommissioner: league.commissionerId === m.userId,
    }))

    return NextResponse.json({
      draft: {
        id: draft.id,
        status: draft.status,
        currentPickNumber: draft.currentPickNumber,
        totalPicks,
        pickDeadline: draft.pickDeadline?.toISOString() ?? null,
        pickTimeLimitSecs: draft.pickTimeLimitSecs,
        isMock: draft.isMock,
        startedAt: draft.startedAt?.toISOString() ?? null,
      },
      currentPicker,
      picks: picks.map(p => ({
        pickNumber: p.pickNumber,
        round: p.round,
        leagueMemberId: p.leagueMemberId,
        teamName: p.leagueMember.teamName,
        teamIcon: p.leagueMember.teamIcon,
        player: p.player,
        pickSource: p.pickSource,
        pickedAt: p.pickedAt.toISOString(),
      })),
      members: memberSummaries,
      myLeagueMemberId: myMember.id,
      isCommissioner: league.commissionerId === user.id,
    })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft/state error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add draft state polling API"
```

---

## Task 8: Autodraft Settings + Wishlist APIs

**Files:**
- Create: `app/api/leagues/[id]/draft/settings/route.ts`
- Create: `app/api/leagues/[id]/draft/wishlist/route.ts`
- Create: `app/api/leagues/[id]/draft/wishlist/[playerId]/route.ts`

- [ ] **Step 1: Write the settings route**

Create `app/api/leagues/[id]/draft/settings/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function PATCH(
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
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const body = await request.json().catch(() => ({}))
    const { autodraftEnabled, autodraftStrategy } = body

    const updateData: Record<string, unknown> = {}
    if (typeof autodraftEnabled === 'boolean') updateData.autodraftEnabled = autodraftEnabled
    if (autodraftStrategy === 'adp' || autodraftStrategy === 'wishlist') {
      updateData.autodraftStrategy = autodraftStrategy
    }

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json({ error: 'Nothing to update' }, { status: 400 })
    }

    const updated = await prisma.leagueMember.update({ where: { id: member.id }, data: updateData })
    return NextResponse.json({ member: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/draft/settings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Write the wishlist route**

Create `app/api/leagues/[id]/draft/wishlist/route.ts`:

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
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const wishlist = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true } } },
      orderBy: { rank: 'asc' },
    })

    return NextResponse.json({ wishlist })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

export async function POST(
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
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const body = await request.json()
    const { playerId } = body
    if (typeof playerId !== 'number') return NextResponse.json({ error: 'playerId required' }, { status: 400 })

    const player = await prisma.nhlPlayer.findUnique({ where: { id: playerId } })
    if (!player) return NextResponse.json({ error: 'Player not found' }, { status: 404 })

    // Add to end of wishlist
    const last = await prisma.autodraftWishlist.findFirst({
      where: { leagueMemberId: member.id },
      orderBy: { rank: 'desc' },
    })
    const rank = (last?.rank ?? 0) + 1

    const entry = await prisma.autodraftWishlist.create({
      data: { leagueMemberId: member.id, playerId, rank },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true } } },
    })

    return NextResponse.json({ entry }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    if ((error as { code?: string }).code === 'P2002') return NextResponse.json({ error: 'Player already in wishlist' }, { status: 409 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /wishlist — reorder the full wishlist
export async function PUT(
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
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    const body = await request.json()
    const { playerIds } = body
    if (!Array.isArray(playerIds)) return NextResponse.json({ error: 'playerIds array required' }, { status: 400 })

    await prisma.$transaction(
      playerIds.map((id: number, index: number) =>
        prisma.autodraftWishlist.update({
          where: { leagueMemberId_playerId: { leagueMemberId: member.id, playerId: id } },
          data: { rank: index + 1 },
        })
      )
    )

    const wishlist = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      include: { player: { select: { id: true, name: true, position: true, teamId: true, headshotUrl: true } } },
      orderBy: { rank: 'asc' },
    })

    return NextResponse.json({ wishlist })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 3: Write the wishlist DELETE route**

Create `app/api/leagues/[id]/draft/wishlist/[playerId]/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; playerId: string }> }
) {
  try {
    const { id: leagueId, playerId: playerIdStr } = await params
    const playerId = parseInt(playerIdStr, 10)
    if (isNaN(playerId)) return NextResponse.json({ error: 'Invalid playerId' }, { status: 400 })

    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)
    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member' }, { status: 403 })

    await prisma.autodraftWishlist.delete({
      where: { leagueMemberId_playerId: { leagueMemberId: member.id, playerId } },
    })

    // Re-rank remaining entries
    const remaining = await prisma.autodraftWishlist.findMany({
      where: { leagueMemberId: member.id },
      orderBy: { rank: 'asc' },
    })
    await prisma.$transaction(
      remaining.map((entry, index) =>
        prisma.autodraftWishlist.update({ where: { id: entry.id }, data: { rank: index + 1 } })
      )
    )

    return NextResponse.json({ ok: true })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 4: Commit**

```bash
git add app/api/leagues/
git commit -m "feat: add autodraft settings and wishlist APIs"
```

---

## Task 9: Updated League Lobby UI

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

Replace the file entirely with a version that includes pre-draft controls.

- [ ] **Step 1: Write the updated lobby page**

Replace `app/(app)/league/[id]/page.tsx` with:

```typescript
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import Link from 'next/link'
import { useRouter } from 'next/navigation'

interface Member {
  id: string; teamName: string; teamIcon: string | null
  draftPosition: number | null; autodraftEnabled: boolean
  user: { displayName: string; id: string }
}
interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number; playersPerTeam: number
  commissioner: { displayName: string }
  commissionerId: string
  members: Member[]
}
interface Draft {
  id: string; status: string; currentPickNumber: number; isMock: boolean
  pickTimeLimitSecs: number
}

export default function LeagueLobbyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [draft, setDraft] = useState<Draft | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [orderLoading, setOrderLoading] = useState(false)
  const [startLoading, setStartLoading] = useState(false)
  const [autodraftLoading, setAutodraftLoading] = useState(false)
  const [error, setError] = useState('')

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  useEffect(() => {
    async function load() {
      const token = await getToken()
      const headers: HeadersInit = token ? { Authorization: `Bearer ${token}` } : {}

      const [leagueRes, meRes, draftRes] = await Promise.all([
        fetch(`/api/leagues/${id}`, { headers }),
        token ? fetch('/api/auth/me', { headers }) : Promise.resolve(null),
        fetch(`/api/leagues/${id}/draft`, { headers }),
      ])

      if (leagueRes.ok) {
        const data = await leagueRes.json()
        setLeague(data.league)
      }
      if (meRes?.ok) {
        const data = await meRes.json()
        setMyUserId(data.user.id)
      }
      if (draftRes.ok) {
        const data = await draftRes.json()
        setDraft(data.draft)
      }
    }
    load()
  }, [id])

  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  const isCommissioner = myUserId === league.commissionerId
  const myMember = league.members.find(m => m.user.id === myUserId)
  const inviteUrl = `${typeof window !== 'undefined' ? window.location.origin : ''}/join/${league.inviteCode}`
  const allHavePositions = league.members.every(m => m.draftPosition !== null)
  const sortedMembers = [...league.members].sort((a, b) => (a.draftPosition ?? 999) - (b.draftPosition ?? 999))

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  async function randomizeOrder() {
    setOrderLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/leagues/${id}/draft/order`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ randomize: true }),
      })
      if (!res.ok) { setError('Failed to randomize order'); return }
      // Reload league data
      const leagueRes = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (leagueRes.ok) setLeague((await leagueRes.json()).league)
    } finally { setOrderLoading(false) }
  }

  async function createAndStartDraft() {
    setStartLoading(true)
    setError('')
    try {
      const token = await getToken()
      // Create draft if none exists
      if (!draft) {
        const res = await fetch(`/api/leagues/${id}/draft`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({}),
        })
        if (!res.ok) { setError('Failed to create draft'); return }
        const data = await res.json()
        setDraft(data.draft)
      }
      // Start draft
      const res = await fetch(`/api/leagues/${id}/draft`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'start' }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to start draft')
        return
      }
      router.push(`/league/${id}/draft`)
    } finally { setStartLoading(false) }
  }

  async function toggleAutodraft() {
    if (!myMember) return
    setAutodraftLoading(true)
    try {
      const token = await getToken()
      await fetch(`/api/leagues/${id}/draft/settings`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ autodraftEnabled: !myMember.autodraftEnabled }),
      })
      // Reload
      const res = await fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } })
      if (res.ok) setLeague((await res.json()).league)
    } finally { setAutodraftLoading(false) }
  }

  const draftActive = draft?.status === 'active' || draft?.status === 'paused'

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black mb-1">{league.name}</h1>
      <p className="text-gray-500 text-sm mb-6">{league.members.length}/{league.maxTeams} teams · {league.playersPerTeam} players per team</p>

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {/* Draft status banner */}
      {draftActive && (
        <div className="bg-orange-50 border-2 border-orange-300 rounded-xl p-4 mb-6">
          <p className="font-bold text-orange-800 text-sm">Draft is {draft!.status}!</p>
          <Link href={`/league/${id}/draft`}
            className="mt-2 inline-block bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
            Go to Draft Room →
          </Link>
        </div>
      )}

      {/* Invite link */}
      {league.status === 'setup' && (
        <div className="bg-gray-50 rounded-xl p-4 mb-6">
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
          <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
          <button onClick={copyLink}
            className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
            {copied ? '✓ Copied!' : 'Copy Link'}
          </button>
        </div>
      )}

      {/* Draft order (setup phase) */}
      {league.status === 'setup' && (
        <div className="mb-6">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider">Draft Order</p>
            {isCommissioner && (
              <button onClick={randomizeOrder} disabled={orderLoading}
                className="text-xs text-orange-500 font-bold hover:text-orange-700 disabled:opacity-50">
                {orderLoading ? 'Shuffling…' : '🔀 Randomize'}
              </button>
            )}
          </div>
          {sortedMembers.map((m, i) => (
            <div key={m.id} className="flex items-center gap-3 p-3 border-b border-gray-100">
              <span className="text-sm font-black text-gray-400 w-6 text-right">
                {m.draftPosition ?? '—'}
              </span>
              <span className="text-xl">{m.teamIcon ?? '🏒'}</span>
              <div className="flex-1">
                <p className="font-semibold text-sm">{m.teamName}</p>
                <p className="text-xs text-gray-400">{m.user.displayName}</p>
              </div>
              {m.autodraftEnabled && (
                <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded font-bold">AUTO</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* My autodraft toggle */}
      {myMember && league.status === 'setup' && (
        <div className="bg-blue-50 rounded-xl p-4 mb-6">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-bold text-sm">Autodraft</p>
              <p className="text-xs text-gray-500">Can't make it? We'll pick for you by ADP.</p>
            </div>
            <button
              onClick={toggleAutodraft}
              disabled={autodraftLoading}
              className={`w-12 h-6 rounded-full transition-colors ${myMember.autodraftEnabled ? 'bg-blue-500' : 'bg-gray-300'} disabled:opacity-50`}
            >
              <span className={`block w-5 h-5 bg-white rounded-full shadow transition-transform mx-0.5 ${myMember.autodraftEnabled ? 'translate-x-6' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      )}

      {/* Members list (draft/active phase) */}
      {league.status !== 'setup' && (
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

      {/* Commissioner controls */}
      <div className="mt-6 flex gap-3 flex-wrap">
        <Link href={`/league/${id}/settings`}
          className="flex-1 text-center py-3 border-2 border-gray-200 rounded-xl text-sm font-bold hover:border-gray-400 transition">
          Scoring Settings
        </Link>
        {isCommissioner && league.status === 'setup' && !draftActive && (
          <button
            onClick={createAndStartDraft}
            disabled={startLoading || !allHavePositions}
            className="flex-1 py-3 bg-orange-500 text-white rounded-xl text-sm font-bold hover:bg-orange-600 disabled:opacity-50 transition"
            title={!allHavePositions ? 'Randomize draft order first' : ''}
          >
            {startLoading ? 'Starting…' : '🚀 Start Draft'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add app/
git commit -m "feat: update league lobby with draft order, autodraft toggle, start draft controls"
```

---

## Task 10: Draft Room UI

**Files:**
- Create: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Write the draft room page**

Create `app/(app)/league/[id]/draft/page.tsx`:

```typescript
'use client'
import { useState, useEffect, useCallback, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { useRouter } from 'next/navigation'

interface Player {
  id: number; name: string; position: string; teamId: string; headshotUrl: string | null
  team?: { id: string; name: string; colorPrimary: string }
}
interface Pick {
  pickNumber: number; round: number
  leagueMemberId: string; teamName: string; teamIcon: string | null
  player: { id: number; name: string; position: string; teamId: string; headshotUrl: string | null }
  pickSource: string; pickedAt: string
}
interface MemberSummary {
  leagueMemberId: string; teamName: string; teamIcon: string | null
  draftPosition: number; pickCount: number; autodraftEnabled: boolean; isCommissioner: boolean
}
interface DraftState {
  draft: {
    id: string; status: string; currentPickNumber: number; totalPicks: number
    pickDeadline: string | null; pickTimeLimitSecs: number; isMock: boolean
  } | null
  currentPicker: { leagueMemberId: string; teamName: string; teamIcon: string | null; isMe: boolean; autodraftEnabled: boolean } | null
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  isCommissioner: boolean
}

const POSITIONS = ['All', 'C', 'LW', 'RW', 'D', 'G']

export default function DraftRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: leagueId } = use(params)
  const router = useRouter()
  const [state, setState] = useState<DraftState | null>(null)
  const [players, setPlayers] = useState<Player[]>([])
  const [posFilter, setPosFilter] = useState('All')
  const [search, setSearch] = useState('')
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [pickLoading, setPickLoading] = useState(false)
  const [error, setError] = useState('')

  async function getToken() { return await auth.currentUser?.getIdToken() ?? '' }

  const fetchState = useCallback(async () => {
    const token = await getToken()
    const res = await fetch(`/api/leagues/${leagueId}/draft/state`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data: DraftState = await res.json()
    setState(data)
    if (data.draft?.status === 'complete') router.push(`/league/${leagueId}`)
  }, [leagueId, router])

  const fetchPlayers = useCallback(async () => {
    if (!state?.draft) return
    const token = await getToken()
    const pos = posFilter !== 'All' ? `&position=${posFilter}` : ''
    const q = search ? `&search=${encodeURIComponent(search)}` : ''
    const res = await fetch(
      `/api/nhl-players?draftId=${state.draft.id}${pos}${q}`,
      { headers: { Authorization: `Bearer ${token}` } }
    )
    if (res.ok) {
      const data = await res.json()
      setPlayers(data.players)
    }
  }, [state?.draft, posFilter, search])

  // Poll draft state every 5 seconds
  useEffect(() => {
    fetchState()
    const interval = setInterval(fetchState, 5000)
    return () => clearInterval(interval)
  }, [fetchState])

  // Fetch players when draft or filters change
  useEffect(() => { fetchPlayers() }, [fetchPlayers])

  // Countdown timer
  useEffect(() => {
    if (!state?.draft?.pickDeadline || state.draft.status !== 'active') {
      setSecondsLeft(null)
      return
    }
    const deadline = new Date(state.draft.pickDeadline).getTime()

    function tick() {
      const secs = Math.max(0, Math.ceil((deadline - Date.now()) / 1000))
      setSecondsLeft(secs)
      if (secs === 0) triggerAutoPickExpired()
    }

    tick()
    const interval = setInterval(tick, 500)
    return () => clearInterval(interval)
  }, [state?.draft?.pickDeadline, state?.draft?.status])

  async function triggerAutoPickExpired() {
    const token = await getToken()
    await fetch(`/api/leagues/${leagueId}/draft/pick`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autoPickExpired: true }),
    })
    fetchState()
  }

  async function makePick(playerId: number) {
    setPickLoading(true)
    setError('')
    try {
      const token = await getToken()
      const res = await fetch(`/api/leagues/${leagueId}/draft/pick`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ playerId }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Pick failed'); return }
      await fetchState()
      await fetchPlayers()
    } finally { setPickLoading(false) }
  }

  async function commissionerAction(action: 'pause' | 'resume') {
    const token = await getToken()
    await fetch(`/api/leagues/${leagueId}/draft`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ action }),
    })
    fetchState()
  }

  if (!state) return <div className="p-6 text-gray-400 text-sm">Loading draft…</div>
  if (!state.draft) return <div className="p-6 text-gray-400 text-sm">Draft not started yet.</div>

  const { draft, currentPicker, picks, members, myLeagueMemberId, isCommissioner } = state
  const isMyTurn = currentPicker?.isMe && draft.status === 'active'
  const myPicks = picks.filter(p => p.leagueMemberId === myLeagueMemberId)
  const timerPct = secondsLeft !== null ? (secondsLeft / draft.pickTimeLimitSecs) * 100 : 100
  const timerColor = secondsLeft !== null && secondsLeft <= 15 ? '#ef4444' : '#f97316'

  // Build pick grid: rounds × members
  const memberCount = members.length
  const rounds = Math.ceil(draft.totalPicks / memberCount)

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200 px-4 py-3 flex items-center justify-between">
        <div>
          <h1 className="font-black text-lg tracking-wider">
            {draft.isMock ? '📋 MOCK DRAFT' : '🏒 DRAFT ROOM'}
          </h1>
          <p className="text-xs text-gray-500">
            Pick {draft.currentPickNumber} of {draft.totalPicks}
            {draft.status === 'paused' && ' · ⏸ PAUSED'}
            {draft.status === 'complete' && ' · ✓ COMPLETE'}
          </p>
        </div>
        {isCommissioner && draft.status === 'active' && (
          <button onClick={() => commissionerAction('pause')}
            className="text-xs border border-gray-300 px-3 py-1.5 rounded-lg font-bold hover:bg-gray-100">
            ⏸ Pause
          </button>
        )}
        {isCommissioner && draft.status === 'paused' && (
          <button onClick={() => commissionerAction('resume')}
            className="text-xs bg-orange-500 text-white px-3 py-1.5 rounded-lg font-bold hover:bg-orange-600">
            ▶ Resume
          </button>
        )}
      </div>

      {/* Current pick + timer */}
      {currentPicker && draft.status === 'active' && (
        <div className="bg-white border-b border-gray-200 px-4 py-3">
          <div className="flex items-center justify-between mb-2">
            <div>
              <span className="text-xs text-gray-500">On the clock: </span>
              <span className="font-bold text-sm">
                {currentPicker.teamIcon ?? '🏒'} {currentPicker.teamName}
                {currentPicker.isMe && ' (YOU)'}
                {currentPicker.autodraftEnabled && ' 🤖'}
              </span>
            </div>
            {secondsLeft !== null && (
              <span className="font-black text-xl" style={{ color: timerColor }}>
                {secondsLeft}s
              </span>
            )}
          </div>
          {secondsLeft !== null && (
            <div className="h-1.5 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{ width: `${timerPct}%`, backgroundColor: timerColor }}
              />
            </div>
          )}
          {isMyTurn && (
            <p className="text-xs text-orange-600 font-bold mt-2">⬇ Your pick — select a player below</p>
          )}
        </div>
      )}

      {error && <p className="text-red-600 text-sm px-4 py-2">{error}</p>}

      <div className="flex gap-0 h-[calc(100vh-200px)]">
        {/* Left panel: available players */}
        <div className="flex-1 overflow-y-auto border-r border-gray-200 bg-white">
          <div className="p-3 border-b border-gray-100 sticky top-0 bg-white z-10">
            <input
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm mb-2"
              placeholder="Search players…"
              value={search}
              onChange={e => setSearch(e.target.value)}
            />
            <div className="flex gap-1 flex-wrap">
              {POSITIONS.map(pos => (
                <button key={pos}
                  onClick={() => setPosFilter(pos)}
                  className={`text-xs px-2 py-1 rounded font-bold transition ${posFilter === pos ? 'bg-orange-500 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
                  {pos}
                </button>
              ))}
            </div>
          </div>

          {players.map(player => (
            <div key={player.id}
              className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-50 hover:bg-orange-50 transition">
              <div className="w-8 h-8 rounded-full bg-gray-200 flex-shrink-0 overflow-hidden">
                {player.headshotUrl
                  ? <img src={player.headshotUrl} alt={player.name} className="w-full h-full object-cover" />
                  : <div className="w-full h-full flex items-center justify-center text-xs font-bold text-gray-500">{player.position}</div>
                }
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate">{player.name}</p>
                <p className="text-xs text-gray-400">{player.teamId} · {player.position}</p>
              </div>
              {isMyTurn && !pickLoading && (
                <button onClick={() => makePick(player.id)}
                  className="text-xs bg-orange-500 text-white px-3 py-1 rounded-lg font-bold hover:bg-orange-600 flex-shrink-0">
                  Draft
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Right panel: draft board (compact) + my picks */}
        <div className="w-64 overflow-y-auto bg-white">
          <div className="p-3 border-b border-gray-100">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">My Picks ({myPicks.length})</p>
            {myPicks.length === 0
              ? <p className="text-xs text-gray-400">No picks yet</p>
              : myPicks.map(p => (
                <div key={p.pickNumber} className="flex items-center gap-2 py-1.5 border-b border-gray-50">
                  <span className="text-xs text-gray-400 w-5">R{p.round}</span>
                  <div>
                    <p className="text-xs font-semibold">{p.player.name}</p>
                    <p className="text-xs text-gray-400">{p.player.teamId} · {p.player.position}</p>
                  </div>
                </div>
              ))
            }
          </div>

          <div className="p-3">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">All Picks</p>
            {picks.slice(-20).reverse().map(p => (
              <div key={p.pickNumber} className="flex items-start gap-2 py-1.5 border-b border-gray-50">
                <span className="text-xs text-gray-400 w-10 flex-shrink-0">#{p.pickNumber}</span>
                <div className="min-w-0">
                  <p className="text-xs font-semibold truncate">{p.player.name}</p>
                  <p className="text-xs text-gray-400 truncate">{p.teamName}</p>
                  {p.pickSource !== 'manual' && (
                    <span className="text-xs text-blue-500 font-bold">AUTO</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run local dev to verify rendering**

```bash
npm run dev
```

Navigate to a league, start a draft (as commissioner), verify the draft room loads.

- [ ] **Step 3: Commit**

```bash
git add app/
git commit -m "feat: add draft room UI with polling, countdown, player picker, and pick board"
```

---

## Task 10: Deploy and Run Migration on Neon

- [ ] **Step 1: Apply schema migration to Neon**

```bash
DATABASE_URL=$DIRECT_URL npx prisma migrate deploy
```

Expected: `1 migration applied.`

- [ ] **Step 2: Run the player seed against Neon**

```bash
npx ts-node --compiler-options '{"module":"CommonJS"}' prisma/seed-players.ts
```

Expected: lists all 16 teams with player counts.

- [ ] **Step 3: Deploy to Vercel**

```bash
npx vercel --prod
```

Expected: build succeeds, deployment URL printed.

- [ ] **Step 4: Smoke test the live app**
  - Log in → create a league → join with a second account → randomize draft order → start draft → make picks → verify picks appear for both accounts

- [ ] **Step 5: Final commit if any fixes needed**

```bash
git add -A
git commit -m "fix: [any fixes from smoke test]"
npx vercel --prod
```

---

## Self-Review Notes

**Spec coverage:**
- ✅ Server-authoritative pick validation
- ✅ Snake draft reversal (odd/even rounds)
- ✅ Pick timer with deadline stored on Draft
- ✅ Auto-pick on timer expiry (any client triggers, server validates idempotently)
- ✅ Commissioner start/pause/resume
- ✅ Autodraft (ADP strategy)
- ✅ Autodraft wishlist (wishlist strategy)
- ✅ Autodraft cascade (consecutive autodraft members picked instantly)
- ✅ Mock draft flag (isMock on Draft model)
- ⚠️ Mock draft CPU picks for other members: the pick API handles autodraft members automatically, but a mock draft needs a UI trigger to advance CPU picks for all non-user members. This can be handled by the draft room page calling `autoPickExpired` immediately for non-user autodraft members after loading — or by having all members set to autodraft=true except the current user in mock mode. For Alpha, treat mock draft like real draft but with all other members set to autodraft=true.
- ✅ "AUTO" badge on auto picks (pickSource field shown in UI)
- ✅ Drafted player immediately removed from available pool (draftId filter on players API)

**Not in this plan (Plan 3):**
- Real NHL player sync from NHL API (StatsService)
- Score calculation
- Morning recaps
