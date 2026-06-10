-- AlterTable
ALTER TABLE "IsoTemplate" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "sourcePdfUrl" TEXT,
ADD COLUMN     "structure" JSONB,
ADD COLUMN     "version" TEXT,
ALTER COLUMN "clause" SET DEFAULT '',
ALTER COLUMN "title" SET DEFAULT '';

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN     "autoTranslate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "translationApiKeyEnc" TEXT,
ADD COLUMN     "translationProvider" TEXT,
ADD COLUMN     "translationTargetLocale" TEXT;

-- AlterTable
ALTER TABLE "ProcessNode" ADD COLUMN     "descriptionText" TEXT,
ADD COLUMN     "isoSuggestions" JSONB,
ADD COLUMN     "relatedProcessIds" TEXT[],
ADD COLUMN     "translations" JSONB;

-- CreateTable
CREATE TABLE "OrgPosition" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserPosition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessPosition" (
    "id" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,

    CONSTRAINT "ProcessPosition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessChangeLog" (
    "id" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "userId" TEXT,
    "changedFields" JSONB NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessChangeLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BackofficeAdmin" (
    "id" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BackofficeAdmin_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "OrgPosition_organizationId_name_key" ON "OrgPosition"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "UserPosition_userId_positionId_key" ON "UserPosition"("userId", "positionId");

-- CreateIndex
CREATE UNIQUE INDEX "ProcessPosition_processNodeId_positionId_key" ON "ProcessPosition"("processNodeId", "positionId");

-- CreateIndex
CREATE INDEX "ProcessChangeLog_processNodeId_createdAt_idx" ON "ProcessChangeLog"("processNodeId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "BackofficeAdmin_username_key" ON "BackofficeAdmin"("username");

-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserPosition" ADD CONSTRAINT "UserPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessPosition" ADD CONSTRAINT "ProcessPosition_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessPosition" ADD CONSTRAINT "ProcessPosition_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessChangeLog" ADD CONSTRAINT "ProcessChangeLog_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessChangeLog" ADD CONSTRAINT "ProcessChangeLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
