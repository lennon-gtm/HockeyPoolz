# User Flows & Team Color Theming — Design Spec

**Goal:** Rebuild the first-time user experience so commissioners and participants land in well-scoped flows that collect the right information at the right time. Apply the user's chosen NHL team colors to their league-scoped pages.

## Problem

The current flows are disjointed:

- Users hit a standalone onboarding page that forces them to pick a team name, icon, and favorite NHL team before they even know what league they're joining.
- Team name and icon are effectively global (stored on the User), so a user can't have different team identities in different leagues.
- League creation auto-copies `user.avatarUrl` as the commissioner's `teamIcon`, which means Google profile pic URLs get stored as icons.
- Join flow only asks for a team name — no icon, no NHL team, no context about the league being joined.
- NHL team colors exist in the database but are only used during onboarding. The rest of the app doesn't theme anything.
- Icons are emoji-only. Users can't upload their own.

## Flows

### New user via invite link
```
Login → Join League (shows league name) → Team Setup (name, icon, NHL team) → League Lobby
```

### New user without invite
```
Login → Home (search for league by name or create one)
```

### Commissioner creating a league
```
Login → Create League (name, max teams, players per team) → Share Invite → Configure Scoring → Team Setup (commissioner's team name, icon, NHL team) → League Lobby
```

### Returning user
```
Login → Home (list of their leagues) → League Lobby
```

## Data Model Changes

**LeagueMember gets new fields:**
- `favoriteTeamId: String?` — FK to `NhlTeam`, null if user hasn't picked one

**LeagueMember existing fields:**
- `teamIcon: String?` — continues to hold either an emoji, a Vercel Blob URL, or null. Display logic already handles the URL case via the `safeIcon()` helper (which will be updated to render `<img>` for URL values).

**User model:**
- `favoriteTeamId` stays for legacy reasons and as a default seed value when joining new leagues, but league-scoped pages read from `LeagueMember.favoriteTeamId` instead.
- `avatarUrl` stops being overwritten with emojis. The onboarding flow is deleted, so nothing sends emoji to this field anymore.

**Migration:**
- Add `favoriteTeamId` to `LeagueMember` (nullable)
- Backfill existing rows: copy each member's `user.favoriteTeamId` to `leagueMember.favoriteTeamId`
- Column stays nullable

## Image Upload

**Storage:** Vercel Blob via `@vercel/blob` SDK.

**API:** `POST /api/uploads/team-icon`
- Accepts multipart form data with an `image` field
- Validates: `image/*` content type, max 2MB
- Uploads to Vercel Blob, returns `{ url }`
- Requires authenticated Bearer token

**Display:** Update `safeIcon()` across pages:
- If value starts with `http` → render as `<img>` tag with rounded full styling
- If value is non-empty text → render as text (emoji)
- If null/empty → render 🏒

## Color Theming

**Where colors apply (all league-scoped pages):**
- League lobby — header strip background, primary buttons
- Standings — user's own row has a left border in their `colorPrimary`
- Draft room — current picker indicator, action buttons
- Player detail — header accent bar
- Recap card — left border accent

**Implementation:**
- League pages already query league data. Include `members.favoriteTeam` (for their own color) and the league's member-specific color.
- Resolve the current user's `colorPrimary` / `colorSecondary` from their LeagueMember → favoriteTeam relation.
- Apply via inline styles (same pattern as onboarding uses today). No theme provider needed.
- Fallback: if no favorite team set, use `#FF6B00` (the current orange).

**Non-league pages:**
- Home, login, and other global pages stay orange. No color theming.

## Page-Level Changes

### Delete
- `app/(app)/onboarding/page.tsx` — gone entirely
- The `needsOnboarding` check in `/api/auth/me` — removed

### Rewrite: `app/(app)/join/[code]/page.tsx`
A multi-step flow:
1. **Welcome screen** — "You've been invited to join {leagueName}". Shows commissioner name and member count. "Join this league" button.
2. **Team Setup** — team name input, icon picker (emoji grid + upload button), NHL team selector (same UI as current onboarding step 3).
3. On submit, POST to `/api/leagues/[id]/join` with all fields, then redirect to `/league/[id]`.

### Rewrite: `app/(app)/league/create/page.tsx`
A multi-step wizard:
1. **League settings** — league name, max teams, players per team (existing form)
2. **Share invite** — after creation, show invite link with copy button and "Continue" (league is persisted at step 1 submission)
3. **Scoring config** — the scoring sliders (reuse the existing settings page component)
4. **Commissioner team setup** — team name, icon, NHL team
5. On finish, redirect to `/league/[id]`

### Update: `app/(app)/league/[id]/page.tsx` (Lobby)
- Read current user's league member + favorite team color
- Apply `colorPrimary` to the header accent and action buttons
- Everything else (draft phase UI, standings summary, recap card) stays — just gets themed

### Update: `app/(app)/league/[id]/draft/page.tsx`
- Apply member's `colorPrimary` to their "on the clock" indicator
- Primary action buttons tinted

### Update: `app/(app)/league/[id]/standings/page.tsx`
- User's own row gets a left border in their `colorPrimary`

### Update: `app/(app)/league/[id]/players/[playerId]/page.tsx`
- Header accent bar in `colorPrimary`

## API Changes

### New: `POST /api/uploads/team-icon`
Multipart upload, validates size/type, uploads to Vercel Blob, returns `{ url }`.

### Update: `POST /api/leagues/[id]/join`
- Accepts `favoriteTeamId` alongside `teamName` and `teamIcon`
- Stores all three on the new LeagueMember

### Update: `POST /api/leagues`
- No longer auto-creates a LeagueMember at league creation time
- Just creates the League + ScoringSettings, returns the league with its `inviteCode`
- The commissioner becomes a LeagueMember by going through the same join flow (step 4 of the wizard POSTs to `/api/leagues/[id]/join` with the league's own invite code)

This keeps the join endpoint as the single source of truth for member creation — no duplicate logic.

### Update: `POST /api/leagues/[id]/join`
- Already accepts `teamName` and `teamIcon` — extend to also accept `favoriteTeamId`
- Persists all three fields on the LeagueMember

### Update: `POST /api/auth/me`
No changes needed. The onboarding page is deleted, so it stops being called with emoji-as-avatarUrl. The endpoint itself stays as-is (still used for first-login user creation and profile reads).

## Migration / Data Cleanup

**Prisma migration:**
```sql
ALTER TABLE league_member ADD COLUMN favorite_team_id TEXT;
ALTER TABLE league_member ADD CONSTRAINT fk_favorite_team
  FOREIGN KEY (favorite_team_id) REFERENCES nhl_team(id);
```

**Backfill script (one-time, run after migration):**
```sql
UPDATE league_member lm
SET favorite_team_id = u.favorite_team_id
FROM "user" u
WHERE lm.user_id = u.id AND u.favorite_team_id IS NOT NULL;
```

Run via `prisma migrate dev` with a data migration.

## Environment Variables

**New:**
- `BLOB_READ_WRITE_TOKEN` — required for Vercel Blob SDK (auto-populated when Vercel Blob is enabled on the project)

User needs to:
1. Enable Vercel Blob in project settings
2. The token gets added to environment variables automatically

## Error Handling

- Image upload failure (network, quota, validation) → toast error, keep existing icon, don't block the rest of the flow
- Missing favorite team on a LeagueMember → fall back to `#FF6B00` orange theme, no crash
- Invalid file type on upload → 400 response, client shows "Only images allowed"
- File too large → 400 response, client shows "Max 2MB"

## Testing

**Unit tests (Vitest):**
- Image upload API: validation cases (no file, wrong type, too large, success path)

**Manual smoke test:**
- Create a league end-to-end as commissioner (all 4 wizard steps, upload a custom icon)
- Join a league via invite link as a second user
- Verify colors apply correctly based on NHL team pick
- Verify the invite URL uses the production domain

## Out of Scope

- Home page redesign (stays orange)
- Editing team identity after setup (already shipped: `PATCH /api/leagues/[id]/members/me`)
- Image optimization / multiple sizes
- Changing NHL team color scheme post-join (can be added later by reusing the members/me PATCH endpoint)
- Email invite sending (the "send via email" option mentioned in the flow description — the UI will show a copy-link button for Alpha; email sending is a future enhancement)
