# Cleanup Pass

Bugs and polish items to fix after Plan 3 (scoring) is complete.

## Display Bugs

- [ ] **Team icon shows Google avatar URL** — League creation UI stores the Google profile pic URL as `teamIcon` instead of an emoji. Appears in lobby draft order list and draft room.
- [ ] **Team branded color scheme not applied** — League/draft UI doesn't use NHL team colors. Either the API isn't returning team color data or the UI isn't consuming it.
- [ ] **Draft order shows raw URL instead of team name** — Related to the team icon bug; the member row in draft order renders the URL string visually.

## Join Flow

- [ ] **Invite link uses preview deployment URL** — Copy Link generates the URL from `window.location.origin`, which on Vercel preview deployments produces a non-production URL. Second user joins on that domain, auth token scoped differently, join may not persist. Consider hardcoding the production domain or using a Vercel env var.
- [ ] **Join appears to succeed but membership not created** — During smoke test, second user went through the join flow (team name, icon) but `LeagueMember` was not persisted. May be a silent API error or a domain mismatch issue. Needs investigation.

## Proxy / Auth

- [ ] **Audit proxy.ts public paths** — Currently manually maintaining a list of unauthenticated routes. Consider a more scalable pattern (e.g., route-level opt-out, or only protect `/api/` routes that explicitly require auth).
