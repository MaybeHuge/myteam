-- The user requested a fresh lightweight flow without retaining old testing/defect history.
-- Core identity, projects, requirements, tasks, cases, versions and builds remain intact.
ALTER TYPE "RequirementStatus" ADD VALUE IF NOT EXISTS 'TESTING';
ALTER TYPE "CollaborationTargetType" ADD VALUE IF NOT EXISTS 'TEST_RECORD';
ALTER TABLE "Project" ADD COLUMN "testRecordSequence" integer NOT NULL DEFAULT 0;
ALTER TABLE "Requirement" ADD COLUMN "testCycle" integer NOT NULL DEFAULT 1;
TRUNCATE TABLE "DefectDisposition", "DefectTestLink", "Defect", "TestResult", "TestRunItem", "TestRun", "SubmissionReview", "SubmissionTask", "Submission" CASCADE;
DELETE FROM "Notification" WHERE "targetType" IN ('SUBMISSION','TEST_RUN','DEFECT');
DELETE FROM "Comment" WHERE "targetType" IN ('SUBMISSION','TEST_RUN','DEFECT');
-- Storage objects can be collected by the existing storage pruning command.
DELETE FROM "Attachment" WHERE "targetType" IN ('SUBMISSION','TEST_RUN','DEFECT');
DELETE FROM "ActivityLog" WHERE action LIKE 'submission.%' OR action LIKE 'test.%' OR action LIKE 'defect.%';
DELETE FROM "IdempotencyRecord";
UPDATE "Task" SET status='COMPLETED', version=version+1 WHERE status IN ('READY_FOR_TEST','TESTING','ACCEPTING');
UPDATE "WorkItem" SET resolution='DONE' WHERE id IN (SELECT id FROM "Task" WHERE status='COMPLETED');
UPDATE "Requirement" r SET status=CASE
 WHEN EXISTS(SELECT 1 FROM "Task" t WHERE t."requirementId"=r.id AND t.status<>'CANCELLED')
  AND NOT EXISTS(SELECT 1 FROM "Task" t WHERE t."requirementId"=r.id AND t.status NOT IN ('COMPLETED','CANCELLED')) THEN 'ACCEPTING'::"RequirementStatus"
 WHEN EXISTS(SELECT 1 FROM "Task" t WHERE t."requirementId"=r.id AND t.status IN ('IN_PROGRESS','COMPLETED')) THEN 'IMPLEMENTING'::"RequirementStatus"
 ELSE 'CONFIRMED'::"RequirementStatus" END, version=version+1
 WHERE r.status IN ('CONFIRMED','IMPLEMENTING','ACCEPTING','COMPLETED');
UPDATE "WorkItem" SET resolution='OPEN' WHERE id IN (SELECT id FROM "Requirement" WHERE status<>'CANCELLED');
ALTER TABLE "Defect" ALTER COLUMN "foundBuildId" DROP NOT NULL, ALTER COLUMN "releaseId" DROP NOT NULL, ALTER COLUMN "targetReleaseId" DROP NOT NULL;
CREATE TYPE "TestRecordOutcome" AS ENUM ('NOT_RUN','PASSED','FAILED');
CREATE TYPE "TestRecordType" AS ENUM ('INITIAL','RETEST');
CREATE TABLE "TestRecord" (
 id uuid PRIMARY KEY, "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
 number integer NOT NULL, "testCaseId" uuid NOT NULL, "caseRevision" integer NOT NULL,
 "requirementId" uuid NOT NULL, "requirementRevision" integer NOT NULL, cycle integer NOT NULL,
 type "TestRecordType" NOT NULL DEFAULT 'INITIAL', outcome "TestRecordOutcome" NOT NULL DEFAULT 'NOT_RUN',
 snapshot jsonb NOT NULL, "buildId" uuid, environment varchar(2000) NOT NULL,
 actual varchar(5000) NOT NULL DEFAULT '', evidence varchar(5000) NOT NULL DEFAULT '',
 "attachmentIds" jsonb NOT NULL DEFAULT '[]', "executorId" uuid NOT NULL REFERENCES "User"(id),
 version integer NOT NULL DEFAULT 1, "createdAt" timestamptz(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "completedAt" timestamptz(3),
 UNIQUE("projectId",id), UNIQUE("projectId",number),
 FOREIGN KEY("projectId","testCaseId") REFERENCES "TestCase"("projectId",id),
 FOREIGN KEY("projectId","requirementId") REFERENCES "Requirement"("projectId",id),
 FOREIGN KEY("projectId","buildId") REFERENCES "Build"("projectId",id),
 CHECK ("caseRevision">0 AND "requirementRevision">0 AND cycle>0),
 CHECK ((outcome='NOT_RUN' AND "completedAt" IS NULL) OR (outcome<>'NOT_RUN' AND "completedAt" IS NOT NULL AND length(trim(actual))>0)),
 CHECK (snapshot->'source'->>'testCaseId'="testCaseId"::text AND (snapshot->'source'->>'revision')::integer="caseRevision")
);
CREATE INDEX "TestRecord_projectId_requirementId_cycle_testCaseId_createdAt_idx" ON "TestRecord"("projectId","requirementId",cycle,"testCaseId","createdAt");
CREATE INDEX "TestRecord_projectId_testCaseId_createdAt_idx" ON "TestRecord"("projectId","testCaseId","createdAt");
CREATE INDEX "TestRecord_executorId_outcome_idx" ON "TestRecord"("executorId",outcome);
CREATE UNIQUE INDEX "TestRecord_one_pending" ON "TestRecord"("projectId","requirementId",cycle,"testCaseId") WHERE outcome='NOT_RUN';
CREATE TABLE "DefectCaseLink" (
 id uuid PRIMARY KEY, "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
 "defectId" uuid NOT NULL, "testCaseId" uuid NOT NULL, UNIQUE("defectId","testCaseId"),
 FOREIGN KEY("projectId","defectId") REFERENCES "Defect"("projectId",id) ON DELETE CASCADE,
 FOREIGN KEY("projectId","testCaseId") REFERENCES "TestCase"("projectId",id)
);
CREATE TABLE "DefectRecordLink" (
 id uuid PRIMARY KEY, "projectId" uuid NOT NULL REFERENCES "Project"(id) ON DELETE CASCADE,
 "defectId" uuid NOT NULL, "testRecordId" uuid NOT NULL, UNIQUE("defectId","testRecordId"),
 FOREIGN KEY("projectId","defectId") REFERENCES "Defect"("projectId",id) ON DELETE CASCADE,
 FOREIGN KEY("projectId","testRecordId") REFERENCES "TestRecord"("projectId",id)
);
CREATE FUNCTION protect_test_record() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF OLD.outcome<>'NOT_RUN' OR (NEW."projectId",NEW."testCaseId",NEW."caseRevision",NEW."requirementId",NEW."requirementRevision",NEW.cycle,NEW.snapshot,NEW."buildId",NEW.environment,NEW."executorId",NEW.type,NEW."createdAt",NEW.number) IS DISTINCT FROM (OLD."projectId",OLD."testCaseId",OLD."caseRevision",OLD."requirementId",OLD."requirementRevision",OLD.cycle,OLD.snapshot,OLD."buildId",OLD.environment,OLD."executorId",OLD.type,OLD."createdAt",OLD.number) THEN RAISE EXCEPTION 'Test evidence is immutable; create another record' USING ERRCODE='23514'; END IF;
 RETURN NEW; END; $$;
CREATE TRIGGER "TestRecord_frozen" BEFORE UPDATE ON "TestRecord" FOR EACH ROW EXECUTE FUNCTION protect_test_record();

ALTER TABLE "Defect" DROP CONSTRAINT "Defect_positive";
ALTER TABLE "Defect" ADD CONSTRAINT "Defect_positive" CHECK (version>0 AND number>0 AND source IN ('TESTING','PRODUCTION') AND id IS DISTINCT FROM "duplicateOfId" AND (status<>'DUPLICATE' OR "duplicateOfId" IS NOT NULL) AND (status<>'DEFERRED' OR severity IN ('MINOR','TRIVIAL')));
