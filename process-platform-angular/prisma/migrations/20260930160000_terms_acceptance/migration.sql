-- #21 — súhlas s podmienkami používania pri registrácii firmy (verzia a čas)
-- AlterTable
ALTER TABLE "User" ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3),
ADD COLUMN     "termsVersion" TEXT;
