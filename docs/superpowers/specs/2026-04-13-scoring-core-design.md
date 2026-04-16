# Plan 3 — Scoring Core Design Spec

**Date:** 2026-04-13
**Status:** Draft — pending user review
**Scope:** StatsService, stat syncing, score calculation, standings UI, player detail, team elimination

---

## 1. Summary

Build the scoring pipeline that powers the active-playoffs experience. After the draft completes, the system fetches real NHL playoff stats twice daily, calculates each participant's score based on commissioner-configured weights, and displays standings and player performance in the UI.

This plan covers: NHL API integration, expanded scoring categories, cron-based stat sync, score recalculation, team elimination detection, standings page, and player detail views.

**Out of scope:** Morning recaps (Plan 4), admin dashboard, roster compare, mock draft scoring.

---

## 2. NHL API Integration

Three endpoints from `api-web.nhle.com/v1`:

### 2a. Completed games by date
**Endpoint:** `GET /v1/score/{YYYY-MM-DD}`
**Purpose:** Get list of completed playoff games for a given date.
**Filter:** `gameType === 3` (playoff) AND `gameState === "OFF"` (final).
**Key fields:** `id` (gameId), `awayTeam.abbrev`, `homeTeam.abbrev`, `awayTeam.score`, `homeTeam.score`.

### 2b. Player box score per game
**Endpoint:** `GET /v1/gamecenter/{gameId}/boxscore`
**Purpose:** Per-player stats for a completed game.
**Skater fields:** `playerId`, `goals`, `assists`, `plusMinus`, `pim`, `sog` (shots), `hits`, `blockedShots`, `powerPlayGoals`.
**Goalie fields:** `playerId`, `decision` (W/L), `saves`, `goalsAgainst`, `savePctg`, `starter`.
**Structure:** `playerByGameStats.{awayTeam|homeTeam}.{forwards|defense|goalies}[]`.

### 2c. Player game log (for extended stats)
**Endpoint:** `GET /v1/player/{playerId}/game-log/{season}/{gameType}`
**Purpose:** Per-game stats not available in the box score.
**Skater extended fields:** `powerPlayPoints`, `shorthandedGoals`, `shorthandedPoints`, `gameWinningGoals`, `otGoals`.
**Goalie extended fields:** `shutouts`.
**Usage:** Called per drafted player. Season format: `20252026`. Game type: `3` (playoffs).

### 2d. Playoff bracket (for elimination)
**Endpoint:** `GET /v1/playoff-bracket/{year}`
**Purpose:** Detect eliminated teams.
**Key fields:** Each series has `losingTeamId` (populated when a team loses 4 games). Map `losingTeamId` to `nhl_teams.id` to set `eliminated_at`.

---

## 3. Expanded Scoring Categories

### Current schema (8 fields)
goals, assists, plusMinus, pim, shots, goalieWins, goalieSaves, shutouts

### New fields to add (9 fields)

**Skater:**
- `hits` — Decimal(5,2), default 0.0
- `blockedShots` — Decimal(5,2), default 0.0
- `powerPlayGoals` — Decimal(5,2), default 0.0
- `powerPlayPoints` — Decimal(5,2), default 0.0
- `shorthandedGoals` — Decimal(5,2), default 0.0
- `shorthandedPoints` — Decimal(5,2), default 0.0
- `gameWinningGoals` — Decimal(5,2), default 0.0
- `overtimeGoals` — Decimal(5,2), default 0.0

**Goalie:**
- `goalsAgainst` — Decimal(5,2), default 0.0 (note: this is a penalty weight — points are *subtracted* per goal against)

### Updated defaults (non-zero)

| Category | Default Weight |
|---|---|
| goals | 2.0 |
| assists | 1.5 |
| plusMinus | 0.5 |
| shots | 0.1 |
| powerPlayGoals | 0.5 |
| gameWinningGoals | 1.0 |
| overtimeGoals | 1.0 |
| goalieWins | 3.0 |
| goalieSaves | 0.2 |
| shutouts | 5.0 |

All other categories default to 0.0 — commissioner opts in by setting a weight.

### `player_game_stats` expansion

Add to match the new scoring categories:

- `hits` Int default 0
- `blockedShots` Int default 0 (`blocked_shots`)
- `powerPlayGoals` Int default 0 (`power_play_goals`)
- `powerPlayPoints` Int default 0 (`power_play_points`)
- `shorthandedGoals` Int default 0 (`shorthanded_goals`)
- `shorthandedPoints` Int default 0 (`shorthanded_points`)
- `gameWinningGoals` Int default 0 (`game_winning_goals`)
- `overtimeGoals` Int default 0 (`overtime_goals`)
- `savePct` Decimal(5,4) default 0 (`save_pct`) — stored for display purposes only, not used in scoring

---

## 4. StatsService (`lib/stats-service.ts`)

Pure module — all NHL API calls go through here. No other file calls the NHL API directly.

### Functions

**`syncGameStats(date: string): Promise<SyncResult>`**
1. Fetch `/v1/score/{date}` — get completed playoff games
2. For each completed game, fetch `/v1/gamecenter/{gameId}/boxscore`
3. Upsert `player_game_stats` rows for every player in the game (box score fields)
4. Collect all drafted player IDs across all active leagues
5. For each drafted player, fetch `/v1/player/{playerId}/game-log/20252026/3`
6. Update the game stats rows with extended fields (GWG, SHG, PPP, OTG, shutouts)
7. Return: `{ gamesProcessed, playersUpdated, errors[] }`

**Optimizations:**
- Step 5 only fetches game logs for players who appear in drafted rosters (not every player in every game). This limits API calls to ~100-200 players max across all leagues.
- Skip API calls entirely for players whose team has `eliminated_at` set. Their stats are frozen — no new data to fetch. This progressively reduces API load as teams are knocked out through the playoffs.

**`recalculateScores(leagueId: string): Promise<void>`**
1. Load league's `scoring_settings`
2. Load all `draft_picks` for the league (joining to `league_members`)
3. For each member, sum `player_game_stats` for their drafted players:
   - Skip players whose team has `eliminated_at` set AND the game date is after `eliminated_at`
   - Apply weights: `stat_value × weight` for each category
4. Update `league_members.total_score` and `score_last_calculated_at`

**`checkEliminations(): Promise<string[]>`**
1. Fetch `/v1/playoff-bracket/2026`
2. For each series with `losingTeamId` set, find the matching `nhl_teams` row
3. If `eliminated_at` is null, set it to now
4. Return list of newly eliminated team abbreviations

**`syncRosters(): Promise<void>`**
1. Get all teams that are NOT eliminated
2. For each, fetch `/v1/roster/{abbrev}/current`
3. Upsert `nhl_players` — catches mid-playoff roster changes

### Error handling
- Individual game/player failures logged but don't halt the sync
- `SyncResult` includes an `errors[]` array for visibility
- The cron endpoint returns the full `SyncResult` as JSON

---

## 5. Cron Sync

### Schedule
Two runs daily:
- **6:00 UTC** — early sweep, catches most completed games
- **11:00 UTC** — second pass, catches late West Coast games and any stragglers

### Route: `POST /api/cron/sync-stats`

**Auth:** Vercel cron requests include an `Authorization: Bearer <CRON_SECRET>` header. Validate against `process.env.CRON_SECRET`.

**Flow:**
1. Determine sync date range: yesterday's date (most games) + today's date (early-morning finishes)
2. Call `syncRosters()` — refresh player data
3. Call `syncGameStats(yesterday)` and `syncGameStats(today)`
4. Call `checkEliminations()`
5. For each active league, call `recalculateScores(leagueId)`
6. Return JSON summary: games processed, scores updated, eliminations detected

### `vercel.json` update
```json
{
  "crons": [
    { "path": "/api/cron/sync-stats", "schedule": "0 6 * * *" },
    { "path": "/api/cron/sync-stats", "schedule": "0 11 * * *" },
    { "path": "/api/cron/generate-recaps", "schedule": "30 11 * * *" }
  ]
}
```

Note: `generate-recaps` schedule updated to 11:30 UTC (runs after the second sync). Implementation is Plan 4 scope — the cron entry is a placeholder.

---

## 6. Admin Elimination Fallback

### Route: `PATCH /api/admin/teams/[teamId]/eliminate`

**Auth:** Requires authenticated user with `is_platform_admin: true`.

**Body:** `{ eliminatedAt: "2026-05-15T00:00:00Z" }` (ISO date) or `{ eliminatedAt: null }` to undo.

**Purpose:** Manual override if the bracket endpoint doesn't detect an elimination correctly, or if the NHL API is delayed.

---

## 7. Scoring Settings API Update

### Expand `PUT /api/leagues/[id]/scoring`

Add the 10 new fields to `allowedFields`:
`hits`, `blockedShots`, `powerPlayGoals`, `powerPlayPoints`, `shorthandedGoals`, `shorthandedPoints`, `gameWinningGoals`, `overtimeGoals`, `goalsAgainst`

No other changes to the route logic — the existing upsert pattern handles new fields automatically.

---

## 8. New API Routes

### `GET /api/leagues/[id]/standings`

Returns ranked standings for the league.

**Response:**
```json
{
  "standings": [
    {
      "rank": 1,
      "memberId": "uuid",
      "teamName": "Puck Buddies",
      "teamIcon": "🏒",
      "userName": "Lennon",
      "totalScore": 142.50,
      "scoreLastCalculatedAt": "2026-05-10T11:00:00Z",
      "players": [
        {
          "playerId": 8478402,
          "name": "Connor McDavid",
          "position": "C",
          "teamAbbrev": "EDM",
          "headshotUrl": "...",
          "totalPoints": 32.50,
          "isEliminated": false,
          "stats": {
            "goals": 8, "assists": 12, "plusMinus": 5,
            "hits": 10, "powerPlayGoals": 3, "gameWinningGoals": 2
          }
        }
      ]
    }
  ],
  "scoringSettings": { "goals": 2.0, "assists": 1.5, ... }
}
```

**Auth:** Any league member can view.

### `GET /api/leagues/[id]/players/[playerId]`

Returns a player's game-by-game stat log within the context of a league's scoring weights.

**Response:**
```json
{
  "player": {
    "id": 8478402,
    "name": "Connor McDavid",
    "position": "C",
    "team": { "abbreviation": "EDM", "name": "Edmonton Oilers", "isEliminated": false },
    "headshotUrl": "...",
    "totals": { "goals": 8, "assists": 12, ... , "weightedTotal": 32.50 },
    "gameLog": [
      {
        "gameId": "2026030111",
        "gameDate": "2026-04-20",
        "opponent": "VAN",
        "stats": { "goals": 2, "assists": 1, "plusMinus": 2, ... },
        "weightedScore": 8.50
      }
    ]
  }
}
```

**Auth:** Any league member can view.

---

## 9. UI — Standings

### 9a. League lobby standings summary (embedded)

When `league.status === 'active'` or `'complete'`, the lobby page (`/league/[id]`) shows a compact standings card:

- Ranked list: position, team icon, team name, total score
- Current user's row highlighted
- "View Full Standings" link to `/league/[id]/standings`

Replaces the draft controls section that shows when `status === 'draft'`.

### 9b. Full standings page (`/league/[id]/standings`)

- Leaderboard table: rank, team icon, team name, user name, total score
- Click a row to expand: shows that member's roster (player name, position, team, points, eliminated badge)
- Click a player to navigate to player detail page
- "Last updated" timestamp from `scoreLastCalculatedAt`
- Scoring settings summary shown in a collapsible section (so users can see how points are weighted)

---

## 10. UI — Player Detail (`/league/[id]/players/[playerId]`)

- Player header: headshot, name, position, team logo, eliminated badge if applicable
- Season totals: each stat category with raw value and weighted contribution
- Game log table: date, opponent, each stat, weighted score for that game
- Sorted by game date descending (most recent first)

---

## 11. League Status Transition

When the draft completes (`draft.status` → `complete`), the league status should transition from `draft` → `active`. This triggers:

1. The lobby page switches from draft controls to standings view
2. The cron job includes this league in score recalculation

The draft completion logic (already in Plan 2) should set `league.status = 'active'` when the last pick is made. Verify this exists; if not, add it.

---

## 12. Data Flow Summary

```
NHL API
  │
  ├── /v1/score/{date} ──────────────── list completed games
  │     │
  │     └── /v1/gamecenter/{id}/boxscore ── per-player stats (box score fields)
  │
  ├── /v1/player/{id}/game-log/{s}/{t} ── extended stats (GWG, SHG, PPP, OTG, shutouts)
  │
  ├── /v1/playoff-bracket/{year} ──────── elimination detection
  │
  └── /v1/roster/{abbrev}/current ─────── roster refresh
        │
        ▼
   player_game_stats (upsert per player per game)
        │
        ▼
   recalculateScores() ── scoring_settings × player_game_stats → league_members.total_score
        │
        ▼
   Standings API → UI
```

---

## 13. Files Changed / Created

**New files:**
- `lib/stats-service.ts` — all NHL API integration and score calculation
- `app/api/cron/sync-stats/route.ts` — cron handler
- `app/api/leagues/[id]/standings/route.ts` — standings endpoint
- `app/api/leagues/[id]/players/[playerId]/route.ts` — player detail endpoint
- `app/api/admin/teams/[teamId]/eliminate/route.ts` — admin elimination fallback
- `app/(app)/league/[id]/standings/page.tsx` — full standings page
- `app/(app)/league/[id]/players/[playerId]/page.tsx` — player detail page
- `__tests__/lib/stats-service.test.ts` — unit tests for score calculation

**Modified files:**
- `prisma/schema.prisma` — expand `ScoringSettings` + `PlayerGameStats`
- `app/api/leagues/[id]/scoring/route.ts` — add new fields to allowedFields
- `app/(app)/league/[id]/page.tsx` — add standings summary when league is active
- `vercel.json` — update cron schedules
- `middleware.ts` or `proxy.ts` — add cron and admin routes to public/protected paths

---

## 14. Testing Strategy

- **Unit tests:** `stats-service.ts` pure functions — score calculation with various weight configs, elimination date filtering, edge cases (goalie shutout derivation, zero-weight categories)
- **Integration verification:** Manual test of cron endpoint against live NHL API with a test league
- **No mocking the NHL API in tests** — test the calculation logic with hardcoded stat fixtures, not the HTTP layer
