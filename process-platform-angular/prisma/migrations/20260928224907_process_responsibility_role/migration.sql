-- #15 Rola pracovneho miesta v zodpovednosti za proces.
-- Doterajsie priradenia pozicii k procesu su vykonavatelia (PERFORMER).

-- CreateEnum
CREATE TYPE "ResponsibilityRole" AS ENUM ('OWNER', 'PERFORMER');

-- DropIndex
DROP INDEX "ProcessPosition_processNodeId_positionId_key";

-- AlterTable
ALTER TABLE "ProcessPosition" ADD COLUMN     "role" "ResponsibilityRole" NOT NULL DEFAULT 'PERFORMER';

-- CreateIndex
CREATE UNIQUE INDEX "ProcessPosition_processNodeId_positionId_role_key" ON "ProcessPosition"("processNodeId", "positionId", "role");
