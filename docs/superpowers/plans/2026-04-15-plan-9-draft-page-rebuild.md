# Draft Page Rebuild Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `app/(app)/league/[id]/draft/page.tsx` to handle three lifecycle states: pre-draft (player rankings + wishlist), live draft (existing room + mid-draft autodraft toggle), and post-draft (pick history grouped by round).

**Architecture:** A new `GET /api/leagues/[id]/draft/rankings` endpoint computes projected FPTS (player season stats × league scoring weights). The existing draft page branches on `draft.status` to show pre-draft, live, or post-draft sections. Pre-draft uses local sub-tab state (Rankings / Wishlist). Wishlist reorder calls the existing PUT `/wishlist` endpoint. Mid-draft autodraft toggle calls the existing PATCH `/settings` endpoint. Post-draft removes the existing lobby redirect and renders pick history in-page.

**Tech Stack:** Next.js 16 App Router, Prisma + Postgres (Neon), Firebase Auth, Tailwind, React

---

## Codebase Context

Read these files before starting any task:

- `app/(app)/league/[id]/draft/page.tsx` — 323 lines; live draft room only. Key facts:
  - Line 151: `if (!state.draft) return <div>Draft not started yet.</div>` — replace with pre-draft UI
  - Line 58: `if (data.draft?.status === 'complete') router.push(...)` — remove; show post-draft in-page instead
  - `DraftState.draft` interface (line 21) needs `scheduledStartAt: string | null` added
  - `DraftState` needs `myColor: string | null` added (current member's team color)
  - `MemberSummary` interface (line 28) — check if `colorPrimary` is already present
- `app/api/leagues/[id]/draft/state/route.ts` — check if `scheduledStartAt` and member `colorPrimary` are returned; add them if missing
- `app/api/leagues/[id]/draft/wishlist/route.ts` — GET returns `{ wishlist: [{ id, playerId, rank, player: { id, name, position, adp, team } }] }`, POST adds one player, PUT replaces full list
- `app/api/leagues/[id]/draft/settings/route.ts` — PATCH `{ autodraftEnabled, autodraftStrategy }` on `LeagueMember`
- `prisma/schema.prisma` — read `ScoringSettings` and `PlayerGameStats` models; note ALL numeric fields on both (there are ~17 scoring categories from Plan 3)
- `components/team-icon.tsx` — `<TeamIcon icon={str|null} size="sm"|"md"|"lg" />`
- `components/position-badge.tsx` — `<PositionBadge position="F"|"D"|"G" />`
- Auth pattern everywhere: `getBearerToken(headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`

## File Structure

**New files:**
- `app/api/leagues/[id]/draft/rankings/route.ts`
- `__tests__/api/draft/rankings.test.ts`

**Modified files:**
- `app/(app)/league/[id]/draft/page.tsx` — all UI changes across Tasks 2–6
- `app/api/leagues/[id]/draft/state/route.ts` — add `scheduledStartAt` + `myColor` if missing (Task 2)

---

## Task 1: Rankings API (`GET /api/leagues/[id]/draft/rankings`)

**Files:**
- Create: `app/api/leagues/[id]/draft/rankings/route.ts`
- Create: `__tests__/api/draft/rankings.test.ts`

- [ ] **Step 1: Read the schema**

Open `prisma/schema.prisma`. List every numeric field on `ScoringSettings` and every stat field on `PlayerGameStats`. You will extend the `ZERO_TOTALS` object and `proj` calculation to include ALL matching fields.

- [ ] **Step 2: Write failing tests**

Create `__tests__/api/draft/rankings.test.ts`:

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
  league: { findUnique: vi.fn() },
  nhlPlayer: { findMany: vi.fn() },
}
vi.mock('@/lib/prisma', () => ({ prisma: mockPrisma }))

function makeReq(leagueId: string, qs = '') {
  return new NextRequest(
    `http://localhost/api/leagues/${leagueId}/draft/rankings${qs}`,
    { headers: { authorization: 'Bearer token' } }
  )
}
const ctx = (id: string) => ({ params: Promise.resolve({ id }) })

describe('GET /api/leagues/[id]/draft/rankings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockPrisma.user.findUnique.mockResolvedValue({ id: 'user-1', isBanned: false })
    mockPrisma.leagueMember.findUnique.mockResolvedValue({ id: 'member-1' })
    mockPrisma.league.findUnique.mockResolvedValue({
      id: 'league-1',
      scoringSettings: {
        goals: 2, assists: 1.5, plusMinus: 0.5, shots: 0.1,
        pim: 0, goalieWins: 3, goalieSaves: 0.2, shutouts: 5,
      },
    })
    mockPrisma.nhlPlayer.findMany.mockResolvedValue([
      {
        id: 1, name: 'Connor McDavid', position: 'C', adp: 1.2, headshotUrl: null,
        team: { id: 'EDM', name: 'Edmonton Oilers', colorPrimary: '#FF4C00' },
        gameStats: [
          { goals: 10, assists: 20, plusMinus: 5, pim: 4, shots: 50,
            goalieWins: 0, goalieSaves: 0, goalsAgainst: 0, shutouts: 0 },
        ],
      },
      {
        id: 2, name: 'Leon Draisaitl', position: 'C', adp: 2.0, headshotUrl: null,
        team: { id: 'EDM', name: 'Edmonton Oilers', colorPrimary: '#FF4C00' },
        gameStats: [
          { goals: 8, assists: 15, plusMinus: 3, pim: 2, shots: 40,
            goalieWins: 0, goalieSaves: 0, goalsAgainst: 0, shutouts: 0 },
        ],
      },
    ])
  })

  it('returns 401 when auth fails', async () => {
    const { verifyIdToken } = await import('@/lib/auth')
    vi.mocked(verifyIdToken).mockRejectedValueOnce(new Error('bad token'))
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    expect(res.status).toBe(401)
  })

  it('returns 403 when not a league member', async () => {
    mockPrisma.leagueMember.findUnique.mockResolvedValue(null)
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    expect(res.status).toBe(403)
  })

  it('returns players sorted by PROJ descending in scoring mode', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1'), ctx('league-1'))
    const data = await res.json()
    expect(res.status).toBe(200)
    // McDavid: 10*2 + 20*1.5 + 5*0.5 + 50*0.1 = 57.5
    // Draisaitl: 8*2 + 15*1.5 + 3*0.5 + 40*0.1 = 44.0
    expect(data.players[0].name).toBe('Connor McDavid')
    expect(data.players[0].proj).toBe(57.5)
    expect(data.players[1].proj).toBe(44.0)
  })

  it('returns players sorted by ADP ascending in adp mode', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    const res = await GET(makeReq('league-1', '?mode=adp'), ctx('league-1'))
    const data = await res.json()
    expect(data.players[0].adp).toBe(1.2)
    expect(data.players[1].adp).toBe(2.0)
  })

  it('passes position filter F as { in: [C, LW, RW] } to Prisma', async () => {
    const { GET } = await import('@/app/api/leagues/[id]/draft/rankings/route')
    await GET(makeReq('league-1', '?position=F'), ctx('league-1'))
    expect(mockPrisma.nhlPlayer.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ position: { in: ['C', 'LW', 'RW'] } }),
      })
    )
  })
})
```

Run: `cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run -- __tests__/api/draft/rankings.test.ts 2>&1 | tail -10`

Expected: FAIL — module not found.

- [ ] **Step 3: Create the route**

Create `app/api/leagues/[id]/draft/rankings/route.ts`:

```ts
import { NextRequest, NextResponse } from 'next/server'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

// Extend this type to include ALL numeric fields present in PlayerGameStats
type StatTotals = {
  goals: number; assists: number; plusMinus: number; pim: number; shots: number
  goalieWins: number; goalieSaves: number; goalsAgainst: number; shutouts: number
  // Add additional fields from your schema here, e.g.:
  // ppGoals: number; ppAssists: number; shGoals: number; gwGoals: number; blocks: number
}

const ZERO_TOTALS: StatTotals = {
  goals: 0, assists: 0, plusMinus: 0, pim: 0, shots: 0,
  goalieWins: 0, goalieSaves: 0, goalsAgainst: 0, shutouts: 0,
  // Mirror any additions above
}

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
    if (user.isBanned) return NextResponse.json({ error: 'Account suspended' }, { status: 403 })

    const member = await prisma.leagueMember.findUnique({
      where: { leagueId_userId: { leagueId, userId: user.id } },
    })
    if (!member) return NextResponse.json({ error: 'Not a member of this league' }, { status: 403 })

    const league = await prisma.league.findUnique({
      where: { id: leagueId },
      include: { scoringSettings: true },
    })
    if (!league) return NextResponse.json({ error: 'League not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const mode = searchParams.get('mode') ?? 'scoring'
    const position = searchParams.get('position')
    const teamId = searchParams.get('teamId')
    const search = searchParams.get('search')

    const positionFilter =
      position === 'F' ? { in: ['C', 'LW', 'RW'] as const } :
      position === 'D' ? { equals: 'D' as const } :
      position === 'G' ? { equals: 'G' as const } :
      undefined

    const players = await prisma.nhlPlayer.findMany({
      where: {
        isActive: true,
        ...(positionFilter ? { position: positionFilter } : {}),
        ...(teamId ? { teamId } : {}),
        ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
      },
      include: {
        team: { select: { id: true, name: true, colorPrimary: true } },
        gameStats: {
          select: Object.fromEntries(
            Object.keys(ZERO_TOTALS).map(k => [k, true])
          ) as Record<keyof StatTotals, true>,
        },
      },
    })

    const settings = league.scoringSettings

    const ranked = players.map(player => {
      const totals = player.gameStats.reduce(
        (acc, g) => {
          for (const key of Object.keys(ZERO_TOTALS) as (keyof StatTotals)[]) {
            acc[key] += (g as Record<string, number>)[key] ?? 0
          }
          return acc
        },
        { ...ZERO_TOTALS }
      )

      let proj = 0
      if (settings) {
        // Base 8 fields — extend to match ALL ScoringSettings fields from your schema
        proj =
          Number(settings.goals) * totals.goals +
          Number(settings.assists) * totals.assists +
          Number(settings.plusMinus) * totals.plusMinus +
          Number(settings.pim) * totals.pim +
          Number(settings.shots) * totals.shots +
          Number(settings.goalieWins) * totals.goalieWins +
          Number(settings.goalieSaves) * totals.goalieSaves +
          Number(settings.shutouts) * totals.shutouts
        // Add lines for each additional scoring field, e.g.:
        // + Number((settings as any).ppGoals ?? 0) * ((totals as any).ppGoals ?? 0)
      }

      return {
        id: player.id,
        name: player.name,
        position: player.position,
        team: player.team,
        headshotUrl: player.headshotUrl,
        adp: player.adp,
        totals,
        proj: Math.round(proj * 10) / 10,
      }
    })

    const sorted = mode === 'adp'
      ? ranked.sort((a, b) => (a.adp ?? 9999) - (b.adp ?? 9999))
      : ranked.sort((a, b) => b.proj - a.proj)

    return NextResponse.json({ players: sorted })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('GET /api/leagues/[id]/draft/rankings error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
```

If `gameStats: { select: Object.fromEntries(...) }` causes a TypeScript error, replace with an explicit select listing every field by name.

- [ ] **Step 4: Run tests**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run -- __tests__/api/draft/rankings.test.ts 2>&1 | tail -15`

Expected: 5 tests pass.

- [ ] **Step 5: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Expected: no errors.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/api/leagues/[id]/draft/rankings/route.ts" __tests__/api/draft/rankings.test.ts && git commit -m "feat(api): add draft rankings endpoint with PROJ calculation"
```

---

## Task 2: Pre-draft shell + state routing

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`
- Modify: `app/api/leagues/[id]/draft/state/route.ts` (if fields missing)

- [ ] **Step 1: Extend the DraftState interface**

In `page.tsx`, find the `DraftState` interface. Add `scheduledStartAt: string | null` to the `draft` object type, and add `myColor: string | null` at the top level:

```ts
interface DraftState {
  draft: {
    id: string; status: string; currentPickNumber: number; totalPicks: number
    pickDeadline: string | null; pickTimeLimitSecs: number; isMock: boolean
    scheduledStartAt: string | null  // ADD
  } | null
  currentPicker: { ... } | null  // unchanged
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  isCommissioner: boolean
  myColor: string | null  // ADD
}
```

- [ ] **Step 2: Ensure state endpoint returns the new fields**

Open `app/api/leagues/[id]/draft/state/route.ts`. Check:
1. Is `scheduledStartAt` included in the draft object in the response? If not, add it to the select/include for the `Draft` query.
2. Is `myColor` (the current member's `favoriteTeam.colorPrimary`) in the response? If not, find where the response is built and add:

```ts
// After resolving myLeagueMemberId and building the members array:
const myMemberRow = membersList.find(m => m.leagueMemberId === myLeagueMemberId)
const myColor = myMemberRow?.colorPrimary ?? null
// Then include myColor in the returned JSON object
```

If member rows in the state endpoint don't include `colorPrimary`, add it to whatever select/include fetches member data (join through `favoriteTeam` → `colorPrimary`).

- [ ] **Step 3: Add new state variables to DraftRoomPage**

In `DraftRoomPage`, after the existing `useState` declarations, add:

```tsx
const [preDraftTab, setPreDraftTab] = useState<'rankings' | 'wishlist'>('rankings')
const [autodraftEnabled, setAutodraftEnabled] = useState(false)
```

- [ ] **Step 4: Remove auto-redirect on draft complete**

In `fetchState`, find and delete this line:

```ts
if (data.draft?.status === 'complete') router.push(`/league/${leagueId}`)
```

The post-draft history will render in-page instead.

- [ ] **Step 5: Add state-routing branches**

Find lines 150–151:

```tsx
if (!state) return <div className="p-6 text-gray-400 text-sm">Loading draft…</div>
if (!state.draft) return <div className="p-6 text-gray-400 text-sm">Draft not started yet.</div>
```

Replace the second line with:

```tsx
if (!state.draft || state.draft.status === 'pending') {
  return (
    <PreDraft
      leagueId={leagueId}
      draft={state.draft}
      myColor={state.myColor ?? '#FF6B00'}
      preDraftTab={preDraftTab}
      setPreDraftTab={setPreDraftTab}
      autodraftEnabled={autodraftEnabled}
      setAutodraftEnabled={setAutodraftEnabled}
    />
  )
}

if (state.draft.status === 'complete') {
  return (
    <PostDraft
      draft={state.draft}
      picks={state.picks}
      members={state.members}
      myLeagueMemberId={state.myLeagueMemberId}
      myColor={state.myColor ?? '#FF6B00'}
    />
  )
}
```

- [ ] **Step 6: Add stub components at the bottom of the file**

After the closing `}` of `DraftRoomPage` (after line 323), add:

```tsx
// ── Interfaces ────────────────────────────────────────────────────────────────

interface RankedPlayer {
  id: number; name: string; position: string; adp: number | null; headshotUrl: string | null
  team: { id: string; name: string; colorPrimary: string } | null
  totals: { goals: number; assists: number; plusMinus: number; pim: number; shots: number
            goalieWins: number; goalieSaves: number; goalsAgainst: number; shutouts: number }
  proj: number
}

interface WishlistEntry {
  id: string; playerId: number; rank: number
  player: { id: number; name: string; position: string; adp: number | null
            team: { id: string; name: string } | null; proj?: number }
}

interface PreDraftProps {
  leagueId: string
  draft: DraftState['draft']
  myColor: string
  preDraftTab: 'rankings' | 'wishlist'
  setPreDraftTab: (t: 'rankings' | 'wishlist') => void
  autodraftEnabled: boolean
  setAutodraftEnabled: (v: boolean) => void
}

interface PostDraftProps {
  draft: NonNullable<DraftState['draft']>
  picks: Pick[]
  members: MemberSummary[]
  myLeagueMemberId: string | null
  myColor: string
}

// ── PreDraft ──────────────────────────────────────────────────────────────────

function PreDraft({
  leagueId, draft, myColor,
  preDraftTab, setPreDraftTab,
  autodraftEnabled, setAutodraftEnabled,
}: PreDraftProps) {
  const [wishlistCount, setWishlistCount] = useState(0)
  const [countdown, setCountdown] = useState('TBD')

  useEffect(() => {
    if (!draft?.scheduledStartAt) { setCountdown('TBD'); return }
    function tick() {
      const ms = new Date(draft!.scheduledStartAt!).getTime() - Date.now()
      if (ms <= 0) { setCountdown('Starting soon'); return }
      const d = Math.floor(ms / 86400000)
      const h = Math.floor((ms % 86400000) / 3600000)
      const m = Math.floor((ms % 3600000) / 60000)
      setCountdown(d > 0 ? `${d}d ${h}h ${m}m` : `${h}h ${m}m`)
    }
    tick()
    const interval = setInterval(tick, 30000)
    return () => clearInterval(interval)
  }, [draft?.scheduledStartAt])

  useEffect(() => {
    async function loadCount() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (res.ok) {
        const data = await res.json()
        setWishlistCount(data.wishlist?.length ?? 0)
      }
    }
    loadCount()
  }, [leagueId])

  async function toggleAutodraft(enabled: boolean) {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    await fetch(`/api/leagues/${leagueId}/draft/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autodraftEnabled: enabled }),
    })
    setAutodraftEnabled(enabled)
  }

  const draftDateStr = draft?.scheduledStartAt
    ? new Date(draft.scheduledStartAt).toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
      })
    : null

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        {/* Countdown card */}
        <div
          className="rounded-xl p-4 mb-4 flex items-center justify-between"
          style={{ backgroundColor: myColor + '18', borderLeft: `3px solid ${myColor}` }}
        >
          <div>
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#98989e] mb-0.5">Draft Starts In</p>
            <p className="text-2xl font-black tracking-tight text-[#121212]">{countdown}</p>
            {draftDateStr && <p className="text-xs text-[#98989e] font-semibold mt-0.5">{draftDateStr}</p>}
          </div>
          <div className="text-right">
            <p className="text-[9px] font-bold uppercase tracking-widest text-[#98989e] mb-1">Autodraft</p>
            <button
              onClick={() => toggleAutodraft(!autodraftEnabled)}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${autodraftEnabled ? 'bg-orange-500' : 'bg-gray-200'}`}
            >
              <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${autodraftEnabled ? 'translate-x-6' : 'translate-x-1'}`} />
            </button>
            <p className="text-[9px] text-[#98989e] mt-0.5">{autodraftEnabled ? "On — we'll pick by ADP" : 'Off'}</p>
          </div>
        </div>

        {/* Sub-tabs */}
        <div className="flex border-b border-[#eeeeee] mb-4">
          {(['rankings', 'wishlist'] as const).map(tab => (
            <button
              key={tab}
              onClick={() => setPreDraftTab(tab)}
              className={`px-4 py-2 text-xs font-bold transition flex items-center gap-1.5 ${
                preDraftTab === tab ? 'border-b-2 text-[#121212]' : 'text-[#98989e] hover:text-[#515151]'
              }`}
              style={preDraftTab === tab ? { borderBottomColor: myColor } : {}}
            >
              {tab === 'rankings' ? 'RANKINGS' : 'MY WISHLIST'}
              {tab === 'wishlist' && wishlistCount > 0 && (
                <span
                  className="text-[9px] font-bold text-white rounded-full w-4 h-4 flex items-center justify-center"
                  style={{ backgroundColor: myColor }}
                >
                  {wishlistCount}
                </span>
              )}
            </button>
          ))}
        </div>

        {/* Tab content — filled in Tasks 3 and 4 */}
        {preDraftTab === 'rankings' && (
          <p className="text-sm text-[#98989e] py-4">Rankings loading…</p>
        )}
        {preDraftTab === 'wishlist' && (
          <p className="text-sm text-[#98989e] py-4">Wishlist loading…</p>
        )}
      </div>
    </div>
  )
}

// ── PostDraft stub (filled in Task 6) ─────────────────────────────────────────

function PostDraft({ draft, picks, members, myLeagueMemberId, myColor }: PostDraftProps) {
  return (
    <div className="bg-white min-h-screen p-4 max-w-xl mx-auto">
      <p className="text-sm text-[#98989e]">Draft complete. History loading…</p>
    </div>
  )
}
```

- [ ] **Step 7: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Fix any errors. Common: missing `myColor` in state endpoint response (fix Step 2), missing `useCallback` import if used.

- [ ] **Step 8: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" "app/api/leagues/[id]/draft/state/route.ts" && git commit -m "feat(draft): add pre-draft shell with countdown, autodraft toggle, and tab stubs"
```

---

## Task 3: Rankings sub-tab

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Add rankings state to `PreDraft`**

In the `PreDraft` function, after the `const [countdown, setCountdown] = useState('TBD')` line, add:

```tsx
const [rankMode, setRankMode] = useState<'scoring' | 'adp'>('scoring')
const [rankPos, setRankPos] = useState<'ALL' | 'F' | 'D' | 'G'>('ALL')
const [rankSearch, setRankSearch] = useState('')
const [rankPlayers, setRankPlayers] = useState<RankedPlayer[]>([])
const [rankLoading, setRankLoading] = useState(false)
const [wishlistIds, setWishlistIds] = useState<Set<number>>(new Set())
```

Update the wishlist load effect to also populate `wishlistIds`:

```tsx
useEffect(() => {
  async function loadCount() {
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok) {
      const data = await res.json()
      setWishlistCount(data.wishlist?.length ?? 0)
      setWishlistIds(new Set((data.wishlist ?? []).map((w: { playerId: number }) => w.playerId)))
    }
  }
  loadCount()
}, [leagueId])
```

- [ ] **Step 2: Add rankings fetch effect**

After the wishlist count effect, add:

```tsx
useEffect(() => {
  if (preDraftTab !== 'rankings') return
  let cancelled = false
  async function fetchRankings() {
    setRankLoading(true)
    const token = await auth.currentUser?.getIdToken()
    if (!token) return
    const qs = new URLSearchParams({
      mode: rankMode,
      ...(rankPos !== 'ALL' ? { position: rankPos } : {}),
      ...(rankSearch ? { search: rankSearch } : {}),
    })
    const res = await fetch(`/api/leagues/${leagueId}/draft/rankings?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (res.ok && !cancelled) {
      const data = await res.json()
      setRankPlayers(data.players ?? [])
    }
    if (!cancelled) setRankLoading(false)
  }
  fetchRankings()
  return () => { cancelled = true }
}, [leagueId, preDraftTab, rankMode, rankPos, rankSearch])
```

- [ ] **Step 3: Add star toggle handler**

After the `toggleAutodraft` function, add:

```tsx
async function toggleWishlist(playerId: number) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) return
  const isInWishlist = wishlistIds.has(playerId)
  if (isInWishlist) {
    const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    const data = await res.json()
    const newList = (data.wishlist ?? [])
      .filter((w: { playerId: number }) => w.playerId !== playerId)
      .map((w: { playerId: number }, i: number) => ({ playerId: w.playerId, rank: i + 1 }))
    await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ wishlist: newList }),
    })
    setWishlistIds(prev => { const s = new Set(prev); s.delete(playerId); return s })
    setWishlistCount(c => Math.max(0, c - 1))
  } else {
    await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ playerId }),
    })
    setWishlistIds(prev => new Set([...prev, playerId]))
    setWishlistCount(c => c + 1)
  }
}
```

- [ ] **Step 4: Replace the rankings stub**

Find:
```tsx
{preDraftTab === 'rankings' && (
  <p className="text-sm text-[#98989e] py-4">Rankings loading…</p>
)}
```

Replace with:

```tsx
{preDraftTab === 'rankings' && (
  <div>
    {/* Mode toggle */}
    <div className="flex gap-2 mb-3">
      {(['scoring', 'adp'] as const).map(m => (
        <button key={m} onClick={() => setRankMode(m)}
          className={`px-3 py-1.5 text-xs font-bold rounded-lg transition ${rankMode === m ? 'text-white' : 'bg-[#f8f8f8] text-[#515151] hover:bg-gray-200'}`}
          style={rankMode === m ? { backgroundColor: myColor } : {}}
        >
          {m === 'scoring' ? 'MY SCORING' : 'ADP'}
        </button>
      ))}
    </div>

    {/* Position + search filters */}
    <div className="flex gap-2 mb-3 flex-wrap items-center">
      {(['ALL', 'F', 'D', 'G'] as const).map(p => (
        <button key={p} onClick={() => setRankPos(p)}
          className={`px-2.5 py-1 text-xs font-bold rounded transition ${rankPos === p ? 'text-white' : 'bg-[#f8f8f8] text-[#515151] hover:bg-gray-200'}`}
          style={rankPos === p ? { backgroundColor: myColor } : {}}
        >
          {p}
        </button>
      ))}
      <input value={rankSearch} onChange={e => setRankSearch(e.target.value)}
        placeholder="Search…"
        className="ml-auto border border-[#eeeeee] rounded-lg px-3 py-1 text-xs w-28"
      />
    </div>

    {/* Table */}
    {rankLoading ? (
      <p className="text-sm text-[#98989e] py-4">Loading…</p>
    ) : (
      <div className="overflow-x-auto rounded-xl border border-[#eeeeee]">
        <table className="text-xs w-full">
          <thead>
            <tr className="bg-[#f8f8f8] text-[#98989e]">
              <th className="sticky left-0 z-20 bg-[#f8f8f8] px-3 py-2 text-left font-bold uppercase tracking-widest text-[10px] min-w-[160px] border-r border-[#eeeeee]">Player</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px] bg-[#eef3ff] text-[#0042bb] whitespace-nowrap">{rankMode === 'scoring' ? 'PROJ ↓' : 'ADP ↓'}</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">G</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">A</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">PTS</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px]">+/-</th>
              <th className="px-3 py-2 text-right font-bold uppercase tracking-widest text-[10px] whitespace-nowrap">SOG</th>
              <th className="px-2 py-2 text-center font-bold uppercase tracking-widest text-[10px]">★</th>
            </tr>
          </thead>
          <tbody>
            {rankPlayers.map((player, i) => {
              const isGoalie = player.position === 'G'
              const inWishlist = wishlistIds.has(player.id)
              const rowBg = i % 2 === 1 ? '#fafafa' : '#ffffff'
              return (
                <tr key={player.id} className="border-t border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                  <td className="sticky left-0 z-10 px-3 py-2 border-r border-[#eeeeee]" style={{ backgroundColor: rowBg }}>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#98989e] w-5 text-right flex-shrink-0">{i + 1}</span>
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex-shrink-0 overflow-hidden">
                        {player.headshotUrl
                          ? <img src={player.headshotUrl} alt="" className="w-full h-full object-cover" />
                          : <div className="w-full h-full flex items-center justify-center text-[9px] text-gray-400">{player.position}</div>
                        }
                      </div>
                      <div className="min-w-0">
                        <div className="flex items-center gap-1">
                          <span className="font-bold text-[#121212] truncate text-xs">{player.name}</span>
                          <PositionBadge position={isGoalie ? 'G' : player.position === 'D' ? 'D' : 'F'} />
                        </div>
                        <span className="text-[10px] text-[#98989e]">{player.team?.id ?? '—'}</span>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-black text-[#0042bb] bg-[#eef3ff] whitespace-nowrap">
                    {rankMode === 'scoring' ? player.proj : (player.adp?.toFixed(1) ?? '—')}
                  </td>
                  <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                    {isGoalie ? (player.totals.goalieWins || '—') : (player.totals.goals || '—')}
                  </td>
                  <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                    {isGoalie ? '—' : (player.totals.assists || '—')}
                  </td>
                  <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                    {isGoalie ? '—' : ((player.totals.goals + player.totals.assists) || '—')}
                  </td>
                  <td className="px-3 py-2 text-right font-semibold"
                    style={{ color: isGoalie ? '#98989e' : player.totals.plusMinus >= 0 ? '#2db944' : '#c8102e' }}>
                    {isGoalie ? '—' : (player.totals.plusMinus > 0 ? `+${player.totals.plusMinus}` : player.totals.plusMinus || '—')}
                  </td>
                  <td className="px-3 py-2 text-right text-[#121212] font-semibold">
                    {isGoalie ? (player.totals.goalieSaves || '—') : (player.totals.shots || '—')}
                  </td>
                  <td className="px-2 py-2 text-center">
                    <button onClick={() => toggleWishlist(player.id)}
                      className="text-base leading-none hover:scale-110 transition-transform"
                      style={{ color: inWishlist ? '#ffcf00' : '#d1d5db' }}
                    >★</button>
                  </td>
                </tr>
              )
            })}
            {rankPlayers.length === 0 && (
              <tr><td colSpan={8} className="px-4 py-6 text-center text-sm text-[#98989e]">No players found</td></tr>
            )}
          </tbody>
        </table>
      </div>
    )}
  </div>
)}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" && git commit -m "feat(draft): add rankings sub-tab with filters, PROJ column, and star toggle"
```

---

## Task 4: Wishlist sub-tab

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Add wishlist state to `PreDraft`**

After the rankings state declarations, add:

```tsx
const [wishlist, setWishlist] = useState<WishlistEntry[]>([])
const [dragIndex, setDragIndex] = useState<number | null>(null)
```

- [ ] **Step 2: Add full wishlist load + reorder functions**

After `toggleWishlist`, add:

```tsx
async function loadWishlist() {
  const token = await auth.currentUser?.getIdToken()
  if (!token) return
  const res = await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) return
  const data = await res.json()
  const entries: WishlistEntry[] = data.wishlist ?? []
  setWishlist(entries)
  setWishlistIds(new Set(entries.map(e => e.playerId)))
  setWishlistCount(entries.length)
}

async function saveWishlistOrder(reordered: WishlistEntry[]) {
  const token = await auth.currentUser?.getIdToken()
  if (!token) return
  await fetch(`/api/leagues/${leagueId}/draft/wishlist`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      wishlist: reordered.map((e, i) => ({ playerId: e.playerId, rank: i + 1 })),
    }),
  })
}
```

Add a `useEffect` that loads the full wishlist when the wishlist tab is opened:

```tsx
useEffect(() => {
  if (preDraftTab === 'wishlist') loadWishlist()
}, [preDraftTab, leagueId])
```

- [ ] **Step 3: Replace the wishlist stub**

Find:
```tsx
{preDraftTab === 'wishlist' && (
  <p className="text-sm text-[#98989e] py-4">Wishlist loading…</p>
)}
```

Replace with:

```tsx
{preDraftTab === 'wishlist' && (
  <div>
    {wishlist.length === 0 ? (
      <div className="text-center py-8">
        <p className="text-sm text-[#98989e] mb-4">No players on your wishlist yet.</p>
        <button onClick={() => setPreDraftTab('rankings')}
          className="text-xs font-bold border-2 border-dashed border-[#eeeeee] rounded-xl px-6 py-3 text-[#98989e] hover:border-gray-300 hover:text-[#515151] transition">
          ➕ Add players from Rankings
        </button>
      </div>
    ) : (
      <>
        <p className="text-[10px] text-[#98989e] font-semibold mb-3">
          Drag to reorder. Autodraft picks in this order, skipping players already taken.
        </p>
        {wishlist.map((entry, i) => {
          const isTop = i === 0
          return (
            <div key={entry.id}
              draggable
              onDragStart={() => setDragIndex(i)}
              onDragOver={e => e.preventDefault()}
              onDrop={() => {
                if (dragIndex === null || dragIndex === i) return
                const reordered = [...wishlist]
                const [moved] = reordered.splice(dragIndex, 1)
                reordered.splice(i, 0, moved)
                setWishlist(reordered)
                setDragIndex(null)
                saveWishlistOrder(reordered)
              }}
              onDragEnd={() => setDragIndex(null)}
              className={`flex items-center gap-3 py-3 border-b border-[#f5f5f5] cursor-grab select-none ${isTop ? 'bg-[#fff8f8]' : ''}`}
              style={isTop ? { borderLeft: `3px solid ${myColor}`, paddingLeft: '12px' } : {}}
            >
              <span className="text-[#d1d5db] text-base leading-none flex-shrink-0">⋮⋮</span>
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-black flex-shrink-0"
                style={{ backgroundColor: isTop ? myColor : '#f0f0f0', color: isTop ? '#fff' : '#98989e' }}>
                {i + 1}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-sm font-bold text-[#121212] truncate">{entry.player.name}</span>
                  <PositionBadge position={entry.player.position === 'G' ? 'G' : entry.player.position === 'D' ? 'D' : 'F'} />
                </div>
                <span className="text-[10px] text-[#98989e]">{entry.player.team?.id ?? '—'}</span>
              </div>
              <div className="flex gap-4 items-center flex-shrink-0">
                {entry.player.proj !== undefined && (
                  <div className="text-right">
                    <div className="text-[10px] font-black bg-[#eef3ff] text-[#0042bb] px-2 py-0.5 rounded">{entry.player.proj.toFixed(1)}</div>
                    <div className="text-[9px] text-[#98989e] font-semibold text-center">PROJ</div>
                  </div>
                )}
                <div className="text-right">
                  <div className="text-xs font-bold text-[#121212]">{entry.player.adp?.toFixed(1) ?? '—'}</div>
                  <div className="text-[9px] text-[#98989e] font-semibold">ADP</div>
                </div>
                <button onClick={() => toggleWishlist(entry.playerId)}
                  className="text-[#98989e] hover:text-red-400 text-sm font-bold transition">
                  ✕
                </button>
              </div>
            </div>
          )
        })}
        <button onClick={() => setPreDraftTab('rankings')}
          className="mt-4 w-full text-xs font-bold border-2 border-dashed border-[#eeeeee] rounded-xl px-4 py-3 text-[#98989e] hover:border-gray-300 hover:text-[#515151] transition">
          ➕ Add players from Rankings
        </button>
      </>
    )}
  </div>
)}
```

**Note:** `entry.player.proj` is shown only when present. Check the wishlist endpoint's response shape — if `proj` is not included in the player object, omit the PROJ cell (the `entry.player.proj !== undefined` guard handles this).

- [ ] **Step 4: TypeScript check + commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" && git commit -m "feat(draft): add wishlist sub-tab with drag-to-reorder"
```

---

## Task 5: Mid-draft autodraft toggle

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Add live autodraft state to `DraftRoomPage`**

In `DraftRoomPage`, after the existing `useState` declarations, add:

```tsx
const [liveAutodraft, setLiveAutodraft] = useState(false)
const [autodraftSaving, setAutodraftSaving] = useState(false)
```

- [ ] **Step 2: Sync toggle from fetched state**

In `fetchState`, after `setState(data)`, add:

```tsx
const myMemberData = data.members.find(m => m.leagueMemberId === data.myLeagueMemberId)
if (myMemberData) setLiveAutodraft(myMemberData.autodraftEnabled)
```

- [ ] **Step 3: Add toggle handler**

After the `commissionerAction` function, add:

```tsx
async function toggleLiveAutodraft(enabled: boolean) {
  setAutodraftSaving(true)
  try {
    const token = await getToken()
    await fetch(`/api/leagues/${leagueId}/draft/settings`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ autodraftEnabled: enabled }),
    })
    setLiveAutodraft(enabled)
  } finally {
    setAutodraftSaving(false)
  }
}
```

- [ ] **Step 4: Insert toggle row after the on-the-clock card**

In the live draft JSX, find the closing `</div>` of the `{/* Current pick + timer */}` section (the `<div className="mb-3">` wrapper). Immediately after it, insert:

```tsx
{/* Mid-draft autodraft toggle */}
{state.myLeagueMemberId && (
  <div className="flex items-center justify-between px-3 py-2.5 bg-[#f8f8f8] rounded-xl mb-3">
    <div>
      <p className="text-xs font-bold text-[#121212]">
        {liveAutodraft ? '🤖 Autodraft on' : 'Autodraft off'}
      </p>
      <p className="text-[10px] text-[#98989e]">
        {liveAutodraft ? "We'll pick for you going forward" : "Switch on and we'll pick by ADP"}
      </p>
    </div>
    <button
      onClick={() => toggleLiveAutodraft(!liveAutodraft)}
      disabled={autodraftSaving}
      className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${liveAutodraft ? 'bg-orange-500' : 'bg-gray-200'}`}
    >
      <span className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${liveAutodraft ? 'translate-x-6' : 'translate-x-1'}`} />
    </button>
  </div>
)}
```

- [ ] **Step 5: TypeScript check + commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" && git commit -m "feat(draft): add mid-draft autodraft toggle"
```

---

## Task 6: Post-draft history

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Replace the `PostDraft` stub**

Find the stub `PostDraft` function at the bottom of the file and replace it entirely with:

```tsx
function PostDraft({ draft, picks, members, myLeagueMemberId, myColor }: PostDraftProps) {
  const [search, setSearch] = useState('')
  const [expandedRounds, setExpandedRounds] = useState<Set<number>>(new Set([1, 2]))

  const totalRounds = picks.length > 0 ? Math.max(...picks.map(p => p.round)) : 0
  const firstPick = picks[0]
  const lastPick = picks[picks.length - 1]

  let durationStr = ''
  if (firstPick && lastPick) {
    const ms = new Date(lastPick.pickedAt).getTime() - new Date(firstPick.pickedAt).getTime()
    const mins = Math.floor(ms / 60000)
    const secs = Math.floor((ms % 60000) / 1000)
    durationStr = mins > 0 ? `${mins}m ${secs}s` : `${secs}s`
  }

  const draftDate = draft.scheduledStartAt
    ? new Date(draft.scheduledStartAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : firstPick
      ? new Date(firstPick.pickedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—'

  const filteredPicks = search
    ? picks.filter(p =>
        p.player.name.toLowerCase().includes(search.toLowerCase()) ||
        p.teamName.toLowerCase().includes(search.toLowerCase())
      )
    : picks

  // Group by round
  const rounds: Record<number, Pick[]> = {}
  for (const p of filteredPicks) {
    if (!rounds[p.round]) rounds[p.round] = []
    rounds[p.round].push(p)
  }
  const roundNumbers = Object.keys(rounds).map(Number).sort((a, b) => a - b)
  const collapsedPickCount = filteredPicks.filter(p => p.round > 2).length
  const lateRounds = roundNumbers.filter(r => r > 2)
  const allLateExpanded = lateRounds.length > 0 && lateRounds.every(r => expandedRounds.has(r))

  function expandAllLate() {
    setExpandedRounds(prev => { const s = new Set(prev); lateRounds.forEach(r => s.add(r)); return s })
  }

  function renderPick(pick: Pick) {
    const isMe = pick.leagueMemberId === myLeagueMemberId
    const isAuto = pick.pickSource !== 'manual'
    let timeTaken = ''
    if (firstPick) {
      const ms = new Date(pick.pickedAt).getTime() - new Date(firstPick.pickedAt).getTime()
      const s = Math.floor(ms / 1000) % 60
      const m = Math.floor(ms / 60000)
      timeTaken = m > 0 ? `${m}:${String(s).padStart(2, '0')}` : `0:${String(s).padStart(2, '0')}`
    }
    return (
      <div key={pick.pickNumber}
        className="flex items-center gap-3 py-3 border-b border-[#f5f5f5]"
        style={isMe ? { borderLeft: `3px solid ${myColor}`, backgroundColor: myColor + '10', paddingLeft: '10px' } : {}}
      >
        <span className="text-[10px] text-[#98989e] font-bold w-6 flex-shrink-0">#{pick.pickNumber}</span>
        <TeamIcon icon={pick.teamIcon} size="md" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-sm font-bold text-[#121212] truncate">{pick.player.name}</span>
            <PositionBadge position={pick.player.position === 'G' ? 'G' : pick.player.position === 'D' ? 'D' : 'F'} />
          </div>
          <span className="text-[10px] text-[#98989e]">{pick.teamName} · {pick.player.teamId}</span>
        </div>
        <div className="flex-shrink-0">
          {isMe && (
            <span className="text-[9px] font-black px-2 py-0.5 rounded"
              style={{ backgroundColor: myColor + '20', color: myColor }}>YOU</span>
          )}
          {!isMe && isAuto && (
            <span className="text-[9px] font-black text-[#0042bb] bg-[#eef3ff] px-2 py-0.5 rounded">AUTO</span>
          )}
          {!isMe && !isAuto && timeTaken && (
            <span className="text-[10px] text-[#98989e]">{timeTaken}</span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div className="bg-white min-h-screen">
      <div className="p-4 max-w-xl mx-auto">
        {/* Summary card */}
        <div className="bg-[#1a1a1a] rounded-xl p-4 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-[9px] font-black text-white bg-[#2db944] px-2 py-0.5 rounded uppercase tracking-wider">COMPLETE</span>
            <span className="text-[10px] text-[#98989e] font-semibold">{draftDate}</span>
          </div>
          <p className="text-sm font-bold text-white">
            {picks.length} picks · {members.length} teams · {totalRounds} rounds
          </p>
          {durationStr && <p className="text-[10px] text-[#98989e] mt-0.5">Draft took {durationStr}</p>}
        </div>

        {/* Search */}
        <input value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search picks…"
          className="w-full border border-[#eeeeee] rounded-lg px-3 py-2 text-sm mb-4"
        />

        {/* Rounds */}
        {roundNumbers.map(round => {
          const roundPicks = rounds[round] ?? []
          const isLate = round > 2
          const isExpanded = expandedRounds.has(round)

          // Show collapse toggle before first late round (when not searching)
          if (isLate && !search && round === lateRounds[0] && !allLateExpanded) {
            return (
              <button key={`expand-${round}`}
                onClick={expandAllLate}
                className="w-full text-xs font-bold text-[#98989e] border border-dashed border-[#eeeeee] rounded-xl py-3 mb-3 hover:border-gray-300 hover:text-[#515151] transition">
                Show Rounds 3 – {totalRounds} ({collapsedPickCount} more picks) ▾
              </button>
            )
          }

          if (isLate && !search && !isExpanded) return null

          return (
            <div key={round} className="mb-3">
              <div className="mb-2">
                <span className="text-[9px] font-black text-white bg-[#1a1a1a] px-3 py-1 rounded-full uppercase tracking-wider">
                  ROUND {round}
                </span>
              </div>
              {roundPicks.map(pick => renderPick(pick))}
            </div>
          )
        })}

        {filteredPicks.length === 0 && (
          <p className="text-sm text-[#98989e] text-center py-6">No picks match your search.</p>
        )}
      </div>
    </div>
  )
}
```

**Note:** `pick.player.teamId` — verify this field exists on the `Pick` interface's player object. If the existing interface uses `team.id` or just `teamId` at a different path, adjust accordingly.

- [ ] **Step 2: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10`

Common fix: if `renderPick` inside the `return` block causes a TS error, move it above the `return` statement as a regular nested function.

- [ ] **Step 3: Run all tests**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -15`

Expected: all tests pass (76 existing + 5 new = 81).

- [ ] **Step 4: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" && git commit -m "feat(draft): add post-draft pick history grouped by round"
```

---

## Task 7: Full build + verification

- [ ] **Step 1: TypeScript check**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -20`

- [ ] **Step 2: Run all tests**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -15`

Expected: 81 tests pass.

- [ ] **Step 3: Build**

`cd c:/Users/Lenno/Projects/HockeyPoolz && npm run build 2>&1 | tail -30`

Expected: no errors. Route list includes `/api/leagues/[id]/draft/rankings`.

- [ ] **Step 4: Fix if needed**

If build fails:
- `renderPick` declared inside `return` → move it before `return`
- `pick.player.teamId` mismatch → read the `Pick` interface and use the correct field name
- Missing `useCallback` import → add to the `import { useState, useEffect, ... }` line at the top

---

## Spec Coverage

| Spec requirement | Task |
|---|---|
| Pre-draft countdown card | 2 |
| Autodraft toggle (pre-draft) | 2 |
| Rankings sub-tab | 3 |
| Mode toggle MY SCORING / ADP | 3 |
| Position filter pills | 3 |
| Search input | 3 |
| PROJ column (blue highlight) | 3 |
| ★ wishlist star per row | 3 |
| Goalie row handling (W/saves in G/A columns) | 3 |
| My Wishlist sub-tab with count badge | 4 |
| Drag-to-reorder with handles | 4 |
| Rank circles (top pick team-color filled) | 4 |
| Remove button (✕) | 4 |
| "Add from Rankings" CTA footer | 4 |
| Mid-draft autodraft toggle | 5 |
| Post-draft COMPLETE summary card | 6 |
| Pick history grouped by round | 6 |
| Rounds 3+ collapsed by default | 6 |
| YOU badge + team-color left border | 6 |
| AUTO badge for autopicks | 6 |
| Time taken per pick | 6 |

**Not covered (out of scope):**
- Team dropdown filter for 32 NHL teams — API supports `teamId` param (Task 1) but no dropdown in the UI; search covers primary use case
- Goalie W/GAA/SV% columns — `goalsAgainst` is in game stats but GAA/SV% are derived; table shows wins + saves which is available
- Post-draft search + team filter dropdown — search is included; team filter is omitted
