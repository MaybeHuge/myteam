-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "documentVersionId" UUID;

-- CreateTable
CREATE TABLE "RequirementDocumentDraft" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "content" JSONB NOT NULL,
    "plainText" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "baseRevision" INTEGER NOT NULL,
    "updatedById" UUID NOT NULL,
    "updatedByName" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RequirementDocumentDraft_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDocumentVersion" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "number" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "plainText" TEXT NOT NULL,
    "createdById" UUID NOT NULL,
    "createdByName" VARCHAR(200) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementDocumentVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDocumentImage" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(80) NOT NULL,
    "storageBucket" VARCHAR(63) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "draftReferenced" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementDocumentImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RequirementDocumentVersionImage" (
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "versionId" UUID NOT NULL,
    "imageId" UUID NOT NULL,

    CONSTRAINT "RequirementDocumentVersionImage_pkey" PRIMARY KEY ("versionId","imageId")
);

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentDraft_requirementId_key" ON "RequirementDocumentDraft"("requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentDraft_projectId_requirementId_key" ON "RequirementDocumentDraft"("projectId", "requirementId");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentVersion_projectId_requirementId_id_key" ON "RequirementDocumentVersion"("projectId", "requirementId", "id");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentVersion_requirementId_number_key" ON "RequirementDocumentVersion"("requirementId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentImage_storageKey_key" ON "RequirementDocumentImage"("storageKey");

-- CreateIndex
CREATE INDEX "RequirementDocumentImage_draftReferenced_createdAt_idx" ON "RequirementDocumentImage"("draftReferenced", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementDocumentImage_projectId_requirementId_id_key" ON "RequirementDocumentImage"("projectId", "requirementId", "id");

-- CreateIndex
CREATE INDEX "RequirementDocumentVersionImage_imageId_idx" ON "RequirementDocumentVersionImage"("imageId");

-- AddForeignKey
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_projectId_id_documentVersionId_fkey" FOREIGN KEY ("projectId", "id", "documentVersionId") REFERENCES "RequirementDocumentVersion"("projectId", "requirementId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementDocumentDraft" ADD CONSTRAINT "RequirementDocumentDraft_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementDocumentVersion" ADD CONSTRAINT "RequirementDocumentVersion_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementDocumentImage" ADD CONSTRAINT "RequirementDocumentImage_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementDocumentVersionImage" ADD CONSTRAINT "RequirementDocumentVersionImage_projectId_requirementId_ve_fkey" FOREIGN KEY ("projectId", "requirementId", "versionId") REFERENCES "RequirementDocumentVersion"("projectId", "requirementId", "id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "RequirementDocumentVersionImage" ADD CONSTRAINT "RequirementDocumentVersionImage_projectId_requirementId_im_fkey" FOREIGN KEY ("projectId", "requirementId", "imageId") REFERENCES "RequirementDocumentImage"("projectId", "requirementId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- Applied document versions and stored image bytes are immutable. A new edit creates a new version.
CREATE FUNCTION requirement_document_version_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' AND NOT EXISTS(SELECT 1 FROM "Requirement" WHERE id=OLD."requirementId") THEN RETURN OLD; END IF;
 RAISE EXCEPTION 'Applied document versions are immutable' USING ERRCODE='23514';
END; $$;
CREATE TRIGGER "RequirementDocumentVersion_immutable" BEFORE UPDATE OR DELETE ON "RequirementDocumentVersion" FOR EACH ROW EXECUTE FUNCTION requirement_document_version_immutable();
CREATE FUNCTION requirement_document_image_immutable() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF TG_OP = 'DELETE' THEN
  IF EXISTS(SELECT 1 FROM "Requirement" WHERE id=OLD."requirementId") AND (OLD."draftReferenced" OR EXISTS(SELECT 1 FROM "RequirementDocumentVersionImage" WHERE "imageId"=OLD.id)) THEN
   RAISE EXCEPTION 'Referenced document images cannot be deleted' USING ERRCODE='23514';
  END IF;
  RETURN OLD;
 END IF;
 IF (to_jsonb(NEW)-'draftReferenced') IS DISTINCT FROM (to_jsonb(OLD)-'draftReferenced') THEN RAISE EXCEPTION 'Document image metadata is immutable' USING ERRCODE='23514'; END IF;
 RETURN NEW;
END; $$;
CREATE TRIGGER "RequirementDocumentImage_immutable" BEFORE UPDATE OR DELETE ON "RequirementDocumentImage" FOR EACH ROW EXECUTE FUNCTION requirement_document_image_immutable();
ALTER TABLE "RequirementDocumentImage" ADD CONSTRAINT "RequirementDocumentImage_type_size" CHECK ("contentType" IN ('image/png','image/jpeg','image/webp') AND size > 0 AND size <= 20971520);
