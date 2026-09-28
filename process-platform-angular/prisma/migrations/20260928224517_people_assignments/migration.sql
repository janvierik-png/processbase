-- #13 Osoba a #14 obsadenie miesta s obdobim platnosti.
-- Poradie je zamerne: najprv nove tabulky, potom prenos dat z UserPosition,
-- az nakoniec zmazanie UserPosition — ziadne priradenie sa nestrati.

-- CreateTable
CREATE TABLE "Person" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "note" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Person_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PositionAssignment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "positionId" TEXT NOT NULL,
    "personId" TEXT NOT NULL,
    "validFrom" DATE NOT NULL,
    "validTo" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PositionAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Person_organizationId_active_idx" ON "Person"("organizationId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Person_organizationId_userId_key" ON "Person"("organizationId", "userId");

-- CreateIndex
CREATE INDEX "PositionAssignment_positionId_validTo_idx" ON "PositionAssignment"("positionId", "validTo");

-- CreateIndex
CREATE INDEX "PositionAssignment_personId_idx" ON "PositionAssignment"("personId");

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Person" ADD CONSTRAINT "Person_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "OrgPosition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PositionAssignment" ADD CONSTRAINT "PositionAssignment_personId_fkey" FOREIGN KEY ("personId") REFERENCES "Person"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Prenos dat: kazdy clen firmy dostane osobu v adresari prepojenu s uctom.
INSERT INTO "Person" ("id", "organizationId", "userId", "name", "email", "active", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, ou."organizationId", ou."userId", u."name", u."email", true, ou."createdAt", CURRENT_TIMESTAMP
FROM "OrganizationUser" ou
JOIN "User" u ON u."id" = ou."userId";

-- Doterajsie priradenia pozicii -> aktivne obsadenia od datumu priradenia.
-- Priradenie k pozicii firmy, ktorej pouzivatel nie je clenom, sa neprenasa
-- (mohlo vzniknut pred opravou izolacie firiem).
INSERT INTO "PositionAssignment" ("id", "organizationId", "positionId", "personId", "validFrom", "createdAt")
SELECT gen_random_uuid()::text, p."organizationId", up."positionId", pe."id", up."assignedAt"::date, up."assignedAt"
FROM "UserPosition" up
JOIN "OrgPosition" p ON p."id" = up."positionId"
JOIN "Person" pe ON pe."organizationId" = p."organizationId" AND pe."userId" = up."userId";

-- DropForeignKey
ALTER TABLE "UserPosition" DROP CONSTRAINT "UserPosition_positionId_fkey";

-- DropForeignKey
ALTER TABLE "UserPosition" DROP CONSTRAINT "UserPosition_userId_fkey";

-- DropTable
DROP TABLE "UserPosition";
