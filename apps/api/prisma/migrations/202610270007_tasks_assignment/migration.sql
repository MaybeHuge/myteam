-- CreateEnum
CREATE TYPE "TaskStatus" AS ENUM ('TODO', 'IN_PROGRESS', 'READY_FOR_TEST', 'TESTING', 'ACCEPTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TaskPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- AlterEnum
ALTER TYPE "CollaborationTargetType" ADD VALUE 'TASK';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "taskSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Task" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "priority" "TaskPriority" NOT NULL DEFAULT 'MEDIUM',
    "assigneeId" UUID,
    "createdById" UUID NOT NULL,
    "estimatedHours" DECIMAL(8,2),
    "dueDate" DATE,
    "status" "TaskStatus" NOT NULL DEFAULT 'TODO',
    "version" INTEGER NOT NULL DEFAULT 1,
    "startedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Task_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Task_projectId_status_priority_updatedAt_idx" ON "Task"("projectId", "status", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "Task_projectId_requirementId_idx" ON "Task"("projectId", "requirementId");

-- CreateIndex
CREATE INDEX "Task_assigneeId_status_dueDate_idx" ON "Task"("assigneeId", "status", "dueDate");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_id_key" ON "Task"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Task_projectId_number_key" ON "Task"("projectId", "number");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_id_fkey" FOREIGN KEY ("projectId", "id") REFERENCES "WorkItem"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A task extends the shared planning item and must keep its kind.
ALTER TABLE "Task" ADD CONSTRAINT "Task_positive_numbers" CHECK (number > 0 AND version > 0);
ALTER TABLE "Task" ADD CONSTRAINT "Task_estimate_quarters" CHECK ("estimatedHours" IS NULL OR ("estimatedHours" >= 0 AND "estimatedHours" <= 10000 AND mod("estimatedHours" * 4, 1) = 0));
CREATE FUNCTION task_work_item_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WorkItem" WHERE id = NEW.id AND "projectId" = NEW."projectId" AND kind = 'TASK') THEN
    RAISE EXCEPTION 'Task requires a same-project TASK WorkItem' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_work_item_kind" BEFORE INSERT OR UPDATE OF id, "projectId" ON "Task" FOR EACH ROW EXECUTE FUNCTION task_work_item_kind();
CREATE FUNCTION task_protect_work_item_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'TASK' AND EXISTS (SELECT 1 FROM "Task" WHERE id = OLD.id) THEN
    RAISE EXCEPTION 'A task WorkItem cannot change kind' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "Task_protect_kind" BEFORE UPDATE OF kind ON "WorkItem" FOR EACH ROW EXECUTE FUNCTION task_protect_work_item_kind();
