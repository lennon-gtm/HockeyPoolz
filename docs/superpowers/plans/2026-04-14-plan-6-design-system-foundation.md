# Design System Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the nhl.com-inspired design language across HockeyPoolz: dark global header, league sub-nav with 4 tabs (LOBBY · MY TEAM · DRAFT · STANDINGS), shared components (TeamIcon, PositionBadge, StatCard, SortableHeader), and a stubbed My Team page. No new data or features — pure visual/structural refresh.

**Architecture:** Extract duplicated `TeamIcon` into a shared component, add small UI primitives in `components/`, create a new `league/[id]/layout.tsx` that renders the `LeagueNav` around each child route, update the root `(app)/layout.tsx` to render the dark global header, and apply the new visual tokens via Tailwind arbitrary values and existing utility classes. The My Team page ships as a read-only roster list without the YDAY column (added in Plan 10).

**Tech Stack:** Next.js 16.2.2 App Router, Tailwind CSS 4, Prisma v7, Firebase Auth, Vitest. Inter font loaded via `next/font/google`.

---

## Codebase Context

Before reading this plan, know that:
- Auth: every protected route calls `getBearerToken(request.headers.get('authorization'))` → `verifyIdToken(token)` → `prisma.user.findUnique({ where: { firebaseUid: decoded.uid } })`
- `app/(app)/layout.tsx` is a client component that handles the Firebase auth state and session cookie
- Three pages currently duplicate a `TeamIcon` component inline: `app/(app)/league/[id]/page.tsx`, `app/(app)/league/[id]/draft/page.tsx`, `app/(app)/league/[id]/standings/page.tsx`
- Lobby currently renders "Scoring Settings" and "Go to Draft Room" as bottom action buttons — those get replaced by the new nav
- Tailwind v4 uses CSS variables and the `@theme` block in `app/globals.css`
- Tests use Vitest with `@vitest-environment node` pragma for API route tests
- The existing `LeagueMember.favoriteTeam.colorPrimary` is the source of the per-user "team color"
- `/api/leagues/[id]` already returns members with `favoriteTeam: { select: { colorPrimary, colorSecondary, name } }`
- No `/league/[id]/team` route exists today; it will be new

## File Structure

**New files:**
- `components/team-icon.tsx` — shared icon component (replaces 3 local duplicates)
- `components/position-badge.tsx` — F / D / G pill badge
- `components/stat-card.tsx` — 3-up grid card primitive
- `components/sortable-header.tsx` — table header button with `↕` / `↑` / `↓` states
- `components/league-nav.tsx` — horizontal sub-nav with 4 tabs and active-tab underline in team color
- `components/global-header.tsx` — dark top bar with HOCKEYPOOLZ brand + user dropdown
- `app/(app)/league/[id]/layout.tsx` — new layout that loads the current user's color + renders `LeagueNav`
- `app/(app)/league/[id]/team/page.tsx` — new My Team page (read-only roster list, no YDAY yet)

**Modified files:**
- `app/globals.css` — add color tokens, Inter font setup
- `app/(app)/layout.tsx` — render `GlobalHeader` above children
- `app/(app)/league/[id]/page.tsx` — remove duplicated TeamIcon, remove bottom nav buttons (nav moved to LeagueNav), apply new visual tokens
- `app/(app)/league/[id]/draft/page.tsx` — remove duplicated TeamIcon, apply new visual tokens
- `app/(app)/league/[id]/standings/page.tsx` — remove duplicated TeamIcon, apply new visual tokens
- `app/(app)/league/[id]/players/[playerId]/page.tsx` — use shared TeamIcon, apply new visual tokens
- `app/layout.tsx` — add Inter font via `next/font/google`

---

## Task 1: Add Inter Font & Color Tokens

**Files:**
- Modify: `app/layout.tsx`
- Modify: `app/globals.css`

- [ ] **Step 1: Load Inter from next/font/google**

Read `app/layout.tsx` first to see the current structure. Then update it:

```tsx
import { Inter } from 'next/font/google'
import './globals.css'

const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700', '800', '900'],
  display: 'swap',
  variable: '--font-inter',
})

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={inter.variable}>
      <body className="font-sans">{children}</body>
    </html>
  )
}
```

Keep any existing metadata exports.

- [ ] **Step 2: Add design tokens to globals.css**

Read `app/globals.css` first. Append (or merge into the existing `@theme` block):

```css
@theme {
  --font-sans: var(--font-inter), system-ui, sans-serif;

  /* Nav */
  --color-nav-primary: #1a1a1a;
  --color-nav-secondary: #111111;

  /* Content */
  --color-surface: #f8f8f8;
  --color-surface-alt: #fafafa;
  --color-border: #eeeeee;

  /* Text */
  --color-text-primary: #121212;
  --color-text-secondary: #98989e;
  --color-text-tertiary: #515151;

  /* Accents */
  --color-data-accent: #0042bb;
  --color-data-accent-bg: #e8f0ff;
  --color-positive: #2db944;
  --color-negative: #c8102e;
  --color-wishlist: #ffcf00;

  /* Position badges — bg / text */
  --color-pos-f-bg: #e8f4fd;
  --color-pos-f-text: #0042bb;
  --color-pos-d-bg: #fce8f3;
  --color-pos-d-text: #8b008b;
  --color-pos-g-bg: #fff3e0;
  --color-pos-g-text: #e65100;

  /* Fallback team color */
  --color-team-fallback: #ff6b00;
}
```

- [ ] **Step 3: Verify the font loads**

Run:

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx next build 2>&1 | tail -10
```

Expected: Build succeeds. (Inter is fetched from Google Fonts at build time and self-hosted.)

- [ ] **Step 4: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add app/layout.tsx app/globals.css && git commit -m "feat(design): load Inter font and add color tokens"
```

---

## Task 2: Shared `TeamIcon` Component

**Files:**
- Create: `components/team-icon.tsx`
- Modify: `app/(app)/league/[id]/page.tsx`
- Modify: `app/(app)/league/[id]/draft/page.tsx`
- Modify: `app/(app)/league/[id]/standings/page.tsx`

- [ ] **Step 1: Create the shared component**

Create `components/team-icon.tsx`:

```tsx
type Size = 'sm' | 'md' | 'lg'

interface Props {
  icon: string | null
  size?: Size
}

export function TeamIcon({ icon, size = 'md' }: Props) {
  const sizeClass =
    size === 'sm' ? 'w-6 h-6 text-base' :
    size === 'lg' ? 'w-10 h-10 text-2xl' :
    'w-8 h-8 text-xl'

  if (icon?.startsWith('https://')) {
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={icon} alt="" className={`${sizeClass} rounded-full object-cover`} />
  }

  const textSize = size === 'sm' ? 'text-base' : size === 'lg' ? 'text-2xl' : 'text-xl'
  return <span className={textSize}>{icon || '🏒'}</span>
}
```

- [ ] **Step 2: Remove the local `TeamIcon` from the lobby page**

Read `app/(app)/league/[id]/page.tsx` to find the local `function TeamIcon(...)` definition. Delete it. Add this import near the other imports:

```tsx
import { TeamIcon } from '@/components/team-icon'
```

- [ ] **Step 3: Remove the local `TeamIcon` from the draft page**

Same as Step 2, for `app/(app)/league/[id]/draft/page.tsx`. Delete the local function; add the import.

- [ ] **Step 4: Remove the local `TeamIcon` from the standings page**

Same as Step 2, for `app/(app)/league/[id]/standings/page.tsx`. Delete the local function; add the import.

- [ ] **Step 5: TypeScript check**

Run:

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors. If any show up related to the files you just edited, check that the imports are correct and every `<TeamIcon />` usage is unchanged.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/team-icon.tsx "app/(app)/league/[id]/page.tsx" "app/(app)/league/[id]/draft/page.tsx" "app/(app)/league/[id]/standings/page.tsx" && git commit -m "refactor: extract TeamIcon into shared component"
```

---

## Task 3: `PositionBadge` Component

**Files:**
- Create: `components/position-badge.tsx`

- [ ] **Step 1: Create the component**

Create `components/position-badge.tsx`:

```tsx
export type PlayerPosition = 'F' | 'D' | 'G'

interface Props {
  position: PlayerPosition
  size?: 'xs' | 'sm'
}

const STYLES: Record<PlayerPosition, { bg: string; text: string }> = {
  F: { bg: 'bg-[#e8f4fd]', text: 'text-[#0042bb]' },
  D: { bg: 'bg-[#fce8f3]', text: 'text-[#8b008b]' },
  G: { bg: 'bg-[#fff3e0]', text: 'text-[#e65100]' },
}

export function PositionBadge({ position, size = 'sm' }: Props) {
  const { bg, text } = STYLES[position]
  const sizeClass = size === 'xs' ? 'text-[9px] px-1 py-[2px]' : 'text-[10px] px-1.5 py-[2px]'
  return (
    <span className={`inline-block rounded font-bold ${bg} ${text} ${sizeClass}`}>
      {position}
    </span>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/position-badge.tsx && git commit -m "feat(design): add PositionBadge component"
```

---

## Task 4: `StatCard` Component

**Files:**
- Create: `components/stat-card.tsx`

- [ ] **Step 1: Create the component**

Create `components/stat-card.tsx`:

```tsx
interface Props {
  value: React.ReactNode
  label: string
  tone?: 'default' | 'positive' | 'negative' | 'dark'
  onClick?: () => void
  icon?: React.ReactNode
}

export function StatCard({ value, label, tone = 'default', onClick, icon }: Props) {
  const bg = tone === 'dark' ? 'bg-[#1a1a1a] text-white' : 'bg-[#f8f8f8]'
  const valueColor =
    tone === 'positive' ? 'text-[#2db944]' :
    tone === 'negative' ? 'text-[#c8102e]' :
    tone === 'dark' ? 'text-white' :
    'text-[#121212]'
  const labelColor = tone === 'dark' ? 'text-white/70' : 'text-[#98989e]'
  const clickable = onClick ? 'cursor-pointer hover:brightness-95 active:brightness-90' : ''

  return (
    <div onClick={onClick} className={`${bg} ${clickable} rounded-lg p-2.5 text-center transition`}>
      {icon && <div className="text-base mb-0.5">{icon}</div>}
      <div className={`text-xl font-black leading-none ${valueColor}`}>{value}</div>
      <div className={`text-[9px] font-bold uppercase tracking-widest mt-1 ${labelColor}`}>{label}</div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/stat-card.tsx && git commit -m "feat(design): add StatCard component"
```

---

## Task 5: `SortableHeader` Component

**Files:**
- Create: `components/sortable-header.tsx`

- [ ] **Step 1: Create the component**

Create `components/sortable-header.tsx`:

```tsx
export type SortDirection = 'asc' | 'desc' | null

interface Props {
  label: string
  active: boolean
  direction: SortDirection
  onClick: () => void
  align?: 'left' | 'center' | 'right'
  highlight?: boolean
}

export function SortableHeader({ label, active, direction, onClick, align = 'center', highlight = false }: Props) {
  const indicator = !active ? '↕' : direction === 'asc' ? '↑' : '↓'
  const color = highlight ? 'text-[#0042bb]' : active ? 'text-[#121212]' : 'text-[#98989e]'
  const bg = highlight ? 'bg-[#e8f0ff] rounded px-1 py-0.5' : ''
  const alignClass = align === 'right' ? 'text-right' : align === 'left' ? 'text-left' : 'text-center'

  return (
    <button
      type="button"
      onClick={onClick}
      className={`text-[9px] font-bold uppercase tracking-wider cursor-pointer ${color} ${bg} ${alignClass} whitespace-nowrap`}
    >
      {label} <span className="inline-block w-2">{indicator}</span>
    </button>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/sortable-header.tsx && git commit -m "feat(design): add SortableHeader component"
```

---

## Task 6: `GlobalHeader` Component

**Files:**
- Create: `components/global-header.tsx`

- [ ] **Step 1: Create the component**

Create `components/global-header.tsx`:

```tsx
'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'

interface CurrentUser {
  displayName: string
  avatarUrl: string | null
  favoriteTeam?: { colorPrimary: string; colorSecondary: string } | null
}

export function GlobalHeader() {
  const router = useRouter()
  const [user, setUser] = useState<CurrentUser | null>(null)
  const [menuOpen, setMenuOpen] = useState(false)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const res = await fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } })
      if (!res.ok) return
      const data = await res.json()
      setUser(data.user)
    }
    load()
  }, [])

  async function signOut() {
    await auth.signOut()
    document.cookie = 'session=; path=/; max-age=0'
    router.push('/login')
  }

  const avatarGradient = user?.favoriteTeam
    ? `linear-gradient(135deg, ${user.favoriteTeam.colorPrimary}, ${user.favoriteTeam.colorSecondary})`
    : 'linear-gradient(135deg, #FF6B00, #CC5500)'

  return (
    <header className="bg-[#1a1a1a]">
      <div className="px-4 py-3 flex items-center justify-between">
        <span className="text-white font-black tracking-[3px] text-sm">HOCKEYPOOLZ</span>
        <div className="relative">
          <button
            onClick={() => setMenuOpen(o => !o)}
            className="flex items-center gap-2"
          >
            <div
              className="w-7 h-7 rounded-full flex items-center justify-center overflow-hidden"
              style={{ background: avatarGradient }}
            >
              {user?.avatarUrl?.startsWith('https://')
                ? <TeamIcon icon={user.avatarUrl} size="sm" />
                : <span className="text-xs text-white font-bold">{user?.displayName?.[0]?.toUpperCase() ?? '?'}</span>}
            </div>
            <span className="text-white text-xs font-semibold">{user?.displayName ?? ''} ▾</span>
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[140px] z-50">
              <button
                onClick={signOut}
                className="w-full text-left px-3 py-2 text-xs font-semibold text-[#121212] hover:bg-[#f8f8f8]"
              >
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
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
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/global-header.tsx && git commit -m "feat(design): add GlobalHeader with user menu"
```

---

## Task 7: Wire `GlobalHeader` into `(app)` layout

**Files:**
- Modify: `app/(app)/layout.tsx`

- [ ] **Step 1: Read the current layout**

Read `app/(app)/layout.tsx` to understand its current structure (it handles auth state and returns `<>{children}</>`).

- [ ] **Step 2: Update the layout**

Replace the file contents:

```tsx
'use client'
import { useEffect, useState } from 'react'
import { useRouter, usePathname } from 'next/navigation'
import { onAuthStateChanged } from 'firebase/auth'
import { auth } from '@/lib/firebase/client'
import { GlobalHeader } from '@/components/global-header'

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const pathname = usePathname()
  const [checking, setChecking] = useState(true)

  useEffect(() => {
    let unsub: (() => void) | undefined
    auth.authStateReady().then(() => {
      unsub = onAuthStateChanged(auth, async (user) => {
        if (!user) {
          router.push('/login')
          return
        }
        const token = await user.getIdToken()
        document.cookie = `session=${token}; path=/; max-age=3600; SameSite=Strict`
        setChecking(false)
      })
    })
    return () => unsub?.()
  }, [router])

  if (checking) {
    return <div className="min-h-screen bg-white flex items-center justify-center">
      <p className="text-gray-400 text-sm">Loading...</p>
    </div>
  }

  // Suppress header on the join flow (pre-member, invite-only pages)
  const hideHeader = pathname?.startsWith('/join/')

  return (
    <div className="min-h-screen bg-white">
      {!hideHeader && <GlobalHeader />}
      {children}
    </div>
  )
}
```

- [ ] **Step 3: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 4: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/layout.tsx" && git commit -m "feat(design): render GlobalHeader in app layout"
```

---

## Task 8: `LeagueNav` Component

**Files:**
- Create: `components/league-nav.tsx`

- [ ] **Step 1: Create the nav component**

Create `components/league-nav.tsx`:

```tsx
'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

interface Props {
  leagueId: string
  color: string
}

interface Tab {
  label: string
  slug: string
  match: (pathname: string) => boolean
}

export function LeagueNav({ leagueId, color }: Props) {
  const pathname = usePathname() ?? ''
  const base = `/league/${leagueId}`

  const tabs: Tab[] = [
    { label: 'LOBBY', slug: '', match: (p) => p === base || p === `${base}/` },
    { label: 'MY TEAM', slug: '/team', match: (p) => p.startsWith(`${base}/team`) },
    { label: 'DRAFT', slug: '/draft', match: (p) => p.startsWith(`${base}/draft`) },
    { label: 'STANDINGS', slug: '/standings', match: (p) => p.startsWith(`${base}/standings`) },
  ]

  return (
    <nav className="bg-[#111] border-t border-[#252525] px-4 flex">
      {tabs.map(tab => {
        const active = tab.match(pathname)
        return (
          <Link
            key={tab.label}
            href={`${base}${tab.slug}`}
            className={`py-2.5 px-3 text-[10px] font-bold tracking-wider ${active ? 'text-white' : 'text-[#515151]'}`}
            style={active ? { borderBottom: `2px solid ${color}` } : undefined}
          >
            {tab.label}
          </Link>
        )
      })}
    </nav>
  )
}
```

- [ ] **Step 2: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add components/league-nav.tsx && git commit -m "feat(design): add LeagueNav with 4 tabs"
```

---

## Task 9: League layout that loads user color + renders LeagueNav

**Files:**
- Create: `app/(app)/league/[id]/layout.tsx`

- [ ] **Step 1: Create the layout**

Create `app/(app)/league/[id]/layout.tsx`:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { LeagueNav } from '@/components/league-nav'

export default function LeagueLayout({
  children,
  params,
}: {
  children: React.ReactNode
  params: Promise<{ id: string }>
}) {
  const { id } = use(params)
  const [color, setColor] = useState<string>('#FF6B00')

  useEffect(() => {
    async function loadColor() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const [meRes, leagueRes] = await Promise.all([
        fetch('/api/auth/me', { headers: { Authorization: `Bearer ${token}` } }),
        fetch(`/api/leagues/${id}`, { headers: { Authorization: `Bearer ${token}` } }),
      ])
      if (!meRes.ok || !leagueRes.ok) return
      const me = await meRes.json()
      const league = await leagueRes.json()
      const myMember = league.league?.members?.find((m: { user: { id: string } }) => m.user.id === me.user.id)
      const c = myMember?.favoriteTeam?.colorPrimary ?? '#FF6B00'
      setColor(c)
    }
    loadColor()
  }, [id])

  return (
    <>
      <LeagueNav leagueId={id} color={color} />
      {children}
    </>
  )
}
```

- [ ] **Step 2: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/layout.tsx" && git commit -m "feat(design): add league layout with subnav"
```

---

## Task 10: My Team stub page

**Files:**
- Create: `app/(app)/league/[id]/team/page.tsx`

- [ ] **Step 1: Create the stub page**

Create `app/(app)/league/[id]/team/page.tsx`:

```tsx
'use client'
import { useState, useEffect, use } from 'react'
import { auth } from '@/lib/firebase/client'
import { TeamIcon } from '@/components/team-icon'
import { PositionBadge, type PlayerPosition } from '@/components/position-badge'
import { StatCard } from '@/components/stat-card'

interface Member {
  id: string
  teamName: string
  teamIcon: string | null
  user: { id: string; displayName: string }
  totalScore: number
  favoriteTeam?: { colorPrimary: string } | null
}

interface LeagueDetail {
  id: string
  name: string
  members: Member[]
}

interface DraftedPlayer {
  playerId: string
  fullName: string
  position: PlayerPosition
  nhlTeamAbbrev: string
  totalFpts: number
}

export default function MyTeamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params)
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const [myUserId, setMyUserId] = useState<string | null>(null)
  const [roster, setRoster] = useState<DraftedPlayer[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    async function load() {
      const token = await auth.currentUser?.getIdToken()
      if (!token) return
      const headers = { Authorization: `Bearer ${token}` }
      const [meRes, leagueRes] = await Promise.all([
        fetch('/api/auth/me', { headers }),
        fetch(`/api/leagues/${id}`, { headers }),
      ])
      const me = await meRes.json()
      const leagueData = await leagueRes.json()
      setMyUserId(me.user.id)
      setLeague(leagueData.league)
      setLoading(false)
      // Roster fetched from a future endpoint — leave empty for this plan
    }
    load()
  }, [id])

  if (loading || !league) {
    return <div className="p-6 text-sm text-[#98989e]">Loading…</div>
  }

  const myMember = league.members.find(m => m.user.id === myUserId)
  if (!myMember) {
    return <div className="p-6 text-sm text-[#98989e]">You&apos;re not a member of this league.</div>
  }

  const myColor = myMember.favoriteTeam?.colorPrimary ?? '#FF6B00'
  const myRank = [...league.members]
    .sort((a, b) => Number(b.totalScore) - Number(a.totalScore))
    .findIndex(m => m.id === myMember.id) + 1

  return (
    <div className="p-4 max-w-xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <TeamIcon icon={myMember.teamIcon} size="lg" />
          <div>
            <div className="text-lg font-black tracking-tight text-[#121212]">{myMember.teamName}</div>
            <div className="text-xs text-[#98989e] font-semibold">{myMember.user.displayName}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-2xl font-black" style={{ color: myColor }}>{Number(myMember.totalScore).toFixed(1)}</div>
          <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
        </div>
      </div>

      {/* Stat cards */}
      <div className="grid grid-cols-3 gap-1.5 mb-4">
        <StatCard value={`${myRank}${ordinal(myRank)}`} label="Standing" />
        <StatCard value="—" label="Yesterday" />
        <StatCard value="📰" label="Recap" tone="dark" />
      </div>

      {/* Roster — stub */}
      <div className="border border-[#eeeeee] rounded-xl p-6 text-center">
        <p className="text-xs text-[#98989e] font-semibold">Your roster will appear here after the draft.</p>
        <p className="text-[10px] text-[#98989e] mt-2">{roster.length} players drafted</p>
      </div>
    </div>
  )
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}
```

- [ ] **Step 2: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 3: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/team/page.tsx" && git commit -m "feat: add My Team page stub"
```

---

## Task 11: Apply visual refresh to Lobby

**Files:**
- Modify: `app/(app)/league/[id]/page.tsx`

- [ ] **Step 1: Read the current lobby**

Read `app/(app)/league/[id]/page.tsx` to refresh your memory on its structure (league title, stat info, commissioner controls, draft order, standings/recap for active phase, invite link).

- [ ] **Step 2: Remove bottom nav buttons (now handled by LeagueNav)**

In the same file, find the block that renders "Scoring Settings" and "Start Draft" as bottom action buttons:

```tsx
{/* Commissioner controls */}
<div className="mt-6 flex gap-3 flex-wrap">
  <Link href={`/league/${id}/settings`}
    className="flex-1 text-center py-3 border-2 border-gray-200 rounded-xl text-sm font-bold hover:border-gray-400 transition">
    Scoring Settings
  </Link>
  {isCommissioner && league.status === 'setup' && !draftActive && (
    ...
  )}
</div>
```

Replace this entire `<div>` block with:

```tsx
{/* Commissioner controls (setup phase only) */}
{isCommissioner && league.status === 'setup' && !draftActive && (
  <div className="mt-4 grid grid-cols-2 gap-2">
    <button
      onClick={createAndStartDraft}
      disabled={startLoading || !allHavePositions}
      style={{ backgroundColor: myColor }}
      className="py-3 text-white rounded-xl text-sm font-bold hover:opacity-90 disabled:opacity-50 transition"
      title={!allHavePositions ? 'Randomize draft order first' : ''}
    >
      {startLoading ? 'Starting…' : '🚀 Start Draft'}
    </button>
    <button
      onClick={randomizeOrder}
      disabled={orderLoading}
      className="py-3 bg-[#f8f8f8] border-2 border-[#eeeeee] rounded-xl text-sm font-bold text-[#121212] hover:border-gray-400 transition disabled:opacity-50"
    >
      {orderLoading ? 'Shuffling…' : '🔀 Randomize'}
    </button>
  </div>
)}
```

The "Scoring Settings" link is removed entirely — the settings gear is surfaced via the `LeagueNav` area in a future plan, and for now scoring can be edited via the direct `/league/[id]/settings` URL.

Also remove the separate "Randomize" button that currently sits in the draft order section header — it's consolidated into this action row.

Search the file for `randomizeOrder` — find the small "🔀 Randomize" button that sits inside the Draft Order header and delete that button. The function call still lives in the consolidated button above.

- [ ] **Step 3: Apply visual refresh — page wrapper**

Find the outermost page wrapper div (usually `<div className="min-h-screen bg-white">`) and replace it with:

```tsx
<div className="bg-white min-h-screen">
  <div className="p-4 max-w-xl mx-auto">
    {/* … existing content … */}
  </div>
</div>
```

The existing `h1`, stat info, and other elements stay but will now inherit the Inter font and new spacing context. Wrap the league title line (`<h1>`) and its subtitle so they look like:

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

- [ ] **Step 4: Replace stat section with StatCard grid**

If there's an existing "Draft Phase" or setup info section, replace it (or insert before the draft order) with a `StatCard` grid. Find an appropriate insertion point (right after the header, before the "Draft Order" section), and add:

```tsx
{league.status === 'setup' && (
  <div className="grid grid-cols-3 gap-1.5 mb-4">
    <StatCard value={`${league.members.length}/${league.maxTeams}`} label="Teams" />
    <StatCard value="—" label="Draft" />
    <StatCard value={`${draft?.pickTimeLimitSecs ?? 90}s`} label="Per Pick" />
  </div>
)}
```

Add the import at the top of the file:

```tsx
import { StatCard } from '@/components/stat-card'
```

(The "Draft" value will be the actual date once Plan 7 adds draft scheduling. For now use an em dash.)

- [ ] **Step 5: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/page.tsx" && git commit -m "feat(design): apply new design tokens to lobby"
```

---

## Task 12: Apply visual refresh to Draft page

**Files:**
- Modify: `app/(app)/league/[id]/draft/page.tsx`

- [ ] **Step 1: Read the current draft page**

Read `app/(app)/league/[id]/draft/page.tsx` to understand the sections: "On the clock" card, my picks list, all picks feed, available players.

- [ ] **Step 2: Apply page wrapper & typography**

Find the outermost page wrapper. Update it to:

```tsx
<div className="bg-white min-h-screen">
  <div className="p-4 max-w-xl mx-auto">
    {/* … existing content … */}
  </div>
</div>
```

- [ ] **Step 3: Update the "On the clock" card styling**

Find the current picker card (look for text "On the clock" or the block that renders `currentPicker`). Whatever the existing structure, update the wrapper styles to use:

```tsx
<div
  className="rounded-xl p-3 mb-4 border-2"
  style={{
    backgroundColor: (currentPicker.colorPrimary ?? '#FF6B00') + '20',
    borderColor: currentPicker.colorPrimary ?? '#FF6B00',
  }}
>
  <div className="text-[9px] font-bold text-[#98989e] uppercase tracking-widest mb-1.5">
    On the Clock · Pick {state.currentPickNumber}
  </div>
  {/* … picker info, timer, etc. … */}
</div>
```

- [ ] **Step 4: Replace any emoji position labels with PositionBadge**

Search for hard-coded position text like `F`, `D`, `G` in rendering. If the Draft page lists players' positions, wrap them with `<PositionBadge position={player.position as 'F'|'D'|'G'} />`. Add the import:

```tsx
import { PositionBadge } from '@/components/position-badge'
```

If the position field today is `C/LW/RW/D/G`, map each to its bucket:

```tsx
function toBucket(pos: string): 'F' | 'D' | 'G' {
  if (pos === 'G') return 'G'
  if (pos === 'D') return 'D'
  return 'F'
}
```

Use `toBucket(player.position)` when rendering.

- [ ] **Step 5: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/draft/page.tsx" && git commit -m "feat(design): apply new design tokens to draft page"
```

---

## Task 13: Apply visual refresh to Standings page

**Files:**
- Modify: `app/(app)/league/[id]/standings/page.tsx`

- [ ] **Step 1: Read the current standings page**

Read `app/(app)/league/[id]/standings/page.tsx`.

- [ ] **Step 2: Apply page wrapper & header**

Wrap the page content with the standard wrapper and add a header block:

```tsx
<div className="bg-white min-h-screen">
  <div className="p-4 max-w-xl mx-auto">
    <div className="mb-4">
      <h1 className="text-xl font-black tracking-tight text-[#121212]">Standings</h1>
      <p className="text-xs text-[#98989e] font-semibold mt-0.5">Through {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}</p>
    </div>
    {/* … existing content … */}
  </div>
</div>
```

- [ ] **Step 3: Add hero card for user's position**

If the page doesn't already show the user's position prominently, insert a hero card above the main standings list:

```tsx
{myStanding && (
  <div
    className="bg-[#1a1a1a] rounded-xl p-3 mb-4 flex items-center justify-between"
    style={{ borderLeft: `4px solid ${myColor}` }}
  >
    <div className="flex items-center gap-2.5">
      <div className="text-xl font-black text-white">{myStanding.rank}{ordinal(myStanding.rank)}</div>
      <div>
        <div className="text-xs font-bold text-white">{myStanding.teamName}</div>
        <div className="text-[10px] text-[#98989e]">You</div>
      </div>
    </div>
    <div className="text-right">
      <div className="text-base font-black" style={{ color: myColor }}>{myStanding.totalScore.toFixed(1)}</div>
      <div className="text-[9px] text-[#98989e] font-bold uppercase tracking-widest">Total FPTS</div>
    </div>
  </div>
)}
```

Add the `ordinal` helper at the bottom of the file (if not already present):

```tsx
function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return s[(v - 20) % 10] ?? s[v] ?? s[0]
}
```

`myStanding` is the row matching `myMemberId` from the existing standings array.

- [ ] **Step 4: Update the table row styles**

For the standings rows in the main list, update the row for the current user to use the team-color left border:

```tsx
<div
  className="border-b border-[#f5f5f5] px-3 py-2.5 grid grid-cols-[24px_24px_1fr_50px] gap-1.5 items-center"
  style={s.memberId === myMemberId ? { borderLeft: `3px solid ${myColor}`, backgroundColor: '#fff8f8' } : undefined}
>
  {/* … */}
</div>
```

- [ ] **Step 5: Build check**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npx tsc --noEmit 2>&1 | grep "error TS" | grep -v ".next/" | head -10
```

Expected: No errors.

- [ ] **Step 6: Commit**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add "app/(app)/league/[id]/standings/page.tsx" && git commit -m "feat(design): apply new design tokens to standings"
```

---

## Task 14: Run full build + tests

**Files:** None (verification only)

- [ ] **Step 1: Run all tests**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && npm run test:run 2>&1 | tail -15
```

Expected: All tests pass (no tests target design-system changes, so existing 37 tests should still all pass).

- [ ] **Step 2: Run the build**

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && rm -rf .next && npx next build 2>&1 | tail -20
```

Expected: Build completes with no type errors.

- [ ] **Step 3: Fix any errors**

If there are errors, fix them in the relevant file and commit:

```bash
cd c:/Users/Lenno/Projects/HockeyPoolz && git add -A && git commit -m "fix: resolve build errors from design system refactor"
```

---

## Task 15: Manual smoke test

**Files:** None (manual verification)

After deploying, verify:

- [ ] **Global header** shows HOCKEYPOOLZ branding on dark bar with user avatar + name dropdown on the right
- [ ] **Sign out** works from the avatar dropdown — returns you to /login and clears the session cookie
- [ ] **League sub-nav** (LOBBY · MY TEAM · DRAFT · STANDINGS) shows on any `/league/[id]/*` page below the global header
- [ ] **Active tab** has a border-bottom in your favorite NHL team's color
- [ ] **My Team tab** lands on a page with the stat cards and "Your roster will appear here after the draft" placeholder
- [ ] **Lobby commissioner view** shows Start Draft + Randomize buttons as a 2-up grid, stat cards above the draft order, and the invite link card at the bottom
- [ ] **Draft page** "On the clock" card uses the current picker's team color as tint + border
- [ ] **Standings** shows your hero card pinned at top with rank + total in your team color, and your row in the main table has a left-border accent
- [ ] **Inter font** loads correctly (no flash of system font on initial page load)
- [ ] **Join flow** (`/join/[code]`) does NOT show the global header (suppressed for pre-member views)
