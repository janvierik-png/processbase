-- #40 QUAL-01 riadeny proces, profil Kvalita a audit, zaznamy o vykonani a vynimky pripravenosti
-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "qualityProfile" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "downstreamProcessIds" TEXT[],
ADD COLUMN     "evidenceRequirements" TEXT[],
ADD COLUMN     "inputs" TEXT[],
ADD COLUMN     "opportunities" TEXT,
ADD COLUMN     "outputs" TEXT[],
ADD COLUMN     "resources" TEXT,
ADD COLUMN     "risks" TEXT,
ADD COLUMN     "successMeasure" TEXT,
ADD COLUMN     "upstreamProcessIds" TEXT[];

-- CreateTable
CREATE TABLE "EvidenceRecord" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "requirement" TEXT NOT NULL,
    "performedOn" DATE NOT NULL,
    "note" TEXT,
    "attachmentId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EvidenceRecord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReadinessException" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "markedById" TEXT,
    "markedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),

    CONSTRAINT "ReadinessException_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EvidenceRecord_processNodeId_requirement_performedOn_idx" ON "EvidenceRecord"("processNodeId", "requirement", "performedOn");

-- CreateIndex
CREATE UNIQUE INDEX "ReadinessException_processNodeId_itemKey_key" ON "ReadinessException"("processNodeId", "itemKey");

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceRecord" ADD CONSTRAINT "EvidenceRecord_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessException" ADD CONSTRAINT "ReadinessException_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessException" ADD CONSTRAINT "ReadinessException_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReadinessException" ADD CONSTRAINT "ReadinessException_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

