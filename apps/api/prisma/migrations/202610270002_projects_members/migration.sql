-- CreateEnum
CREATE TYPE "ProjectRole" AS ENUM ('OWNER', 'PRODUCT', 'DEVELOPER', 'TESTER', 'RELEASE_MANAGER', 'VIEWER');

-- CreateEnum
CREATE TYPE "ProjectStatus" AS ENUM ('PENDING', 'ACTIVE', 'PAUSED', 'ACCEPTING', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "projectId" UUID;

-- CreateTable
CREATE TABLE "Project" (
    "id" UUID NOT NULL,
    "key" VARCHAR(12) NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "description" VARCHAR(2000) NOT NULL DEFAULT '',
    "color" VARCHAR(20) NOT NULL DEFAULT 'teal',
    "icon" VARCHAR(20) NOT NULL DEFAULT 'layers',
    "status" "ProjectStatus" NOT NULL DEFAULT 'PENDING',
    "ownerId" UUID NOT NULL,
    "startDate" DATE,
    "endDate" DATE,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Project_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProjectMember" (
    "projectId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "roles" "ProjectRole"[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "joinedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProjectMember_pkey" PRIMARY KEY ("projectId","userId")
);

-- CreateIndex
CREATE UNIQUE INDEX "Project_key_key" ON "Project"("key");

-- CreateIndex
CREATE INDEX "Project_ownerId_status_idx" ON "Project"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Project_status_updatedAt_idx" ON "Project"("status", "updatedAt");

-- CreateIndex
CREATE INDEX "ProjectMember_userId_projectId_idx" ON "ProjectMember"("userId", "projectId");

-- CreateIndex
CREATE INDEX "ActivityLog_projectId_createdAt_idx" ON "ActivityLog"("projectId", "createdAt");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProjectMember" ADD CONSTRAINT "ProjectMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

