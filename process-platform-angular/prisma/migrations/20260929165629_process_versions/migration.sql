-- #27 CORE-01 Publikovane verzie procesu (nemenny snapshot, ucinnost).
-- Existujuce procesy ostavaju navrhmi — nic sa nepublikuje automaticky.

-- CreateTable
CREATE TABLE "ProcessVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "changeReason" TEXT,
    "effectiveFrom" DATE NOT NULL,
    "effectiveTo" DATE,
    "nextReviewAt" DATE,
    "publishedById" TEXT,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ProcessVersion_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ProcessVersion_processNodeId_effectiveFrom_idx" ON "ProcessVersion"("processNodeId", "effectiveFrom");
-- CreateIndex
CREATE UNIQUE INDEX "ProcessVersion_processNodeId_revision_key" ON "ProcessVersion"("processNodeId", "revision");
-- AddForeignKey
ALTER TABLE "ProcessVersion" ADD CONSTRAINT "ProcessVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProcessVersion" ADD CONSTRAINT "ProcessVersion_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "ProcessVersion" ADD CONSTRAINT "ProcessVersion_publishedById_fkey" FOREIGN KEY ("publishedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
