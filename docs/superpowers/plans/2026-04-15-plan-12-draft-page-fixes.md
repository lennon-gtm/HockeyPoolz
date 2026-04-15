# Draft Page Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three bugs on the draft page: show playoff-qualified teams only, add a 2025-26 RS stats label, and make scoring settings read-only for non-commissioners.

**Architecture:** Four independent changes — a Prisma schema migration + seed update, two API where-clause filters, one table header UI tweak, and one settings page conditional render. No new files required. Operational step (cron sync) is last.

**Tech Stack:** Next.js 16, Prisma 7, PostgreSQL, React, Tailwind, Firebase Auth

---

## File Map

| File | Change |
|------|--------|
| `prisma/schema.prisma` | Add `playoffQualified` field to `NhlTeam` |
| `lib/nhl-teams-data.ts` | Add `playoffQualified` to interface + set true for 16 teams |
| `prisma/seed.ts` | Include `playoffQualified` in upsert |
| `app/api/nhl-players/route.ts` | Filter `team: { playoffQualified: true }` |
| `app/api/leagues/[id]/draft/rankings/route.ts` | Filter `team: { playoffQualified: true }` |
| `app/(app)/league/[id]/draft/page.tsx` | Add "2025-26 RS" pill to table header |
| `app/(app)/league/[id]/settings/page.tsx` | Fetch commissioner status, disable UI for non-commissioners |

---

## Task 1: Add `playoffQualified` to schema and migrate

**Files:**
- Modify: `prisma/schema.prisma`

- [ ] **Step 1: Add field to NhlTeam model**

In `prisma/schema.prisma`, find the `NhlTeam` model and add the new field after `eliminatedAt`:

```prisma
model NhlTeam {
  id             String     @id
  name           String
  city           String
  abbreviation   String
  logoUrl        String?    @map("logo_url")
  conference     Conference
  division       String
  colorPrimary   String     @map("color_primary")
  colorSecondary String     @map("color_secondary")
  eliminatedAt   DateTime?  @map("eliminated_at")
  playoffQualified Boolean  @default(false) @map("playoff_qualified")

  players             NhlPlayer[]
  users               User[]          @relation("UserFavoriteTeam")
  leagueMembers       LeagueMember[]  @relation("LeagueMemberFavoriteTeam")
  pendingJoinRequests PendingJoinRequest[]

  @@map("nhl_teams")
}
```

- [ ] **Step 2: Generate and run migration**

```bash
npx prisma migrate dev --name add_playoff_qualified
```

Expected output:
```
Applying migration `20260415_add_playoff_qualified`
Your database is now in sync with your schema.
```

- [ ] **Step 3: Verify Prisma client regenerated**

```bash
npx prisma generate
```

Expected: `✔ Generated Prisma Client`

- [ ] **Step 4: Commit**

```bash
git add prisma/schema.prisma prisma/migrations/
git commit -m "feat(db): add playoffQualified field to NhlTeam"
```

---

## Task 2: Update team data and re-seed

**Files:**
- Modify: `lib/nhl-teams-data.ts`
- Modify: `prisma/seed.ts`

- [ ] **Step 1: Add `playoffQualified` to the interface and data**

Replace the entire `lib/nhl-teams-data.ts` with:

```typescript
// id is the 3-letter abbreviation (e.g. 'BOS') — it IS the abbreviation; no separate field needed
export interface NhlTeamData {
  id: string
  name: string
  city: string
  conference: 'east' | 'west'
  division: string
  colorPrimary: string
  colorSecondary: string
  playoffQualified?: boolean
}

const PLAYOFF_2026 = new Set([
  'COL', 'CAR', 'DAL', 'BUF', 'TBL', 'MTL', 'MIN', 'BOS',
  'PIT', 'PHI', 'VGK', 'OTT', 'UTA', 'EDM', 'ANA', 'LAK',
])

export const NHL_TEAMS: NhlTeamData[] = [
  // Eastern — Atlantic
  { id: 'BOS', name: 'Bruins',        city: 'Boston',       conference: 'east', division: 'Atlantic',     colorPrimary: '#FFB81C', colorSecondary: '#010101' },
  { id: 'BUF', name: 'Sabres',        city: 'Buffalo',      conference: 'east', division: 'Atlantic',     colorPrimary: '#002654', colorSecondary: '#FCB514' },
  { id: 'DET', name: 'Red Wings',     city: 'Detroit',      conference: 'east', division: 'Atlantic',     colorPrimary: '#CE1126', colorSecondary: '#FFFFFF' },
  { id: 'FLA', name: 'Panthers',      city: 'Florida',      conference: 'east', division: 'Atlantic',     colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  { id: 'MTL', name: 'Canadiens',     city: 'Montréal',     conference: 'east', division: 'Atlantic',     colorPrimary: '#AF1E2D', colorSecondary: '#192168' },
  { id: 'OTT', name: 'Senators',      city: 'Ottawa',       conference: 'east', division: 'Atlantic',     colorPrimary: '#C8102E', colorSecondary: '#C69214' },
  { id: 'TBL', name: 'Lightning',     city: 'Tampa Bay',    conference: 'east', division: 'Atlantic',     colorPrimary: '#002868', colorSecondary: '#FFFFFF' },
  { id: 'TOR', name: 'Maple Leafs',   city: 'Toronto',      conference: 'east', division: 'Atlantic',     colorPrimary: '#00205B', colorSecondary: '#FFFFFF' },
  // Eastern — Metropolitan
  { id: 'CAR', name: 'Hurricanes',    city: 'Carolina',     conference: 'east', division: 'Metropolitan', colorPrimary: '#CC0000', colorSecondary: '#000000' },
  { id: 'CBJ', name: 'Blue Jackets',  city: 'Columbus',     conference: 'east', division: 'Metropolitan', colorPrimary: '#002654', colorSecondary: '#CE1126' },
  { id: 'NJD', name: 'Devils',        city: 'New Jersey',   conference: 'east', division: 'Metropolitan', colorPrimary: '#CE1126', colorSecondary: '#003366' },
  { id: 'NYI', name: 'Islanders',     city: 'New York',     conference: 'east', division: 'Metropolitan', colorPrimary: '#00539B', colorSecondary: '#F47D30' },
  { id: 'NYR', name: 'Rangers',       city: 'New York',     conference: 'east', division: 'Metropolitan', colorPrimary: '#0038A8', colorSecondary: '#CE1126' },
  { id: 'PHI', name: 'Flyers',        city: 'Philadelphia', conference: 'east', division: 'Metropolitan', colorPrimary: '#F74902', colorSecondary: '#000000' },
  { id: 'PIT', name: 'Penguins',      city: 'Pittsburgh',   conference: 'east', division: 'Metropolitan', colorPrimary: '#FCB514', colorSecondary: '#000000' },
  { id: 'WSH', name: 'Capitals',      city: 'Washington',   conference: 'east', division: 'Metropolitan', colorPrimary: '#041E42', colorSecondary: '#C8102E' },
  // Western — Central
  { id: 'CHI', name: 'Blackhawks',    city: 'Chicago',      conference: 'west', division: 'Central',      colorPrimary: '#CF0A2C', colorSecondary: '#FF671B' },
  { id: 'COL', name: 'Avalanche',     city: 'Colorado',     conference: 'west', division: 'Central',      colorPrimary: '#6F263D', colorSecondary: '#236192' },
  { id: 'DAL', name: 'Stars',         city: 'Dallas',       conference: 'west', division: 'Central',      colorPrimary: '#006847', colorSecondary: '#8F8F8C' },
  { id: 'MIN', name: 'Wild',          city: 'Minnesota',    conference: 'west', division: 'Central',      colorPrimary: '#154734', colorSecondary: '#A6192E' },
  { id: 'NSH', name: 'Predators',     city: 'Nashville',    conference: 'west', division: 'Central',      colorPrimary: '#FFB81C', colorSecondary: '#041E42' },
  { id: 'STL', name: 'Blues',         city: 'St. Louis',    conference: 'west', division: 'Central',      colorPrimary: '#002F87', colorSecondary: '#FCB514' },
  { id: 'UTA', name: 'Hockey Club',   city: 'Utah',         conference: 'west', division: 'Central',      colorPrimary: '#6CACE4', colorSecondary: '#010101' },
  { id: 'WPG', name: 'Jets',          city: 'Winnipeg',     conference: 'west', division: 'Central',      colorPrimary: '#041E42', colorSecondary: '#004C97' },
  // Western — Pacific
  { id: 'ANA', name: 'Ducks',         city: 'Anaheim',      conference: 'west', division: 'Pacific',      colorPrimary: '#F47A38', colorSecondary: '#B09865' },
  { id: 'CGY', name: 'Flames',        city: 'Calgary',      conference: 'west', division: 'Pacific',      colorPrimary: '#C8102E', colorSecondary: '#F1BE48' },
  { id: 'EDM', name: 'Oilers',        city: 'Edmonton',     conference: 'west', division: 'Pacific',      colorPrimary: '#FF4C00', colorSecondary: '#003087' },
  { id: 'LAK', name: 'Kings',         city: 'Los Angeles',  conference: 'west', division: 'Pacific',      colorPrimary: '#111111', colorSecondary: '#A2AAAD' },
  { id: 'SJS', name: 'Sharks',        city: 'San Jose',     conference: 'west', division: 'Pacific',      colorPrimary: '#006D75', colorSecondary: '#EA7200' },
  { id: 'SEA', name: 'Kraken',        city: 'Seattle',      conference: 'west', division: 'Pacific',      colorPrimary: '#001628', colorSecondary: '#99D9D9' },
  { id: 'VAN', name: 'Canucks',       city: 'Vancouver',    conference: 'west', division: 'Pacific',      colorPrimary: '#00205B', colorSecondary: '#00843D' },
  { id: 'VGK', name: 'Golden Knights', city: 'Vegas',       conference: 'west', division: 'Pacific',      colorPrimary: '#B4975A', colorSecondary: '#333F42' },
].map(t => ({ ...t, playoffQualified: PLAYOFF_2026.has(t.id) }))
```

- [ ] **Step 2: Update seed.ts to include playoffQualified**

Replace `prisma/seed.ts` with:

```typescript
import { config } from 'dotenv'
config({ path: '.env.local' })

import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { NHL_TEAMS } from '../lib/nhl-teams-data'

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL })
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('Seeding NHL teams...')
  await prisma.$transaction(
    NHL_TEAMS.map(team =>
      prisma.nhlTeam.upsert({
        where: { id: team.id },
        update: {
          name: team.name,
          city: team.city,
          abbreviation: team.id,
          conference: team.conference,
          division: team.division,
          colorPrimary: team.colorPrimary,
          colorSecondary: team.colorSecondary,
          playoffQualified: team.playoffQualified ?? false,
        },
        create: {
          id: team.id,
          name: team.name,
          city: team.city,
          abbreviation: team.id,
          conference: team.conference,
          division: team.division,
          colorPrimary: team.colorPrimary,
          colorSecondary: team.colorSecondary,
          playoffQualified: team.playoffQualified ?? false,
        },
      })
    )
  )
  console.log(`Seeded ${NHL_TEAMS.length} teams.`)
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect())
```

- [ ] **Step 3: Run the seed**

```bash
npm run db:seed
```

Expected output:
```
Seeding NHL teams...
Seeded 32 teams.
```

- [ ] **Step 4: Verify in database**

```bash
npx prisma studio
```

Open `NhlTeam` table and confirm `playoff_qualified = true` for COL, CAR, DAL, BUF, TBL, MTL, MIN, BOS, PIT, PHI, VGK, OTT, UTA, EDM, ANA, LAK and `false` for all others (TOR, FLA, etc.).

- [ ] **Step 5: Commit**

```bash
git add lib/nhl-teams-data.ts prisma/seed.ts
git commit -m "feat(seed): mark 16 playoff-qualified teams for 2025-26 season"
```

---

## Task 3: Filter `/api/nhl-players` to playoff teams only

**Files:**
- Modify: `app/api/nhl-players/route.ts`

- [ ] **Step 1: Add playoff filter to where clause**

In `app/api/nhl-players/route.ts`, replace the `where` initialization and the `prisma.nhlPlayer.findMany` block:

```typescript
// Build where clause
const where: Record<string, unknown> = {
  isActive: true,
  team: { playoffQualified: true },
}
```

The rest of the file stays unchanged. Full updated file:

```typescript
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = request.nextUrl
    const position = searchParams.get('position')   // C|LW|RW|D|G
    const rawSearch = searchParams.get('search')?.trim()
    const search = rawSearch && rawSearch.length <= 100 ? rawSearch : null
    const draftId = searchParams.get('draftId')     // filter to available players only
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const pageSize = 50

    // Build where clause
    const where: Record<string, unknown> = {
      isActive: true,
      team: { playoffQualified: true },
    }

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

- [ ] **Step 2: Commit**

```bash
git add app/api/nhl-players/route.ts
git commit -m "feat(api): filter nhl-players to playoff-qualified teams only"
```

---

## Task 4: Filter `/api/leagues/[id]/draft/rankings` to playoff teams only

**Files:**
- Modify: `app/api/leagues/[id]/draft/rankings/route.ts`

- [ ] **Step 1: Add playoff filter to the player query**

In `app/api/leagues/[id]/draft/rankings/route.ts`, find the `prisma.nhlPlayer.findMany` call and add `team: { playoffQualified: true }` to its `where` clause:

```typescript
const players: PlayerWithIncludes[] = await prisma.nhlPlayer.findMany({
  where: {
    isActive: true,
    team: { playoffQualified: true },
    ...positionWhere,
    ...(teamId ? { teamId } : {}),
    ...(search ? { name: { contains: search, mode: 'insensitive' } } : {}),
  },
  include: {
    team: { select: teamSelect },
    gameStats: { select: gameStatsSelect },
  },
})
```

- [ ] **Step 2: Commit**

```bash
git add "app/api/leagues/[id]/draft/rankings/route.ts"
git commit -m "feat(api): filter draft rankings to playoff-qualified teams only"
```

---

## Task 5: Add "2025-26 RS" pill to draft table header

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Add season pill to the table header row**

In `app/(app)/league/[id]/draft/page.tsx`, find the `<thead>` block inside the rankings table. It starts with:

```tsx
<thead>
  <tr className="bg-[#f8f8f8] text-[#98989e]">
    <th className="sticky left-0 z-20 bg-[#f8f8f8] px-3 py-2 text-left font-bold uppercase tracking-widest text-[10px] min-w-[160px] border-r border-[#eeeeee]">Player</th>
```

Replace only the Player `<th>` with one that includes the pill:

```tsx
<th className="sticky left-0 z-20 bg-[#f8f8f8] px-3 py-2 text-left font-bold uppercase tracking-widest text-[10px] min-w-[160px] border-r border-[#eeeeee]">
  <span>Player</span>
  <span style={{ marginLeft: 8, padding: '2px 7px', borderRadius: 999, background: '#fff7ed', color: '#f97316', fontWeight: 700, fontSize: 9, letterSpacing: '1px', textTransform: 'uppercase', verticalAlign: 'middle' }}>
    2025-26 RS
  </span>
</th>
```

All other `<th>` elements stay unchanged.

- [ ] **Step 2: Commit**

```bash
git add "app/(app)/league/[id]/draft/page.tsx"
git commit -m "feat(draft): add 2025-26 RS season label to rankings table header"
```

---

## Task 6: Make scoring settings read-only for non-commissioners

**Files:**
- Modify: `app/(app)/league/[id]/settings/page.tsx`

- [ ] **Step 1: Add commissioner state and fetch**

Replace the entire `app/(app)/league/[id]/settings/page.tsx` with:

```typescript
'use client'
import { useState, useEffect, use } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'

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

export default function ScoringSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const router = useRouter()
  const [settings, setSettings] = useState<ScoringSettings | null>(null)
  const [isCommissioner, setIsCommissioner] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    async function load() {
      try {
        const token = await auth.currentUser?.getIdToken()
        if (!token) { setError('Not signed in. Please reload.'); return }

        const [scoringRes, leagueRes, meRes] = await Promise.all([
          fetch(`/api/leagues/${id}/scoring`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch(`/api/leagues/${id}`, {
            headers: { Authorization: `Bearer ${token}` },
          }),
          fetch('/api/auth/me', {
            headers: { Authorization: `Bearer ${token}` },
          }),
        ])

        if (!scoringRes.ok) { setError('Failed to load settings.'); return }
        const scoringData = await scoringRes.json()
        setSettings(scoringData.settings)

        if (leagueRes.ok && meRes.ok) {
          const leagueData = await leagueRes.json()
          const meData = await meRes.json()
          setIsCommissioner(leagueData.league?.commissionerId === meData.user?.id)
        }
      } catch {
        setError('Failed to load settings.')
      }
    }
    load()
  }, [id])

  async function save() {
    if (!settings || !isCommissioner) return
    setSaving(true)
    setError('')
    try {
      const token = await auth.currentUser?.getIdToken()
      if (!token) { setError('Not signed in. Please reload.'); return }
      const res = await fetch(`/api/leagues/${id}/scoring`, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(settings),
      })
      const data = await res.json()
      if (!res.ok) { setError(data.error); return }
      setSaved(true)
      setTimeout(() => setSaved(false), 2000)
    } catch {
      setError('Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  if (!settings) return <div className="p-6 text-gray-400 text-sm">Loading…</div>

  return (
    <div className="min-h-screen bg-white p-6 max-w-lg mx-auto">
      <button onClick={() => router.back()} className="text-sm text-gray-400 mb-4 hover:text-gray-600">← Back</button>
      <h1 className="text-2xl font-black tracking-widest mb-2">Scoring Settings</h1>

      {!isCommissioner && (
        <div className="flex items-center gap-2 mb-6 px-3 py-2 rounded-lg bg-gray-50 border border-gray-200">
          <span className="text-base">🔒</span>
          <span className="text-xs text-gray-500 font-semibold">Commissioner controls scoring settings</span>
        </div>
      )}

      {error && <p className="text-red-600 text-sm mb-4">{error}</p>}

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4">Skater Categories</p>
      {Object.entries(SKATER_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className={`text-sm font-semibold ${!isCommissioner ? 'text-gray-400' : ''}`}>{label}</label>
            <span className={`text-sm font-bold ${isCommissioner ? 'text-orange-500' : 'text-gray-400'}`}>
              {Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts
            </span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => isCommissioner && setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            disabled={!isCommissioner}
            className={`w-full ${isCommissioner ? 'accent-orange-500' : 'accent-gray-300 opacity-50 cursor-not-allowed'}`}
          />
        </div>
      ))}

      <p className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-4 mt-8">Goalie Categories</p>
      {Object.entries(GOALIE_LABELS).map(([field, label]) => (
        <div key={field} className="mb-5">
          <div className="flex items-center justify-between mb-1">
            <label className={`text-sm font-semibold ${!isCommissioner ? 'text-gray-400' : ''}`}>{label}</label>
            <span className={`text-sm font-bold ${isCommissioner ? 'text-orange-500' : 'text-gray-400'}`}>
              {Number(settings[field as keyof ScoringSettings]).toFixed(1)} pts
            </span>
          </div>
          <input
            type="range" min={0} max={10} step={0.5}
            value={Number(settings[field as keyof ScoringSettings])}
            onChange={e => isCommissioner && setSettings(s => s ? { ...s, [field]: parseFloat(e.target.value) } : s)}
            disabled={!isCommissioner}
            className={`w-full ${isCommissioner ? 'accent-orange-500' : 'accent-gray-300 opacity-50 cursor-not-allowed'}`}
          />
        </div>
      ))}

      {isCommissioner && (
        <button onClick={save} disabled={saving}
          className="w-full py-3 rounded-xl font-bold text-white bg-orange-500 hover:bg-orange-600 transition disabled:opacity-40 mt-2">
          {saved ? '✓ Saved!' : saving ? 'Saving…' : 'Save Settings'}
        </button>
      )}
    </div>
  )
}
```

- [ ] **Step 2: Verify the league API returns the expected shape**

The code above assumes `GET /api/leagues/${id}` returns `{ league: { commissionerId: string, ... } }` and `GET /api/auth/me` returns `{ user: { id: string, ... } }`. If the response shapes differ, adjust the property access on these two lines accordingly:

```typescript
setIsCommissioner(leagueData.league?.commissionerId === meData.user?.id)
```

Check `app/api/leagues/[id]/route.ts` and `app/api/auth/me/route.ts` to confirm the response structure before proceeding.

- [ ] **Step 3: Commit**

```bash
git add "app/(app)/league/[id]/settings/page.tsx"
git commit -m "feat(settings): scoring settings read-only for non-commissioners"
```

---

## Task 7: Deploy and trigger sync cron

- [ ] **Step 1: Deploy to production**

```bash
npx vercel --prod
```

- [ ] **Step 2: Set CRON_SECRET in Vercel**

In the Vercel dashboard → Project Settings → Environment Variables, add:
- Key: `CRON_SECRET`
- Value: any long random string (e.g. generate with `openssl rand -hex 32`)
- Environment: Production

Redeploy after setting the env var so the new value is picked up.

- [ ] **Step 3: Trigger the sync cron manually**

```bash
curl -X GET https://hockeypoolz.signyl.gg/api/cron/sync-stats \
  -H "Authorization: Bearer <YOUR_CRON_SECRET>"
```

Expected: `{"ok":true}` or similar success response. Check Vercel function logs to confirm `PlayerGameStats` rows are being written.

- [ ] **Step 4: Verify stats appear in draft room**

Open the draft page for a league. The G, A, PTS, +/-, SOG columns should now show real numbers for playoff-team players. Only players from the 16 qualified teams should appear.
