-- CreateEnum
CREATE TYPE "IterationStatus" AS ENUM ('PLANNING', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "WorkItemKind" AS ENUM ('REQUIREMENT', 'TASK');

-- CreateEnum
CREATE TYPE "WorkItemResolution" AS ENUM ('OPEN', 'DONE', 'CANCELED');

-- CreateTable
CREATE TABLE "Iteration" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "goal" VARCHAR(2000) NOT NULL DEFAULT '',
    "ownerId" UUID NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "status" "IterationStatus" NOT NULL DEFAULT 'PLANNING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),
    "closeSummary" VARCHAR(2000),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Iteration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "iterationId" UUID,
    "kind" "WorkItemKind" NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "resolution" "WorkItemResolution" NOT NULL DEFAULT 'OPEN',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Iteration_projectId_status_startDate_idx" ON "Iteration"("projectId", "status", "startDate");

-- CreateIndex
CREATE INDEX "Iteration_ownerId_status_idx" ON "Iteration"("ownerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Iteration_projectId_id_key" ON "Iteration"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Iteration_projectId_name_key" ON "Iteration"("projectId", "name");

-- CreateIndex
CREATE INDEX "WorkItem_projectId_iterationId_resolution_idx" ON "WorkItem"("projectId", "iterationId", "resolution");

-- CreateIndex
CREATE UNIQUE INDEX "WorkItem_projectId_id_key" ON "WorkItem"("projectId", "id");

-- AddForeignKey
ALTER TABLE "Iteration" ADD CONSTRAINT "Iteration_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Iteration" ADD CONSTRAINT "Iteration_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkItem" ADD CONSTRAINT "WorkItem_projectId_iterationId_fkey" FOREIGN KEY ("projectId", "iterationId") REFERENCES "Iteration"("projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;
