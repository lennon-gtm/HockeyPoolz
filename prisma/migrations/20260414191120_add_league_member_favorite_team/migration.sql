-- AlterTable
ALTER TABLE "league_members" ADD COLUMN     "favorite_nhl_team_id" TEXT;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_favorite_nhl_team_id_fkey" FOREIGN KEY ("favorite_nhl_team_id") REFERENCES "nhl_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
