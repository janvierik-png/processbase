-- #43 GRAPH-01 — IT systemy a ich pouzitie v procesoch a krokoch
-- AlterTable
ALTER TABLE "ProcessActivity" ADD COLUMN     "systemIds" TEXT[];

-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "systemIds" TEXT[];

-- CreateTable
CREATE TABLE "ItSystem" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "description" TEXT,
    "vendor" TEXT,
    "url" TEXT,
    "ownerPositionId" TEXT,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ItSystem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ItSystem_organizationId_name_key" ON "ItSystem"("organizationId", "name");

-- AddForeignKey
ALTER TABLE "ItSystem" ADD CONSTRAINT "ItSystem_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItSystem" ADD CONSTRAINT "ItSystem_ownerPositionId_fkey" FOREIGN KEY ("ownerPositionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- existujuce procesy a kroky: prazdne zoznamy namiesto NULL (schema sa nemeni)
UPDATE "ProcessNode" SET "systemIds" = '{}' WHERE "systemIds" IS NULL;
UPDATE "ProcessActivity" SET "systemIds" = '{}' WHERE "systemIds" IS NULL;
