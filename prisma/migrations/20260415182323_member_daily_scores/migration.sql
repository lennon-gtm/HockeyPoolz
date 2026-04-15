-- CreateTable
CREATE TABLE "member_daily_scores" (
    "id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "game_date" DATE NOT NULL,
    "fpts" DECIMAL(10,2) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "member_daily_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "member_daily_scores_member_id_game_date_key" ON "member_daily_scores"("member_id", "game_date");

-- AddForeignKey
ALTER TABLE "member_daily_scores" ADD CONSTRAINT "member_daily_scores_member_id_fkey" FOREIGN KEY ("member_id") REFERENCES "league_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
