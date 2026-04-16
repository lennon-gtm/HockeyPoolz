-- AlterTable
ALTER TABLE "leagues" ADD COLUMN     "conn_smythe_winner_id" INTEGER;

-- AlterTable
ALTER TABLE "player_game_stats" ADD COLUMN     "overtime_assists" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "scoring_settings" ADD COLUMN     "conn_smythe_trophy" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "overtime_assists" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "power_play_assists" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "shorthanded_assists" DECIMAL(5,2) NOT NULL DEFAULT 0.0;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_conn_smythe_winner_id_fkey" FOREIGN KEY ("conn_smythe_winner_id") REFERENCES "nhl_players"("id") ON DELETE SET NULL ON UPDATE CASCADE;
