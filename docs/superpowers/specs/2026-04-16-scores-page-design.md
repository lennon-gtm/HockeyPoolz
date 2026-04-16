# Yesterday's Scores Page — Design Spec

**Date:** 2026-04-16
**Status:** Approved

---

## Overview

A league-contextual scores page at `/league/[id]/scores` showing yesterday's NHL game results. Each game gets a one-to-two sentence radio host-style callout: game narrative + who in this league cashed in. Links to the full NHL.com recap article.

---

## 1. Data Flow Per Game

Three inputs assembled for each game:

### 1a. Game Result
- Source: `GET https://api-web.nhle.com/v1/score/{date}` (date = yesterday, `YYYY-MM-DD`)
- Fields used: `homeTeam`, `awayTeam`, `homeScore`, `awayScore`, `gameState` (FINAL/OT/SO), `seriesStatus` (series score if playoff game), `gameId`

### 1b. Article Content
- Source: `GET https://api-web.nhle.com/v1/gamecenter/{gameId}/story`
- Fields used: article `headline`, first 2 paragraphs of `body` text, `canonicalUrl` (links to NHL.com full article)
- If the story endpoint returns no content (rare), skip the article link; still generate the callout from box score data

### 1c. League Benefactor
- Query `PlayerGameStats` where `gameId = "po-{gameId}"` (playoff prefix)
- Join to `DraftPick` → `LeagueMember` scoped to this league
- Sum fantasy points per member for that game using league's `ScoringSettings` weights
- Top-scoring member = the benefactor. Include: member's team name, their total fpts from that game, and their players who scored (name + goals + assists)
- If no league member had players in the game: omit the league callout sentence

---

## 2. AI Generation

### Trigger
New function `generateLeagueScoreSummaries(leagueId: string, date: string)` called from the `generate-recaps` cron after `generateLeagueRecap` completes.

### Skip logic
Skip if no games found for yesterday's date. Skip individual games where `gameState` is not `FINAL`, `OFF`, or `OFFICIAL` (game not complete).

### Per-game Claude call
One call per game per league. Input tokens ~400. Output: 1–2 sentences, ~50 words max.

**System prompt:**
> You are the host of a fantasy hockey radio show — loud, punchy, and fun. Write 1–2 sentences max about this game. Sentence 1: the game result with a highlight (a big goal, a comeback, series context). Sentence 2: call out the fantasy winner from this league by name with their point total and the player who delivered. Use the same voice throughout — enthusiastic, specific, a little bit of edge. No filler. No "In conclusion." Just the take.

**User prompt structure:**
```
Game: {awayTeam} {awayScore} @ {homeTeam} {homeScore} (FINAL/OT — Game 3, {homeTeam} leads 2-1)
Top performers: {player1} ({goals}G {assists}A), {player2} ({goals}G {assists}A)
Article context: {headline}. {first_paragraph}
League fantasy winner: {memberTeamName} — {fpts} pts ({player1}: {pts}, {player2}: {pts})
```

**Example output:**
> Makar scored twice and Colorado grabbed a 2-1 series lead — it wasn't even close. BobsTeam walks away with a whopping 14.2 pts on the night, all thanks to Makar doing Makar things.

### Storage
New model `LeagueGameSummary` — one record per league per NHL game per day.

---

## 3. New Data Model

```prisma
model LeagueGameSummary {
  id           String   @id @default(uuid())
  leagueId     String   @map("league_id")
  gameId       String   @map("game_id")
  gameDate     DateTime @db.Date @map("game_date")
  homeTeamId   String   @map("home_team_id")
  awayTeamId   String   @map("away_team_id")
  homeScore    Int      @map("home_score")
  awayScore    Int      @map("away_score")
  gameState    String   @map("game_state")   // "FINAL", "OT", "SO"
  seriesStatus String?  @map("series_status") // "COL leads 2-1", null for regular season
  articleUrl   String?  @map("article_url")
  content      String                         // AI-generated callout
  createdAt    DateTime @default(now()) @map("created_at")

  league League @relation(fields: [leagueId], references: [id])

  @@unique([leagueId, gameId])
  @@map("league_game_summaries")
}
```

---

## 4. API

### `GET /api/leagues/[id]/scores`

Returns all `LeagueGameSummary` records for the league where `gameDate = yesterday`, ordered by `awayScore + homeScore` desc (highest-scoring games first).

Auth: any league member (existing Bearer token pattern).

```json
{
  "games": [
    {
      "id": "uuid",
      "gameId": "po-2024030201",
      "gameDate": "2026-05-10",
      "homeTeamId": "COL",
      "awayTeamId": "DAL",
      "homeScore": 4,
      "awayScore": 2,
      "gameState": "FINAL",
      "seriesStatus": "COL leads 2-1",
      "articleUrl": "https://www.nhl.com/news/...",
      "content": "Makar scored twice and Colorado grabbed a 2-1 series lead..."
    }
  ]
}
```

Returns `{ "games": [] }` if no summaries exist for yesterday.

---

## 5. UI — `/league/[id]/scores`

### Navigation
Add "Scores" to the league nav alongside Standings, Draft, My Team, Settings.

### Page layout
Header: `YESTERDAY'S GAMES` + date

One card per game:
- **Top row:** Away team logo + score — Home team logo + score. Series status pill if applicable (e.g. `COL leads 2-1`). Final/OT/SO badge.
- **Body:** AI-generated callout in the radio host voice (1–2 sentences)
- **Footer:** `Read full recap →` link to `articleUrl` (opens new tab). Hidden if `articleUrl` is null.

Empty state: "No games yesterday" if `games` is empty.

Loading state: skeleton cards while fetching.

---

## 6. Files Changed / Created

**Schema:**
- `prisma/schema.prisma` — add `LeagueGameSummary` model and `League` relation

**New files:**
- `lib/scores-service.ts` — `generateLeagueScoreSummaries()`, NHL API fetches, benefactor calculation, prompt assembly
- `app/api/leagues/[id]/scores/route.ts` — GET endpoint
- `app/(app)/league/[id]/scores/page.tsx` — scores page UI

**Modified files:**
- `app/api/cron/generate-recaps/route.ts` — call `generateLeagueScoreSummaries` per league
- `app/(app)/league/[id]/layout.tsx` — add Scores nav link

---

## 7. Testing

- Unit test `buildGameSummaryPrompt()`: verify game result, article context, and benefactor data are all present in assembled prompt
- Unit test benefactor calculation: given fixture `PlayerGameStats` and `DraftPick` data, correct member is identified with correct fpts
- Skip logic: no completed games → no summaries generated
- No Claude API mocking — test prompt assembly and data aggregation only
