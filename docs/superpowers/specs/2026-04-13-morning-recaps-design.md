# Plan 4 — Morning Recaps Design Spec

**Date:** 2026-04-13
**Status:** Draft — pending user review
**Scope:** AI-generated personalized morning recaps per league member

---

## 1. Summary

After the 11am UTC stats sync completes, a cron job generates personalized AI recaps for each league member who had players in games the previous night. Each recap is written in a sportscaster voice — enthusiastic, irreverent, trash-talk-friendly — and highlights the member's players, their standing movement, and comparisons to other members. Recaps are displayed as a card in the league lobby.

**Out of scope:** Push notifications, email delivery, recap history browsing, league-wide recap.

---

## 2. Generation Flow

```
11:00 UTC — sync-stats cron runs (stats + scores updated)
11:30 UTC — generate-recaps cron runs
  │
  ├── For each active league:
  │     ├── Snapshot current standings (rank per member)
  │     ├── For each member:
  │     │     ├── Check: did any of their players have games since last recap?
  │     │     │     └── No → skip this member
  │     │     │     └── Yes → continue
  │     │     ├── Assemble prompt context (see Section 4)
  │     │     ├── Call Claude API (claude-sonnet-4-6)
  │     │     ├── Calculate standing_change (current rank vs previous rank)
  │     │     └── Store recap in `recaps` table
```

---

## 3. Skip Logic

A recap is generated for a member only if at least one of their drafted players appears in `player_game_stats` with a `game_date` after the member's most recent `recaps.recap_date` (or ever, if no prior recap exists).

This means:
- No recap on nights when none of a member's players had games
- If the cron missed a day, the next run catches up (checks since last recap, not just yesterday)

---

## 4. Prompt Context (Rich)

For each eligible member, assemble ~1500 input tokens of context:

**System prompt:**
```
You are a sportscaster for a fantasy hockey playoff pool called HockeyPoolz. Write a 2-3 paragraph personalized morning recap for a participant. Be enthusiastic, slightly irreverent, and include friendly trash talk about other teams in the league. Reference specific players and stats. Keep it under 200 words.
```

**User prompt includes:**
1. **Member info:** team name, current rank, standing change
2. **Their players' recent stats:** for each player who had a game, include: name, opponent, goals, assists, +/-, and their weighted fantasy score for that game
3. **Current full standings:** all members ranked with total scores (so the AI can reference who's ahead/behind)
4. **Notable performances by other members' players:** top 3 scoring players across the league from last night's games (for comparison/trash talk material)

---

## 5. Claude API Integration

**Model:** `claude-sonnet-4-6` — fast, cheap, good at creative writing.

**SDK:** `@anthropic-ai/sdk` (already installed)

**Call pattern:**
```typescript
import Anthropic from '@anthropic-ai/sdk'

const client = new Anthropic()  // reads ANTHROPIC_API_KEY from env

const response = await client.messages.create({
  model: 'claude-sonnet-4-6',
  max_tokens: 400,
  system: SYSTEM_PROMPT,
  messages: [{ role: 'user', content: userPrompt }],
})
```

**Error handling:** If the API call fails for a specific member, log the error and continue to the next member. Don't fail the entire cron job because one recap failed.

---

## 6. Standing Change Calculation

To calculate `standing_change` for a member:

1. Look up their previous recap's `standing_change` context — or more simply, compare their current rank to what their rank was before the latest score recalculation
2. Simpler approach: store each member's rank at the time of recap generation. On the next run, compare current rank to the rank stored in their most recent recap.

**Implementation:** Add a `rank` field to the recap context. On generation:
- Current rank = their position in standings sorted by `total_score` desc
- Previous rank = current rank stored in most recent prior recap (if exists)
- `standing_change` = previous rank - current rank (positive = moved up, negative = moved down)

If no prior recap exists, `standing_change` = 0.

---

## 7. API Endpoints

### `GET /api/leagues/[id]/recaps`

Returns the current user's latest recap for this league.

**Auth:** Any league member.

**Response:**
```json
{
  "recap": {
    "id": "uuid",
    "recapDate": "2026-05-10",
    "content": "What a night for the Puck Buddies! McDavid lit up the Canucks with a hat trick...",
    "standingChange": 2,
    "createdAt": "2026-05-10T11:35:00Z"
  }
}
```

Returns `null` if no recap exists yet.

---

## 8. UI — Recap Card in League Lobby

When `league.status === 'active'` and a recap exists, show a recap card in the lobby page above the standings summary.

**Card design:**
- Header: "Morning Recap" + recap date
- Standing change badge: green up arrow (+2), red down arrow (-1), or gray dash (no change)
- Body: the AI-generated text content
- Collapsible — shows first paragraph by default, expand to see full recap

---

## 9. Files Changed / Created

**New files:**
- `lib/recap-service.ts` — prompt assembly, Claude API call, recap generation logic
- `app/api/cron/generate-recaps/route.ts` — cron handler
- `app/api/leagues/[id]/recaps/route.ts` — GET latest recap for current user

**Modified files:**
- `app/(app)/league/[id]/page.tsx` — add recap card above standings summary

---

## 10. Recap Table (already exists)

The `recaps` table is already in the schema:
- `id` uuid PK
- `league_id` → leagues
- `league_member_id` → league_members
- `user_id` → users
- `recap_date` date
- `content` text
- `standing_change` int
- `created_at` timestamp
- Unique constraint on `(league_member_id, recap_date)`

No schema changes needed.

---

## 11. Testing Strategy

- **Unit tests:** prompt assembly function — verify correct context structure with fixture data
- **No mocking the Claude API** — test the prompt builder, not the API call
- **Manual verification:** trigger the cron endpoint manually and verify recap quality
