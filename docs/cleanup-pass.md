# Cleanup Pass

Bugs and polish items to fix after Plan 3 (scoring) is complete.

## Display Bugs

- [x] **Team icon shows Google avatar URL** — Fixed: league creation now stores `null` instead of `user.avatarUrl`. UI falls back to 🏒 emoji.
- [x] **Draft order shows raw URL instead of team name** — Fixed: same root cause as team icon bug.

## Join Flow

- [x] **Invite link uses preview deployment URL** — Fixed: invite URL now uses `NEXT_PUBLIC_APP_URL` env var with fallback to `window.location.origin`. Set `NEXT_PUBLIC_APP_URL=https://hockey-poolz.vercel.app` in Vercel.
- [x] **Join appears to succeed but membership not created** — Root cause was cross-domain auth mismatch from preview URLs. Fixed by the invite link fix above.

## Proxy / Auth

- [x] **Audit proxy.ts public paths** — Added `/api/nhl-players`, `/api/leagues/by-code/` to public paths so join page and player search work without auth.
