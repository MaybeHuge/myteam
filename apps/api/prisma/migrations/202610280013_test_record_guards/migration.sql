DROP INDEX "TestRecord_one_pending";
CREATE UNIQUE INDEX "TestRecord_one_pending" ON "TestRecord"("projectId","requirementId",cycle,"testCaseId","caseRevision") WHERE outcome='NOT_RUN';
CREATE FUNCTION test_record_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM "Project" WHERE id=OLD."projectId") THEN RAISE EXCEPTION 'Test records cannot be deleted' USING ERRCODE='23514'; END IF; RETURN OLD; END; $$;
CREATE TRIGGER "TestRecord_no_delete" BEFORE DELETE ON "TestRecord" FOR EACH ROW EXECUTE FUNCTION test_record_no_delete();
