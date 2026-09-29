-- #30 CORE-04 kod procesu, jedinecny vo firme (NULL sa neporovnava — procesy bez kodu su v poriadku)
ALTER TABLE "ProcessNode" ADD COLUMN     "code" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "ProcessNode_organizationId_code_key" ON "ProcessNode"("organizationId", "code");
