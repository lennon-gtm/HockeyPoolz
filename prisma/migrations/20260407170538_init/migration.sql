-- CreateEnum
CREATE TYPE "BanType" AS ENUM ('soft', 'hard');

-- CreateEnum
CREATE TYPE "LeagueStatus" AS ENUM ('setup', 'draft', 'active', 'complete', 'frozen');

-- CreateEnum
CREATE TYPE "AutodraftStrategy" AS ENUM ('adp', 'wishlist');

-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('pending', 'active', 'paused', 'complete');

-- CreateEnum
CREATE TYPE "PickSource" AS ENUM ('manual', 'timed_autopick', 'autodraft');

-- CreateEnum
CREATE TYPE "Conference" AS ENUM ('east', 'west');

-- CreateEnum
CREATE TYPE "Position" AS ENUM ('C', 'LW', 'RW', 'D', 'G');

-- CreateTable
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "firebase_uid" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "display_name" TEXT NOT NULL,
    "avatar_url" TEXT,
    "favorite_nhl_team_id" TEXT,
    "is_platform_admin" BOOLEAN NOT NULL DEFAULT false,
    "is_banned" BOOLEAN NOT NULL DEFAULT false,
    "ban_type" "BanType",
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leagues" (
    "id" TEXT NOT NULL,
    "commissioner_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "invite_code" TEXT NOT NULL,
    "status" "LeagueStatus" NOT NULL DEFAULT 'setup',
    "max_teams" INTEGER NOT NULL,
    "players_per_team" INTEGER NOT NULL DEFAULT 10,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "leagues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "league_members" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "team_name" TEXT NOT NULL,
    "team_icon" TEXT,
    "draft_position" INTEGER,
    "autodraft_enabled" BOOLEAN NOT NULL DEFAULT false,
    "autodraft_strategy" "AutodraftStrategy" NOT NULL DEFAULT 'adp',
    "total_score" DECIMAL(10,2) NOT NULL DEFAULT 0,
    "score_last_calculated_at" TIMESTAMP(3),
    "joined_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "league_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scoring_settings" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "goals" DECIMAL(5,2) NOT NULL DEFAULT 2.0,
    "assists" DECIMAL(5,2) NOT NULL DEFAULT 1.5,
    "plus_minus" DECIMAL(5,2) NOT NULL DEFAULT 0.5,
    "pim" DECIMAL(5,2) NOT NULL DEFAULT 0.0,
    "shots" DECIMAL(5,2) NOT NULL DEFAULT 0.1,
    "goalie_wins" DECIMAL(5,2) NOT NULL DEFAULT 3.0,
    "goalie_saves" DECIMAL(5,2) NOT NULL DEFAULT 0.2,
    "shutouts" DECIMAL(5,2) NOT NULL DEFAULT 5.0,

    CONSTRAINT "scoring_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "drafts" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "status" "DraftStatus" NOT NULL DEFAULT 'pending',
    "current_pick_number" INTEGER NOT NULL DEFAULT 1,
    "pick_time_limit_secs" INTEGER NOT NULL DEFAULT 90,
    "is_mock" BOOLEAN NOT NULL DEFAULT false,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "draft_picks" (
    "id" TEXT NOT NULL,
    "draft_id" TEXT NOT NULL,
    "league_member_id" TEXT NOT NULL,
    "player_id" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "pick_number" INTEGER NOT NULL,
    "pick_source" "PickSource" NOT NULL DEFAULT 'manual',
    "picked_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "draft_picks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "autodraft_wishlist" (
    "id" TEXT NOT NULL,
    "league_member_id" TEXT NOT NULL,
    "player_id" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL,

    CONSTRAINT "autodraft_wishlist_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "recaps" (
    "id" TEXT NOT NULL,
    "league_id" TEXT NOT NULL,
    "league_member_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "recap_date" DATE NOT NULL,
    "content" TEXT NOT NULL,
    "standing_change" INTEGER NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "recaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nhl_teams" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "logo_url" TEXT,
    "conference" "Conference" NOT NULL,
    "division" TEXT NOT NULL,
    "color_primary" TEXT NOT NULL,
    "color_secondary" TEXT NOT NULL,
    "eliminated_at" TIMESTAMP(3),

    CONSTRAINT "nhl_teams_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "nhl_players" (
    "id" INTEGER NOT NULL,
    "team_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "position" "Position" NOT NULL,
    "headshot_url" TEXT,
    "adp" DECIMAL(6,2),
    "is_active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "nhl_players_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "player_game_stats" (
    "id" TEXT NOT NULL,
    "player_id" INTEGER NOT NULL,
    "game_id" TEXT NOT NULL,
    "game_date" DATE NOT NULL,
    "goals" INTEGER NOT NULL DEFAULT 0,
    "assists" INTEGER NOT NULL DEFAULT 0,
    "plus_minus" INTEGER NOT NULL DEFAULT 0,
    "pim" INTEGER NOT NULL DEFAULT 0,
    "shots" INTEGER NOT NULL DEFAULT 0,
    "goalie_wins" INTEGER NOT NULL DEFAULT 0,
    "goalie_saves" INTEGER NOT NULL DEFAULT 0,
    "goals_against" INTEGER NOT NULL DEFAULT 0,
    "shutouts" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "player_game_stats_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users"("firebase_uid");

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "leagues_invite_code_key" ON "leagues"("invite_code");

-- CreateIndex
CREATE UNIQUE INDEX "league_members_league_id_user_id_key" ON "league_members"("league_id", "user_id");

-- CreateIndex
CREATE UNIQUE INDEX "scoring_settings_league_id_key" ON "scoring_settings"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "drafts_league_id_key" ON "drafts"("league_id");

-- CreateIndex
CREATE UNIQUE INDEX "draft_picks_draft_id_pick_number_key" ON "draft_picks"("draft_id", "pick_number");

-- CreateIndex
CREATE UNIQUE INDEX "autodraft_wishlist_league_member_id_player_id_key" ON "autodraft_wishlist"("league_member_id", "player_id");

-- CreateIndex
CREATE UNIQUE INDEX "autodraft_wishlist_league_member_id_rank_key" ON "autodraft_wishlist"("league_member_id", "rank");

-- CreateIndex
CREATE UNIQUE INDEX "recaps_league_member_id_recap_date_key" ON "recaps"("league_member_id", "recap_date");

-- CreateIndex
CREATE UNIQUE INDEX "player_game_stats_player_id_game_id_key" ON "player_game_stats"("player_id", "game_id");

-- AddForeignKey
ALTER TABLE "users" ADD CONSTRAINT "users_favorite_nhl_team_id_fkey" FOREIGN KEY ("favorite_nhl_team_id") REFERENCES "nhl_teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leagues" ADD CONSTRAINT "leagues_commissioner_id_fkey" FOREIGN KEY ("commissioner_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "league_members" ADD CONSTRAINT "league_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scoring_settings" ADD CONSTRAINT "scoring_settings_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "drafts" ADD CONSTRAINT "drafts_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "drafts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_league_member_id_fkey" FOREIGN KEY ("league_member_id") REFERENCES "league_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "draft_picks" ADD CONSTRAINT "draft_picks_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "nhl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodraft_wishlist" ADD CONSTRAINT "autodraft_wishlist_league_member_id_fkey" FOREIGN KEY ("league_member_id") REFERENCES "league_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "autodraft_wishlist" ADD CONSTRAINT "autodraft_wishlist_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "nhl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_league_id_fkey" FOREIGN KEY ("league_id") REFERENCES "leagues"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_league_member_id_fkey" FOREIGN KEY ("league_member_id") REFERENCES "league_members"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "recaps" ADD CONSTRAINT "recaps_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "nhl_players" ADD CONSTRAINT "nhl_players_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "nhl_teams"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "player_game_stats" ADD CONSTRAINT "player_game_stats_player_id_fkey" FOREIGN KEY ("player_id") REFERENCES "nhl_players"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
