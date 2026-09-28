-- #16 Profil prace a verzie popisu prace (navrh / publikovana, autor, datum ucinnosti).

-- CreateEnum
CREATE TYPE "JobDescriptionStatus" AS ENUM ('DRAFT', 'PUBLISHED');
-- AlterTable
ALTER TABLE "OrgPosition" ADD COLUMN     "jobProfileId" TEXT;
-- CreateTable
CREATE TABLE "JobProfile" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobProfile_pkey" PRIMARY KEY ("id")
);
-- CreateTable
CREATE TABLE "JobDescriptionVersion" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "jobProfileId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "JobDescriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "content" TEXT NOT NULL DEFAULT '',
    "authorId" TEXT,
    "effectiveFrom" DATE,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "JobDescriptionVersion_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE UNIQUE INDEX "JobProfile_organizationId_name_key" ON "JobProfile"("organizationId", "name");
-- CreateIndex
CREATE UNIQUE INDEX "JobDescriptionVersion_jobProfileId_version_key" ON "JobDescriptionVersion"("jobProfileId", "version");
-- AddForeignKey
ALTER TABLE "OrgPosition" ADD CONSTRAINT "OrgPosition_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "JobProfile" ADD CONSTRAINT "JobProfile_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "JobDescriptionVersion" ADD CONSTRAINT "JobDescriptionVersion_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "JobDescriptionVersion" ADD CONSTRAINT "JobDescriptionVersion_jobProfileId_fkey" FOREIGN KEY ("jobProfileId") REFERENCES "JobProfile"("id") ON DELETE CASCADE ON UPDATE CASCADE;
-- AddForeignKey
ALTER TABLE "JobDescriptionVersion" ADD CONSTRAINT "JobDescriptionVersion_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
