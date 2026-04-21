# Auth-Aware Landing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Consolidate the login page and authed pool lobby into a single auth-aware landing at `app/page.tsx`, with per-device default-pool autobounce and a "+ Create Pool" entry in the header dropdown.

**Architecture:** Single client component at `app/page.tsx` reads Firebase auth state on mount; pure decision function (`lib/pool-selection.ts`) resolves `leagues + defaultPoolId + pickMode` to one of `{ redirect | show-selector | show-create }`. Redirect states call `router.replace`. All pool-list UI (pin toggle, create button) lives on this page or in the global header dropdown.

**Tech Stack:** Next.js 16 App Router, React 19, Firebase Auth (client), Vitest, Tailwind. No new deps.

**Spec:** `docs/superpowers/specs/2026-04-20-auth-aware-landing-design.md`

---

## File Structure

**New:**
- `lib/pool-selection.ts` — pure decision function + types
- `__tests__/lib/pool-selection.test.ts` — unit tests for the decision function
- `app/page.tsx` — consolidated auth-aware landing

**Modified:**
- `app/(auth)/login/page.tsx` — becomes a one-line server redirect to `/`
- `app/(app)/layout.tsx` — unauth redirect target changes from `/login` → `/`
- `components/global-header.tsx` — adds "+ Create Pool" item, updates "All Leagues" href + sign-out redirect

**Deleted:**
- `app/(app)/page.tsx` — the old authed lobby, replaced by the landing

---

## Task 1: Pure decision function + tests

**Files:**
- Create: `lib/pool-selection.ts`
- Test: `__tests__/lib/pool-selection.test.ts`

- [ ] **Step 1: Write the failing tests**

Create `__tests__/lib/pool-selection.test.ts`:

```ts
import { describe, it, expect } from 'vitest'
import { decideLandingAction } from '@/lib/pool-selection'

describe('decideLandingAction', () => {
  const leagues = [
    { id: 'a', name: 'Pool A' },
    { id: 'b', name: 'Pool B' },
  ]

  it('returns show-create when 0 pools', () => {
    expect(decideLandingAction([], null, false)).toEqual({ action: 'show-create' })
  })

  it('autobounces when exactly 1 pool and no default', () => {
    expect(decideLandingAction([leagues[0]], null, false)).toEqual({
      action: 'redirect',
      poolId: 'a',
    })
  })

  it('autobounces to default when 2+ pools and valid default set', () => {
    expect(decideLandingAction(leagues, 'b', false)).toEqual({
      action: 'redirect',
      poolId: 'b',
    })
  })

  it('clears stale default and shows selector when default pool no longer in list', () => {
    expect(decideLandingAction(leagues, 'gone', false)).toEqual({
      action: 'show-selector',
      clearDefault: true,
    })
  })

  it('shows selector when 2+ pools and no default', () => {
    expect(decideLandingAction(leagues, null, false)).toEqual({ action: 'show-selector' })
  })

  it('honors pickMode by skipping redirects even with 1 pool', () => {
    expect(decideLandingAction([leagues[0]], null, true)).toEqual({ action: 'show-selector' })
  })

  it('honors pickMode by skipping redirects even with a valid default', () => {
    expect(decideLandingAction(leagues, 'b', true)).toEqual({ action: 'show-selector' })
  })

  it('still shows create when 0 pools even in pickMode', () => {
    expect(decideLandingAction([], null, true)).toEqual({ action: 'show-create' })
  })
})
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run __tests__/lib/pool-selection.test.ts`
Expected: FAIL — module `@/lib/pool-selection` not found.

- [ ] **Step 3: Write the minimal implementation**

Create `lib/pool-selection.ts`:

```ts
export interface PoolSummary {
  id: string
  name: string
}

export type LandingAction =
  | { action: 'show-create' }
  | { action: 'show-selector'; clearDefault?: true }
  | { action: 'redirect'; poolId: string }

export function decideLandingAction(
  leagues: PoolSummary[],
  defaultPoolId: string | null,
  pickMode: boolean,
): LandingAction {
  if (leagues.length === 0) return { action: 'show-create' }
  if (pickMode) return { action: 'show-selector' }
  if (defaultPoolId) {
    const found = leagues.some(l => l.id === defaultPoolId)
    if (found) return { action: 'redirect', poolId: defaultPoolId }
    return { action: 'show-selector', clearDefault: true }
  }
  if (leagues.length === 1) return { action: 'redirect', poolId: leagues[0].id }
  return { action: 'show-selector' }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run __tests__/lib/pool-selection.test.ts`
Expected: PASS — 8 tests pass.

- [ ] **Step 5: Commit**

```bash
git add lib/pool-selection.ts __tests__/lib/pool-selection.test.ts
git commit -m "feat(lib): pure decideLandingAction for auth-aware landing"
```

---

## Task 2: Scaffold `app/page.tsx` with the unauth state

Port the existing login page content into a new root landing. This task produces an identical unauth experience at `/` — same hero, same sign-in buttons, same email flow, same errors. Auth-state branching comes in Task 3.

**Files:**
- Create: `app/page.tsx` (new)

- [ ] **Step 1: Read the current login page to copy its layout and logic**

Run: `cat app/\(auth\)/login/page.tsx`
Keep the file open in context. You will port its JSX and handlers.

- [ ] **Step 2: Create `app/page.tsx` as a client component that mirrors the login page**

Create `app/page.tsx` with the exact contents of `app/(auth)/login/page.tsx`. This is a temporary staging state. Next.js App Router will serve `/` from this new file.

> **Note on routing:** Next.js route groups `(auth)` and `(app)` don't add URL segments. `/` will currently resolve from both `app/(app)/page.tsx` AND (if created naively) `app/page.tsx` — Next.js treats this as a route collision and builds will fail. Solution: proceed to Task 8 (delete `app/(app)/page.tsx`) before running the dev server. For now, just create the new file; the build-level verification runs at the end of Task 4.

- [ ] **Step 3: Verify the file compiles at the type level**

Run: `npx tsc --noEmit`
Expected: PASS (or same errors as pre-change). No new errors introduced by the new file.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): scaffold root landing page (unauth state only)"
```

---

## Task 3: Add auth state detection + loading skeleton

Wire `app/page.tsx` to read Firebase auth state. Add a `checking` state that renders a skeleton in the CTA slot until auth state is resolved. Unauth state continues to render as-is.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add auth state detection logic to `app/page.tsx`**

At the top of the `LoginPage` component (rename the component to `LandingPage` and rename the default export name accordingly), add:

```tsx
import { useEffect, useState } from 'react'
import { onAuthStateChanged, User } from 'firebase/auth'
// ... existing imports

type AuthPhase = 'checking' | 'unauth' | 'auth'

export default function LandingPage() {
  const router = useRouter()
  const [phase, setPhase] = useState<AuthPhase>('checking')
  const [currentUser, setCurrentUser] = useState<User | null>(null)

  // ... existing useState hooks for loading / error / mode / email etc.

  useEffect(() => {
    let unsub: (() => void) | undefined
    auth.authStateReady().then(() => {
      unsub = onAuthStateChanged(auth, (user) => {
        setCurrentUser(user)
        setPhase(user ? 'auth' : 'unauth')
      })
    })
    return () => unsub?.()
  }, [])

  // ... existing handlers
```

- [ ] **Step 2: Render a skeleton when `phase === 'checking'`**

In the JSX where the sign-in buttons currently render (the CTA slot), wrap the existing CTA section in a conditional:

```tsx
{phase === 'checking' && (
  <div className="w-full h-[52px] rounded-full bg-white/10 animate-pulse" />
)}

{phase === 'unauth' && (
  <>
    {/* existing unauth CTAs: Sign in with Google, Continue with email, email form, errors, etc. */}
  </>
)}

{phase === 'auth' && (
  <div className="w-full h-[52px] rounded-full bg-white/10 animate-pulse" />
  /* placeholder — Task 4 replaces this */
)}
```

- [ ] **Step 3: Manually verify the unauth and loading states**

Run: `npm run dev`
Visit `http://localhost:3000/` in an incognito window.
Expected: Briefly see skeleton, then see the Google/email CTAs. No regressions to the visual layout.

Stop the dev server after confirming.

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): wire auth state + loading skeleton"
```

---

## Task 4: Render authed states (redirect, selector, create)

Fetch leagues when authed, apply `decideLandingAction`, render appropriate UI. Pin icon logic comes in Task 5; this task renders the raw pool buttons without pins yet.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add league fetching + decision logic**

Inside `LandingPage`, after the auth detection `useEffect`, add:

```tsx
import { decideLandingAction, PoolSummary } from '@/lib/pool-selection'

const DEFAULT_POOL_KEY = 'hockeypoolz:defaultPoolId'

const [leagues, setLeagues] = useState<PoolSummary[] | null>(null)

useEffect(() => {
  if (phase !== 'auth' || !currentUser) return
  let cancelled = false
  async function loadLeagues() {
    const token = await currentUser!.getIdToken()
    const res = await fetch('/api/leagues', { headers: { Authorization: `Bearer ${token}` } })
    if (!res.ok) {
      if (!cancelled) setLeagues([])
      return
    }
    const data = await res.json()
    if (!cancelled) {
      setLeagues((data.leagues ?? []).map((l: { id: string; name: string }) => ({ id: l.id, name: l.name })))
    }
  }
  loadLeagues()
  return () => { cancelled = true }
}, [phase, currentUser])

useEffect(() => {
  if (phase !== 'auth' || leagues === null) return
  const params = new URLSearchParams(window.location.search)
  const pickMode = params.get('pick') === '1'
  const defaultId = typeof window !== 'undefined' ? localStorage.getItem(DEFAULT_POOL_KEY) : null
  const decision = decideLandingAction(leagues, defaultId, pickMode)

  if (decision.action === 'redirect') {
    router.replace(`/league/${decision.poolId}`)
    return
  }
  if (decision.action === 'show-selector' && decision.clearDefault) {
    localStorage.removeItem(DEFAULT_POOL_KEY)
  }
}, [phase, leagues, router])
```

- [ ] **Step 2: Replace the auth-phase placeholder with real render branches**

Replace the `phase === 'auth'` block in the JSX:

```tsx
{phase === 'auth' && leagues === null && (
  <div className="w-full h-[52px] rounded-full bg-white/10 animate-pulse" />
)}

{phase === 'auth' && leagues !== null && leagues.length === 0 && (
  <div className="w-full flex flex-col gap-3">
    <button
      onClick={() => router.push('/league/create')}
      className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-full transition"
      style={{ fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
    >
      Create a Pool
    </button>
    <p className="text-xs text-gray-400 text-center">Got an invite link? Open it to join a pool.</p>
  </div>
)}

{phase === 'auth' && leagues !== null && leagues.length > 0 && (
  <div className="w-full flex flex-col gap-2">
    {leagues.map(l => (
      <button
        key={l.id}
        onClick={() => router.push(`/league/${l.id}`)}
        className="w-full bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-full transition text-left px-6"
        style={{ fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
      >
        Enter {l.name} →
      </button>
    ))}
  </div>
)}
```

- [ ] **Step 3: Delete the old `app/(app)/page.tsx` now to avoid route collision**

Run: `rm app/\(app\)/page.tsx`

- [ ] **Step 4: Manual verification**

Run: `npm run dev`
Sign in as a test account with exactly 1 league.
Expected: Land on `/`, briefly see skeleton, then get redirected to `/league/{id}` automatically.

Sign in as an account with 2+ leagues (or use a fresh account with 0 leagues for the create path).
Expected: With 2+, see stacked "Enter [Name] →" buttons. With 0, see "Create a Pool" + helper text.

- [ ] **Step 5: Commit**

```bash
git add app/page.tsx
git rm app/\(app\)/page.tsx
git commit -m "feat(landing): render authed states (redirect, selector, create); remove old lobby"
```

---

## Task 5: Pin icon — set/clear default pool

Add a pin button inside each stacked pool button. Clicking toggles the localStorage default and shows an inline toast.

**Files:**
- Modify: `app/page.tsx`

- [ ] **Step 1: Add pin state + toast state**

Inside `LandingPage`:

```tsx
const [defaultPoolId, setDefaultPoolId] = useState<string | null>(null)
const [toast, setToast] = useState<string | null>(null)

useEffect(() => {
  if (typeof window !== 'undefined') {
    setDefaultPoolId(localStorage.getItem(DEFAULT_POOL_KEY))
  }
}, [])

function togglePin(poolId: string, poolName: string) {
  if (defaultPoolId === poolId) {
    localStorage.removeItem(DEFAULT_POOL_KEY)
    setDefaultPoolId(null)
    setToast('No default pool set.')
  } else {
    localStorage.setItem(DEFAULT_POOL_KEY, poolId)
    setDefaultPoolId(poolId)
    setToast(`HockeyPoolz will open ${poolName} next time.`)
  }
  setTimeout(() => setToast(null), 3000)
}
```

- [ ] **Step 2: Update the stacked-pool render to include the pin**

Replace the `leagues.length > 0` branch from Task 4:

```tsx
{phase === 'auth' && leagues !== null && leagues.length > 0 && (
  <div className="w-full flex flex-col gap-2">
    {leagues.map(l => {
      const isDefault = defaultPoolId === l.id
      return (
        <div key={l.id} className="flex items-center gap-2">
          <button
            onClick={() => router.push(`/league/${l.id}`)}
            className="flex-1 bg-orange-500 hover:bg-orange-600 text-white font-bold py-3.5 rounded-full transition text-left px-6"
            style={{ fontFamily: 'var(--font-nunito, Nunito, sans-serif)' }}
          >
            Enter {l.name} →
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); togglePin(l.id, l.name) }}
            aria-label={isDefault ? `Clear ${l.name} as default pool` : `Set ${l.name} as default pool`}
            className="w-11 h-11 rounded-full flex items-center justify-center transition"
            style={{
              background: isDefault ? '#c8a060' : 'transparent',
              border: `1.5px solid ${isDefault ? '#c8a060' : 'rgba(255,255,255,0.35)'}`,
              color: isDefault ? '#1a1612' : 'rgba(255,255,255,0.85)',
            }}
          >
            {/* Pin glyph — filled vs outlined handled by background+color */}
            <svg width="18" height="18" viewBox="0 0 24 24" fill={isDefault ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2">
              <path d="M12 2l2 7h7l-5.5 4 2 7L12 16l-5.5 4 2-7L3 9h7z" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      )
    })}
    {toast && (
      <p className="text-xs text-center mt-2" style={{ color: '#c8a060' }}>{toast}</p>
    )}
  </div>
)}
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
Sign in as a 2+ league account. Click the pin next to Pool A. Toast appears. Reload `/`.
Expected: Auto-redirects to Pool A.

Go to `/?pick=1`. See selector. Click filled pin on Pool A to clear.
Expected: Toast "No default pool set." Reload `/`.
Expected: See selector again (no redirect).

- [ ] **Step 4: Commit**

```bash
git add app/page.tsx
git commit -m "feat(landing): pin icon for per-device default pool"
```

---

## Task 6: Replace `/login` with a redirect

Turn `app/(auth)/login/page.tsx` into a server-side redirect so email links and bookmarks pointing to `/login` still work.

**Files:**
- Modify: `app/(auth)/login/page.tsx` (full rewrite to a 3-line server component)

- [ ] **Step 1: Replace the file contents**

Overwrite `app/(auth)/login/page.tsx` with:

```tsx
import { redirect } from 'next/navigation'

export default function LoginRedirect() {
  redirect('/')
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`
Visit `http://localhost:3000/login`.
Expected: Browser URL becomes `/`. Landing renders (unauth CTAs if signed out, autobounce if signed in).

- [ ] **Step 3: Commit**

```bash
git add app/\(auth\)/login/page.tsx
git commit -m "feat(landing): /login now redirects to /"
```

---

## Task 7: Update `app/(app)/layout.tsx` unauth redirect

Change the redirect target for unauthed users hitting a gated page.

**Files:**
- Modify: `app/(app)/layout.tsx:18-20`

- [ ] **Step 1: Edit the redirect**

In `app/(app)/layout.tsx`, replace:

```tsx
if (!user) {
  router.push('/login')
  return
}
```

with:

```tsx
if (!user) {
  router.push('/')
  return
}
```

- [ ] **Step 2: Manual verification**

Run: `npm run dev`
Sign out. Try to visit `http://localhost:3000/league/abc123` (any gated URL).
Expected: Bounced to `/` (unauth landing).

- [ ] **Step 3: Commit**

```bash
git add app/\(app\)/layout.tsx
git commit -m "feat(landing): (app) layout redirects unauth users to /"
```

---

## Task 8: Update the global header dropdown

Add "+ Create Pool" to the top of the dropdown; update "All Leagues" href to `/?pick=1`; change sign-out redirect from `/login` → `/`.

**Files:**
- Modify: `components/global-header.tsx`

- [ ] **Step 1: Edit the sign-out handler**

In `components/global-header.tsx`, change:

```tsx
async function signOut() {
  await auth.signOut()
  document.cookie = 'session=; path=/; max-age=0'
  router.push('/login')
}
```

to:

```tsx
async function signOut() {
  await auth.signOut()
  document.cookie = 'session=; path=/; max-age=0'
  router.push('/')
}
```

- [ ] **Step 2: Add "+ Create Pool" item at the top of the dropdown and update "All Leagues" href**

Replace the current dropdown menu body (the inner contents of the `{menuOpen && (...)}` block) with:

```tsx
<div className="absolute right-0 top-full mt-1 bg-white rounded-lg shadow-lg py-1 min-w-[200px] z-50">
  <Link
    href="/league/create"
    onClick={() => setMenuOpen(false)}
    className="block px-3 py-2 text-xs font-black uppercase tracking-widest text-[#f97316] hover:bg-[#fff7ed]"
  >
    + Create Pool
  </Link>
  <div className="border-t border-[#f0f0f0] my-1" />
  <Link
    href="/?pick=1"
    onClick={() => setMenuOpen(false)}
    className="block px-3 py-2 text-xs font-bold uppercase tracking-widest text-[#98989e] hover:bg-[#f8f8f8]"
  >
    All Leagues
  </Link>
  {leagues.length > 0 && (
    <>
      <div className="border-t border-[#f0f0f0] my-1" />
      <div className="px-3 pt-1 pb-0.5 text-[9px] font-black uppercase tracking-widest text-[#c8c8c8]">
        Switch League
      </div>
      <div className="max-h-60 overflow-y-auto">
        {leagues.map(l => (
          <Link
            key={l.id}
            href={`/league/${l.id}`}
            onClick={() => setMenuOpen(false)}
            className="block px-3 py-2 text-xs text-[#121212] hover:bg-[#f8f8f8] truncate"
            title={l.name}
          >
            <span className="font-semibold">{l.name}</span>
            <span className="ml-2 text-[9px] text-[#98989e] uppercase tracking-wide">{l.status}</span>
          </Link>
        ))}
      </div>
    </>
  )}
  <div className="border-t border-[#f0f0f0] my-1" />
  <button
    onClick={signOut}
    className="w-full text-left px-3 py-2 text-xs font-semibold text-[#121212] hover:bg-[#f8f8f8]"
  >
    Sign out
  </button>
</div>
```

- [ ] **Step 3: Manual verification**

Run: `npm run dev`
Sign in, open the header dropdown on any authed page.
Expected: "+ Create Pool" at the top (ember text), "All Leagues" below, then "Switch League" list, then "Sign out".

Click "All Leagues" while signed in with a default pool set.
Expected: Land on `/?pick=1` → see the selector (no autobounce).

Click "+ Create Pool".
Expected: Navigate to `/league/create`.

Click "Sign out".
Expected: Land on `/` showing unauth CTAs.

- [ ] **Step 4: Commit**

```bash
git add components/global-header.tsx
git commit -m "feat(header): add + Create Pool, update All Leagues and signout targets"
```

---

## Task 9: End-to-end manual QA + production build

- [ ] **Step 1: Run a production build to catch route collisions and type errors**

Run: `npm run build`
Expected: Build succeeds. No "duplicate route" or "conflicting public file" errors.

- [ ] **Step 2: Run the full vitest suite**

Run: `npx vitest run`
Expected: All tests pass, including the new `pool-selection` tests.

- [ ] **Step 3: Walk the spec's 12-case test plan on dev**

Run: `npm run dev`

Work through each case from `docs/superpowers/specs/2026-04-20-auth-aware-landing-design.md` "Test Plan" section:

1. First-time visitor (incognito) — unauth CTAs visible.
2. Google sign-in — ends up in a pool (1-pool) or selector (2+).
3. Email sign-up (new account, 0 pools) — "Create a Pool" visible.
4. Returning 1-pool user — autobounce.
5. 2+ pools, no default — selector visible.
6. Pin Pool B → reload `/` → redirected to Pool B.
7. Clear default — reload `/` → selector again.
8. Default pool no longer in membership — stale key cleared, selector shown.
9. Header "+ Create Pool" from any authed page → `/league/create`.
10. Sign out → unauth `/`.
11. `/login` URL → redirects to `/`.
12. Cross-device confirmation (optional, informational only): localStorage is per-device.

Note any failures, return to the relevant task, fix, re-run.

- [ ] **Step 4: Final commit (only if fixes were made)**

If any bugs surfaced in Step 3 and required fixes, commit them with a descriptive message. Otherwise, this plan is complete — no commit needed.

---

## Self-Review Notes

**Spec coverage:** Every section of the spec has a task — decision logic (Task 1), landing scaffolding (Task 2), auth detection (Task 3), authed rendering (Task 4), pin interaction (Task 5), `/login` redirect (Task 6), layout redirect change (Task 7), dropdown changes (Task 8), QA (Task 9). Route deletion (`app/(app)/page.tsx`) is in Task 4 to avoid a route collision when the dev server starts.

**No placeholders:** Every code step contains the real code to write. No "TBD", no "add validation", no "similar to above".

**Type consistency:** `PoolSummary` defined in Task 1 is the shape used in Task 4's fetch (`id`, `name` only — status not needed on landing). The global header uses its own local `LeagueSummary` (with `status`) — no cross-contamination.

**Scope:** Appropriately sized for a single plan. ~9 tasks, each small; total surface ≈ 300 lines of code across 5 files.
