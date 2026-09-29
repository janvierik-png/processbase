-- #29 CORE-03 RACI na kroku procesu
-- CreateEnum
CREATE TYPE "RaciRole" AS ENUM ('RESPONSIBLE', 'ACCOUNTABLE', 'CONSULTED', 'INFORMED');

-- CreateTable
CREATE TABLE "ActivityResponsibility" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "role" "RaciRole" NOT NULL,
    "positionId" TEXT,
    "personId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityResponsibility_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityResponsibility_activityId_idx" ON "ActivityResponsibility"("activityId");

-- CreateIndex
CREATE INDEX "ActivityResponsibility_positionId_idx" ON "ActivityResponsibility"("positionId");

-- CreateIndex
CREATE INDEX "ActivityResponsibility_personId_idx" ON "ActivityResponsibility"("personId");

-- AddForeignKey
ALTER TABLE "ActivityResponsibility" ADD CONSTRAINT "ActivityResponsibility_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "ProcessActivity"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityResponsibility" ADD CONSTRAINT "ActivityResponsibility_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ActivityResponsibility" ADD CONSTRAINT "ActivityResponsibility_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- zodpovednost patri bud miestu, alebo (vynimocne) osobe — nikdy obom ani nikomu
ALTER TABLE "ActivityResponsibility" ADD CONSTRAINT "ActivityResponsibility_one_holder_check" CHECK (("positionId" IS NULL) <> ("personId" IS NULL));
