-- #37 GOV-01 Schvalovanie verzie procesu: zmrazeny obsah na schvalenie, rozhodnutie
-- s historickym zaznamom miesta, nastavenie firmy „vyzadovat schvalenie“.

-- AlterEnum
ALTER TYPE "ApprovalStatus" ADD VALUE 'WITHDRAWN';
-- AlterTable
ALTER TABLE "ApprovalRequest" ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "effectiveFrom" DATE,
ADD COLUMN     "nextReviewAt" DATE,
ADD COLUMN     "snapshot" JSONB,
ADD COLUMN     "versionId" TEXT;
-- AlterTable
ALTER TABLE "ApprovalStep" ADD COLUMN     "deciderPositions" TEXT;
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "requireApproval" BOOLEAN NOT NULL DEFAULT false;
-- AlterTable
ALTER TABLE "ProcessVersion" ADD COLUMN     "approvedAt" TIMESTAMP(3),
ADD COLUMN     "approvedById" TEXT;
-- CreateIndex
CREATE INDEX "ApprovalRequest_organizationId_status_idx" ON "ApprovalRequest"("organizationId", "status");
-- AddForeignKey
ALTER TABLE "ProcessVersion" ADD CONSTRAINT "ProcessVersion_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
