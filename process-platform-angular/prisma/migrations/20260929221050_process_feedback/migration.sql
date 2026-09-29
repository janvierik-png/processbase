-- #36 UX-01d podnety k procesu (chyba / navrh zlepsenia)
-- CreateEnum
CREATE TYPE "FeedbackKind" AS ENUM ('ERROR', 'IMPROVEMENT');

-- CreateEnum
CREATE TYPE "FeedbackStatus" AS ENUM ('OPEN', 'ACCEPTED', 'REJECTED', 'DONE');

-- CreateTable
CREATE TABLE "ProcessFeedback" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "versionId" TEXT,
    "activityId" TEXT,
    "stepTitle" TEXT,
    "kind" "FeedbackKind" NOT NULL,
    "text" TEXT NOT NULL,
    "status" "FeedbackStatus" NOT NULL DEFAULT 'OPEN',
    "authorId" TEXT,
    "decisionNote" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessFeedback_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessFeedback_organizationId_status_idx" ON "ProcessFeedback"("organizationId", "status");

-- CreateIndex
CREATE INDEX "ProcessFeedback_processNodeId_createdAt_idx" ON "ProcessFeedback"("processNodeId", "createdAt");

-- AddForeignKey
ALTER TABLE "ProcessFeedback" ADD CONSTRAINT "ProcessFeedback_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFeedback" ADD CONSTRAINT "ProcessFeedback_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "ProcessVersion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFeedback" ADD CONSTRAINT "ProcessFeedback_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ProcessActivity"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFeedback" ADD CONSTRAINT "ProcessFeedback_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessFeedback" ADD CONSTRAINT "ProcessFeedback_decidedById_fkey" FOREIGN KEY ("decidedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

