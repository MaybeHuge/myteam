-- CreateEnum
CREATE TYPE "ReleaseStatus" AS ENUM ('PLANNING', 'DEVELOPING', 'TESTING', 'READY', 'RELEASED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "SubmissionStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'ACCEPTED', 'TESTING', 'COMPLETED', 'RETURNED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TestOutcome" AS ENUM ('PASSED', 'FAILED', 'BLOCKED', 'NOT_APPLICABLE');

-- CreateEnum
CREATE TYPE "DefectStatus" AS ENUM ('UNCONFIRMED', 'OPEN', 'FIXING', 'AWAITING_RETEST', 'CLOSED', 'DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE', 'DEFERRED');

-- CreateEnum
CREATE TYPE "DefectSeverity" AS ENUM ('CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CollaborationTargetType" ADD VALUE 'SUBMISSION';
ALTER TYPE "CollaborationTargetType" ADD VALUE 'TEST_RUN';
ALTER TYPE "CollaborationTargetType" ADD VALUE 'DEFECT';
ALTER TYPE "CollaborationTargetType" ADD VALUE 'RELEASE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "defectSequence" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "submissionSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Release" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "name" VARCHAR(100) NOT NULL,
    "description" VARCHAR(5000) NOT NULL DEFAULT '',
    "status" "ReleaseStatus" NOT NULL DEFAULT 'PLANNING',
    "scopeVersion" INTEGER NOT NULL DEFAULT 1,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Release_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ReleaseItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "workItemId" UUID NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "ReleaseItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Build" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "identifier" VARCHAR(100) NOT NULL,
    "codeUrl" VARCHAR(2000) NOT NULL DEFAULT '',
    "artifactUrl" VARCHAR(2000) NOT NULL DEFAULT '',
    "notes" VARCHAR(5000) NOT NULL DEFAULT '',
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Build_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Submission" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "releaseId" UUID NOT NULL,
    "buildId" UUID NOT NULL,
    "receiverId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "environment" VARCHAR(2000) NOT NULL,
    "selfTest" VARCHAR(5000) NOT NULL,
    "changes" VARCHAR(5000) NOT NULL,
    "status" "SubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "round" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 1,
    "scopeVersion" INTEGER NOT NULL,
    "requirementBasis" JSONB NOT NULL,
    "scopeSnapshot" JSONB NOT NULL,
    "acceptedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Submission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionTask" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "taskId" UUID NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SubmissionTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SubmissionReview" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "round" INTEGER NOT NULL,
    "action" VARCHAR(30) NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" VARCHAR(5000) NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubmissionReview_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRun" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "submissionId" UUID NOT NULL,
    "buildId" UUID NOT NULL,
    "executorId" UUID NOT NULL,
    "status" "TestRunStatus" NOT NULL DEFAULT 'PENDING',
    "version" INTEGER NOT NULL DEFAULT 1,
    "passed" BOOLEAN,
    "summary" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMPTZ(3),

    CONSTRAINT "TestRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestRunItem" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "runId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestRunItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestResult" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "itemId" UUID NOT NULL,
    "attempt" INTEGER NOT NULL,
    "outcome" "TestOutcome" NOT NULL,
    "actual" VARCHAR(5000) NOT NULL,
    "reason" VARCHAR(5000) NOT NULL,
    "evidence" VARCHAR(5000) NOT NULL,
    "attachmentIds" JSONB NOT NULL,
    "actorId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Defect" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "reproduction" VARCHAR(10000) NOT NULL,
    "expected" VARCHAR(5000) NOT NULL,
    "actual" VARCHAR(5000) NOT NULL,
    "environment" VARCHAR(2000) NOT NULL,
    "source" VARCHAR(20) NOT NULL,
    "severity" "DefectSeverity" NOT NULL,
    "status" "DefectStatus" NOT NULL DEFAULT 'UNCONFIRMED',
    "requirementId" UUID NOT NULL,
    "taskId" UUID,
    "foundBuildId" UUID NOT NULL,
    "releaseId" UUID NOT NULL,
    "targetReleaseId" UUID NOT NULL,
    "fixedBuildId" UUID,
    "duplicateOfId" UUID,
    "assigneeId" UUID NOT NULL,
    "retesterId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "deferUntil" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Defect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectTestLink" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "resultId" UUID NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefectTestLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DefectDisposition" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "defectId" UUID NOT NULL,
    "action" VARCHAR(40) NOT NULL,
    "fromStatus" "DefectStatus" NOT NULL,
    "toStatus" "DefectStatus" NOT NULL,
    "actorId" UUID NOT NULL,
    "reason" VARCHAR(5000) NOT NULL,
    "evidence" VARCHAR(5000) NOT NULL,
    "buildId" UUID,
    "resultId" UUID,
    "details" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DefectDisposition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Release_projectId_id_key" ON "Release"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Release_projectId_name_key" ON "Release"("projectId", "name");

-- CreateIndex
CREATE INDEX "ReleaseItem_projectId_workItemId_active_idx" ON "ReleaseItem"("projectId", "workItemId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ReleaseItem_releaseId_scopeVersion_workItemId_key" ON "ReleaseItem"("releaseId", "scopeVersion", "workItemId");

-- CreateIndex
CREATE INDEX "Build_projectId_releaseId_createdAt_idx" ON "Build"("projectId", "releaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Build_projectId_id_key" ON "Build"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Build_projectId_identifier_key" ON "Build"("projectId", "identifier");

-- CreateIndex
CREATE INDEX "Submission_receiverId_status_idx" ON "Submission"("receiverId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_projectId_id_key" ON "Submission"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Submission_projectId_number_key" ON "Submission"("projectId", "number");

-- CreateIndex
CREATE INDEX "SubmissionTask_projectId_taskId_active_idx" ON "SubmissionTask"("projectId", "taskId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionTask_submissionId_taskId_key" ON "SubmissionTask"("submissionId", "taskId");

-- CreateIndex
CREATE UNIQUE INDEX "SubmissionReview_submissionId_round_action_key" ON "SubmissionReview"("submissionId", "round", "action");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_submissionId_key" ON "TestRun"("submissionId");

-- CreateIndex
CREATE INDEX "TestRun_executorId_status_idx" ON "TestRun"("executorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestRun_projectId_id_key" ON "TestRun"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunItem_projectId_id_key" ON "TestRunItem"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TestRunItem_runId_testCaseId_key" ON "TestRunItem"("runId", "testCaseId");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_projectId_id_key" ON "TestResult"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TestResult_itemId_attempt_key" ON "TestResult"("itemId", "attempt");

-- CreateIndex
CREATE INDEX "Defect_assigneeId_status_idx" ON "Defect"("assigneeId", "status");

-- CreateIndex
CREATE INDEX "Defect_retesterId_status_idx" ON "Defect"("retesterId", "status");

-- CreateIndex
CREATE INDEX "Defect_projectId_releaseId_severity_status_idx" ON "Defect"("projectId", "releaseId", "severity", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_projectId_id_key" ON "Defect"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "Defect_projectId_number_key" ON "Defect"("projectId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "DefectTestLink_defectId_resultId_key" ON "DefectTestLink"("defectId", "resultId");

-- AddForeignKey
ALTER TABLE "Release" ADD CONSTRAINT "Release_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Build" ADD CONSTRAINT "Build_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionTask" ADD CONSTRAINT "SubmissionTask_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubmissionTask" ADD CONSTRAINT "SubmissionTask_projectId_taskId_fkey" FOREIGN KEY ("projectId", "taskId") REFERENCES "Task"("projectId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "SubmissionReview" ADD CONSTRAINT "SubmissionReview_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectTestLink" ADD CONSTRAINT "DefectTestLink_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DefectDisposition" ADD CONSTRAINT "DefectDisposition_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Project-scoped references, including associations managed explicitly by the services.
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_releaseId_scope" FOREIGN KEY ("projectId","releaseId") REFERENCES "Release"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "ReleaseItem" ADD CONSTRAINT "ReleaseItem_workItemId_scope" FOREIGN KEY ("projectId","workItemId") REFERENCES "WorkItem"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Build" ADD CONSTRAINT "Build_releaseId_scope" FOREIGN KEY ("projectId","releaseId") REFERENCES "Release"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_releaseId_scope" FOREIGN KEY ("projectId","releaseId") REFERENCES "Release"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_buildId_scope" FOREIGN KEY ("projectId","buildId") REFERENCES "Build"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "SubmissionTask" ADD CONSTRAINT "SubmissionTask_submissionId_scope" FOREIGN KEY ("projectId","submissionId") REFERENCES "Submission"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "SubmissionReview" ADD CONSTRAINT "SubmissionReview_submissionId_scope" FOREIGN KEY ("projectId","submissionId") REFERENCES "Submission"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_submissionId_scope" FOREIGN KEY ("projectId","submissionId") REFERENCES "Submission"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_buildId_scope" FOREIGN KEY ("projectId","buildId") REFERENCES "Build"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_runId_scope" FOREIGN KEY ("projectId","runId") REFERENCES "TestRun"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_testCaseId_scope" FOREIGN KEY ("projectId","testCaseId") REFERENCES "TestCase"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_itemId_scope" FOREIGN KEY ("projectId","itemId") REFERENCES "TestRunItem"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_requirementId_scope" FOREIGN KEY ("projectId","requirementId") REFERENCES "Requirement"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_taskId_scope" FOREIGN KEY ("projectId","taskId") REFERENCES "Task"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_foundBuildId_scope" FOREIGN KEY ("projectId","foundBuildId") REFERENCES "Build"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_fixedBuildId_scope" FOREIGN KEY ("projectId","fixedBuildId") REFERENCES "Build"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_releaseId_scope" FOREIGN KEY ("projectId","releaseId") REFERENCES "Release"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_targetReleaseId_scope" FOREIGN KEY ("projectId","targetReleaseId") REFERENCES "Release"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_duplicateOfId_scope" FOREIGN KEY ("projectId","duplicateOfId") REFERENCES "Defect"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "DefectTestLink" ADD CONSTRAINT "DefectTestLink_defectId_scope" FOREIGN KEY ("projectId","defectId") REFERENCES "Defect"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "DefectTestLink" ADD CONSTRAINT "DefectTestLink_resultId_scope" FOREIGN KEY ("projectId","resultId") REFERENCES "TestResult"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "DefectDisposition" ADD CONSTRAINT "DefectDisposition_defectId_scope" FOREIGN KEY ("projectId","defectId") REFERENCES "Defect"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "DefectDisposition" ADD CONSTRAINT "DefectDisposition_buildId_scope" FOREIGN KEY ("projectId","buildId") REFERENCES "Build"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "DefectDisposition" ADD CONSTRAINT "DefectDisposition_resultId_scope" FOREIGN KEY ("projectId","resultId") REFERENCES "TestResult"("projectId",id) ON DELETE CASCADE;
ALTER TABLE "Release" ADD CONSTRAINT "Release_createdById_user" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Build" ADD CONSTRAINT "Build_createdById_user" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_receiverId_user" FOREIGN KEY ("receiverId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_createdById_user" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "SubmissionReview" ADD CONSTRAINT "SubmissionReview_actorId_user" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_executorId_user" FOREIGN KEY ("executorId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_actorId_user" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_assigneeId_user" FOREIGN KEY ("assigneeId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_retesterId_user" FOREIGN KEY ("retesterId") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_createdById_user" FOREIGN KEY ("createdById") REFERENCES "User"(id) ON DELETE RESTRICT;
ALTER TABLE "DefectDisposition" ADD CONSTRAINT "DefectDisposition_actorId_user" FOREIGN KEY ("actorId") REFERENCES "User"(id) ON DELETE RESTRICT;

CREATE UNIQUE INDEX "SubmissionTask_one_active" ON "SubmissionTask"("projectId","taskId") WHERE active;
CREATE UNIQUE INDEX "ReleaseItem_one_active" ON "ReleaseItem"("projectId","workItemId") WHERE active;
ALTER TABLE "Release" ADD CONSTRAINT "Release_positive" CHECK (version>0 AND "scopeVersion">0);
ALTER TABLE "Submission" ADD CONSTRAINT "Submission_positive" CHECK (version>0 AND round>=0 AND jsonb_typeof("requirementBasis")='array');
ALTER TABLE "TestRun" ADD CONSTRAINT "TestRun_positive" CHECK (version>0 AND (status<>'COMPLETED' OR (passed IS NOT NULL AND "completedAt" IS NOT NULL)));
ALTER TABLE "TestResult" ADD CONSTRAINT "TestResult_complete" CHECK (attempt>0 AND length(trim(actual))>0 AND length(trim(evidence))>0 AND jsonb_typeof("attachmentIds")='array' AND (outcome NOT IN ('BLOCKED','NOT_APPLICABLE') OR length(trim(reason))>0));
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_positive" CHECK (version>0 AND number>0 AND source IN ('TESTING','PRODUCTION') AND id IS DISTINCT FROM "duplicateOfId" AND (status<>'AWAITING_RETEST' OR "fixedBuildId" IS NOT NULL) AND (status<>'DUPLICATE' OR "duplicateOfId" IS NOT NULL) AND (status<>'DEFERRED' OR severity IN ('MINOR','TRIVIAL')));
CREATE FUNCTION quality_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Quality history is append-only' USING ERRCODE='23514'; END; $$;
CREATE TRIGGER "Build_append_only" BEFORE UPDATE ON "Build" FOR EACH ROW EXECUTE FUNCTION quality_history_append_only();
CREATE TRIGGER "SubmissionReview_append_only" BEFORE UPDATE ON "SubmissionReview" FOR EACH ROW EXECUTE FUNCTION quality_history_append_only();
CREATE TRIGGER "TestResult_append_only" BEFORE UPDATE ON "TestResult" FOR EACH ROW EXECUTE FUNCTION quality_history_append_only();
CREATE TRIGGER "DefectDisposition_append_only" BEFORE UPDATE ON "DefectDisposition" FOR EACH ROW EXECUTE FUNCTION quality_history_append_only();
CREATE TRIGGER "DefectTestLink_append_only" BEFORE UPDATE ON "DefectTestLink" FOR EACH ROW EXECUTE FUNCTION quality_history_append_only();

CREATE FUNCTION protect_test_item() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' THEN RAISE EXCEPTION 'Test execution snapshots are immutable' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM "TestRun" WHERE id=OLD."runId" AND status<>'PENDING') THEN RAISE EXCEPTION 'Started execution items cannot be deleted' USING ERRCODE='23514'; END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER "TestRunItem_immutable" BEFORE UPDATE ON "TestRunItem" FOR EACH ROW EXECUTE FUNCTION protect_test_item();
CREATE FUNCTION protect_accepted_submission() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.status IN ('ACCEPTED','TESTING','COMPLETED') AND
  (NEW."releaseId",NEW."buildId",NEW."receiverId",NEW.environment,NEW."selfTest",NEW.changes,NEW."scopeVersion",NEW."scopeSnapshot",NEW."requirementBasis") IS DISTINCT FROM
  (OLD."releaseId",OLD."buildId",OLD."receiverId",OLD.environment,OLD."selfTest",OLD.changes,OLD."scopeVersion",OLD."scopeSnapshot",OLD."requirementBasis")
 THEN RAISE EXCEPTION 'Accepted submission scope is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "Submission_frozen_scope" BEFORE UPDATE ON "Submission" FOR EACH ROW EXECUTE FUNCTION protect_accepted_submission();

CREATE FUNCTION quality_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId") THEN RAISE EXCEPTION 'Quality history cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD; END; $$;
CREATE TRIGGER "Build_no_delete" BEFORE DELETE ON "Build" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "TestRunItem_no_delete" BEFORE DELETE ON "TestRunItem" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "TestResult_no_delete" BEFORE DELETE ON "TestResult" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "SubmissionReview_no_delete" BEFORE DELETE ON "SubmissionReview" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "DefectDisposition_no_delete" BEFORE DELETE ON "DefectDisposition" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "DefectTestLink_no_delete" BEFORE DELETE ON "DefectTestLink" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();
CREATE TRIGGER "ReleaseItem_no_delete" BEFORE DELETE ON "ReleaseItem" FOR EACH ROW EXECUTE FUNCTION quality_no_delete();

ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_snapshot_source" CHECK (revision>0 AND snapshot->>'schemaVersion'='1' AND snapshot->>'projectId'="projectId"::text AND snapshot->'source'->>'testCaseId'="testCaseId"::text AND (snapshot->'source'->>'revision')::integer=revision AND jsonb_array_length(snapshot->'content'->'steps')>0);
CREATE FUNCTION protect_run_context() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.status IN ('COMPLETED','CANCELLED') OR (NEW."buildId",NEW."submissionId",NEW."projectId") IS DISTINCT FROM (OLD."buildId",OLD."submissionId",OLD."projectId") THEN RAISE EXCEPTION 'Execution context and completed batches are immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "TestRun_frozen_context" BEFORE UPDATE ON "TestRun" FOR EACH ROW EXECUTE FUNCTION protect_run_context();
CREATE FUNCTION protect_submission_task_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF (NEW."projectId",NEW."taskId",NEW."submissionId") IS DISTINCT FROM (OLD."projectId",OLD."taskId",OLD."submissionId") THEN RAISE EXCEPTION 'Submission task identity is immutable' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "SubmissionTask_identity" BEFORE UPDATE ON "SubmissionTask" FOR EACH ROW EXECUTE FUNCTION protect_submission_task_scope();
