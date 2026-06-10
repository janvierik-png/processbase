-- CreateEnum
CREATE TYPE "OrganizationRole" AS ENUM ('OWNER', 'ADMIN', 'MANAGER', 'MODELER', 'AUDITOR', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProcessNodeType" AS ENUM ('GROUP', 'PROCESS');

-- CreateEnum
CREATE TYPE "ProcessStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'APPROVED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "InvitationStatus" AS ENUM ('PENDING', 'ACCEPTED', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "ApprovalStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AttachmentKind" AS ENUM ('DOCUMENT', 'IMAGE', 'EXPORT', 'OTHER');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "defaultLocale" TEXT NOT NULL DEFAULT 'sk',
    "camundaBaseUrl" TEXT,
    "camundaDeploymentKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "locale" TEXT NOT NULL DEFAULT 'sk',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrganizationUser" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'VIEWER',
    "roleId" TEXT,
    "isOwner" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationUser_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "permissions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Invitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "role" "OrganizationRole" NOT NULL DEFAULT 'VIEWER',
    "roleId" TEXT,
    "status" "InvitationStatus" NOT NULL DEFAULT 'PENDING',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Invitation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessNode" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "parentId" TEXT,
    "ownerId" TEXT,
    "type" "ProcessNodeType" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProcessStatus" NOT NULL DEFAULT 'DRAFT',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "bpmnXml" TEXT,
    "isoLinks" TEXT[],
    "camundaProcessKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProcessNode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessRevision" (
    "id" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "authorId" TEXT,
    "name" TEXT NOT NULL,
    "note" TEXT,
    "bpmnXml" TEXT NOT NULL,
    "diagramSvg" TEXT,
    "documentation" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProcessRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT,
    "uploadedById" TEXT,
    "kind" "AttachmentKind" NOT NULL DEFAULT 'DOCUMENT',
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "storagePath" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalRequest" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "requestedById" TEXT,
    "title" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ApprovalStep" (
    "id" TEXT NOT NULL,
    "approvalRequestId" TEXT NOT NULL,
    "assigneeId" TEXT,
    "order" INTEGER NOT NULL DEFAULT 0,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "ApprovalStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IsoTemplate" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "standard" TEXT NOT NULL,
    "clause" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "controls" JSONB,

    CONSTRAINT "IsoTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Translation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT,
    "locale" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Translation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CamundaDeployment" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "processNodeId" TEXT NOT NULL,
    "deploymentId" TEXT NOT NULL,
    "processKey" TEXT NOT NULL,
    "deployedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "response" JSONB,

    CONSTRAINT "CamundaDeployment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organization_slug_key" ON "Organization"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "OrganizationUser_userId_idx" ON "OrganizationUser"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "OrganizationUser_organizationId_userId_key" ON "OrganizationUser"("organizationId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Role_organizationId_name_key" ON "Role"("organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Invitation_token_key" ON "Invitation"("token");

-- CreateIndex
CREATE INDEX "Invitation_organizationId_email_idx" ON "Invitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "ProcessNode_organizationId_parentId_sortOrder_idx" ON "ProcessNode"("organizationId", "parentId", "sortOrder");

-- CreateIndex
CREATE INDEX "ProcessRevision_processNodeId_createdAt_idx" ON "ProcessRevision"("processNodeId", "createdAt");

-- CreateIndex
CREATE INDEX "Attachment_organizationId_processNodeId_idx" ON "Attachment"("organizationId", "processNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "IsoTemplate_organizationId_standard_clause_key" ON "IsoTemplate"("organizationId", "standard", "clause");

-- CreateIndex
CREATE INDEX "Translation_locale_key_idx" ON "Translation"("locale", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Translation_organizationId_locale_key_key" ON "Translation"("organizationId", "locale", "key");

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OrganizationUser" ADD CONSTRAINT "OrganizationUser_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Role" ADD CONSTRAINT "Role_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitation" ADD CONSTRAINT "Invitation_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessNode" ADD CONSTRAINT "ProcessNode_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessNode" ADD CONSTRAINT "ProcessNode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessNode" ADD CONSTRAINT "ProcessNode_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRevision" ADD CONSTRAINT "ProcessRevision_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProcessRevision" ADD CONSTRAINT "ProcessRevision_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalRequest" ADD CONSTRAINT "ApprovalRequest_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "ApprovalRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ApprovalStep" ADD CONSTRAINT "ApprovalStep_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IsoTemplate" ADD CONSTRAINT "IsoTemplate_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Translation" ADD CONSTRAINT "Translation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamundaDeployment" ADD CONSTRAINT "CamundaDeployment_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CamundaDeployment" ADD CONSTRAINT "CamundaDeployment_processNodeId_fkey" FOREIGN KEY ("processNodeId") REFERENCES "ProcessNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;
