BEGIN;
-- Standalone project documents share the existing draft and image tables.
ALTER TABLE "RequirementDocumentDraft" ALTER COLUMN "requirementId" DROP NOT NULL;
ALTER TABLE "RequirementDocumentDraft" ADD COLUMN "title" VARCHAR(200), ADD COLUMN "createdById" UUID, ADD COLUMN "createdByName" VARCHAR(200);
CREATE UNIQUE INDEX "RequirementDocumentDraft_projectId_id_key" ON "RequirementDocumentDraft"("projectId", "id");
CREATE INDEX "RequirementDocumentDraft_projectId_updatedAt_idx" ON "RequirementDocumentDraft"("projectId", "updatedAt");
ALTER TABLE "RequirementDocumentDraft" ADD CONSTRAINT "RequirementDocumentDraft_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RequirementDocumentDraft" ADD CONSTRAINT "RequirementDocumentDraft_scope_check" CHECK (("requirementId" IS NULL AND "title" IS NOT NULL AND "createdById" IS NOT NULL AND "createdByName" IS NOT NULL AND "baseRevision" = 0) OR ("requirementId" IS NOT NULL AND "title" IS NULL AND "createdById" IS NULL AND "createdByName" IS NULL AND "baseRevision" > 0));
ALTER TABLE "RequirementDocumentImage" ALTER COLUMN "requirementId" DROP NOT NULL;
ALTER TABLE "RequirementDocumentImage" ADD COLUMN "documentDraftId" UUID;
ALTER TABLE "RequirementDocumentImage" ADD CONSTRAINT "RequirementDocumentImage_projectId_documentDraftId_fkey" FOREIGN KEY ("projectId", "documentDraftId") REFERENCES "RequirementDocumentDraft"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;
ALTER TABLE "RequirementDocumentImage" ADD CONSTRAINT "RequirementDocumentImage_scope_check" CHECK (("requirementId" IS NULL AND "documentDraftId" IS NOT NULL) OR ("requirementId" IS NOT NULL AND "documentDraftId" IS NULL));
CREATE INDEX "RequirementDocumentImage_projectId_documentDraftId_createdAt_idx" ON "RequirementDocumentImage"("projectId", "documentDraftId", "createdAt");
CREATE FUNCTION requirement_document_image_scope() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF NEW."documentDraftId" IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "RequirementDocumentDraft" WHERE id=NEW."documentDraftId" AND "projectId"=NEW."projectId" AND "requirementId" IS NULL) THEN
  RAISE EXCEPTION 'Project image must belong to a standalone project document' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "RequirementDocumentImage_scope" BEFORE INSERT ON "RequirementDocumentImage" FOR EACH ROW EXECUTE FUNCTION requirement_document_image_scope();
-- Keep immutable metadata and referenced-image protection for both document scopes.
CREATE OR REPLACE FUNCTION requirement_document_image_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' THEN
  IF (EXISTS(SELECT 1 FROM "Requirement" WHERE id=OLD."requirementId") OR EXISTS(SELECT 1 FROM "RequirementDocumentDraft" WHERE id=OLD."documentDraftId")) AND (OLD."draftReferenced" OR EXISTS(SELECT 1 FROM "RequirementDocumentVersionImage" WHERE "imageId"=OLD.id)) THEN
   RAISE EXCEPTION 'Referenced document images cannot be deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF (to_jsonb(NEW)-'draftReferenced') IS DISTINCT FROM (to_jsonb(OLD)-'draftReferenced') THEN RAISE EXCEPTION 'Document image metadata is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
COMMIT;
