-- #28 CORE-02 Rychly proces: spustac, vysledok a kroky.

-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "trigger" TEXT;
-- CreateTable
CREATE TABLE "ProcessActivity" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ProcessActivity_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "ProcessActivity_processNodeId_sortOrder_idx" ON "ProcessActivity"("processNodeId", "sortOrder");
-- AddForeignKey
ALTER TABLE "ProcessActivity" ADD CONSTRAINT "ProcessActivity_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
