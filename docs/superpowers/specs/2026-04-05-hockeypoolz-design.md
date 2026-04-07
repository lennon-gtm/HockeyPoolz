# HockeyPoolz — Alpha Design Spec
**Date:** 2026-04-05  
**Status:** Draft — pending user review  
**Scope:** Alpha (Total Points format, snake draft, single season)

---

## 1. Product Summary

HockeyPoolz is a web app for running NHL playoff fantasy pools. It targets friend groups and office leagues who want a modern, easy-to-join experience with real-time player stats, flexible scoring, and a social hook (draft night, morning recaps, personalized dashboards).

The Alpha ships one format: **Total Points**. Each participant drafts a roster of NHL players via a live snake draft. Points accumulate based on player stats weighted by the commissioner's custom scoring settings. The highest total score at the end of the playoffs wins.

---

## 2. Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Frontend + API | Next.js (App Router) | Full-stack in one codebase, deploys to Vercel |
| Database | Neon (serverless PostgreSQL) | Free tier, scales, pairs with Vercel |
| ORM | Prisma | Type-safe queries, schema migrations |
| Auth | Firebase Auth | Google + Apple SSO, user already set up |
| Hosting | Vercel | Zero-config, free tier covers Alpha |
| Stats source | NHL unofficial API | Free, sufficient for Alpha |
| AI (Morning Recap) | Claude API (claude-sonnet-4-6) | Personalized sportscaster commentary |
| Styling | Tailwind CSS | Utility-first, fast to build |

**Upgrade path:**  
- NHL API → SportsRadar: swap one module (`StatsService`), nothing else changes  
- Score polling (60s) → WebSocket push: upgrade transport layer, app logic unchanged  
- Neon free → paid: connection string change only  

---

## 3. Architecture

```
Browser
  └── Next.js App (pages + components)
  └── Firebase Auth SDK (Google + Apple SSO)
  └── Score polling every 60s

Next.js API Routes (Vercel)
  ├── League API       — create, join, manage leagues
  ├── Draft API        — snake draft engine, mock draft
  ├── Scoring API      — calculate + rank participants
  ├── StatsService     — isolated module, NHL API calls only go here
  └── Admin API        — platform operator tools

Data Layer
  ├── Neon PostgreSQL  — all game data (via Prisma)
  └── Firebase Auth    — identity only; UID links to users table

External
  └── NHL API          — player rosters, game stats (via StatsService)
  └── Claude API       — morning recap generation
```

**Key principle:** All NHL API calls go through `StatsService`. No other API route or component calls the NHL API directly. This boundary makes the stats source swappable and extractable into a standalone service at scale.

**Auth flow:** Firebase issues a JWT on login. Every API route verifies the Firebase ID token via Firebase Admin SDK. No sessions, no cookies. The Firebase UID links to a `users` row in Postgres.

**Multi-tenant isolation:** Every database query is scoped by `league_id`. Application-level checks ensure a user can only read/write data belonging to leagues they are a member of. Platform admins bypass this scope.

---

## 4. Data Model

### Core tables

**`users`**
- `id` uuid PK
- `firebase_uid` text unique — links Firebase identity to game data
- `email` text unique
- `display_name` text
- `avatar_url` text — uploaded photo or emoji
- `favorite_nhl_team_id` text → `nhl_teams` — drives dashboard theme
- `is_platform_admin` boolean default false
- `is_banned` boolean default false
- `ban_type` enum: `soft | hard | null`
- `created_at` timestamptz

**`leagues`**
- `id` uuid PK
- `commissioner_id` uuid → `users`
- `name` text
- `invite_code` text unique — URL-safe short code
- `status` enum: `setup | draft | active | complete | frozen`
- `max_teams` int
- `players_per_team` int — controls number of draft rounds
- `created_at` timestamptz

**`league_members`**
- `id` uuid PK
- `league_id` uuid → `leagues`
- `user_id` uuid → `users`
- `team_name` text
- `team_icon` text — URL or emoji
- `draft_position` int
- `autodraft_enabled` boolean default false — participant opts in before draft starts
- `autodraft_strategy` enum: `adp | wishlist` default `adp`
- `total_score` decimal — cached, recalculated on each stats sync
- `joined_at` timestamptz

**`autodraft_wishlist`** (ordered player preference list, set before draft)
- `id` uuid PK
- `league_member_id` uuid → `league_members`
- `player_id` int → `nhl_players`
- `rank` int — lower = higher preference (1 = top pick)

**`scoring_settings`** (one row per league)
- `id` uuid PK
- `league_id` uuid → `leagues` unique
- `goals` decimal weight (default 2.0)
- `assists` decimal weight (default 1.5)
- `plus_minus` decimal weight (default 0.5)
- `pim` decimal weight (default 0.0)
- `shots` decimal weight (default 0.1)
- `goalie_wins` decimal weight (default 3.0)
- `goalie_saves` decimal weight (default 0.2)
- `shutouts` decimal weight (default 5.0)

**`drafts`** (one per league)
- `id` uuid PK
- `league_id` uuid → `leagues` unique
- `status` enum: `pending | active | paused | complete`
- `current_pick_number` int
- `pick_time_limit_secs` int (default 90)
- `is_mock` boolean — true for practice drafts, never affects real rosters
- `started_at` timestamptz

**`draft_picks`**
- `id` uuid PK
- `draft_id` uuid → `drafts`
- `league_member_id` uuid → `league_members`
- `player_id` int → `nhl_players`
- `round` int
- `pick_number` int
- `is_auto_pick` boolean — true if timer expired
- `is_autodraft` boolean — true if picked by the autodraft system on the participant's behalf
- `picked_at` timestamptz

**`recaps`**
- `id` uuid PK
- `league_id` uuid → `leagues`
- `league_member_id` uuid → `league_members`
- `recap_date` date — the morning this was generated (covering previous night)
- `content` text — AI-generated commentary
- `standing_change` int — e.g. +2 or -1
- `created_at` timestamptz

### StatsService tables (read-only for app logic)

**`nhl_teams`**
- `id` text PK (e.g. `"MTL"`)
- `name` text
- `city` text
- `abbreviation` text
- `logo_url` text
- `conference` enum: `east | west`
- `division` text
- `color_primary` text hex
- `color_secondary` text hex
- `eliminated_at` timestamptz null — null = still in playoffs

**`nhl_players`**
- `id` int PK (NHL API player ID)
- `team_id` text → `nhl_teams`
- `name` text
- `position` enum: `C | LW | RW | D | G`
- `headshot_url` text
- `adp` decimal — average draft position, used for mock draft CPU picks

**`player_game_stats`**
- `id` uuid PK
- `player_id` int → `nhl_players`
- `game_id` text (NHL API game ID)
- `game_date` date
- `goals` int
- `assists` int
- `plus_minus` int
- `pim` int
- `shots` int
- `goalie_wins` int
- `goalie_saves` int
- `goals_against` int
- `shutouts` int

---

## 5. User Flows

### ① New user — joining a league
Invite link → League preview landing page → Sign in (Google/Apple) → Set team name → Upload team icon or pick emoji → Enter lobby (waiting for draft)

### ② Commissioner — creating a league
Sign in → Create league (name, max teams) → League settings (players per team, roster rules) → Configure scoring weights → Share invite link → Set draft order (manual or randomize) → Start draft

### ③ Draft night — snake draft
Draft room opens → On-the-clock picks with countdown timer → Browse available players (filter by position/team) → Pick player (removed from pool for all) → Snake order reverses each round → Auto-pick fires on timer expiry → Commissioner can pause/resume clock at any time → Draft complete → Playoffs begin

Participants with **autodraft enabled** skip the timer entirely — their pick fires instantly when their slot comes up. Autodraft participants can join the room and disable autodraft to take over live at any point.

**Pre-draft:** Participants set autodraft preference and optional wishlist from the lobby before the commissioner starts the draft.

### ③b Mock draft — practice mode
Any participant can launch a mock draft from the lobby. Absent slots are filled by CPU (picks by ADP). Full draft simulation using real playoff roster data. Results can be saved or discarded. No impact on real draft rosters. Unlimited runs before draft night.

### ④ Active playoffs — daily use
Open app → Morning Recap card (AI sportscaster commentary on last night's results, personalized to the participant's roster and standing) → Standings → My Roster (player stats breakdown, eliminated players shown greyed-out) → Player detail (game log + totals) → Compare rosters vs other participants

### ⑤ Platform admin
Admin login → All leagues overview (status, member count) → User lookup → Soft ban (suspend user, revoke league access) or Hard ban (disable account, block in Firebase Auth) → Freeze league → Stats sync status → Manual sync trigger

---

## 6. Core Features

### Authentication
Firebase Auth handles all identity. Google and Apple SSO only — no email/password. On first login, a `users` row is created linked by `firebase_uid`. All API routes verify the Firebase ID token on every request.

### League management
- Commissioner creates a league and receives a unique invite code (short URL)
- Invite link shows a league preview (name, commissioner, member count) before requiring sign-in
- Commissioner configures: league name, max teams, players per team, scoring weights
- Commissioner sets draft order manually or uses random shuffle
- League status machine: `setup → draft → active → complete`

### Scoring settings
Commissioners set a decimal weight per stat category. Score for a participant = sum over all their drafted players of (stat × weight). Calculated fresh on every stats sync, cached as `total_score` on `league_members`. Standings are a ranked sort of `total_score` descending.

### Snake draft engine
- Server-authoritative: pick order and validity enforced on the API, not the client
- Pick timer managed server-side; auto-pick fires if `pick_time_limit_secs` elapses
- Commissioner can set status to `paused` at any time; timer freezes, no picks accepted
- Picks broadcast to all connected clients via score polling refresh (60s) — for Alpha; upgradeable to WebSocket
- Snake reversal: odd rounds pick 1→N, even rounds pick N→1
- Drafted players are immediately unavailable to other participants

### Autodraft
Participants who can't attend the live draft opt in before it starts. Two strategies:

- **ADP (default):** When it's their turn, the system immediately picks the highest-ranked available player by `adp`. No timer needed — the pick fires instantly.
- **Wishlist:** Before the draft, the participant ranks players in priority order via a wishlist UI. When their turn comes, the system picks their highest-ranked player still available. Falls back to ADP if the wishlist is exhausted.

Autodraft picks show an "AUTO" badge on the draft board so other participants can see which picks were made by the system. The participant can disable autodraft and take over manually at any time during the draft — they join the next live pick when it's their turn.

Draft flow with autodraft participants: the pick still advances through the full snake order. Autodraft picks are instantaneous; live participants see them appear immediately and have no timer impact. The commissioner can override an autodraft pick if needed (commissioner-only action).

### Mock draft
Identical UI and rules to the real draft. `is_mock: true` on the `drafts` row. CPU auto-picks by ADP rank for absent slots. Draft picks written to a separate result set, never to real `draft_picks`. Participants can view their mock roster after completion.

### Player elimination
When a player's team is eliminated (`nhl_teams.eliminated_at` set by StatsService), the player's stats stop accumulating. Their existing points remain. They appear greyed-out in roster views. No waiver wire in Alpha.

### Morning Recap (AI)
A scheduled job runs each morning after overnight stats sync. For each active league, it calls the Claude API with:
- Last night's game results
- Scoring changes per participant
- Standing movement (who moved up/down, by how much)

The prompt instructs Claude to write in a sportscaster voice — enthusiastic, slightly irreverent, trash-talk-friendly. Output is personalized per participant (highlights their specific players). Stored as a `recaps` record, displayed as a card on the home screen.

### Team theme personalization
During onboarding, the user picks their favourite NHL team from a full 32-team picker organized by conference and division. The selected team's `color_primary` and `color_secondary` drive the user's dashboard accent colors. Background is always white. Primary color drives: nav active state, accent borders, badges, scores, CTA buttons. Secondary color drives: supporting labels and the gradient strip.

---

## 7. StatsService

One module, one responsibility. Interface:

- `syncPlayoffRoster()` — fetch all playoff teams + players from NHL API, upsert `nhl_teams` and `nhl_players`
- `syncGameStats(date)` — fetch completed game stats for a given date, upsert `player_game_stats`
- `markEliminatedTeams()` — check series results, set `eliminated_at` on knocked-out teams
- `recalculateScores(leagueId?)` — recompute `total_score` for all (or one) league's members from raw `player_game_stats` + `scoring_settings` + `draft_picks`

Called by:
- A Vercel cron job (daily, post-game window)
- The Admin API's manual sync trigger

NHL API → SportsRadar swap: replace the HTTP calls inside `syncPlayoffRoster` and `syncGameStats`. The rest of the app is unaffected.

---

## 8. Platform Admin

Accessible only to users with `is_platform_admin: true`. Separate Next.js route group, middleware-protected.

**Capabilities:**
- View all leagues: name, commissioner, member count, status, created date
- User lookup by email or display name
- Soft ban: sets `users.is_banned = true`, `ban_type = soft` — user can't join new leagues, league access revoked (read-only view of existing leagues, no further participation)
- Hard ban: soft ban + Firebase Admin `disableUser()` — account disabled at auth level
- Freeze league: sets `leagues.status = frozen` — all activity halted, commissioner notified
- Stats sync status: last successful sync timestamp, error log
- Manual sync trigger: calls `StatsService.syncGameStats(today)` on demand

---

## 9. Design Direction

**Palette system:** White background, team-driven accents. Each user's primary and secondary NHL team colors drive their personal view.  
**Global brand elements:** High Energy direction — bold typography, strong contrast, orange (`#FF6B00`) used for HockeyPoolz brand touchpoints (logo, loading states, platform-level UI).  
**Typography:** System font stack for Alpha. Condensed, heavy weights for scores and stats.  
**Full UI design session:** Scheduled as a separate workstream post-Alpha spec. The current direction is a placeholder for component-level detail.

---

## 10. Out of Scope — Alpha

These are confirmed roadmap items, not Alpha deliverables:

| Feature | Target |
|---|---|
| Head-to-head league format | Post-Alpha |
| Waiver wire (player replacement) | Gold Master (commissioner-configurable) |
| Push notifications (morning recap) | Gold Master |
| Billing / paid tiers | Payment-ready architecture; no billing UI for Alpha |
| Mobile native app | Post-Alpha |
| Player elimination — commissioner decides | Gold Master |
| Real-time draft via WebSocket | Post-Alpha (polling for Alpha) |

---

## 11. Open Questions

- [ ] What is the maximum roster size the commissioner can configure? (Suggested default: 10 players — 8 skaters + 2 goalies)
- [ ] Does the morning recap send to all participants or only those who have opened the app that day?
- [ ] Should commissioners be able to edit scoring settings after the draft has started?
- [ ] ADP data source for mock draft CPU picks — manually seeded pre-season, or pulled from a third-party rankings source?
