-- AlterTable
ALTER TABLE "league_members" ADD COLUMN     "whatsapp_opted_in" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "whatsapp_phone" TEXT;
