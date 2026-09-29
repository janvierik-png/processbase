-- #31 DOC-02 riadene dokumenty s verziami suborov
-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- AlterTable
ALTER TABLE "Attachment" ADD COLUMN     "changeNote" TEXT,
ADD COLUMN     "documentId" TEXT,
ADD COLUMN     "effectiveFrom" DATE,
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "ControlledDocument" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT,
    "title" TEXT NOT NULL,
    "ownerPositionId" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ControlledDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ControlledDocument_organizationId_processNodeId_idx" ON "ControlledDocument"("organizationId", "processNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_documentId_version_key" ON "Attachment"("documentId", "version");

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "ControlledDocument"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ControlledDocument" ADD CONSTRAINT "ControlledDocument_ownerPositionId_fkey" FOREIGN KEY ("ownerPositionId") REFERENCES "OrgPosition"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- prenos: kazda existujuca priloha = verzia 1 vlastneho dokumentu. ID dokumentu = ID prilohy,
-- takze odkazy v publikovanych verziach procesov ostavaju platne a ich odtlacok sa nemeni.
INSERT INTO "ControlledDocument" ("id", "organizationId", "processNodeId", "title", "createdAt", "updatedAt")
SELECT a."id", a."organizationId", a."processNodeId", a."fileName", a."createdAt", CURRENT_TIMESTAMP
FROM "Attachment" a
WHERE a."documentId" IS NULL AND a."kind" = 'DOCUMENT';

UPDATE "Attachment"
SET "documentId" = "id",
    "version" = 1,
    "effectiveFrom" = (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE 'Europe/Bratislava')::date
WHERE "documentId" IS NULL AND "kind" = 'DOCUMENT';
