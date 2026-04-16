# League Recap Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

Replace the personal recap card in the league lobby with a single **league-wide daily bulletin**. The bulletin reads like a brutal radio host — celebrating top performers and publicly roasting the bottom of the table by name. Goal: stir conversation among league members.

The existing per-member recap moves from the lobby to the My Team page.

---

## 1. New Data Model — `LeagueRecap`

```prisma
model LeagueRecap {
  id         String   @id @default(uuid())
  leagueId   String   @map("league_id")
  recapDate  DateTime @db.Date @map("recap_date")
  content    String
  createdAt  DateTime @default(now()) @map("created_at")

  league League @relation(fields: [leagueId], references: [id])

  @@unique([leagueId, recapDate])
  @@map("league_recaps")
}
```

One record per league per day. Separate from the existing per-member `Recap` model (unchanged).

---

## 2. Generation

### Trigger

The existing `generate-recaps` cron (11:30 AM UTC) calls a new function `generateLeagueRecap(leagueId)` once per league, after per-member recaps complete.

### Skip logic

Skip if no `MemberDailyScore` records exist for the league with `game_date = yesterday`. Avoids generating on off-days.

### Input data

Assembled from existing tables — no new data collection:

- Full standings: `LeagueMember` ordered by `totalScore` desc (team name, rank, total score)
- Yesterday's scores: `MemberDailyScore` where `gameDate = yesterday`, joined to `LeagueMember` (team name, fpts)
- Rank movement: compare each member's current rank to their rank in the most recent prior `LeagueRecap` context (stored as a JSON standings snapshot, or derived by comparing current standings to standings implied by the previous `LeagueRecap` generation date's scores)

Simplification: rank movement is derived by sorting yesterday's full standings vs today's — no separate snapshot table needed.

### Prompt

**System prompt:**
> You are the host of a fantasy hockey radio show. You are loud, funny, and ruthless. You celebrate winners by name, and you roast the worst performers specifically and mercilessly — use their actual team name, their actual point total from yesterday, and make it sting. Keep it playful, never mean-spirited. 2–3 paragraphs, under 200 words.

**User prompt includes:**
1. Yesterday's scores ranked best to worst (team name + fpts)
2. Current overall standings (rank + total score)
3. Biggest movers up and down since the previous day

### Output

150–200 words. Stored in `LeagueRecap.content`.

---

## 3. API

### `GET /api/leagues/[id]/league-recap`

Returns the most recent `LeagueRecap` for the league. Auth: any league member (existing Bearer token pattern).

```json
{
  "recap": {
    "id": "uuid",
    "recapDate": "2026-05-10",
    "content": "...",
    "createdAt": "2026-05-10T11:35:00Z"
  }
}
```

Returns `{ "recap": null }` if no recap exists yet.

---

## 4. UI Changes

### League Lobby (`/league/[id]`)

- **Remove:** personal recap card
- **Add:** `LEAGUE BULLETIN` card in its place

Card design:
- Header: `LEAGUE BULLETIN` label (all-caps, orange) + recap date
- Body: AI-generated text, shown in full (no collapse — it's short enough)
- Card background: `#fff7ed` (light orange tint, same as the RS pill accent)
- Only shown when league status is `active` or `completed`

### My Team Page (`/league/[id]/team`)

- **Add:** personal recap card at the top of the page, same design it had in the lobby (collapsible, standing change badge, "Morning Recap" header)
- Fetches from existing `GET /api/leagues/[id]/recaps` endpoint — no API changes needed

---

## 5. Files Changed / Created

**Schema:**
- `prisma/schema.prisma` — add `LeagueRecap` model and `League` relation

**New files:**
- `app/api/leagues/[id]/league-recap/route.ts` — GET endpoint

**Modified files:**
- `lib/recap-service.ts` — add `generateLeagueRecap(leagueId)` function
- `app/api/cron/generate-recaps/route.ts` — call `generateLeagueRecap` per league
- `app/(app)/league/[id]/page.tsx` — swap personal recap card for league bulletin card
- `app/(app)/league/[id]/team/page.tsx` — add personal recap card at top

---

## 6. Testing

- Unit test `buildLeagueRecapPrompt()` with fixture standings and daily scores
- Verify skip logic: no `MemberDailyScore` records → no recap generated
- No Claude API mocking — test prompt assembly only
