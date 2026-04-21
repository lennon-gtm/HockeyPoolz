# Auth-Aware Landing with Default Pool Autobounce

**Date:** 2026-04-20
**Status:** Approved for implementation

## Goals

1. Returning logged-in users arrive at content, not at a sign-in wall.
2. Consolidate the two pool-selection surfaces (landing for auth'd users + `(app)/page.tsx` lobby) into one.
3. Give multi-pool users a way to make their most-used pool the default — one click to set, auto-launch on future visits.
4. Pool management (create, switch, future features) lives in the global header dropdown.

## Current State

- **Landing = login page**: `app/(auth)/login/page.tsx`. Shows hero ("Your Pool. Your Way."), 3-step explainer, Google / email CTAs. Does not check auth state — logged-in visitors see the login buttons.
- **Authed lobby**: `app/(app)/page.tsx` renders a full card list of the user's leagues + "+ Create League" button. Served at `/`.
- **Guarded layout**: `app/(app)/layout.tsx` runs `onAuthStateChanged`, redirects unauth users to `/login`, sets a 1-hour `session` cookie.
- **Global header**: `components/global-header.tsx` has a dropdown with "All Leagues", a "Switch League" list, and "Sign out".
- **Firebase persistence**: default (`browserLocalPersistence`). Users already stay signed in across browser restarts — no code change needed.

## Design

### Route Consolidation

| Before | After |
|---|---|
| `app/(auth)/login/page.tsx` → `/login` | Deleted; `/login` redirects to `/` |
| `app/(app)/page.tsx` → `/` (authed lobby) | Deleted |
| `/` (unauth) redirects to `/login` | Removed; `/` handles both states |
| — | `app/page.tsx` (new root landing, handles auth states) |

### Landing States

`app/page.tsx` decides what to render in the CTA slot below the hero, based on Firebase auth state and league count. Hero + 3-step explainer always render.

| State | CTA slot contents |
|---|---|
| Loading (auth check in flight) | Skeleton (single muted bar matching button height). Prevents flicker. |
| Unauthenticated | Current sign-in UI: "Sign in with Google", "Continue with email" (opens inline form with signIn/signUp tabs + forgot password), error/info text. |
| Auth + 0 pools | Primary ember "Create a Pool" → `/league/create`. Muted helper line below: "Got an invite link? Open it to join a pool." |
| Auth + 1 pool, no default set | **Autobounce**: `router.replace('/league/{poolId}')` on mount. Do not render CTA slot. |
| Auth + 1 pool, arrived via `?pick=1` | Single ember "Enter [Pool Name] →" button with pin icon (pin is filled by default since it's the only pool; clicking it toggles autobounce for this pool). |
| Auth + 2+ pools, default set | **Autobounce**: `router.replace('/league/{defaultPoolId}')`. If the default pool ID is no longer in the user's league list (deleted/removed), clear `localStorage` key and render the selector. |
| Auth + 2+ pools, no default set (or arrived via `?pick=1`) | Stacked ember buttons, one per pool. Each button shows pool name + pin icon on the right. |

### Pin Icon Interaction

- Outlined pin = not default for this device; clicking sets `localStorage['hockeypoolz:defaultPoolId'] = poolId`. Inline toast "HockeyPoolz will open [Pool Name] next time."
- Filled ember pin = current default. Clicking clears the localStorage key. Inline toast "No default pool set."
- Only one pool can have a filled pin at a time.
- Setting a default does NOT immediately redirect — the user is here to pick, let them pick. The default takes effect on the next `/` visit.

### Autobounce Logic (on `app/page.tsx` mount)

```
1. Wait for auth.authStateReady()
2. If not authenticated → render unauth state, stop
3. Fetch /api/leagues (gated by ?pick=1 query param; if present, skip autobounce)
4. Let defaultId = localStorage.getItem('hockeypoolz:defaultPoolId')
5. If defaultId && leagues.some(l => l.id === defaultId): router.replace(`/league/${defaultId}`), stop
6. If defaultId && not in league list: localStorage.removeItem(key), continue
7. If exactly 1 league: router.replace(`/league/${leagues[0].id}`), stop
8. Else: render selector with pin interactions
```

### Global Header Dropdown Changes

Edit `components/global-header.tsx`:

1. Add "+ Create Pool" item at top of dropdown (ember-accented text, links to `/league/create`).
2. "All Leagues" link stays but routes to `/?pick=1` (forces selector display, bypasses autobounce).
3. Sign-out redirect changes from `/login` → `/`.
4. No other structural changes.

### Session Persistence

No code change. Firebase's default `browserLocalPersistence` already persists across browser restarts. The 1-hour `session` cookie gets refreshed by `(app)/layout.tsx` on every authed page load, which is sufficient — users interacting with the app keep it fresh.

### Redirects

- `app/(auth)/login/page.tsx` becomes a one-liner server component that calls `redirect('/')` from `next/navigation`. Preserves any stale links (bookmarks, email links referencing `/login`) without introducing middleware.

### Post-login Routing

`finishSignIn` in the landing's inline auth code continues to call `router.push('/')`. With `/` being the same page, the router triggers a re-render; the new auth state + league list triggers the autobounce path. User ends up in their pool.

## Out of Scope

- Per-user (DB-backed) default pool preference — localStorage only. Can migrate later.
- Multi-device sync for defaults.
- "Create Pool" UX changes (page lives at `/league/create`, not touched here).
- Renaming "League" → "Pool" in copy. Do that in a separate pass; this spec preserves the current "League" copy inside the dropdown.

## Test Plan

**Manual, using a Vercel preview + incognito windows:**

1. **First-time visitor (unauth)**: Visit `/` → see hero + 3 steps + Google/email CTAs. No skeleton after initial load.
2. **Google sign-in flow**: Click "Sign in with Google", authenticate, end up in the pool they belong to (or selector if 2+). No `/login` URL exposed.
3. **Email sign-up flow**: Create new account → 0 pools → see "Create a Pool" CTA on landing.
4. **Returning 1-pool user**: Log out, log back in. After auth completes, browser URL changes to `/league/{id}` without manual navigation.
5. **Returning 2+ pool user, no default**: See stacked pool buttons. Click pin on Pool A. See confirmation toast. Reload `/` → redirected to Pool A.
6. **Change default**: Log in as 2+ pool user with default set. Open header dropdown → "All Leagues" → lands on `/?pick=1` selector → click pin on Pool B. Reload `/` → redirected to Pool B.
7. **Clear default**: Click the filled pin on Pool A. Pin goes outlined. Reload `/` → see selector again (no redirect).
8. **Default pool removed**: Set Pool A as default, remove self from Pool A (via another user). Visit `/` → selector shows remaining pools; localStorage key is cleared.
9. **Header "+ Create Pool"**: From any page, open dropdown → click "+ Create Pool" → land on `/league/create`.
10. **Sign-out lands safely**: Click sign-out from dropdown → redirect to `/` (unauth state, CTAs visible). Not `/login`.
11. **Old `/login` URL**: Visit `/login` directly → server-side redirect to `/`.
12. **Cross-device**: localStorage default on laptop does NOT carry to phone — phone shows selector. Confirmed expected behavior.

## Files Changed

**New**
- `app/page.tsx` — the consolidated landing (copy-adapt from `app/(auth)/login/page.tsx`, add auth-aware rendering + autobounce + pin interactions)

**Modified**
- `components/global-header.tsx` — add "+ Create Pool", change sign-out redirect, update "All Leagues" href to `/?pick=1`
- `app/(app)/layout.tsx` — change unauth redirect from `/login` → `/`

**Deleted**
- `app/(app)/page.tsx`
- `app/(auth)/login/page.tsx` (or replaced with a server-side `redirect('/')`)

## Risks

- **Flash of wrong state**: If auth check and leagues fetch happen in sequence, a logged-in user could see unauth CTAs briefly before the autobounce. Mitigation: gate the CTA slot on `checking === false`. Render skeleton during check.
- **Autobounce loop**: If `/league/{id}` redirects back to `/` for any reason (e.g., bad ID), the page would bounce forever. Guard: only autobounce when the leagues fetch returns the ID as a valid membership.
- **localStorage availability**: SSR-safe check required (`typeof window !== 'undefined'`). Next.js App Router client components handle this correctly if access is inside `useEffect`.
