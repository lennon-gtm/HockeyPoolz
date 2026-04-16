# User Flows & Team Color Theming Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild first-time user flows (join and create league), add image upload for team icons, and apply NHL team colors to league-scoped pages.

**Architecture:** Fold onboarding into the join/create flows (team name, icon, NHL team become league-specific). Store `favoriteTeamId` on LeagueMember. Add Vercel Blob image upload. Apply `colorPrimary` from the member's favorite team to league-scoped pages via inline styles.

**Tech Stack:** Next.js 16.2.2 App Router, Prisma v7, Vercel Blob (`@vercel/blob`), Firebase Auth, Vitest

---

## Codebase Context

Before reading this plan, know that:
- Auth: every protected route calls `getBearerToken(request.headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`
- `lib/auth.ts` exports `verifyIdToken`, `getBearerToken`, `AuthError`
- `lib/prisma.ts` exports `prisma` (singleton PrismaClient with PrismaPg adapter)
- Pages use `'use client'`, `use(params)` for dynamic route params, `useEffect` for data fetching
- Tests use Vitest: run with `npm run test:run`
- `safeIcon()` helper exists in `app/(app)/league/[id]/page.tsx`, `draft/page.tsx`, `standings/page.tsx` — currently returns `🏒` for URL or null, otherwise returns the icon string
- NhlTeam model has `colorPrimary` and `colorSecondary` fields, seeded with real NHL colors
- NHL team data in `lib/nhl-teams-data.ts`; seeded via `prisma/seed.ts`
- Onboarding page at `app/(app)/onboarding/page.tsx` has 3-step UI: team name, emoji grid, NHL team picker grouped by conference/division
- `proxy.ts` PUBLIC_PATHS already includes `/api/cron/`, `/api/admin/`, `/api/nhl-teams`, `/api/nhl-players`, `/api/leagues/by-code/`

## File Structure

**New files:**
- `app/api/uploads/team-icon/route.ts` — multipart image upload → Vercel Blob
- `app/(app)/league/[id]/create/wizard.tsx` — NOT creating this; the create flow lives in `app/(app)/league/create/page.tsx` as a multi-step in-page state machine
- `components/team-setup-form.tsx` — shared 3-field form (team name, icon picker with upload, NHL team selector) used by both join and create flows
- `__tests__/api/uploads/team-icon.test.ts` — unit tests for the upload route validation

**Modified files:**
- `prisma/schema.prisma` — add `favoriteTeamId` to LeagueMember
- `app/api/leagues/[id]/join/route.ts` — accept `favoriteTeamId`
- `app/api/leagues/route.ts` — stop auto-creating a LeagueMember on league creation
- `app/(app)/join/[code]/page.tsx` — rewrite as 2-step flow (welcome, team setup)
- `app/(app)/league/create/page.tsx` — rewrite as 4-step wizard
- `app/(app)/league/[id]/page.tsx` — apply member color theming
- `app/(app)/league/[id]/draft/page.tsx` — apply member color theming
- `app/(app)/league/[id]/standings/page.tsx` — apply member color theming
- `app/(app)/league/[id]/players/[playerId]/page.tsx` — apply member color theming
- `app/api/leagues/[id]/route.ts` — include `members.favoriteTeam` in response
- All three `safeIcon()` usages — update to detect URL and render `<img>`, not `🏒` fallback (still returns raw value, rendering is at callsite)

**Deleted files:**
- `app/(app)/onboarding/page.tsx`

---

## Task 1: Database Migration — Add favoriteTeamId to LeagueMember

**Files:**
- Modify: `prisma/schema.prisma`
- Create: `prisma/migrations/YYYYMMDDHHMMSS_add_league_member_favorite_team/migration.sql` (generated)

- [ ] **Step 1: Update the Prisma schema**

In `prisma/schema.prisma`, modify the `LeagueMember` model. After the `joinedAt` line, add `favoriteTeamId`. In the relations section, add `favoriteTeam`.

```prisma
model LeagueMember {
  id                String            @id @default(uuid())
  leagueId          String            @map("league_id")
  userId            String            @map("user_id")
  teamName          String            @map("team_name")
  teamIcon          String?           @map("team_icon")
  favoriteTeamId    String?           @map("favorite_nhl_team_id")
  draftPosition     Int?              @map("draft_position")
  autodraftEnabled  Boolean           @default(false) @map("autodraft_enabled")
  autodraftStrategy AutodraftStrategy @default(adp) @map("autodraft_strategy")
  totalScore        Decimal           @default(0) @db.Decimal(10, 2) @map("total_score")
  scoreLastCalculatedAt DateTime?     @map("score_last_calculated_at")
  joinedAt          DateTime          @default(now()) @map("joined_at")

  league       League              @relation(fields: [leagueId], references: [id])
  user         User                @relation(fields: [userId], references: [id])
  favoriteTeam NhlTeam?            @relation("LeagueMemberFavoriteTeam", fields: [favoriteTeamId], references: [id])
  draftPicks   DraftPick[]
  wishlist     AutodraftWishlist[]
  recaps       Recap[]

  @@unique([leagueId, userId])
  @@map("league_members")
}
```

Also update the `NhlTeam` model's relations (find the `NhlTeam` block — around line 195) to include:

```prisma
model NhlTeam {
  // ... existing fields ...

  players       NhlPlayer[]
  users         User[]
  leagueMembers LeagueMember[] @relation("LeagueMemberFavoriteTeam")
}
```

And update the `User.favoriteTeam` relation to add a relation name so it doesn't conflict:

```prisma
  favoriteTeam NhlTeam? @relation("UserFavoriteTeam", fields: [favoriteTeamId], references: [id])
```

And in `NhlTeam`, rename the `users` relation:

```prisma
  users User[] @relation("UserFavoriteTeam")
```

- [ ] **Step 2: Create and apply the migration**

Run:

```bash
npx prisma migrate dev --name add_league_member_favorite_team
```

Expected: Migration created and applied, Prisma client regenerated.

- [ ] **Step 3: Backfill existing data**

Create `prisma/migrations/YYYYMMDDHHMMSS_backfill_league_member_favorite_team/migration.sql` (use next timestamp after step 2):

```sql
UPDATE league_members lm
SET favorite_nhl_team_id = u.favorite_nhl_team_id
FROM users u
WHERE lm.user_id = u.id AND u.favorite_nhl_team_id IS NOT NULL;
```

Then run:

```bash
npx prisma migrate dev
```

Expected: Backfill applied, existing league members now have their favorite NHL team copied from their user record.

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations
git commit -m "feat(db): add favoriteTeamId to LeagueMember with backfill"
```

---

## Task 2: Install Vercel Blob SDK

**Files:**
- Modify: `package.json` (via npm install)

- [ ] **Step 1: Install the package**

Run:

```bash
npm install @vercel/blob
```

- [ ] **Step 2: Verify installation**

Run:

```bash
npm list @vercel/blob
```

Expected: Shows `@vercel/blob@<version>` in the dependency tree.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add @vercel/blob dependency for team icon uploads"
```

---

## Task 3: Image Upload API — Tests First

**Files:**
- Create: `__tests__/api/uploads/team-icon.test.ts`

- [ ] **Step 1: Write failing tests**

Create `__tests__/api/uploads/team-icon.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('@vercel/blob', () => ({
  put: vi.fn(async (name: string) => ({
    url: `https://blob.vercel-storage.com/${name}`,
  })),
}))

vi.mock('@/lib/auth', () => ({
  getBearerToken: vi.fn(() => 'fake-token'),
  verifyIdToken: vi.fn(async () => ({ uid: 'fake-uid' })),
  AuthError: class AuthError extends Error {},
}))

vi.mock('@/lib/prisma', () => ({
  prisma: {
    user: {
      findUnique: vi.fn(async () => ({ id: 'user-1', firebaseUid: 'fake-uid' })),
    },
  },
}))

import { POST } from '../../../app/api/uploads/team-icon/route'

function makeRequest(body: FormData): Request {
  return new Request('http://localhost/api/uploads/team-icon', {
    method: 'POST',
    headers: { authorization: 'Bearer fake-token' },
    body,
  })
}

describe('POST /api/uploads/team-icon', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns 400 when no file is provided', async () => {
    const form = new FormData()
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('rejects non-image files', async () => {
    const form = new FormData()
    const file = new File(['hello'], 'test.txt', { type: 'text/plain' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('rejects files larger than 2MB', async () => {
    const form = new FormData()
    const bigBuffer = new Uint8Array(2 * 1024 * 1024 + 1)
    const file = new File([bigBuffer], 'big.png', { type: 'image/png' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(400)
  })

  it('uploads a valid image and returns the URL', async () => {
    const form = new FormData()
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'icon.png', { type: 'image/png' })
    form.append('image', file)
    const res = await POST(makeRequest(form) as never)
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.url).toContain('https://blob.vercel-storage.com/')
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm run test:run -- __tests__/api/uploads/team-icon.test.ts
```

Expected: FAIL — module not found.

---

## Task 4: Image Upload API — Implementation

**Files:**
- Create: `app/api/uploads/team-icon/route.ts`

- [ ] **Step 1: Implement the upload route**

Create `app/api/uploads/team-icon/route.ts`:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { put } from '@vercel/blob'
import { verifyIdToken, getBearerToken, AuthError } from '@/lib/auth'
import { prisma } from '@/lib/prisma'

const MAX_BYTES = 2 * 1024 * 1024
const ALLOWED_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp']

export async function POST(request: NextRequest) {
  try {
    const token = getBearerToken(request.headers.get('authorization'))
    const decoded = await verifyIdToken(token)

    const user = await prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const form = await request.formData()
    const file = form.get('image')

    if (!(file instanceof File)) {
      return NextResponse.json({ error: 'No image provided' }, { status: 400 })
    }

    if (!ALLOWED_TYPES.includes(file.type)) {
      return NextResponse.json({ error: 'Only PNG, JPEG, GIF, or WEBP images are allowed' }, { status: 400 })
    }

    if (file.size > MAX_BYTES) {
      return NextResponse.json({ error: 'Image must be 2MB or smaller' }, { status: 400 })
    }

    const ext = file.type.split('/')[1]
    const filename = `team-icons/${user.id}-${Date.now()}.${ext}`

    const blob = await put(filename, file, { access: 'public' })

    return NextResponse.json({ url: blob.url })
  } catch (error) {
    if (error instanceof AuthError) return NextResponse.json({ error: error.message }, { status: 401 })
    console.error('POST /api/uploads/team-icon error:', error)
    return NextResponse.json({ error: 'Upload failed' }, { status: 500 })
  }
}
```

- [ ] **Step 2: Run tests to verify they pass**

Run:

```bash
npm run test:run -- __tests__/api/uploads/team-icon.test.ts
```

Expected: All 4 tests PASS.

- [ ] **Step 3: Commit**

```bash
git add app/api/uploads/team-icon/route.ts __tests__/api/uploads/team-icon.test.ts
git commit -m "feat: add team icon upload endpoint with validation"
```

---

## Task 5: Shared Team Setup Form Component

**Files:**
- Create: `components/team-setup-form.tsx`

- [ ] **Step 1: Create the shared component**

Create `components/team-setup-form.tsx`:

```tsx
'use client'
import { useState, useEffect, useRef } from 'react'
import { auth } from '@/lib/firebase/client'

export interface NhlTeam {
  id: string
  name: string
  city: string
  conference: string
  division: string
  colorPrimary: string
  colorSecondary: string
}

export interface TeamSetupValues {
  teamName: string
  teamIcon: string | null
  favoriteTeamId: string | null
}

interface Props {
  initialValues?: Partial<TeamSetupValues>
  submitLabel: string
  loading?: boolean
  onSubmit: (values: TeamSetupValues) => void | Promise<void>
}

const EMOJI_OPTIONS = ['🏒', '🦅', '🐺', '⚡', '🔥', '🦁', '🦊', '🐻', '🏆', '🥅']

export function TeamSetupForm({ initialValues, submitLabel, loading, onSubmit }: Props) {
  const [teamName, setTeamName] = useState(initialValues?.teamName ?? '')
  const [teamIcon, setTeamIcon] = useState<string | null>(initialValues?.teamIcon ?? '🏒')
  const [favoriteTeamId, setFavoriteTeamId] = useState<string | null>(initialValues?.favoriteTeamId ?? null)
  const [nhlTeams, setNhlTeams] = useState<NhlTeam[]>([])
  const [search, setSearch] = useState('')
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    fetch('/api/nhl-teams').then(r => r.json()).then(d => setNhlTeams(d.teams ?? []))
  }, [])

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    setUploading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const form = new FormData()
      form.append('image', file)
      const res = await fetch('/api/uploads/team-icon', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: form,
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Upload failed'); return }
      setTeamIcon(data.url)
    } catch {
      setError('Upload failed')
    } finally {
      setUploading(false)
    }
  }

  function submit() {
    if (teamName.trim().length < 1) { setError('Team name is required'); return }
    if (!favoriteTeamId) { setError('Please pick a favourite NHL team'); return }
    setError('')
    onSubmit({ teamName: teamName.trim(), teamIcon, favoriteTeamId })
  }

  const conferences = ['east', 'west']
  const divisions: Record<string, string[]> = {
    east: ['Atlantic', 'Metropolitan'],
    west: ['Central', 'Pacific'],
  }
  const filteredTeams = (conference: string, division: string) =>
    nhlTeams
      .filter(t => t.conference === conference && t.division === division)
      .filter(t => !search || t.city.toLowerCase().includes(search.toLowerCase()) || t.name.toLowerCase().includes(search.toLowerCase()))

  const selectedTeam = nhlTeams.find(t => t.id === favoriteTeamId)
  const iconIsUrl = teamIcon?.startsWith('http') ?? false

  return (
    <div>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <label className="block text-sm font-semibold mb-1">Team Name</label>
      <input
        className="w-full border-2 border-gray-200 rounded-xl p-3 mb-5 focus:border-orange-500 outline-none"
        placeholder="e.g. BobsTeam"
        value={teamName}
        onChange={e => setTeamName(e.target.value)}
        maxLength={30}
      />

      <label className="block text-sm font-semibold mb-2">Team Icon</label>
      <div className="grid grid-cols-5 gap-2 mb-2">
        {EMOJI_OPTIONS.map(e => (
          <button
            key={e}
            type="button"
            onClick={() => setTeamIcon(e)}
            className={`text-2xl p-2 rounded-xl border-2 transition ${teamIcon === e ? 'border-orange-500 bg-orange-50' : 'border-gray-200'}`}
          >
            {e}
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => fileInputRef.current?.click()}
        disabled={uploading}
        className="w-full py-2 mb-2 border-2 border-dashed border-gray-300 rounded-xl text-sm font-semibold text-gray-600 hover:border-orange-400 disabled:opacity-50"
      >
        {uploading ? 'Uploading…' : '📷 Upload Custom Icon'}
      </button>
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp"
        onChange={handleFile}
        className="hidden"
      />
      {iconIsUrl && teamIcon && (
        <div className="flex items-center gap-2 mb-5 p-2 border border-gray-200 rounded-xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={teamIcon} alt="Team icon" className="w-10 h-10 rounded-full object-cover" />
          <span className="text-xs text-gray-500">Custom icon uploaded</span>
          <button type="button" onClick={() => setTeamIcon('🏒')} className="ml-auto text-xs text-red-500 font-bold">Remove</button>
        </div>
      )}

      <label className="block text-sm font-semibold mb-2 mt-4">Favourite NHL Team</label>
      <p className="text-xs text-gray-500 mb-3">Your league dashboard will use their colours.</p>
      <input
        className="w-full border-2 border-gray-200 rounded-xl p-2 text-sm mb-4 focus:border-orange-500 outline-none"
        placeholder="Search teams…"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      {conferences.map(conf => (
        <div key={conf} className="mb-4">
          <span className={`text-xs font-bold tracking-widest uppercase text-white px-2 py-0.5 rounded ${conf === 'east' ? 'bg-blue-900' : 'bg-green-800'}`}>
            {conf === 'east' ? 'Eastern' : 'Western'}
          </span>
          {divisions[conf].map(div => {
            const teams = filteredTeams(conf, div)
            if (!teams.length) return null
            return (
              <div key={div} className="mt-2">
                <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">{div}</p>
                <div className="grid grid-cols-4 gap-2">
                  {teams.map(team => (
                    <button
                      key={team.id}
                      type="button"
                      onClick={() => setFavoriteTeamId(team.id)}
                      className={`rounded-xl border-2 p-2 text-center transition ${favoriteTeamId === team.id ? 'border-current' : 'border-gray-200'}`}
                      style={favoriteTeamId === team.id ? { borderColor: team.colorPrimary, backgroundColor: team.colorPrimary + '10' } : {}}
                    >
                      <div
                        className="w-6 h-6 rounded-full mx-auto mb-1"
                        style={{ background: `linear-gradient(135deg, ${team.colorPrimary}, ${team.colorSecondary})` }}
                      />
                      <p className="text-[10px] font-semibold leading-tight" style={favoriteTeamId === team.id ? { color: team.colorPrimary } : { color: '#444' }}>
                        {team.city}<br />{team.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      ))}

      <button
        type="button"
        onClick={submit}
        disabled={loading || uploading}
        className="w-full py-3 rounded-xl font-bold text-white transition disabled:opacity-40 mt-2"
        style={{ backgroundColor: selectedTeam?.colorPrimary ?? '#FF6B00' }}
      >
        {loading ? 'Saving…' : submitLabel}
      </button>
    </div>
  )
}
```

- [ ] **Step 2: Verify the component builds**

Run:

```bash
npx next build 2>&1 | tail -10
```

Expected: Build completes with no type errors related to the new file. (Build may fail on other pre-existing issues — that's OK, the component just needs to type-check.)

- [ ] **Step 3: Commit**

```bash
git add components/team-setup-form.tsx
git commit -m "feat: add shared TeamSetupForm component with image upload"
```

---

## Task 6: Update Join Endpoint — Accept favoriteTeamId

**Files:**
- Modify: `app/api/leagues/[id]/join/route.ts`

- [ ] **Step 1: Update the join endpoint**

In `app/api/leagues/[id]/join/route.ts`, update the body destructure and member creation:

```typescript
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

    const member = await prisma.leagueMember.create({
      data: {
        leagueId: league.id,
        userId: user.id,
        teamName: teamName.trim(),
        teamIcon: teamIcon ?? null,
        favoriteTeamId: favoriteTeamId ?? null,
      },
    })
```

The rest of the file stays the same.

- [ ] **Step 2: Commit**

```bash
git add "app/api/leagues/[id]/join/route.ts"
git commit -m "feat(api): accept favoriteTeamId on league join"
```

---

## Task 7: Update League Create Endpoint — Stop Auto-creating Member

**Files:**
- Modify: `app/api/leagues/route.ts`

- [ ] **Step 1: Remove the auto-created LeagueMember**

In `app/api/leagues/route.ts`, in the POST handler, delete the block that creates the commissioner's LeagueMember (lines 42-50):

```typescript
    // DELETE THIS ENTIRE BLOCK:
    // Commissioner auto-joins as first member
    // await prisma.leagueMember.create({
    //   data: {
    //     leagueId: league.id,
    //     userId: user.id,
    //     teamName: user.displayName,
    //     teamIcon: null,
    //   },
    // })
```

The final file should just create the League (with scoring settings), then return it. The commissioner will join via the create wizard's team setup step using the regular join endpoint.

- [ ] **Step 2: Update the PATCH endpoint for members/me to allow favoriteTeamId edits**

In `app/api/leagues/[id]/members/me/route.ts`, update the PATCH handler to also accept `favoriteTeamId`:

Replace the `updates` building block with:

```typescript
    const body = await request.json()
    const updates: Record<string, string | null> = {}

    if (body.teamName !== undefined) {
      const name = String(body.teamName).trim()
      if (name.length < 1) return NextResponse.json({ error: 'Team name is required' }, { status: 400 })
      updates.teamName = name
    }

    if (body.teamIcon !== undefined) {
      updates.teamIcon = body.teamIcon ?? null
    }

    if (body.favoriteTeamId !== undefined) {
      updates.favoriteTeamId = body.favoriteTeamId ?? null
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: 'No valid fields provided' }, { status: 400 })
    }
```

- [ ] **Step 3: Commit**

```bash
git add app/api/leagues/route.ts "app/api/leagues/[id]/members/me/route.ts"
git commit -m "feat(api): decouple league creation from commissioner member creation"
```

---

## Task 8: Rewrite Join Flow UI

**Files:**
- Modify: `app/(app)/join/[code]/page.tsx`

- [ ] **Step 1: Rewrite the join page as a 2-step flow**

Replace the entire contents of `app/(app)/join/[code]/page.tsx` with:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamSetupForm, type TeamSetupValues } from '@/components/team-setup-form'

interface League { id: string; name: string; commissioner: { displayName: string }; members: { id: string }[]; maxTeams: number }

type Step = 'welcome' | 'team-setup'

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
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add "app/(app)/join/[code]/page.tsx"
git commit -m "feat: rewrite join flow as welcome + team setup"
```

---

## Task 9: Rewrite League Create Flow as Wizard

**Files:**
- Modify: `app/(app)/league/create/page.tsx`

- [ ] **Step 1: Rewrite the create page as a 4-step wizard**

Replace the entire contents of `app/(app)/league/create/page.tsx` with:

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamSetupForm, type TeamSetupValues } from '@/components/team-setup-form'

type Step = 'settings' | 'invite' | 'scoring' | 'team-setup'

interface CreatedLeague { id: string; inviteCode: string; name: string }

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

export default function CreateLeaguePage() {
  const router = useRouter()
  const [step, setStep] = useState<Step>('settings')
  const [league, setLeague] = useState<CreatedLeague | null>(null)

  // Step 1 state
  const [name, setName] = useState('')
  const [maxTeams, setMaxTeams] = useState(8)
  const [playersPerTeam, setPlayersPerTeam] = useState(10)

  // Step 3 state
  const [scoring, setScoring] = useState<ScoringSettings | null>(null)

  // Shared state
  const [copied, setCopied] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function createLeague() {
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch('/api/leagues', {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, maxTeams, playersPerTeam }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setLeague(data.league)
      setScoring(data.league.scoringSettings)
      setStep('invite')
    } catch {
      setError('Failed to create league')
    } finally {
      setLoading(false)
    }
  }

  async function saveScoring() {
    if (!league || !scoring) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/scoring`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(scoring),
      })
      if (!res.ok) { setError('Failed to save scoring'); return }
      setStep('team-setup')
    } catch {
      setError('Failed to save scoring')
    } finally {
      setLoading(false)
    }
  }

  async function submitTeam(values: TeamSetupValues) {
    if (!league) return
    setLoading(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${league.id}/join`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...values, inviteCode: league.inviteCode }),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error ?? 'Failed to create team'); return }
      router.push(`/league/${league.id}`)
    } catch {
      setError('Failed to create team')
    } finally {
      setLoading(false)
    }
  }

  const inviteUrl = league
    ? `${process.env.NEXT_PUBLIC_APP_URL ?? (typeof window !== 'undefined' ? window.location.origin : '')}/join/${league.inviteCode}`
    : ''

  function copyLink() {
    navigator.clipboard.writeText(inviteUrl)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <h1 className="text-2xl font-black tracking-widest mb-1">Create League</h1>
      <p className="text-xs text-gray-400 mb-6">
        Step {step === 'settings' ? 1 : step === 'invite' ? 2 : step === 'scoring' ? 3 : 4} of 4
      </p>
      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      {step === 'settings' && (
        <>
          <label className="block text-sm font-semibold mb-1">League Name</label>
          <input
            className="w-full border-2 border-gray-200 rounded-xl p-3 mb-4 focus:border-orange-500 outline-none"
            value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Office Pool 2026"
          />
          <label className="block text-sm font-semibold mb-1">Max Teams ({maxTeams})</label>
          <input type="range" min={2} max={20} value={maxTeams} onChange={e => setMaxTeams(+e.target.value)}
            className="w-full mb-4 accent-orange-500" />
          <label className="block text-sm font-semibold mb-1">Players per Team ({playersPerTeam})</label>
          <input type="range" min={4} max={20} value={playersPerTeam} onChange={e => setPlayersPerTeam(+e.target.value)}
            className="w-full mb-6 accent-orange-500" />
          <button onClick={createLeague} disabled={loading || !name.trim()}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40">
            {loading ? 'Creating…' : 'Create League →'}
          </button>
        </>
      )}

      {step === 'invite' && league && (
        <>
          <h2 className="text-lg font-bold mb-2">League created!</h2>
          <p className="text-sm text-gray-500 mb-4">Share this link with your friends so they can join.</p>
          <div className="bg-gray-50 rounded-xl p-4 mb-4">
            <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">Invite Link</p>
            <p className="text-sm text-gray-600 break-all mb-3">{inviteUrl}</p>
            <button onClick={copyLink}
              className="bg-orange-500 text-white px-4 py-2 rounded-lg text-sm font-bold hover:bg-orange-600 transition">
              {copied ? '✓ Copied!' : 'Copy Link'}
            </button>
          </div>
          <button onClick={() => setStep('scoring')}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition">
            Configure Scoring →
          </button>
        </>
      )}

      {step === 'scoring' && scoring && (
        <>
          <h2 className="text-lg font-bold mb-4">Scoring Settings</h2>
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Skater Categories</p>
          {Object.entries(SKATER_LABELS).map(([field, label]) => (
            <div key={field} className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold">{label}</label>
                <span className="text-sm font-bold text-orange-500">{Number(scoring[field as keyof ScoringSettings]).toFixed(1)} pts</span>
              </div>
              <input
                type="range" min={0} max={10} step={0.5}
                value={Number(scoring[field as keyof ScoringSettings])}
                onChange={e => setScoring(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
                className="w-full accent-orange-500"
              />
            </div>
          ))}
          <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 mt-8">Goalie Categories</p>
          {Object.entries(GOALIE_LABELS).map(([field, label]) => (
            <div key={field} className="mb-5">
              <div className="flex items-center justify-between mb-1">
                <label className="text-sm font-semibold">{label}</label>
                <span className="text-sm font-bold text-orange-500">{Number(scoring[field as keyof ScoringSettings]).toFixed(1)} pts</span>
              </div>
              <input
                type="range" min={0} max={10} step={0.5}
                value={Number(scoring[field as keyof ScoringSettings])}
                onChange={e => setScoring(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
                className="w-full accent-orange-500"
              />
            </div>
          ))}
          <button onClick={saveScoring} disabled={loading}
            className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40 mt-2">
            {loading ? 'Saving…' : 'Next: Set Up Your Team →'}
          </button>
        </>
      )}

      {step === 'team-setup' && league && (
        <>
          <h2 className="text-lg font-bold mb-4">Set up your team</h2>
          <TeamSetupForm submitLabel="Finish →" loading={loading} onSubmit={submitTeam} />
        </>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Update POST /api/leagues to return scoringSettings**

Read the current `app/api/leagues/route.ts` — the POST handler already includes `scoringSettings: true` in the response. Verify:

```bash
grep -n "scoringSettings" app/api/leagues/route.ts
```

Expected: Shows the `include: { scoringSettings: true }` line.

If it's not there, add it.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/league/create/page.tsx"
git commit -m "feat: rewrite league creation as 4-step wizard"
```

---

## Task 10: Delete Onboarding Page

**Files:**
- Delete: `app/(app)/onboarding/page.tsx`

- [ ] **Step 1: Delete the onboarding page**

```bash
rm "app/(app)/onboarding/page.tsx"
```

- [ ] **Step 2: Grep for references**

```bash
grep -r "onboarding" app/ --include="*.tsx" --include="*.ts"
```

Expected: Only hits should be in route configs or comments. The login page may redirect to /onboarding — check and update to redirect to `/` (home) instead if needed.

- [ ] **Step 3: Check the login page redirect**

Read `app/login/page.tsx` (or `app/(auth)/login/page.tsx`). If it redirects to `/onboarding`, change to `/`. If it redirects based on `needsOnboarding`, remove that branch and just redirect to `/`.

- [ ] **Step 4: Check the /api/auth/me needsOnboarding response**

Read `app/api/auth/me/route.ts`. Remove the `needsOnboarding` field from the response:

```typescript
    // Change this:
    return NextResponse.json({ user, needsOnboarding })
    // To this:
    return NextResponse.json({ user })
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: remove standalone onboarding page — team setup moved to join/create flows"
```

---

## Task 11: Apply Color Theming to League Lobby

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`
- Modify: `app/api/leagues/[id]/route.ts`

- [ ] **Step 1: Update the league API to include member favorite teams**

Read `app/api/leagues/[id]/route.ts`. In the GET handler's prisma query, update the `members` include to include `favoriteTeam`:

```typescript
      members: {
        include: {
          user: { select: { id: true, displayName: true } },
          favoriteTeam: { select: { colorPrimary: true, colorSecondary: true, name: true } },
        },
      },
```

If the existing query uses `select` instead of `include`, add `favoriteTeam` to the selection. Read the full file first to see the structure, then adapt.

- [ ] **Step 2: Update the lobby page to apply member color**

In `app/(app)/league/[id]/page.tsx`, update the `Member` interface to include favoriteTeam:

```typescript
interface Member {
  id: string; teamName: string; teamIcon: string | null
  draftPosition: number | null; autodraftEnabled: boolean
  user: { displayName: string; id: string }
  favoriteTeam?: { colorPrimary: string; colorSecondary: string; name: string } | null
}
```

Find the `const myMember = league.members.find(m => m.user.id === myUserId)` line. After it, derive the color:

```typescript
  const myColor = myMember?.favoriteTeam?.colorPrimary ?? '#FF6B00'
```

Then update the `safeIcon` display: find the `{safeIcon(m.teamIcon)}` calls and replace each with a helper that renders either an img or text:

Replace the existing `safeIcon` function at the top of the file with:

```typescript
function TeamIcon({ icon, size = 'md' }: { icon: string | null; size?: 'sm' | 'md' | 'lg' }) {
  const sizeClass = size === 'sm' ? 'w-6 h-6 text-base' : size === 'lg' ? 'w-10 h-10 text-2xl' : 'w-8 h-8 text-xl'
  if (icon?.startsWith('http')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${sizeClass} rounded-full object-cover`} />
  }
  return <span className={size === 'lg' ? 'text-2xl' : 'text-xl'}>{icon || '🏒'}</span>
}
```

Then replace every `<span className="text-xl">{safeIcon(m.teamIcon)}</span>` with `<TeamIcon icon={m.teamIcon} />`, and every `<span className="text-2xl">{safeIcon(m.teamIcon)}</span>` with `<TeamIcon icon={m.teamIcon} size="lg" />`. Same for standings rows using `s.teamIcon`.

Then update the buttons and accent bars to use `myColor`:

- Find the "Start Draft" button — change `bg-orange-500 ... hover:bg-orange-600` to use inline style:
  ```tsx
  <button
    ...
    style={{ backgroundColor: myColor }}
    className="flex-1 py-3 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition"
  >
  ```
- Same for other primary buttons in the lobby page.
- Add a colored header strip at the top (above the h1): `<div className="h-1" style={{ backgroundColor: myColor }} />`

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/league/[id]/page.tsx" "app/api/leagues/[id]/route.ts"
git commit -m "feat: apply member favorite team color theming to league lobby"
```

---

## Task 12: Apply Color Theming to Draft, Standings, and Player Pages

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`
- Modify: `app/(app)/league/[id]/standings/page.tsx`
- Modify: `app/(app)/league/[id]/players/[playerId]/page.tsx`

- [ ] **Step 1: Update standings page to theme user's row**

In `app/(app)/league/[id]/standings/page.tsx`, fetch the current user's member record (the page already likely fetches `/api/auth/me` or knows the user ID).

Add state:
```typescript
const [myColor, setMyColor] = useState<string>('#FF6B00')
const [myMemberId, setMyMemberId] = useState<string | null>(null)
```

In the load useEffect, after fetching standings, also fetch the current user via `/api/auth/me` and match their member in the standings to get the favoriteTeam color. OR extend the standings API to include favoriteTeam.colorPrimary for each member — simpler:

Update `app/api/leagues/[id]/standings/route.ts` to include `favoriteTeam: { select: { colorPrimary: true } }` in the member query, then include `colorPrimary` in each standing entry's output.

Update the Standing interface in the standings page:
```typescript
interface Standing {
  rank: number; memberId: string; teamName: string; teamIcon: string | null
  userName: string; totalScore: number; colorPrimary: string | null
  players: PlayerStanding[]
}
```

For the user's own row: match `s.memberId === myMemberId` (fetch via `/api/auth/me` → find membership). Apply `style={{ borderLeft: \`4px solid ${s.colorPrimary ?? '#FF6B00'}\` }}` when it's the user's row.

Replace existing safeIcon spans with the TeamIcon component (same pattern as Task 11 — add the helper at the top of the file).

- [ ] **Step 2: Update draft page**

In `app/(app)/league/[id]/draft/page.tsx`:
- Add TeamIcon helper same as Task 11
- Replace existing safeIcon/teamIcon displays with `<TeamIcon icon={...} />`
- For "On the clock" indicator, apply the current picker's color if available. The draft API may need to include `favoriteTeam.colorPrimary` for each member — update accordingly.

Extend the Draft interface to include `colorPrimary` on `currentPicker`.

Update the draft API at `app/api/leagues/[id]/draft/route.ts` GET handler: include `favoriteTeam` in the member query used to build `currentPicker`.

In the UI:
```tsx
<div style={{ backgroundColor: (currentPicker.colorPrimary ?? '#FF6B00') + '20', borderColor: currentPicker.colorPrimary ?? '#FF6B00' }}
     className="border-2 rounded-xl p-4 mb-6">
  ... "On the clock" content ...
</div>
```

Action buttons (Draft Player) should use the picker's color when it's the user's turn.

- [ ] **Step 3: Update player detail page**

In `app/(app)/league/[id]/players/[playerId]/page.tsx`:
- Fetch the current user's member color (either extend the player detail API or fetch `/api/auth/me` + the league's members)
- Add a header strip: `<div className="h-1" style={{ backgroundColor: myColor }} />` at the top

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "feat: apply color theming to draft, standings, and player detail pages"
```

---

## Task 13: Update Invite Link to Use NEXT_PUBLIC_APP_URL (verify)

**Files:** None (verification only — already done in earlier cleanup-pass commit)

- [ ] **Step 1: Verify the invite URL logic uses the env var**

```bash
grep -n "NEXT_PUBLIC_APP_URL" app/
```

Expected: At least one hit in `app/(app)/league/[id]/page.tsx` (existing) and one in `app/(app)/league/create/page.tsx` (from Task 9).

If missing from create page, the Task 9 rewrite should already have it. Sanity check.

---

## Task 14: Run Tests and Build

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

Run:

```bash
npm run test:run
```

Expected: All tests pass (including the new upload tests from Task 3).

- [ ] **Step 2: Run the build**

Run:

```bash
rm -rf .next && npx next build
```

Expected: Build completes with no type errors.

- [ ] **Step 3: Fix any issues**

If there are errors, fix them inline and commit:

```bash
git add -A
git commit -m "fix: resolve build/type errors from user flows refactor"
```

---

## Task 15: Smoke Test Checklist

**Files:** None (manual verification)

After deploy, verify the following flows work end-to-end:

- [ ] **Commissioner flow:** Log in → Create League → see invite step with working copy button → configure scoring → set up team (including custom icon upload) → land in league lobby with correct colors applied
- [ ] **Participant flow:** Log in via invite link → see welcome screen with league details → set up team → land in league lobby with correct colors applied
- [ ] **Existing user:** Log in → see list of leagues → click one → lobby shows their colors (from backfilled favorite team)
- [ ] **Image upload:** Upload a custom icon, verify it displays throughout (lobby, draft, standings)

---
