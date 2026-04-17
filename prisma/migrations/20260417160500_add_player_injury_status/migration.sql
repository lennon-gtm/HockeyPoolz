-- CreateEnum
CREATE TYPE "InjuryStatus" AS ENUM ('DTD', 'OUT', 'LTIR');

-- AlterTable
ALTER TABLE "nhl_players" ADD COLUMN "injury_status" "InjuryStatus";
