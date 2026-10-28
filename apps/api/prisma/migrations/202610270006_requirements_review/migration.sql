-- CreateEnum
CREATE TYPE "RequirementStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RequirementType" AS ENUM ('FUNCTIONAL', 'MAINTENANCE');

-- CreateEnum
CREATE TYPE "RequirementPriority" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'URGENT');

-- CreateEnum
CREATE TYPE "RequirementReviewAction" AS ENUM ('SUBMITTED', 'APPROVED', 'RETURNED', 'WITHDRAWN');

-- AlterEnum
ALTER TYPE "CollaborationTargetType" ADD VALUE 'REQUIREMENT';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "requirementSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Requirement" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "type" "RequirementType" NOT NULL DEFAULT 'FUNCTIONAL',
    "priority" "RequirementPriority" NOT NULL DEFAULT 'MEDIUM',
    "description" VARCHAR(10000) NOT NULL DEFAULT '',
    "acceptanceCriteria" VARCHAR(5000) NOT NULL DEFAULT '',
    "ownerId" UUID,
    "reviewerId" UUID,
    "createdById" UUID NOT NULL,
    "status" "RequirementStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewRound" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Requirement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementReview" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "revision" INTEGER NOT NULL,
    "action" "RequirementReviewAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "comment" VARCHAR(2000) NOT NULL DEFAULT '',
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Requirement_projectId_status_priority_updatedAt_idx" ON "Requirement"("projectId", "status", "priority", "updatedAt");

-- CreateIndex
CREATE INDEX "Requirement_ownerId_status_idx" ON "Requirement"("ownerId", "status");

-- CreateIndex
CREATE INDEX "Requirement_reviewerId_status_idx" ON "Requirement"("reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_id_key" ON "Requirement"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Requirement_projectId_number_key" ON "Requirement"("projectId", "number");

-- CreateIndex
CREATE INDEX "RequirementReview_projectId_requirementId_createdAt_idx" ON "RequirementReview"("projectId", "requirementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementReview_requirementId_round_action_key" ON "RequirementReview"("requirementId", "round", "action");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_id_fkey" FOREIGN KEY ("projectId", "id") REFERENCES "WorkItem"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementReview" ADD CONSTRAINT "RequirementReview_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementReview" ADD CONSTRAINT "RequirementReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementReview" ADD CONSTRAINT "RequirementReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 评审证据只追加；结论保存为新记录，不能覆盖提交时的快照。
CREATE FUNCTION requirement_review_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Requirement review records are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER requirement_review_no_update BEFORE UPDATE ON "RequirementReview"
FOR EACH ROW EXECUTE FUNCTION requirement_review_append_only();

ALTER TABLE "Requirement" ADD CONSTRAINT requirement_numbers_valid CHECK (number > 0 AND revision > 0 AND version > 0 AND "reviewRound" >= 0);
ALTER TABLE "RequirementReview" ADD CONSTRAINT requirement_review_numbers_valid CHECK (round > 0 AND revision > 0);

CREATE FUNCTION requirement_work_item_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "WorkItem" WHERE id = NEW.id AND "projectId" = NEW."projectId" AND kind = 'REQUIREMENT') THEN
    RAISE EXCEPTION 'Requirement must extend a same-project REQUIREMENT WorkItem' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER requirement_work_item_kind_guard BEFORE INSERT OR UPDATE OF id, "projectId" ON "Requirement"
FOR EACH ROW EXECUTE FUNCTION requirement_work_item_kind();

CREATE FUNCTION requirement_protect_work_item_kind() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.kind <> 'REQUIREMENT' AND EXISTS (SELECT 1 FROM "Requirement" WHERE id = NEW.id AND "projectId" = NEW."projectId") THEN
    RAISE EXCEPTION 'A requirement WorkItem cannot change kind' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER requirement_protect_work_item_kind_guard BEFORE UPDATE OF kind ON "WorkItem"
FOR EACH ROW EXECUTE FUNCTION requirement_protect_work_item_kind();
