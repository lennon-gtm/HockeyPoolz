# Design System & League Experience — Design Spec

**Date:** 2026-04-14

**Goal:** Establish a cohesive visual language across HockeyPoolz (inspired by nhl.com/stats) and rebuild the four primary league tabs — Lobby, My Team, Draft, Standings — with data-rich, sortable, league-scoped pages. Add the features the Alpha is missing: roster position caps, draft scheduling, commissioner-approved invites, a dedicated draft page with player rankings and wishlists, daily performance tracking, and a draft history view.

## Scope note

This spec covers several independent subsystems. It will be decomposed into multiple implementation plans when writing-plans is invoked:

1. **Design System Foundation** — dark nav, Inter font, color tokens, nav restructure, stat-card pattern, shared components. Apply to existing pages.
2. **League Setup v2** — F/D/G roster caps, draft date/time, pick timer, Draft Settings page.
3. **Invite Approvals** — commissioner-gated join requests.
4. **Draft Page Rebuild** — Rankings sub-tab with full stats & filters, Wishlist sub-tab, autodraft mid-draft toggle, post-draft history view.
5. **Performance Tracking** — daily FPTS snapshot (YDAY column), recap modal, sortable roster and standings.

Each plan produces working, testable software on its own. Order matters: design system is a prerequisite for everything else; performance tracking unlocks the YDAY columns used in lobby / standings / my-team.

---

## Design Language

Inspired by nhl.com/stats: dark header, white content, data-dense tables, 900-weight headings.

### Color tokens

| Role | Value | Usage |
|------|-------|-------|
| Nav / header | `#1a1a1a` | Global top bar, recap modal backdrop |
| Nav secondary | `#111` | Sub-nav strip between global bar and content |
| Content background | `#ffffff` | Page body |
| Surface | `#f8f8f8` | Stat cards, table headers |
| Alt row | `#fafafa` | Zebra striping for table rows |
| Primary text | `#121212` | Body copy, table values |
| Secondary text | `#98989e` | Labels, sub-captions, "uppercase tiny" text |
| Tertiary text | `#515151` | Inactive nav items |
| Border | `#eeeeee` | Tables, card outlines |
| Team color | from `LeagueMember.favoriteTeam.colorPrimary` | Primary action buttons, active-tab underline, your-row left border, hero accents. **Falls back to `#FF6B00`** when not set. |
| Data accent | `#0042bb` / `#e8f0ff` | PROJ / FPTS column highlights |
| Green | `#2db944` | Positive deltas (YDAY +N.N, "COMPLETE" status, +/- positive) |
| Red | `#c8102e` | Negative deltas, destructive actions |
| Amber | `#ffcf00` | Wishlisted ★ icon |

**Position badges** (small uppercase pill, `font-weight:700`, `font-size:7px`):

- **F (Forward):** bg `#e8f4fd` / text `#0042bb`
- **D (Defense):** bg `#fce8f3` / text `#8B008B`
- **G (Goalie):** bg `#fff3e0` / text `#e65100`

### Typography

- **Font:** Inter (already supported via Tailwind's default)
- **Headings:** `font-black` (900), `tracking-tight`
- **Labels:** uppercase, `tracking-widest`, `font-bold`, 9–10px
- **Body:** 11–12px, weight 500–700 in tables

### Component patterns

**Global nav (persistent across all app pages):**

```
┌────────────────────────────────────────┐
│ HOCKEYPOOLZ              [icon] User ▾ │  ← #1a1a1a
├────────────────────────────────────────┤
│ LOBBY  MY TEAM  DRAFT  STANDINGS       │  ← #111, active tab gets team-color border-bottom
└────────────────────────────────────────┘
```

**Nav order:** LOBBY · MY TEAM · DRAFT · STANDINGS.

**Stat cards** — 3-up grid, `bg:#f8f8f8`, `rounded-lg`, 10px padding, big number + tiny all-caps label. Third card can be a dark CTA (e.g. "📰 Recap") to break monotony.

**Data tables:**
- Header row: `bg:#f8f8f8`, small uppercase labels, sort arrow `↕` on each sortable column, `↓` / `↑` indicating current sort direction
- Zebra rows: alternate white / `#fafafa`
- Your row: `border-left: 3px solid {myColor}`, `bg:{myColorTint}` (10% of myColor)
- Highlight column (PROJ / FPTS): each cell `bg:#eef3ff`, text `#0042bb`, `font-black`
- Em dash (`—`) for missing values

**Horizontal scroll with sticky column:**
- Wrap the scrollable content in `overflow-x:auto`
- First column (`<th>` and `<td>`) uses `position:sticky; left:0; z-index:1` (header needs `z-index:2`)
- Sticky cells get matching background color and `border-right:1px solid #eee` as a visual divider
- Alt rows: sticky cell must use the same alt background (`#fafafa`) to avoid seam

**Sortable headers:**
- Each column header is a button with `↕` by default, `↑` ascending, `↓` descending
- Three-state sort: unsorted → desc → asc → unsorted
- Only one column sorted at a time
- Text columns sort A→Z / Z→A; numeric sort numerically

---

## League Lobby

Two states — setup and active — with separate commissioner / player variants.

### Setup phase

**Commissioner view:**

1. League title + "👑 Commissioner · 6/8 Teams · Setup" meta + ⚙ Settings button (top-right)
2. 3 stat cards: Teams (X/Y) · Draft (MMM DD) · Per Pick (Ns)
3. Action row: 🚀 Start Draft (team color) + 🔀 Randomize (secondary)
4. Draft Order table (rank · icon · team · member · "YOU" badge for own row)
5. Pending-invite banner (see Invite Approvals section) — appears above Draft Order when there are pending requests
6. Invite Link card (bottom, below action buttons) — url + Copy Link button in team color

**Player view:**

1. League title + "6/8 Teams · Setup" meta (no settings button)
2. 3 stat cards: Teams · Draft · Days Until Draft
3. Callout card: "You pick Nth · Draft Apr 20 at 8:00 PM" — team-color tinted
4. Draft Order table (read-only) with their own row highlighted
5. Invite Link card — "Invite a Friend" (shared invites require approval — see below)

### Active season

After draft completes (`league.status = 'active'`), the lobby focuses on daily performance.

1. Title with **LIVE** green badge, "8 Teams · Season active"
2. **Hero card** (dark, team-color left border):
   - Left: team icon + name + "You"
   - Right: "Nth of 8" / big score / "TOTAL FPTS"
   - Bottom row (3 columns): Yesterday (+N.N green) · Lead (+N.N, gap to 2nd) · Players (roster count)
3. **Recap card** — tinted team-color gradient background, "New" pill (if unread), headline teaser (first sentence of recap), "Read full recap →" link. Tap opens bottom-sheet modal.
4. **Standings top 3** — compact table, your row highlighted, YDAY + TOTAL columns, "View all →" link
5. **Your top performers** — 3 cards (Top F / Top D / Top G) showing best player by FPTS at each position, "Full roster →" link
6. **No invite link** — league is locked after draft

### Commissioner-only: post-draft

Same as player view. Once draft is complete, there's no commissioner-specific action in the lobby. Scoring changes go through a separate Settings page.

---

## My Team

Single scrollable roster table. No position grouping — F, D, and G players intermix, distinguished only by their position badge.

### Header

- Team icon (2xl) + team name (900-weight) + owner display name
- Right: total FPTS (big, in team color) + "TOTAL FPTS" label

### Stat cards (3-up)

1. **Standing** — "1st" (ordinal rank)
2. **Yesterday** — "+12.1" in green (FPTS earned yesterday, em dash if no games)
3. **Recap** — dark card with 📰 icon. Tap opens bottom-sheet recap modal.

### Recap modal

Bottom sheet, slides up from the bottom, 80% max-height. Content:
- Handle bar (grey drag affordance)
- Header: "Morning Recap" + date + rank delta pill (e.g. "▲ Moved up 2" green, "▼ Dropped 1" red, no pill if flat)
- Recap body text (from existing `Recap` model)
- Close button (dark, bottom)

Backdrop: `rgba(0,0,0,0.6)`. Tap outside to dismiss.

### Roster table

Horizontal scroll with **sticky player column** (position badge + name + NHL team, all in one sticky cell).

**Columns (skaters):**

| Column | Sortable | Note |
|--------|----------|------|
| Player ↕ | yes | Sticky left. Sort A–Z / Z–A by last name |
| **FPTS ↓** | yes | First column after sticky. `#eef3ff` bg, `#0042bb` text. Default sort desc. |
| YDAY ↕ | yes | FPTS earned yesterday (green +N.N or —) |
| G ↕ | yes | |
| A ↕ | yes | |
| PTS ↕ | yes | |
| PPG ↕ | yes | Power-play goals |
| PPA ↕ | yes | Power-play assists |
| SHG ↕ | yes | Shorthanded goals |
| GWG ↕ | yes | Game-winning goals |
| +/- ↕ | yes | Green if positive |
| ATOI ↕ | yes | Average time on ice, format "MM:SS" |

**Goalie rows** show W / SV% in the G / A columns, "—" in other skater columns. Can still sort by FPTS.

All 15 players in one scrollable list — no pagination, no "+N more" truncation.

---

## Draft Page

Three states based on `league.status` / `draft.status`:

### Pre-draft

**Header:**
- Countdown card: "DRAFT STARTS IN" / "4d 6h 22m" / date + time
- Right side of countdown card: small autodraft toggle ("Autodraft — Can't make it? We'll pick for you by ADP")

**Sub-tabs:** Rankings · My Wishlist (with count badge)

#### Rankings sub-tab

**Controls:**

- Mode toggle: **MY SCORING** (default, uses league scoring settings) vs **ADP** (static average draft position)
- Position pills: ALL · F · D · G
- Team dropdown (all 32 NHL teams)
- Search input

**Table (horizontal scroll, sticky player column):**

| Column | Note |
|--------|------|
| # | Current ranking row number |
| POS | F/D/G badge |
| Player | Name + NHL team |
| G / A / PTS / PPG / PPA / SHG / GWG / ATOI | Season stats, all sortable |
| **PROJ ↓** | Default sort. Blue `#eef3ff` bg. In MY SCORING mode = projected fantasy points using league's scoring settings. In ADP mode = static ADP value. |
| ★ | Star/unstar button. Filled gold = in wishlist. Outline grey = not. |

**Goalie rows** show W / GAA / SV% in place of skater stats.

#### My Wishlist sub-tab

Count badge on the tab (e.g. "3").

Info line: "Drag to reorder. Autodraft picks in this order, skipping players already taken."

**List (vertical, no horizontal scroll):**

Each row, top-to-bottom:
- ⋮⋮ drag handle (grey, `cursor:grab`)
- Rank number in a 22px circle (filled with team color if top pick, grey otherwise)
- Player name + position badge + NHL team
- **PTS** column (season total)
- **PROJ** column (blue bg)
- **ADP** column
- ✕ remove button

Top pick gets `border-left: 3px solid {teamColor}` and `bg:#fff8f8`.

Footer: dashed-border "➕ Add players from Rankings" CTA — tapping switches to Rankings tab.

### Live draft

**"On the clock" card** (full-width, picker's team color background):
- Left: picker's team icon + "{Team} — It's your pick!" / owner name
- Right: countdown in `font-size:20px font-weight:900`
- Progress bar across bottom (remaining time / pick limit)

When it's NOT your turn, same card but in muted grey + picker's color accent.

**Autodraft toggle** — available mid-draft. Row below "On the clock" card with same copy pattern: "Switch to Autodraft — We'll pick for you going forward." Toggling on during live draft flips a flag that the auto-pick handler respects for subsequent turns.

**Available players table** (horizontal scroll, sticky player column):

- Same filters as pre-draft Rankings (position, search, team)
- Each row has a **DRAFT** button (team color, only enabled when it's your turn)
- Players already picked are excluded server-side

### Post-draft (complete)

**Summary card:**
- "COMPLETE" green badge + date
- "{totalPicks} picks · {teamCount} teams · {rounds} rounds"
- "Draft took {duration}"

**Controls:** search input + all-teams dropdown filter.

**Content:** list grouped by round. Each round has a dark header pill ("ROUND 1").

Each pick row:
- Pick number
- Team icon (2xl)
- Player name + position badge
- "{team name} · {NHL team}" subtext
- Time taken (e.g. "0:42") OR "AUTO" badge OR "YOU" badge (your picks highlighted with team-color left border and tint)

Rounds 3+ collapsed by default with "Show Rounds 3 – 15 (104 more picks) ▾" button.

---

## Standings

### Header

Title + "Through MMM DD" subtitle.

### Your position hero card

Dark card (`#1a1a1a`) with team-color left border:
- Left: huge rank ("1st") + team icon + team name + "You · +12.1 yesterday"
- Right: total FPTS + "TOTAL FPTS" label

### League table

**Columns:**
- RK (rank)
- Team icon (22px emoji/img)
- Team (sortable A–Z)
- YDAY (FPTS earned yesterday, green if positive, `—` if no games)
- TOTAL (default sort desc, blue `#eef3ff` highlight)

Your row highlighted with team-color left border + tint. Only one "you"-highlight at a time.

All columns sortable. Default sort: TOTAL descending.

---

## Draft Settings Page (League Setup v2)

Accessible from the lobby ⚙ Settings button.

### Commissioner view

Form with:

**Roster** (3 sliders):
- Forwards: 1–12 (default 9)
- Defensemen: 1–8 (default 4)
- Goalies: 1–4 (default 2)
- Live running total displayed: "Total: 15 players per team"

**Draft Schedule:**
- Date picker (native `<input type="date">`)
- Time picker (native `<input type="time">`)
- Text below: "Editable until 1 minute before draft start"
- Disabled state once within 60 seconds of scheduled time

**Pick Timer:**
- Numeric input / slider: 30 – 300 seconds (default 90)

**Scoring** (existing) — link to existing scoring page or inline in this settings page (same categories we already ship)

**Save button** — team color primary button.

### Player view

Read-only display of the same fields. No save button.

---

## Invite Approvals

Commissioners gate new members for a league.

### Flow

1. Player or commissioner shares invite link
2. New user visits `/join/[code]`, fills out team setup form (team name, icon, favorite NHL team)
3. On submit → creates a **PendingJoinRequest** row (NOT a LeagueMember yet)
4. User sees static holding screen: "Your request has been sent. You'll get access once the commissioner approves." No polling, no auto-redirect.
5. Commissioner sees a banner on their lobby (top of page): "🔔 2 people are waiting to join your league" with a "Review" link
6. Review page lists pending requests (one per row): team name + icon preview + requester email + "Approve" button
7. On approve → PendingJoinRequest is deleted, LeagueMember is created (with the same fields the player submitted)
8. Next time the pending user visits the league URL (no automatic notification), they land in the lobby

### Data model: `PendingJoinRequest`

```prisma
model PendingJoinRequest {
  id             String   @id @default(uuid())
  leagueId       String   @map("league_id")
  userId         String   @map("user_id")
  teamName       String   @map("team_name")
  teamIcon       String?  @map("team_icon")
  favoriteTeamId String?  @map("favorite_nhl_team_id")
  submittedAt    DateTime @default(now()) @map("submitted_at")

  league       League   @relation(fields: [leagueId], references: [id])
  user         User     @relation(fields: [userId], references: [id])
  favoriteTeam NhlTeam? @relation(fields: [favoriteTeamId], references: [id])

  @@unique([leagueId, userId])
  @@map("pending_join_requests")
}
```

### APIs

- `POST /api/leagues/[id]/join` — changes behavior: if the requester is not the commissioner (and commissioner-managed), creates PendingJoinRequest instead of LeagueMember
- `POST /api/leagues/[id]/join-requests/[requestId]/approve` — commissioner approves, deletes request, creates LeagueMember
- `GET /api/leagues/[id]/join-requests` — commissioner lists pending (returns count for banner + full list for review page)

**No denial UX for Alpha.** Pending requests pile up until approved or until the commissioner deletes them manually from an admin script (out of scope).

**Commissioner's own join** (step 4 of create wizard) bypasses approval — commissioner can create their own LeagueMember directly.

---

## Performance Tracking

Supports the YDAY columns in standings / my-team / lobby and the lead calculation in the lobby hero card.

### Data model: `PlayerDailyScore`

```prisma
model PlayerDailyScore {
  id          String   @id @default(uuid())
  playerId    String   @map("player_id")
  gameDate    DateTime @db.Date @map("game_date")
  goals       Int      @default(0)
  assists     Int      @default(0)
  plusMinus   Int      @default(0)
  shots       Int      @default(0)
  hits        Int      @default(0)
  // …all skater + goalie stat fields
  createdAt   DateTime @default(now()) @map("created_at")

  player NhlPlayer @relation(fields: [playerId], references: [id])

  @@unique([playerId, gameDate])
  @@map("player_daily_scores")
}
```

### Data model: `MemberDailyScore`

```prisma
model MemberDailyScore {
  id         String   @id @default(uuid())
  memberId   String   @map("member_id")
  gameDate   DateTime @db.Date @map("game_date")
  fpts       Decimal  @db.Decimal(10, 2)
  createdAt  DateTime @default(now()) @map("created_at")

  member LeagueMember @relation(fields: [memberId], references: [id])

  @@unique([memberId, gameDate])
  @@map("member_daily_scores")
}
```

### Cron jobs

- Existing morning cron updates season totals and generates recaps. Extend to also write `PlayerDailyScore` rows for each (player, yesterday's date) and `MemberDailyScore` rows for each (member, yesterday's date).
- No "in-game" / "today's points" tracking for Alpha — `YDAY` is the only time granularity shown.

### APIs

- `GET /api/leagues/[id]/standings` — include `yesterdayFpts` per member
- `GET /api/leagues/[id]/members/[memberId]/roster` — new endpoint, returns roster with each player's season stats + `yesterdayFpts`
- `GET /api/leagues/[id]/draft/history` — new endpoint, returns all DraftPicks ordered by `pickNumber`, grouped on the client by round

---

## Out of scope for this spec

- Email notifications for join approvals
- In-game / live score refresh (only YDAY, updated once per day)
- Denial UX for invite approvals
- Trading / dropping players after draft
- Commentary or chat
- Mobile app (responsive web only)
- Non-league pages (home, login) — stay orange, no design system changes except the new global header

---

## Testing

Manual smoke tests per plan:
- **Design system foundation:** all four tabs render the new nav, typography, colors; no visual regressions
- **League Setup v2:** set F/D/G caps, confirm they persist; set draft date/time, confirm countdown displays correctly; change pick timer, verify draft uses it
- **Invite Approvals:** submit request as second user, see banner on commissioner's lobby, approve, new member appears
- **Draft Page Rebuild:** pre-draft rankings filter + sort + wishlist; live draft autodraft toggle mid-draft; post-draft history shows all picks grouped by round
- **Performance Tracking:** wait one day for cron, verify YDAY columns populate on lobby / my-team / standings
