-- #42 AI-01 — AI asistent: firma ho zapína sama, voliteľne s vlastným kľúčom
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "aiApiKeyEnc" TEXT,
ADD COLUMN     "aiEnabled" BOOLEAN NOT NULL DEFAULT false;
