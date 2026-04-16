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

## 2. Generation — Active Season Bulletin

### Trigger

The existing `generate-recaps` cron (11:30 AM UTC) calls a new function `generateLeagueRecap(leagueId)` once per league, after per-member recaps complete.

### Skip logic

Skip if no `MemberDailyScore` records exist for the league with `game_date = yesterday`. Avoids generating on off-days.

### Input data

Assembled from existing tables — no new data collection:

- Full standings: `LeagueMember` ordered by `totalScore` desc (team name, rank, total score)
- Yesterday's scores: `MemberDailyScore` where `gameDate = yesterday`, joined to `LeagueMember` (team name, fpts)
- Rank movement: derived by comparing yesterday's scores to determine who moved up or down — no separate snapshot needed

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

## 2b. Generation — Draft Day Bulletin

### Trigger

Generated once when the draft status transitions to `active` (commissioner hits Start Draft). Called inline from the existing `PATCH /api/leagues/[id]/draft` → `{ action: 'start' }` endpoint, after the draft record is updated.

### Skip logic

Only generate if no `LeagueRecap` record already exists for this league with `recapDate = today`. Prevents duplicate generation on retry.

### Input data

- League name
- All team names in draft order (`LeagueMember` ordered by `draftPosition` asc)
- Total number of teams

No game stats — the pool hasn't started yet.

### Prompt

**System prompt:**
> You are the host of a fantasy hockey radio show on draft day. You are loud, funny, and ruthless. Riff on the team names — find the humor, the hubris, the delusion. Build anticipation for the pool. Keep it under 150 words, punchy, one paragraph. No filler. End with a hype line to kick things off.

**User prompt includes:**
1. League name
2. Team names in draft order (numbered list)

### Example output

> It's finally here. Eight teams, one Stanley Cup, and absolutely zero chill. **GrindersUnited** — love the blue-collar energy, truly, but this is a fantasy pool and grinding rarely pays the bills. **IceQueenFC** sounds dominant until you realise the queen hasn't won anything since 2019. **PuckDaddyFC**… the "FC" is really doing some heavy lifting there, champ. And **BobsTeam** — bold choice, going with your own name. The confidence is either inspiring or a cry for help, we genuinely can't tell. May your draft boards be kind and your injury luck be kinder. Let's get this pool started. 🏒

### Output

Under 150 words. Stored in `LeagueRecap.content` with `recapDate = today`.

### UI

The League Bulletin card displays during `draft` status as well as `active` and `complete`. Header shows `Draft Day · {date}` instead of just the date.

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
- Header: `📣 LEAGUE BULLETIN` label (all-caps, orange) + date label
  - Active/complete: shows recap date (e.g. `April 15, 2026`)
  - Draft day: shows `Draft Day · {date}`
- Body: AI-generated text, shown in full (no collapse — it's short enough)
- Card background: `#fff7ed` (light orange tint), border: `#fed7aa`
- Shown when league status is `draft`, `active`, or `complete`

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
- `lib/recap-service.ts` — add `generateLeagueRecap(leagueId)` and `generateDraftDayBulletin(leagueId)` functions
- `app/api/cron/generate-recaps/route.ts` — call `generateLeagueRecap` per league
- `app/api/leagues/[id]/draft/route.ts` — call `generateDraftDayBulletin` when draft transitions to `active`
- `app/(app)/league/[id]/page.tsx` — swap personal recap card for league bulletin card (shown in draft, active, complete states)
- `app/(app)/league/[id]/team/page.tsx` — add personal recap card at top

---

## 6. Testing

- Unit test `buildLeagueRecapPrompt()` with fixture standings and daily scores
- Unit test `buildDraftDayPrompt()` with fixture team names — verify all team names appear in assembled prompt
- Verify active season skip logic: no `MemberDailyScore` records → no recap generated
- Verify draft day skip logic: existing `LeagueRecap` for today → no duplicate generated
- No Claude API mocking — test prompt assembly only
