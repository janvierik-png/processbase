-- AlterTable
ALTER TABLE "OrgPosition" ADD COLUMN     "reportsToId" TEXT;

-- AlterTable
ALTER TABLE "OrgUnit" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "OrgUnit_parentId_idx" ON "OrgUnit"("parentId");

-- AddForeignKey
ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_reportsToId_fkey" FOREIGN KEY ("reportsToId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;
