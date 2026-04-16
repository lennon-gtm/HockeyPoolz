-- CreateTable
CREATE TABLE "league_game_summaries" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "game_id" TEXT NOT NULL,
    "game_date" DATE NOT NULL,
    "home_team_id" TEXT NOT NULL,
    "away_team_id" TEXT NOT NULL,
    "home_score" INTEGER NOT NULL,
    "away_score" INTEGER NOT NULL,
    "game_state" TEXT NOT NULL,
    "series_status" TEXT,
    "article_url" TEXT,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_game_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "league_game_summaries_league_id_game_id_key" ON "league_game_summaries"("league_id", "game_id");

-- AddForeignKey
ALTER TABLE "league_game_summaries" ADD CONSTRAINT "league_game_summaries_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
