CREATE TABLE "ReleaseEvent" (
  "sequence" BIGSERIAL NOT NULL,
  "id" UUID NOT NULL,
  "projectId" UUID NOT NULL,
  "releaseId" UUID NOT NULL,
  "buildId" UUID NOT NULL,
  "publishId" UUID,
  "kind" VARCHAR(32) NOT NULL,
  "notes" VARCHAR(5000) NOT NULL DEFAULT '',
  "occurredAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "actorId" UUID NOT NULL,
  "checkSnapshot" JSONB,
  CONSTRAINT "ReleaseEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ReleaseEvent_kind_check" CHECK ("kind" IN ('PUBLISH_SUCCESS', 'PUBLISH_FAILED', 'VERIFY_PASSED', 'VERIFY_FAILED', 'ROLLBACK')),
  CONSTRAINT "ReleaseEvent_parent_check" CHECK (("kind" IN ('PUBLISH_SUCCESS', 'PUBLISH_FAILED') AND "publishId" IS NULL) OR ("kind" IN ('VERIFY_PASSED', 'VERIFY_FAILED', 'ROLLBACK') AND "publishId" IS NOT NULL))
);
CREATE UNIQUE INDEX "ReleaseEvent_sequence_key" ON "ReleaseEvent"("sequence");
CREATE UNIQUE INDEX "ReleaseEvent_projectId_id_key" ON "ReleaseEvent"("projectId", "id");
CREATE INDEX "ReleaseEvent_projectId_releaseId_createdAt_idx" ON "ReleaseEvent"("projectId", "releaseId", "createdAt");
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_release_scope" FOREIGN KEY ("projectId", "releaseId") REFERENCES "Release"("projectId", "id") ON DELETE CASCADE;
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_build_scope" FOREIGN KEY ("projectId", "buildId") REFERENCES "Build"("projectId", "id") ON DELETE CASCADE;
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_publish_scope" FOREIGN KEY ("projectId", "publishId") REFERENCES "ReleaseEvent"("projectId", "id") ON DELETE CASCADE;
ALTER TABLE "ReleaseEvent" ADD CONSTRAINT "ReleaseEvent_actor_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT;
CREATE FUNCTION release_event_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'UPDATE' THEN RAISE EXCEPTION 'Release events cannot be updated' USING ERRCODE = '23514'; END IF;
 IF EXISTS (SELECT 1 FROM "Project" WHERE id = OLD."projectId") THEN RAISE EXCEPTION 'Release events cannot be deleted' USING ERRCODE = '23514'; END IF;
 RETURN OLD;
END; $$;
CREATE TRIGGER "ReleaseEvent_immutable" BEFORE UPDATE OR DELETE ON "ReleaseEvent" FOR EACH ROW EXECUTE FUNCTION release_event_immutable();
