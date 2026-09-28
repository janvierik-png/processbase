-- #18 Audit zasahov operatora v backoffice.

-- CreateTable
CREATE TABLE "BackofficeAuditLog" (
    "id" TEXT NOT NULL,
    "adminId" TEXT,
    "adminUsername" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "detail" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BackofficeAuditLog_pkey" PRIMARY KEY ("id")
);
-- CreateIndex
CREATE INDEX "BackofficeAuditLog_createdAt_idx" ON "BackofficeAuditLog"("createdAt");
