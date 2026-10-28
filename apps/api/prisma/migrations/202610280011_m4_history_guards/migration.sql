-- Keep the first M4 migration immutable and strengthen scope/append constraints incrementally.
ALTER TABLE "TestRunItem" DROP CONSTRAINT "TestRunItem_snapshot_source";
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_snapshot_source" CHECK (coalesce(revision>0 AND snapshot->>'schemaVersion'='1' AND snapshot->>'projectId'="projectId"::text AND snapshot->'source'->>'testCaseId'="testCaseId"::text AND (snapshot->'source'->>'revision')::integer=revision AND jsonb_array_length(snapshot->'content'->'steps')>0,false));
ALTER TABLE "TestRunItem" ADD CONSTRAINT "TestRunItem_revision_scope" FOREIGN KEY ("projectId","testCaseId",revision) REFERENCES "TestCaseRevision"("projectId","testCaseId",revision) ON DELETE CASCADE;
CREATE FUNCTION protect_submission_task_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM "Submission" WHERE id=NEW."submissionId" AND status IN ('DRAFT','RETURNED')) THEN RAISE EXCEPTION 'Submission scope cannot grow after submission' USING ERRCODE='23514'; END IF; RETURN NEW; END; $$;
CREATE TRIGGER "SubmissionTask_frozen_insert" BEFORE INSERT ON "SubmissionTask" FOR EACH ROW EXECUTE FUNCTION protect_submission_task_insert();
CREATE FUNCTION protect_submission_task_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId") AND EXISTS(SELECT 1 FROM "Submission" WHERE id=OLD."submissionId" AND status NOT IN ('DRAFT','RETURNED')) THEN RAISE EXCEPTION 'Submitted task scope cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD; END; $$;
CREATE TRIGGER "SubmissionTask_frozen_delete" BEFORE DELETE ON "SubmissionTask" FOR EACH ROW EXECUTE FUNCTION protect_submission_task_delete();
CREATE FUNCTION check_failure_evidence() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW.outcome='FAILED' AND length(trim(NEW.reason))=0 AND NOT EXISTS(SELECT 1 FROM "DefectTestLink" WHERE "resultId"=NEW.id) THEN RAISE EXCEPTION 'A failed result needs a reason or defect link' USING ERRCODE='23514'; END IF; RETURN NULL; END; $$;
CREATE CONSTRAINT TRIGGER "TestResult_failure_evidence" AFTER INSERT ON "TestResult" DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION check_failure_evidence();
