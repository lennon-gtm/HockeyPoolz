# League Setup v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single `playersPerTeam` roster size with per-position caps (F/D/G), add draft date/time scheduling with a countdown + edit-lock, and introduce a dedicated Draft Settings page accessible from the league lobby.

**Architecture:** Schema gets three `roster*` Int columns on `League` and a nullable `scheduledStartAt` on `Draft`. The draft engine stays identical — callers compute `F + D + G` where they used to pass `playersPerTeam`. A new `PATCH /api/leagues/[id]` handles commissioner edits of roster caps + schedule; a new `/league/[id]/draft-settings` page hosts the UI. The lobby gains a ⚙ gear icon and a countdown card that references the schedule.

**Tech Stack:** Prisma + Postgres (Neon), Next.js 16 App Router, Tailwind, Firebase Auth, Vitest, pg adapter.

---

## File Structure

**New files:**

- `prisma/migrations/<timestamp>_roster_caps_and_draft_schedule/migration.sql` — DB migration
- `lib/roster.ts` — pure helper (`rosterTotal({rosterForwards, rosterDefense, rosterGoalies})`)
- `__tests__/lib/roster.test.ts` — unit test for the helper
- `components/roster-sliders.tsx` — reusable 3-up slider control (F / D / G) with live total
- `app/(app)/league/[id]/draft-settings/page.tsx` — Draft Settings page (roster + schedule + pick timer, commissioner editable)
- `app/api/leagues/[id]/schedule/route.ts` — `PATCH` endpoint for commissioner edits of roster caps + schedule + pick timer (guard: must be setup + >60s out)

**Modified files:**

- `prisma/schema.prisma` — drop `playersPerTeam`, add `rosterForwards`, `rosterDefense`, `rosterGoalies` on `League`; add `scheduledStartAt DateTime?` on `Draft`
- `app/api/leagues/route.ts` — accept `{ rosterForwards, rosterDefense, rosterGoalies }` on POST
- `app/api/leagues/[id]/route.ts` — no code change needed (relies on default include), but verified the new fields surface
- `app/api/leagues/[id]/draft/route.ts` — POST and PATCH use `rosterTotal(league)` not `playersPerTeam`; `start` action now refuses if `scheduledStartAt > now + 60s` unless commissioner force-starts
- `app/api/leagues/[id]/draft/pick/route.ts` — use `rosterTotal(league)` instead of `playersPerTeam`
- `app/api/leagues/[id]/draft/state/route.ts` — use `rosterTotal(league)` instead of `playersPerTeam`
- `app/(app)/league/create/page.tsx` — step 1 replaces single slider with `<RosterSliders>`
- `app/(app)/league/[id]/page.tsx` — stat-card "Draft" cell becomes a countdown when `scheduledStartAt` is set; add ⚙ link button pointing to `draft-settings`
- `__tests__/lib/draft-engine.test.ts` — rename copy to reference "roster total" and keep signature test

---

## Task 1: Prisma migration — roster caps & draft schedule

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_roster_caps_and_draft_schedule/migration.sql`

- [ ] **Step 1: Update the schema file**

In `prisma/schema.prisma`, inside `model League`, remove the line:

```prisma
  playersPerTeam Int          @default(10) @map("players_per_team")
```

And add in its place:

```prisma
  rosterForwards Int          @default(9) @map("roster_forwards")
  rosterDefense  Int          @default(4) @map("roster_defense")
  rosterGoalies  Int          @default(2) @map("roster_goalies")
```

Inside `model Draft`, below the `pickTimeLimitSecs` line, add:

```prisma
  scheduledStartAt  DateTime? @map("scheduled_start_at")
```

- [ ] **Step 2: Generate the migration SQL file**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx prisma migrate dev --name roster_caps_and_draft_schedule --create-only
```

Expected: a new directory under `prisma/migrations/` is created. Open the SQL file — Prisma will generate `DROP COLUMN "players_per_team"` and the three `ADD COLUMN` statements for `roster_*`, plus `ADD COLUMN "scheduled_start_at"` on `drafts`.

- [ ] **Step 3: Add a backfill before the drop**

Prisma's generated migration drops `players_per_team` first, but existing rows would lose data if the new columns aren't populated. Edit the migration SQL so the file ends up as:

```sql
-- AlterTable
ALTER TABLE "leagues" ADD COLUMN "roster_forwards" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "leagues" ADD COLUMN "roster_defense"  INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "leagues" ADD COLUMN "roster_goalies"  INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "leagues" DROP COLUMN "players_per_team";

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN "scheduled_start_at" TIMESTAMP(3);
```

(Defaults cover the backfill — every existing league gets 9/4/2 = 15 total.)

- [ ] **Step 4: Apply the migration**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx prisma migrate dev
```

Expected: migration applies and `npx prisma generate` runs automatically. No errors.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add prisma/schema.prisma prisma/migrations && git commit -m "feat(schema): replace playersPerTeam with F/D/G caps and add draft schedule"
```

---

## Task 2: `lib/roster.ts` helper + test

**Files:**
- Create: `lib/roster.ts`
- Create: `__tests__/lib/roster.test.ts`

- [ ] **Step 1: Write the failing test**

Create `__tests__/lib/roster.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { rosterTotal } from '../../lib/roster'

describe('rosterTotal', () => {
  it('sums F + D + G', () => {
    expect(rosterTotal({ rosterForwards: 9, rosterDefense: 4, rosterGoalies: 2 })).toBe(15)
    expect(rosterTotal({ rosterForwards: 1, rosterDefense: 1, rosterGoalies: 1 })).toBe(3)
    expect(rosterTotal({ rosterForwards: 12, rosterDefense: 8, rosterGoalies: 4 })).toBe(24)
  })
})
```

- [ ] **Step 2: Run the test — it should fail**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx vitest run __tests__/lib/roster.test.ts 2>&1 | tail -10
```

Expected: FAIL with "Cannot find module '../../lib/roster'".

- [ ] **Step 3: Create the helper**

Create `lib/roster.ts`:

```ts
export interface RosterCaps {
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
}

export function rosterTotal(caps: RosterCaps): number {
  return caps.rosterForwards + caps.rosterDefense + caps.rosterGoalies
}
```

- [ ] **Step 4: Run the test — it should pass**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx vitest run __tests__/lib/roster.test.ts 2>&1 | tail -10
```

Expected: `1 passed`.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add lib/roster.ts __tests__/lib/roster.test.ts && git commit -m "feat: add rosterTotal helper"
```

---

## Task 3: Update `POST /api/leagues` to accept F/D/G

**Files:**
- Modify: `app/api/leagues/route.ts`

- [ ] **Step 1: Update the POST handler**

Replace the entire `POST` function body (lines 6–48) in `app/api/leagues/route.ts` with:

```ts
export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const body = await request.json()
    const { name, maxTeams, rosterForwards, rosterDefense, rosterGoalies } = body

    if (!name || typeof name !== 'string' || name.trim().length < 2) {
      return NextResponse.json({ error: 'League name must be at least 2 characters' }, { status: 400 })
    }
    if (!maxTeams || typeof maxTeams !== 'number' || maxTeams < 2 || maxTeams > 20) {
      return NextResponse.json({ error: 'Max teams must be between 2 and 20' }, { status: 400 })
    }
    if (typeof rosterForwards !== 'number' || rosterForwards < 1 || rosterForwards > 12) {
      return NextResponse.json({ error: 'Forwards must be 1–12' }, { status: 400 })
    }
    if (typeof rosterDefense !== 'number' || rosterDefense < 1 || rosterDefense > 8) {
      return NextResponse.json({ error: 'Defensemen must be 1–8' }, { status: 400 })
    }
    if (typeof rosterGoalies !== 'number' || rosterGoalies < 1 || rosterGoalies > 4) {
      return NextResponse.json({ error: 'Goalies must be 1–4' }, { status: 400 })
    }

    const league = await prisma.league.create({
      data: {
        commissionerId: user.id,
        name: name.trim(),
        inviteCode: nanoid(8),
        maxTeams,
        rosterForwards,
        rosterDefense,
        rosterGoalies,
        scoringSettings: {
          create: {},
        },
      },
      include: { scoringSettings: true },
    })

    return NextResponse.json({ league }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add app/api/leagues/route.ts && git commit -m "feat(api): accept F/D/G roster caps on league create"
```

---

## Task 4: Update draft callers to use `rosterTotal`

**Files:**
- Modify: `app/api/leagues/[id]/draft/pick/route.ts`
- Modify: `app/api/leagues/[id]/draft/state/route.ts`

- [ ] **Step 1: Update the pick route**

Open `app/api/leagues/[id]/draft/pick/route.ts`, find the line that reads `league.playersPerTeam` (around line 38):

```ts
const totalPicks = getTotalPicks(allMembers.length, league.playersPerTeam)
```

Replace with:

```ts
const totalPicks = getTotalPicks(allMembers.length, rosterTotal(league))
```

Add the import at the top of the file (next to the existing imports):

```ts
import { rosterTotal } from '@/lib/roster'
```

- [ ] **Step 2: Update the state route**

Open `app/api/leagues/[id]/draft/state/route.ts`, find the line (around line 46):

```ts
const totalPicks = getTotalPicks(members.length, league.playersPerTeam)
```

Replace with:

```ts
const totalPicks = getTotalPicks(members.length, rosterTotal(league))
```

Add the same import at the top:

```ts
import { rosterTotal } from '@/lib/roster'
```

- [ ] **Step 3: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 4: Run existing tests**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -10
```

Expected: all tests pass (38 including new roster test).

- [ ] **Step 5: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add app/api/leagues/[id]/draft/pick/route.ts app/api/leagues/[id]/draft/state/route.ts && git commit -m "feat(draft): use rosterTotal in pick and state handlers"
```

---

## Task 5: `PATCH /api/leagues/[id]/schedule` endpoint

**Files:**
- Create: `app/api/leagues/[id]/schedule/route.ts`

- [ ] **Step 1: Create the endpoint**

Create `app/api/leagues/[id]/schedule/route.ts`:

```ts
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

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draft: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.commissionerId !== user.id) return NextResponse.json({ error: 'Commissioner only' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'Settings are locked once the draft has started' }, { status: 400 })

    // If a draft already exists and is scheduled within 60 seconds, block edits
    if (league.draft?.scheduledStartAt) {
      const msToStart = league.draft.scheduledStartAt.getTime() - Date.now()
      if (msToStart < 60_000) {
        return NextResponse.json({ error: 'Too close to draft start — settings are locked' }, { status: 400 })
      }
    }

    const body = await request.json().catch(() => ({}))
    const { rosterForwards, rosterDefense, rosterGoalies, scheduledStartAt, pickTimeLimitSecs } = body

    const leagueUpdate: Record<string, unknown> = {}
    if (rosterForwards !== undefined) {
      if (typeof rosterForwards !== 'number' || rosterForwards < 1 || rosterForwards > 12) {
        return NextResponse.json({ error: 'Forwards must be 1–12' }, { status: 400 })
      }
      leagueUpdate.rosterForwards = rosterForwards
    }
    if (rosterDefense !== undefined) {
      if (typeof rosterDefense !== 'number' || rosterDefense < 1 || rosterDefense > 8) {
        return NextResponse.json({ error: 'Defensemen must be 1–8' }, { status: 400 })
      }
      leagueUpdate.rosterDefense = rosterDefense
    }
    if (rosterGoalies !== undefined) {
      if (typeof rosterGoalies !== 'number' || rosterGoalies < 1 || rosterGoalies > 4) {
        return NextResponse.json({ error: 'Goalies must be 1–4' }, { status: 400 })
      }
      leagueUpdate.rosterGoalies = rosterGoalies
    }

    if (Object.keys(leagueUpdate).length > 0) {
      await prisma.league.update({ where: { id: leagueId }, data: leagueUpdate })
    }

    const draftUpdate: Record<string, unknown> = {}
    if (scheduledStartAt !== undefined) {
      if (scheduledStartAt === null) {
        draftUpdate.scheduledStartAt = null
      } else if (typeof scheduledStartAt === 'string') {
        const d = new Date(scheduledStartAt)
        if (isNaN(d.getTime())) return NextResponse.json({ error: 'Invalid scheduledStartAt' }, { status: 400 })
        draftUpdate.scheduledStartAt = d
      } else {
        return NextResponse.json({ error: 'scheduledStartAt must be ISO string or null' }, { status: 400 })
      }
    }
    if (pickTimeLimitSecs !== undefined) {
      if (typeof pickTimeLimitSecs !== 'number' || pickTimeLimitSecs < 30 || pickTimeLimitSecs > 300) {
        return NextResponse.json({ error: 'Pick time limit must be 30–300 seconds' }, { status: 400 })
      }
      draftUpdate.pickTimeLimitSecs = pickTimeLimitSecs
    }

    if (Object.keys(draftUpdate).length > 0) {
      if (league.draft) {
        await prisma.draft.update({ where: { leagueId }, data: draftUpdate })
      } else {
        await prisma.draft.create({
          data: {
            leagueId,
            pickTimeLimitSecs: typeof pickTimeLimitSecs === 'number' ? pickTimeLimitSecs : 90,
            scheduledStartAt: draftUpdate.scheduledStartAt as Date | null | undefined,
          },
        })
      }
    }

    const updated = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { draft: true },
    })
    return NextResponse.json({ league: updated })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('PATCH /api/leagues/[id]/schedule error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add app/api/leagues/[id]/schedule/route.ts && git commit -m "feat(api): add PATCH /leagues/[id]/schedule for commissioner edits"
```

---

## Task 6: `RosterSliders` component

**Files:**
- Create: `components/roster-sliders.tsx`

- [ ] **Step 1: Create the component**

Create `components/roster-sliders.tsx`:

```tsx
'use client'

export interface RosterValues {
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
}

interface Props {
  value: RosterValues
  onChange: (next: RosterValues) => void
  disabled?: boolean
}

interface Row {
  key: keyof RosterValues
  label: string
  min: number
  max: number
}

const ROWS: Row[] = [
  { key: 'rosterForwards', label: 'Forwards', min: 1, max: 12 },
  { key: 'rosterDefense',  label: 'Defensemen', min: 1, max: 8 },
  { key: 'rosterGoalies',  label: 'Goalies',  min: 1, max: 4 },
]

export function RosterSliders({ value, onChange, disabled }: Props) {
  const total = value.rosterForwards + value.rosterDefense + value.rosterGoalies

  return (
    <div>
      {ROWS.map(row => (
        <div key={row.key} className="mb-4">
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-[#121212]">{row.label}</label>
            <span className="text-sm font-black text-[#121212]">{value[row.key]}</span>
          </div>
          <input
            type="range"
            min={row.min}
            max={row.max}
            value={value[row.key]}
            disabled={disabled}
            onChange={e => onChange({ ...value, [row.key]: Number(e.target.value) })}
            className="w-full accent-orange-500 disabled:opacity-50"
          />
        </div>
      ))}
      <p className="text-xs text-[#98989e] font-bold uppercase tracking-widest">Total: {total} players per team</p>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/roster-sliders.tsx && git commit -m "feat: add RosterSliders component"
```

---

## Task 7: Update create-league wizard to use `RosterSliders`

**Files:**
- Modify: `app/(app)/league/create/page.tsx`

- [ ] **Step 1: Replace the roster state and the "Players per Team" slider**

Open `app/(app)/league/create/page.tsx`.

Add the import near the other imports at the top:

```tsx
import { RosterSliders, type RosterValues } from '@/components/roster-sliders'
```

Replace this single-slider state (around line 40):

```tsx
const [playersPerTeam, setPlayersPerTeam] = useState(10)
```

with:

```tsx
const [roster, setRoster] = useState<RosterValues>({
  rosterForwards: 9,
  rosterDefense: 4,
  rosterGoalies: 2,
})
```

Find the `createLeague` body (around line 60) and change the POST body:

```tsx
body: JSON.stringify({ name, maxTeams, playersPerTeam }),
```

to:

```tsx
body: JSON.stringify({ name, maxTeams, ...roster }),
```

Find the markup that renders the single "Players per Team" slider (around lines 158–160):

```tsx
<label className="block text-sm font-semibold mb-1">Players per Team ({playersPerTeam})</label>
<input type="range" min={4} max={20} value={playersPerTeam} onChange={e => setPlayersPerTeam(+e.target.value)}
  className="w-full mb-6 accent-orange-500" />
```

Replace with:

```tsx
<label className="block text-sm font-semibold mb-2">Roster</label>
<div className="mb-6">
  <RosterSliders value={roster} onChange={setRoster} />
</div>
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/create/page.tsx" && git commit -m "feat(create): use RosterSliders in create wizard"
```

---

## Task 8: Draft Settings page (commissioner-editable)

**Files:**
- Create: `app/(app)/league/[id]/draft-settings/page.tsx`

- [ ] **Step 1: Create the page**

Create `app/(app)/league/[id]/draft-settings/page.tsx`:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { auth } from '@/lib/firebase/client'
import { RosterSliders, type RosterValues } from '@/components/roster-sliders'

interface LeagueDetail {
  id: string
  commissionerId: string
  rosterForwards: number
  rosterDefense: number
  rosterGoalies: number
  status: string
  draft: {
    id: string
    scheduledStartAt: string | null
    pickTimeLimitSecs: number
    status: string
  } | null
}

export default function DraftSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roster, setRoster] = useState<RosterValues>({ rosterForwards: 9, rosterDefense: 4, rosterGoalies: 2 })
  const [scheduledDate, setScheduledDate] = useState('')
  const [scheduledTime, setScheduledTime] = useState('')
  const [pickTimeLimitSecs, setPickTimeLimitSecs] = useState(90)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const [leagueRes, draftRes, meRes] = await Promise.all([
        fetch(`/api/leagues/${id}`, { headers }),
        fetch(`/api/leagues/${id}/draft`, { headers }),
        fetch('/api/auth/me', { headers }),
      ])
      if (!leagueRes.ok || !meRes.ok) { setError('Failed to load'); return }
      const leagueJson = await leagueRes.json()
      const draftJson = draftRes.ok ? await draftRes.json() : { draft: null }
      const meJson = await meRes.json()
      const merged: LeagueDetail = { ...leagueJson.league, draft: draftJson.draft }
      setLeague(merged)
      setMyUserId(meJson.user.id)
      setRoster({
        rosterForwards: merged.rosterForwards,
        rosterDefense: merged.rosterDefense,
        rosterGoalies: merged.rosterGoalies,
      })
      if (merged.draft?.scheduledStartAt) {
        const d = new Date(merged.draft.scheduledStartAt)
        setScheduledDate(d.toISOString().slice(0, 10))
        setScheduledTime(d.toTimeString().slice(0, 5))
      }
      if (merged.draft) setPickTimeLimitSecs(merged.draft.pickTimeLimitSecs)
    }
    load()
  }, [id])

  if (!league) return <div className="p-6 text-sm text-[#98989e]">Loading…</div>

  const isCommissioner = myUserId === league.commissionerId
  const locked = league.status !== 'setup'
  const lockedByTime = !!league.draft?.scheduledStartAt
    && new Date(league.draft.scheduledStartAt).getTime() - Date.now() < 60_000
  const disabled = !isCommissioner || locked || lockedByTime

  async function save() {
    setSaving(true)
    setError('')
    setSaved(false)
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in'); return }
      const scheduledStartAt = scheduledDate && scheduledTime
        ? new Date(`${scheduledDate}T${scheduledTime}:00`).toISOString()
        : null
      const res = await fetch(`/api/leagues/${id}/schedule`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...roster, scheduledStartAt, pickTimeLimitSecs }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to save')
        return
      }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } finally { setSaving(false) }
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="text-xs text-[#98989e] mb-3 font-semibold hover:text-[#515151]">
          ← Back
        </button>
        <h1 className="text-xl font-black tracking-tight text-[#121212] mb-1">Draft Settings</h1>
        <p className="text-xs text-[#98989e] font-semibold mb-6">
          {isCommissioner ? 'Commissioner-only · Editable until 1 minute before draft start' : 'Read-only'}
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Roster</p>
          <RosterSliders value={roster} onChange={setRoster} disabled={disabled} />
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Draft Schedule</p>
          <div className="grid grid-cols-2 gap-2 mb-2">
            <input
              type="date"
              value={scheduledDate}
              disabled={disabled}
              onChange={e => setScheduledDate(e.target.value)}
              className="border-2 border-[#eeeeee] rounded-xl p-3 text-sm focus:border-orange-500 outline-none disabled:opacity-50"
            />
            <input
              type="time"
              value={scheduledTime}
              disabled={disabled}
              onChange={e => setScheduledTime(e.target.value)}
              className="border-2 border-[#eeeeee] rounded-xl p-3 text-sm focus:border-orange-500 outline-none disabled:opacity-50"
            />
          </div>
          <p className="text-[10px] text-[#98989e]">Editable until 1 minute before draft start.</p>
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Pick Timer</p>
          <div className="flex items-center justify-between mb-1">
            <label className="text-sm font-semibold text-[#121212]">Seconds per pick</label>
            <span className="text-sm font-black text-[#121212]">{pickTimeLimitSecs}s</span>
          </div>
          <input
            type="range"
            min={30}
            max={300}
            step={5}
            value={pickTimeLimitSecs}
            disabled={disabled}
            onChange={e => setPickTimeLimitSecs(Number(e.target.value))}
            className="w-full accent-orange-500 disabled:opacity-50"
          />
        </section>

        <section className="mb-8">
          <p className="text-xs font-bold text-[#98989e] uppercase tracking-widest mb-3">Scoring</p>
          <Link
            href={`/league/${id}/settings`}
            className="block text-center py-3 border-2 border-[#eeeeee] rounded-xl text-sm font-bold text-[#121212] hover:border-gray-400 transition"
          >
            Scoring Settings →
          </Link>
        </section>

        {isCommissioner && (
          <button
            onClick={save}
            disabled={saving || disabled}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40"
          >
            {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Settings'}
          </button>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft-settings/page.tsx" && git commit -m "feat: add Draft Settings page"
```

---

## Task 9: Lobby ⚙ icon + scheduled-draft countdown

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Update the `LeagueDetail` and `Draft` interfaces**

Open `app/(app)/league/[id]/page.tsx`. Find the existing interfaces near the top. Replace:

```tsx
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
```

with:

```tsx
interface LeagueDetail {
  id: string; name: string; inviteCode: string; status: string
  maxTeams: number
  rosterForwards: number; rosterDefense: number; rosterGoalies: number
  commissioner: { displayName: string }
  commissionerId: string
  members: Member[]
}
interface Draft {
  id: string; status: string; currentPickNumber: number; isMock: boolean
  pickTimeLimitSecs: number
  scheduledStartAt: string | null
}
```

- [ ] **Step 2: Replace the "X/Y teams · N players per team" subtitle**

Find the paragraph that currently reads:

```tsx
<p className="text-xs text-[#98989e] font-semibold mt-0.5">
  {isCommissioner ? '👑 Commissioner · ' : ''}{league.members.length}/{league.maxTeams} Teams · {league.status === 'setup' ? 'Setup' : league.status === 'draft' ? 'Drafting' : league.status === 'active' ? 'Active' : 'Complete'}
</p>
```

Leave that line alone (it doesn't mention `playersPerTeam` anymore) and instead add a ⚙ button next to the title. Update the whole "header" block:

```tsx
<div className="flex items-start justify-between mb-4">
  <div>
    <h1 className="text-xl font-black tracking-tight text-[#121212]">{league.name}</h1>
    <p className="text-xs text-[#98989e] font-semibold mt-0.5">
      {isCommissioner ? '👑 Commissioner · ' : ''}{league.members.length}/{league.maxTeams} Teams · {league.status === 'setup' ? 'Setup' : league.status === 'draft' ? 'Drafting' : league.status === 'active' ? 'Active' : 'Complete'}
    </p>
  </div>
</div>
```

to:

```tsx
<div className="flex items-start justify-between mb-4">
  <div>
    <h1 className="text-xl font-black tracking-tight text-[#121212]">{league.name}</h1>
    <p className="text-xs text-[#98989e] font-semibold mt-0.5">
      {isCommissioner ? '👑 Commissioner · ' : ''}{league.members.length}/{league.maxTeams} Teams · {league.status === 'setup' ? 'Setup' : league.status === 'draft' ? 'Drafting' : league.status === 'active' ? 'Active' : 'Complete'}
    </p>
  </div>
  <Link
    href={`/league/${id}/draft-settings`}
    className="w-9 h-9 flex items-center justify-center rounded-full border border-[#eeeeee] text-[#515151] hover:border-gray-400 hover:text-[#121212] transition"
    aria-label="Draft settings"
  >
    ⚙
  </Link>
</div>
```

- [ ] **Step 3: Replace the "Draft" stat card with a countdown**

Find the StatCard grid (still around the same area):

```tsx
{league.status === 'setup' && (
  <div className="grid grid-cols-3 gap-1.5 mb-4">
    <StatCard value={`${league.members.length}/${league.maxTeams}`} label="Teams" />
    <StatCard value="—" label="Draft" />
    <StatCard value={`${draft?.pickTimeLimitSecs ?? 90}s`} label="Per Pick" />
  </div>
)}
```

Replace with:

```tsx
{league.status === 'setup' && (
  <div className="grid grid-cols-3 gap-1.5 mb-4">
    <StatCard value={`${league.members.length}/${league.maxTeams}`} label="Teams" />
    <StatCard value={formatDraftCell(draft?.scheduledStartAt ?? null)} label="Draft" />
    <StatCard value={`${draft?.pickTimeLimitSecs ?? 90}s`} label="Per Pick" />
  </div>
)}
```

- [ ] **Step 4: Add the `formatDraftCell` helper at the bottom of the file**

At the very bottom of `app/(app)/league/[id]/page.tsx` (below the default export's closing brace), add:

```tsx
function formatDraftCell(iso: string | null): string {
  if (!iso) return '—'
  const target = new Date(iso).getTime()
  const diffMs = target - Date.now()
  if (diffMs <= 0) return 'Now'
  const mins = Math.floor(diffMs / 60_000)
  if (mins < 60) return `${mins}m`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
```

- [ ] **Step 5: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/page.tsx" && git commit -m "feat(lobby): add settings gear and draft countdown"
```

---

## Task 10: Lock draft start when scheduled time is in the future

**Files:**
- Modify: `app/api/leagues/[id]/draft/route.ts`

- [ ] **Step 1: Update the `start` branch in PATCH**

Open `app/api/leagues/[id]/draft/route.ts`. Find the `if (action === 'start')` block (starts around line 89). Inside that block, **after** the "verify all members have draft positions" check and **before** the `pickDeadline` assignment, insert this guard:

```ts
      // If a scheduled start exists in the future (more than 60s out), refuse
      if (draft.scheduledStartAt && draft.scheduledStartAt.getTime() - Date.now() > 60_000) {
        return NextResponse.json({ error: 'Draft is scheduled — wait until the start time' }, { status: 400 })
      }
```

- [ ] **Step 2: TypeScript check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/api/leagues/[id]/draft/route.ts" && git commit -m "feat(draft): block manual start when a future schedule is set"
```

---

## Task 11: Full build + test

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -15
```

Expected: all tests pass (existing 37 + 1 new roster test = 38).

- [ ] **Step 2: Run the build**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npm run build 2>&1 | tail -30
```

Expected: build completes with no errors. `/league/[id]/draft-settings` appears in the route list.

- [ ] **Step 3: If any errors, fix them and rebuild**

Common issues and fixes:
- Unused `Link` import: remove it if Task 9 didn't need it (check if `Link` is already imported — the lobby file already uses it, so no change needed).
- `Date` serialization: the API returns `scheduledStartAt` as an ISO string when serialized to JSON, so `string | null` in the `Draft` interface is correct.
- If a caller still references `league.playersPerTeam`, grep the codebase and replace with `rosterTotal(league)` or the specific `rosterForwards/Defense/Goalies` field.

After fixes, re-run steps 1 and 2.

---

## Acceptance criteria (manual smoke test)

- [ ] Create a new league — the "Roster" section shows 3 sliders (F 1–12 default 9 · D 1–8 default 4 · G 1–4 default 2) with a live total of `15 players per team`
- [ ] The league lands in setup status and the lobby shows the ⚙ gear in the top-right
- [ ] Tap ⚙ → Draft Settings page renders with the current values editable (you're the commissioner)
- [ ] Change Roster sliders, set a date + time 10 minutes in the future, change pick timer, press Save → the page shows "✓ Saved!"
- [ ] Reload the lobby — the "Draft" stat card now shows a human-readable countdown (`10m`, `2h`, `3d`)
- [ ] Commissioner tries to click "🚀 Start Draft" now → the server responds with "Draft is scheduled — wait until the start time" and the error banner renders
- [ ] As a non-commissioner member, opening `/league/[id]/draft-settings` shows the values as read-only (no Save button, inputs disabled)
- [ ] Edit settings to < 60s in the future and try to save again → server responds "Too close to draft start — settings are locked"
- [ ] Remove the schedule (leave date/time blank and save) → the lobby "Draft" card falls back to em-dash and Start Draft works normally
- [ ] Existing leagues (created before this migration) still open without error; their Roster shows 9/4/2 after migration

---

## Self-review notes

- **Spec coverage:** roster caps ✓ (Task 1, 6, 7, 8), draft schedule ✓ (Task 1, 5, 8, 9, 10), pick timer slider ✓ (Task 5, 8), scoring link ✓ (Task 8). Join-request gating is intentionally **out of scope** — that's Plan 8.
- **Type consistency:** `RosterValues` defined once in `components/roster-sliders.tsx` and re-used in create wizard + draft-settings page. `RosterCaps` in `lib/roster.ts` has the same shape but is imported separately in API routes (Prisma types will structurally match).
- **Migration safety:** dropping `players_per_team` is acceptable because Plan 7 makes the column unreachable from the code before the migration runs. Existing rows get default backfill values so no data is lost on the new columns; data in the dropped column is permanently gone (acceptable for Alpha).
- **No placeholders:** every task has exact paths, exact code, and exact commands.
