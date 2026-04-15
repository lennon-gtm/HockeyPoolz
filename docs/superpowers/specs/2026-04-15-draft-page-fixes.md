# Draft Page Fixes — Design Spec
**Date:** 2026-04-15  
**Status:** Approved

---

## Overview

Three bug fixes to the draft page and league settings:

1. **Season stats label** — add a "2025-26 RS" pill to the draft rankings table so drafters know which season's stats are displayed
2. **Playoff team filtering** — restrict the draft pool to the 16 playoff-qualified teams only
3. **Scoring settings read-only** — non-commissioners can view scoring settings but cannot edit them

Plus one operational task: trigger the sync cron to populate `PlayerGameStats`.

---

## Fix 1 — Season Stats Label

### What
Add a static `2025-26 RS` pill/badge to the draft rankings table header, inline with the column headers (G, A, PTS, +/-, SOG). This is purely cosmetic — it tells drafters the stats shown are 2025-26 regular season totals, not playoff stats or projections.

### Where
- File: `app/(app)/league/[id]/draft/page.tsx`
- Location: The table header row in the pre-draft rankings panel (near the PROJ/ADP toggle)

### Design
- Small pill, orange accent color (#f97316) to match the app's existing style
- Text: `2025-26 RS`
- No click behavior

---

## Fix 2 — Playoff Team Filtering

### What
Only players from playoff-qualified teams appear in the draft pool. Non-qualifying teams (e.g. Toronto, Florida) are excluded entirely.

### 2025-26 Playoff Teams (16)
| ID | City | Team |
|----|------|------|
| COL | Colorado | Avalanche |
| CAR | Carolina | Hurricanes |
| DAL | Dallas | Stars |
| BUF | Buffalo | Sabres |
| TBL | Tampa Bay | Lightning |
| MTL | Montréal | Canadiens |
| MIN | Minnesota | Wild |
| BOS | Boston | Bruins |
| PIT | Pittsburgh | Penguins |
| PHI | Philadelphia | Flyers |
| VGK | Vegas | Golden Knights |
| OTT | Ottawa | Senators |
| UTA | Utah | Hockey Club |
| EDM | Edmonton | Oilers |
| ANA | Anaheim | Ducks |
| LAK | Los Angeles | Kings |

### Schema Change
Add to `NhlTeam` model in `schema.prisma`:
```prisma
playoffQualified Boolean @default(false) @map("playoff_qualified")
```

### Migration
New Prisma migration sets `playoff_qualified = false` for all teams by default (handled by `@default(false)`).

### Seed Update
Update `prisma/seed.ts` to pass `playoffQualified` in each team's upsert. The 16 teams above get `true`, all others get `false`.

### API Changes
Two endpoints must filter on `playoffQualified: true`:

**`GET /api/nhl-players`**
Add to the Prisma `where` clause:
```ts
team: { playoffQualified: true }
```

**`GET /api/leagues/[id]/draft/rankings`**
Add to the player query `where` clause:
```ts
team: { playoffQualified: true }
```

### Re-seeding
After migration, re-run `npm run db:seed` to apply playoff qualification flags. Existing player records are unaffected.

---

## Fix 3 — Scoring Settings Read-Only for Non-Commissioners

### What
The scoring settings page (`/league/[id]/settings`) is already visible to all league members. Currently non-commissioners can interact with sliders but changes silently fail at the API (403). Fix the UI to match: disable editing for non-commissioners and make the read-only state visually clear.

### Detection
The settings page already fetches the league and current user. Use the existing `league.commissionerId === currentUserId` check.

### Non-Commissioner View
- All sliders: `disabled` attribute applied, grey/muted styling
- Save button: hidden
- Add a lock badge above the sliders: *"Commissioner controls scoring settings"* with a lock icon

### Commissioner View
No change from current behavior.

### No API changes needed
The `PUT /api/leagues/[id]/scoring` endpoint already enforces commissioner-only writes.

---

## Fix 4 — Sync Cron (Operational)

### What
`PlayerGameStats` is empty because the sync cron has never run in production. Stats columns on the draft page show blanks.

### Steps
1. Set `CRON_SECRET` environment variable in Vercel dashboard
2. Manually trigger `GET /api/cron/sync-stats` with the `Authorization: Bearer <CRON_SECRET>` header to backfill 2025-26 regular season stats
3. Verify `PlayerGameStats` records appear in the database

### Note
This is an operational step, not a code change. The sync endpoint and cron schedule in `vercel.json` are already correctly configured.

---

## Out of Scope
- Admin UI for managing playoff qualification (deferred to future plan)
- Changing the Utah team name from "Hockey Club" to "Mammoth"
- Any changes to the post-draft scoring or elimination flow
