-- AlterTable
ALTER TABLE "leagues" ADD COLUMN "roster_forwards" INTEGER NOT NULL DEFAULT 9;
ALTER TABLE "leagues" ADD COLUMN "roster_defense"  INTEGER NOT NULL DEFAULT 4;
ALTER TABLE "leagues" ADD COLUMN "roster_goalies"  INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "leagues" DROP COLUMN "players_per_team";

-- AlterTable
ALTER TABLE "drafts" ADD COLUMN "scheduled_start_at" TIMESTAMP(3);
