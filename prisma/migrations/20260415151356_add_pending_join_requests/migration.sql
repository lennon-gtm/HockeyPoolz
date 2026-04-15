-- CreateTable
CREATE TABLE "pending_join_requests" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "team_icon" TEXT,
    "favorite_nhl_team_id" TEXT,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pending_join_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pending_join_requests_league_id_user_id_key" ON "pending_join_requests"("league_id", "user_id");

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pending_join_requests" ADD CONSTRAINT "pending_join_requests_favorite_nhl_team_id_fkey" FOREIGN KEY ("favorite_nhl_team_id") REFERENCES "nhl_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
