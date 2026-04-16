-- CreateTable
CREATE TABLE "league_recaps" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "recap_date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_recaps_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "league_recaps_league_id_recap_date_key" ON "league_recaps"("league_id", "recap_date");

-- AddForeignKey
ALTER TABLE "league_recaps" ADD CONSTRAINT "league_recaps_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
