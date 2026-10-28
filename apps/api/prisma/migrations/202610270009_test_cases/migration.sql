-- CreateEnum
CREATE TYPE "TestCaseStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'READY', 'DEPRECATED');

-- AlterEnum
ALTER TYPE "CollaborationTargetType" ADD VALUE 'TEST_CASE';

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "testCaseSequence" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "TestCase" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "preconditions" VARCHAR(5000) NOT NULL DEFAULT '',
    "steps" JSONB NOT NULL,
    "priority" "RequirementPriority" NOT NULL DEFAULT 'MEDIUM',
    "ownerId" UUID,
    "reviewerId" UUID,
    "createdById" UUID NOT NULL,
    "status" "TestCaseStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "approvedRevision" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "reviewRound" INTEGER NOT NULL DEFAULT 0,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "TestCase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementCaseLink" (
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,

    CONSTRAINT "RequirementCaseLink_pkey" PRIMARY KEY ("testCaseId","requirementId")
);

-- CreateTable
CREATE TABLE "TestCaseRevision" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "snapshot" JSONB NOT NULL,
    "requirementBasis" JSONB NOT NULL,
    "reason" VARCHAR(2000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseRevision_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TestCaseReview" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "testCaseId" UUID NOT NULL,
    "revision" INTEGER NOT NULL,
    "round" INTEGER NOT NULL,
    "action" "RequirementReviewAction" NOT NULL,
    "actorId" UUID NOT NULL,
    "reviewerId" UUID NOT NULL,
    "comment" VARCHAR(2000) NOT NULL DEFAULT '',
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TestCaseReview_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TestCase_projectId_status_needsReview_updatedAt_idx" ON "TestCase"("projectId", "status", "needsReview", "updatedAt");

-- CreateIndex
CREATE INDEX "TestCase_ownerId_status_idx" ON "TestCase"("ownerId", "status");

-- CreateIndex
CREATE INDEX "TestCase_reviewerId_status_idx" ON "TestCase"("reviewerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_projectId_id_key" ON "TestCase"("projectId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "TestCase_projectId_number_key" ON "TestCase"("projectId", "number");

-- CreateIndex
CREATE INDEX "RequirementCaseLink_projectId_requirementId_idx" ON "RequirementCaseLink"("projectId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseRevision_testCaseId_revision_key" ON "TestCaseRevision"("testCaseId", "revision");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseRevision_projectId_testCaseId_revision_key" ON "TestCaseRevision"("projectId", "testCaseId", "revision");

-- CreateIndex
CREATE INDEX "TestCaseReview_projectId_testCaseId_createdAt_idx" ON "TestCaseReview"("projectId", "testCaseId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TestCaseReview_testCaseId_round_action_key" ON "TestCaseReview"("testCaseId", "round", "action");

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementCaseLink" ADD CONSTRAINT "RequirementCaseLink_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementCaseLink" ADD CONSTRAINT "RequirementCaseLink_projectId_testCaseId_fkey" FOREIGN KEY ("projectId", "testCaseId") REFERENCES "TestCase"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "TestCaseRevision" ADD CONSTRAINT "TestCaseRevision_projectId_testCaseId_fkey" FOREIGN KEY ("projectId", "testCaseId") REFERENCES "TestCase"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseReview" ADD CONSTRAINT "TestCaseReview_projectId_testCaseId_fkey" FOREIGN KEY ("projectId", "testCaseId") REFERENCES "TestCase"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseReview" ADD CONSTRAINT "TestCaseReview_projectId_testCaseId_revision_fkey" FOREIGN KEY ("projectId", "testCaseId", "revision") REFERENCES "TestCaseRevision"("projectId", "testCaseId", "revision") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseReview" ADD CONSTRAINT "TestCaseReview_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TestCaseReview" ADD CONSTRAINT "TestCaseReview_reviewerId_fkey" FOREIGN KEY ("reviewerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "TestCase" ADD CONSTRAINT "TestCase_revision_state" CHECK (revision > 0 AND version > 0 AND "reviewRound" >= 0 AND ("approvedRevision" IS NULL OR ("approvedRevision" > 0 AND "approvedRevision" <= revision)) AND (status <> 'READY' OR "approvedRevision" = revision));
ALTER TABLE "TestCaseRevision" ADD CONSTRAINT "TestCaseRevision_positive" CHECK (revision > 0 AND jsonb_typeof(snapshot) = 'object' AND jsonb_typeof("requirementBasis") = 'array' AND jsonb_array_length("requirementBasis") > 0);
ALTER TABLE "TestCaseReview" ADD CONSTRAINT "TestCaseReview_positive" CHECK (revision > 0 AND round > 0);
CREATE FUNCTION test_case_history_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Test case history is append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "TestCaseRevision_append_only" BEFORE UPDATE ON "TestCaseRevision" FOR EACH ROW EXECUTE FUNCTION test_case_history_append_only();
CREATE TRIGGER "TestCaseReview_append_only" BEFORE UPDATE ON "TestCaseReview" FOR EACH ROW EXECUTE FUNCTION test_case_history_append_only();
