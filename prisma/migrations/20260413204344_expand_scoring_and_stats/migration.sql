-- AlterTable
ALTER TABLE "player_game_stats" ADD COLUMN     "blocked_shots" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "game_winning_goals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "hits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "overtime_goals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "power_play_goals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "power_play_points" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "save_pct" DECIMAL(5,4) NOT NULL DEFAULT 0,
ADD COLUMN     "shorthanded_goals" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "shorthanded_points" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "scoring_settings" ADD COLUMN     "blocked_shots" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "game_winning_goals" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
ADD COLUMN     "goals_against" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "hits" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "overtime_goals" DECIMAL(5,2) NOT NULL DEFAULT 1.0,
ADD COLUMN     "power_play_goals" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
ADD COLUMN     "power_play_points" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "shorthanded_goals" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
ADD COLUMN     "shorthanded_points" DECIMAL(5,2) NOT NULL DEFAULT 0.0;
