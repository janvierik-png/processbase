-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "diagramType" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "flowchartXml" TEXT;
