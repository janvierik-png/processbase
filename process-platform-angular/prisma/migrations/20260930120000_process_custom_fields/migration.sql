-- #45 CFG-01 — vlastne polia procesu (definicia vo firme, hodnoty pri procese)
-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "customFields" JSONB;

-- CreateTable
CREATE TABLE "ProcessFieldDefinition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "options" TEXT[],
    "required" BOOLEAN NOT NULL DEFAULT false,
    "helpText" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "archivedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessFieldDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ProcessFieldDefinition_organizationId_sortOrder_idx" ON "ProcessFieldDefinition"("organizationId", "sortOrder");

-- AddForeignKey
ALTER TABLE "ProcessFieldDefinition" ADD CONSTRAINT "ProcessFieldDefinition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- typ pola len zo zoznamu (aplikacia to kontroluje tiez)
ALTER TABLE "ProcessFieldDefinition" ADD CONSTRAINT "ProcessFieldDefinition_type_check"
  CHECK ("type" IN ('text', 'longText', 'number', 'date', 'select', 'checkbox'));
