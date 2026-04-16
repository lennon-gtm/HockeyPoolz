# Invite Approvals Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Route non-commissioner join attempts through a `PendingJoinRequest` that the league commissioner must approve before a `LeagueMember` is created.

**Architecture:** A new `PendingJoinRequest` table captures the same team-setup fields that `LeagueMember` stores. `POST /api/leagues/[id]/join` becomes polymorphic — direct `LeagueMember` create when the caller is the commissioner, otherwise a `PendingJoinRequest`. A new commissioner-only review endpoint deletes the pending row and creates the real `LeagueMember`. The lobby gains a pending-count banner; a new review page lists requests. The holding screen after pending submit is static (no polling).

**Tech Stack:** Prisma + Postgres (Neon), Next.js 16 App Router, Tailwind, Firebase Auth.

---

## File Structure

**New files:**

- `prisma/migrations/<timestamp>_add_pending_join_requests/migration.sql` — creates `pending_join_requests` table
- `app/api/leagues/[id]/join-requests/route.ts` — `GET` (commissioner-only list) + `POST` (commissioner approves a specific request via body `{ requestId }` — simpler than a nested dynamic route)
- `app/(app)/league/[id]/join-requests/page.tsx` — review page listing pending requests, approve button per row

**Modified files:**

- `prisma/schema.prisma` — add `PendingJoinRequest` model, add `pendingJoinRequests` relation on `League`, `User`, `NhlTeam`
- `app/api/leagues/[id]/join/route.ts` — branch on `user.id === league.commissionerId`; otherwise create `PendingJoinRequest` instead of `LeagueMember` and return `{ status: 'pending' }`
- `app/(app)/join/[code]/page.tsx` — add a third step `'pending'` that renders the holding screen when the API responds with `status: 'pending'`
- `app/(app)/league/[id]/page.tsx` — add a commissioner-only banner that fetches the pending count on mount and links to the review page

---

## Task 1: Prisma schema + migration for `PendingJoinRequest`

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/<timestamp>_add_pending_join_requests/migration.sql`

- [ ] **Step 1: Update the schema file**

In `prisma/schema.prisma`, add relations on the three existing models. Find `model League` and add inside its relation block (after `recaps`):

```prisma
  pendingJoinRequests PendingJoinRequest[]
```

Find `model User` and add (after `recaps`):

```prisma
  pendingJoinRequests PendingJoinRequest[]
```

Find `model NhlTeam` and add (after `leagueMembers`):

```prisma
  pendingJoinRequests PendingJoinRequest[]
```

At the bottom of the schema file, below the last `@@map` (i.e. after the `PlayerGameStats` model), add:

```prisma
model PendingJoinRequest {
  id             String   @id @default(uuid())
  leagueId       String   @map("league_id")
  userId         String   @map("user_id")
  teamName       String   @map("team_name")
  teamIcon       String?  @map("team_icon")
  favoriteTeamId String?  @map("favorite_nhl_team_id")
  submittedAt    DateTime @default(now()) @map("submitted_at")

  league       League   @relation(fields: [leagueId], references: [id])
  user         User     @relation(fields: [userId], references: [id])
  favoriteTeam NhlTeam? @relation(fields: [favoriteTeamId], references: [id])

  @@unique([leagueId, userId])
  @@map("pending_join_requests")
}
```

- [ ] **Step 2: Generate the migration SQL**

Run: `cd c:/Users/Lenno/Projects/HockeyPoolz && npx prisma migrate dev --name add_pending_join_requests --create-only`

Expected: a new migration directory is created. Open the generated SQL and confirm it creates a `pending_join_requests` table with: `id` (uuid), `league_id`, `user_id`, `team_name`, `team_icon` (nullable), `favorite_nhl_team_id` (nullable), `submitted_at` (DEFAULT CURRENT_TIMESTAMP), a unique index on `(league_id, user_id)`, and three foreign keys.

If Prisma generated the SQL correctly you don't need to edit it. If for any reason it's missing a constraint, overwrite with:

```sql
-- CreateTable
CREATE TABLE "pending_join_requests" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "team_icon" TEXT,
    "favorite_nhl_team_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_join_requests_league_id_user_id_key" ON "pending_join_requests"("league_id", "user_id");

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_favorite_nhl_team_id_fkey" FOREIGN KEY ("favorite_nhl_team_id") REFERENCES "nhl_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
```

- [ ] **Step 3: Apply the migration**

Run: `cd c:/Users/Lenno/Projects/HockeyPoolz && npx prisma migrate dev`

Expected: migration applies cleanly; `prisma generate` produces the updated client.

- [ ] **Step 4: Commit**

Run:

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add prisma/schema.prisma prisma/migrations && git commit -m "feat(schema): add PendingJoinRequest model"
```

---

## Task 2: Route non-commissioner joins to `PendingJoinRequest`

**Files:**
- Modify: `app/api/leagues/[id]/join/route.ts`

- [ ] **Step 1: Replace the POST handler**

Open `app/api/leagues/[id]/join/route.ts` and replace the entire file with:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const { teamName, teamIcon, favoriteTeamId, inviteCode } = await request.json()

    const league = await prisma.league.findUnique({ where: { id } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.inviteCode !== inviteCode) return NextResponse.json({ error: 'Invalid invite code' }, { status: 403 })
    if (league.status !== 'setup') return NextResponse.json({ error: 'League is not accepting new members' }, { status: 400 })

    const memberCount = await prisma.leagueMember.count({ where: { leagueId: league.id } })
    if (memberCount >= league.maxTeams) return NextResponse.json({ error: 'League is full' }, { status: 400 })

    const existing = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
    })
    if (existing) return NextResponse.json({ error: 'Already a member' }, { status: 400 })

    if (!teamName || teamName.trim().length < 1) {
      return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
    }

    // Commissioner bypasses approval — creates their own LeagueMember directly
    if (user.id === league.commissionerId) {
      const member = await prisma.leagueMember.create({
        data: {
          leagueId: league.id,
          userId: user.id,
          teamName: teamName.trim(),
          teamIcon: teamIcon ?? null,
          favoriteTeamId: favoriteTeamId ?? null,
        },
      })
      return NextResponse.json({ status: 'approved', member }, { status: 201 })
    }

    // Non-commissioner: create a pending request (or update the existing one)
    const pending = await prisma.pendingJoinRequest.upsert({
      where: { leagueId_userId: { leagueId: league.id, userId: user.id } },
      update: {
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
      create: {
        leagueId: league.id,
        userId: user.id,
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
    })
    return NextResponse.json({ status: 'pending', request: pending }, { status: 202 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/join error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/api/leagues/[id]/join/route.ts" && git commit -m "feat(api): route non-commissioner joins to PendingJoinRequest"
```

---

## Task 3: `GET` + `POST` /api/leagues/[id]/join-requests (list + approve)

**Files:**
- Create: `app/api/leagues/[id]/join-requests/route.ts`

- [ ] **Step 1: Create the route file**

Create `app/api/leagues/[id]/join-requests/route.ts` with exactly:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

async function requireCommissioner(
  request: NextRequest,
  leagueId: string
): Promise<
  | { ok: true; userId: string }
  | { ok: false; response: NextResponse }
> {
  const token = getBearerToken(request.headers.get('authorization'))
  const decoded = await verifyIdToken(token)
  const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
  if (!user) return { ok: false, response: NextResponse.json({ error: 'User not found' }, { status: 404 }) }
  const league = await prisma.league.findUnique({ where: { id: leagueId } })
  if (!league) return { ok: false, response: NextResponse.json({ error: 'League not found' }, { status: 404 }) }
  if (league.commissionerId !== user.id) {
    return { ok: false, response: NextResponse.json({ error: 'Commissioner only' }, { status: 403 }) }
  }
  return { ok: true, userId: user.id }
}

// GET — list pending join requests (commissioner only)
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const auth = await requireCommissioner(request, leagueId)
    if (!auth.ok) return auth.response

    const requests = await prisma.pendingJoinRequest.findMany({
      where: { leagueId },
      include: {
        user: { select: { id: true, email: true, displayName: true, avatarUrl: true } },
        favoriteTeam: { select: { id: true, name: true, colorPrimary: true, colorSecondary: true } },
      },
      orderBy: { submittedAt: 'asc' },
    })

    return NextResponse.json({ requests, count: requests.length })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/join-requests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST — approve a pending request (commissioner only)
// Body: { requestId: string }
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id: leagueId } = await params
    const auth = await requireCommissioner(request, leagueId)
    if (!auth.ok) return auth.response

    const body = await request.json().catch(() => ({}))
    const { requestId } = body
    if (typeof requestId !== 'string' || requestId.length === 0) {
      return NextResponse.json({ error: 'requestId is required' }, { status: 400 })
    }

    const pending = await prisma.pendingJoinRequest.findUnique({
      where: { id: requestId },
    })
    if (!pending) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (pending.leagueId !== leagueId) {
      return NextResponse.json({ error: 'Request does not belong to this league' }, { status: 400 })
    }

    const league = await prisma.league.findUnique({ where: { id: leagueId } })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })
    if (league.status !== 'setup') {
      return NextResponse.json({ error: 'League is not accepting new members' }, { status: 400 })
    }

    const memberCount = await prisma.leagueMember.count({ where: { leagueId } })
    if (memberCount >= league.maxTeams) {
      return NextResponse.json({ error: 'League is full' }, { status: 400 })
    }

    const existing = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: pending.userId } },
    })
    if (existing) {
      // Clean up the stale pending row and return the existing member
      await prisma.pendingJoinRequest.delete({ where: { id: pending.id } })
      return NextResponse.json({ status: 'already_member', member: existing })
    }

    const [member] = await prisma.$transaction([
      prisma.leagueMember.create({
        data: {
          leagueId,
          userId: pending.userId,
          teamName: pending.teamName,
          teamIcon: pending.teamIcon,
          favoriteTeamId: pending.favoriteTeamId,
        },
      }),
      prisma.pendingJoinRequest.delete({ where: { id: pending.id } }),
    ])

    return NextResponse.json({ status: 'approved', member }, { status: 201 })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/leagues/[id]/join-requests error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

- [ ] **Step 2: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/api/leagues/[id]/join-requests/route.ts" && git commit -m "feat(api): add join-requests list + approve endpoints"
```

---

## Task 4: Holding screen on `/join/[code]` when response is pending

**Files:**
- Modify: `app/(app)/join/[code]/page.tsx`

- [ ] **Step 1: Replace the page with the pending-aware version**

Open `app/(app)/join/[code]/page.tsx` and replace the entire file with:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamSetupForm, type TeamSetupValues } from '@/components/team-setup-form'

interface League { id: string; name: string; commissioner: { displayName: string }; members: { id: string }[]; maxTeams: number }

type Step = 'welcome' | 'team-setup' | 'pending'

export default function JoinPage({ params }: { params: Promise<{ code: string }> }) {
  const { code } = use(params)
  const router = useRouter()
  const [league, setLeague] = useState<League | null>(null)
  const [step, setStep] = useState<Step>('welcome')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    fetch(`/api/leagues/by-code/${code}`).then(r => r.json()).then(d => {
      if (d.league) setLeague(d.league)
      else setError('Invalid invite link')
    })
  }, [code])

  async function submitJoin(values: TeamSetupValues) {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, inviteCode: code }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to join league'); return }
      if (data.status === 'pending') {
        setStep('pending')
        return
      }
      router.push(`/league/${league.id}`)
    } catch {
      setError('Failed to join league')
    } finally {
      setLoading(false)
    }
  }

  if (error && !league) return <div className="p-6 text-red-600">{error}</div>
  if (!league) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-white p-6 max-w-sm mx-auto">
      <h1 className="text-xl font-black tracking-widest mb-1">HOCKEYPOOLZ</h1>

      {step === 'welcome' && (
        <>
          <p className="text-gray-500 text-sm mb-6">You&apos;ve been invited to join a league</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-6">
            <p className="font-bold text-lg">{league.name}</p>
            <p className="text-sm text-gray-500">Created by {league.commissioner.displayName}</p>
            <p className="text-sm text-gray-500">{league.members.length}/{league.maxTeams} teams</p>
          </div>
          <button
            onClick={() => setStep('team-setup')}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition"
          >
            Join this league →
          </button>
        </>
      )}

      {step === 'team-setup' && (
        <>
          <p className="text-gray-500 text-sm mb-6">Set up your team for {league.name}</p>
          {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
          <TeamSetupForm
            submitLabel="Join League →"
            loading={loading}
            onSubmit={submitJoin}
          />
          <button
            onClick={() => setStep('welcome')}
            className="w-full py-2 text-sm text-gray-500 mt-2 hover:text-gray-700"
          >
            ← Back
          </button>
        </>
      )}

      {step === 'pending' && (
        <div className="text-center py-8">
          <div className="w-16 h-16 mx-auto mb-4 rounded-full bg-orange-100 flex items-center justify-center text-3xl">⏳</div>
          <h2 className="text-lg font-black tracking-tight text-[#121212] mb-2">Request sent!</h2>
          <p className="text-sm text-gray-500 leading-relaxed">
            Your request to join <span className="font-bold text-[#121212]">{league.name}</span> has been sent to the commissioner.
            You&apos;ll get access once it&apos;s approved.
          </p>
          <p className="text-xs text-gray-400 mt-4">You can close this page.</p>
        </div>
      )}
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/join/[code]/page.tsx" && git commit -m "feat(join): show pending-approval holding screen"
```

---

## Task 5: Commissioner-only join-requests review page

**Files:**
- Create: `app/(app)/league/[id]/join-requests/page.tsx`

- [ ] **Step 1: Create the review page**

Create `app/(app)/league/[id]/join-requests/page.tsx` with exactly:

```tsx
'use client'
import { useState, useEffect, use, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'

interface PendingRequest {
  id: string
  teamName: string
  teamIcon: string | null
  submittedAt: string
  user: { id: string; email: string; displayName: string; avatarUrl: string | null }
  favoriteTeam: { id: string; name: string; colorPrimary: string; colorSecondary: string } | null
}

export default function JoinRequestsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [requests, setRequests] = useState<PendingRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [approving, setApproving] = useState<string | null>(null)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${id}/join-requests`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.status === 403) { setError('Commissioner only'); setLoading(false); return }
    if (!res.ok) { setError('Failed to load requests'); setLoading(false); return }
    const data = await res.json()
    setRequests(data.requests ?? [])
    setLoading(false)
  }, [id])

  useEffect(() => { load() }, [load])

  async function approve(requestId: string) {
    setApproving(requestId)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in'); return }
      const res = await fetch(`/api/leagues/${id}/join-requests`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestId }),
      })
      if (!res.ok) {
        const data = await res.json()
        setError(data.error ?? 'Failed to approve')
        return
      }
      await load()
    } finally { setApproving(null) }
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        <button onClick={() => router.back()} className="text-xs text-[#98989e] mb-3 font-semibold hover:text-[#515151]">
          ← Back
        </button>
        <h1 className="text-xl font-black tracking-tight text-[#121212] mb-1">Join Requests</h1>
        <p className="text-xs text-[#98989e] font-semibold mb-6">
          Review and approve new league members
        </p>
        {error && <p className="text-red-600 text-sm mb-4">{error}</p>}
        {loading && <p className="text-sm text-[#98989e]">Loading…</p>}
        {!loading && requests.length === 0 && !error && (
          <p className="text-sm text-[#98989e]">No pending requests.</p>
        )}
        {requests.map(req => (
          <div key={req.id} className="border-b border-[#f5f5f5] py-3 flex items-center gap-3">
            <TeamIcon icon={req.teamIcon} size="lg" />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-bold text-[#121212] truncate">{req.teamName}</p>
              <p className="text-xs text-[#98989e] truncate">{req.user.displayName} · {req.user.email}</p>
              {req.favoriteTeam && (
                <p className="text-[10px] text-[#98989e] mt-0.5">Fan of {req.favoriteTeam.name}</p>
              )}
            </div>
            <button
              onClick={() => approve(req.id)}
              disabled={approving === req.id}
              className="px-3 py-1.5 text-xs font-bold bg-orange-500 text-white rounded-lg hover:bg-orange-600 disabled:opacity-50 transition"
            >
              {approving === req.id ? 'Approving…' : 'Approve'}
            </button>
          </div>
        ))}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/join-requests/page.tsx" && git commit -m "feat: add commissioner join-requests review page"
```

---

## Task 6: Lobby banner for pending join requests

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Add pending-count state + fetch**

Open `app/(app)/league/[id]/page.tsx`. Near the other `useState` declarations at the top of the component (around line 32–40), add:

```tsx
  const [pendingCount, setPendingCount] = useState(0)
```

- [ ] **Step 2: Fetch pending count inside the existing `load()` function**

Inside the `useEffect(() => { async function load() { ... } load() }, [id])`, at the end of the `load()` function body (right before the closing `}` of `load`), add:

```tsx
      // Fetch pending join requests count (commissioner-only — endpoint returns 403 otherwise)
      if (leagueRes.ok) {
        const pendingRes = await fetch(`/api/leagues/${id}/join-requests`, { headers })
        if (pendingRes.ok) {
          const pendingData = await pendingRes.json()
          setPendingCount(pendingData.count ?? 0)
        }
      }
```

(If the request fails with 403 because the viewer isn't a commissioner, `count` stays at 0. That's fine.)

- [ ] **Step 3: Render the banner**

Find the JSX block that begins with `{error && <p className="text-red-600 text-sm mb-4">{error}</p>}`. Immediately AFTER that line, insert:

```tsx
      {isCommissioner && pendingCount > 0 && league.status === 'setup' && (
        <Link
          href={`/league/${id}/join-requests`}
          className="block bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 mb-4 hover:bg-orange-100 transition"
        >
          <p className="text-sm font-bold text-[#121212]">
            🔔 {pendingCount} {pendingCount === 1 ? 'person is' : 'people are'} waiting to join
          </p>
          <p className="text-xs text-[#515151] mt-0.5">Tap to review →</p>
        </Link>
      )}
```

(Note: `Link` is already imported at the top of this file from Plan 7 Task 9.)

- [ ] **Step 4: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 5: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/page.tsx" && git commit -m "feat(lobby): show pending-join-requests banner to commissioners"
```

---

## Task 7: Full build + test

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -15`

Expected: all 38 existing tests pass.

- [ ] **Step 2: Run the build**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run build 2>&1 | tail -30`

Expected: build completes with no errors. The route list should include:
- `/api/leagues/[id]/join-requests`
- `/league/[id]/join-requests`

- [ ] **Step 3: Fix any errors**

If typecheck or build fails, most likely causes:
- Prisma client not regenerated after schema edit — run `cd c:/Users/Lenno/Projects/HockeyPoolz && npx prisma generate` and retry
- `Link` not imported in lobby — verify the existing `import Link from 'next/link'` at the top of `app/(app)/league/[id]/page.tsx`
- Import path typo in the new route — imports use `@/lib/...` aliasing; confirm consistent usage

After any fix, re-run steps 1 and 2.

---

## Acceptance criteria (manual smoke test)

- [ ] Sign in as a non-commissioner, open an invite link `/join/<code>`, submit team setup → the app advances to a "Request sent!" holding screen (no redirect)
- [ ] Reload the lobby at `/league/[id]` as that same non-commissioner — since no `LeagueMember` exists for them yet, the detail endpoint may 404 or they may not see themselves as a member; this is expected
- [ ] Sign in as the commissioner, open the league lobby → a banner reads "🔔 1 person is waiting to join" with "Tap to review →"
- [ ] Tap the banner → `/league/[id]/join-requests` lists the one pending row with the requester's team name + email + "Approve"
- [ ] Tap Approve → the row disappears, `LeagueMember` is created, banner count drops
- [ ] Revisit the lobby as the now-approved user — they appear in the member list and the lobby renders normally
- [ ] Commissioner's own team setup (create-league wizard step 4) still creates a `LeagueMember` directly, no banner appears
- [ ] If a non-commissioner resubmits the same invite with different team info before approval, the existing pending row is updated (no 409) — try it by submitting twice with different team names
- [ ] Commissioner opening `/league/[id]/join-requests` when no requests exist sees "No pending requests."

---

## Self-review notes

- **Spec coverage:**
  - `PendingJoinRequest` model ✓ (Task 1)
  - `/api/leagues/[id]/join` redirects non-commissioner to pending ✓ (Task 2)
  - Commissioner's own join bypasses approval ✓ (Task 2, explicit branch on `user.id === league.commissionerId`)
  - `GET /api/leagues/[id]/join-requests` ✓ (Task 3)
  - Approve endpoint ✓ (Task 3 — POST to the same route with `{ requestId }`; spec showed it as a nested dynamic route, but merging under the collection route with body is simpler and equivalent)
  - Holding screen ✓ (Task 4)
  - Commissioner lobby banner ✓ (Task 6)
  - Review page ✓ (Task 5)
  - No denial UX ✓ (out of scope, per spec)
- **Placeholder scan:** every code step contains complete code; every command specifies expected output.
- **Type consistency:** the pending `{ status: 'pending' | 'approved' | 'already_member' }` discriminator is consistent across the join route (Task 2) and the join-requests approve route (Task 3). The join-code page only checks for `'pending'` specifically (Task 4).
- **Deviation from spec:** the spec showed approve as `POST /api/leagues/[id]/join-requests/[requestId]/approve`. This plan uses `POST /api/leagues/[id]/join-requests` with `{ requestId }` in the body. Functionally equivalent, one less dynamic segment, easier to test.
