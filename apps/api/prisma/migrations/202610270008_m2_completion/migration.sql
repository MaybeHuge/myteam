-- AlterTable
ALTER TABLE "Requirement" ADD COLUMN     "acceptedRevision" INTEGER,
ADD COLUMN     "scopeVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "basisRevision" INTEGER,
ADD COLUMN     "blocked" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "blockedAt" TIMESTAMPTZ(3),
ADD COLUMN     "blockedReason" VARCHAR(2000) NOT NULL DEFAULT '',
ADD COLUMN     "helperId" UUID;

-- CreateTable
CREATE TABLE "RequirementChange" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "requirementId" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "fromRevision" INTEGER NOT NULL,
    "toRevision" INTEGER NOT NULL,
    "scopeVersion" INTEGER NOT NULL,
    "reason" VARCHAR(500) NOT NULL,
    "impact" VARCHAR(2000) NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "affectedTaskIds" JSONB NOT NULL,
    "effects" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RequirementChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RequirementChange_projectId_requirementId_createdAt_idx" ON "RequirementChange"("projectId", "requirementId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "RequirementChange_requirementId_scopeVersion_key" ON "RequirementChange"("requirementId", "scopeVersion");

-- AddForeignKey
ALTER TABLE "Task" ADD CONSTRAINT "Task_helperId_fkey" FOREIGN KEY ("helperId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementChange" ADD CONSTRAINT "RequirementChange_projectId_requirementId_fkey" FOREIGN KEY ("projectId", "requirementId") REFERENCES "Requirement"("projectId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RequirementChange" ADD CONSTRAINT "RequirementChange_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill accepted bases without rewriting historical reviews.
UPDATE "Requirement" r SET "acceptedRevision" = approved.revision
FROM (SELECT DISTINCT ON ("requirementId") "requirementId", revision FROM "RequirementReview" WHERE action = 'APPROVED' ORDER BY "requirementId", round DESC) approved
WHERE r.id = approved."requirementId";
UPDATE "Task" t SET "basisRevision" = r."acceptedRevision" FROM "Requirement" r WHERE t."requirementId" = r.id AND t."startedAt" IS NOT NULL;
ALTER TABLE "Requirement" ADD CONSTRAINT "Requirement_scope_version" CHECK ("scopeVersion" >= 0 AND ("acceptedRevision" IS NULL OR "acceptedRevision" > 0));
ALTER TABLE "Task" ADD CONSTRAINT "Task_blocking_details" CHECK ((blocked AND "helperId" IS NOT NULL AND length(trim("blockedReason")) > 0 AND "blockedAt" IS NOT NULL) OR (NOT blocked AND "helperId" IS NULL AND "blockedReason" = '' AND "blockedAt" IS NULL));
ALTER TABLE "RequirementChange" ADD CONSTRAINT "RequirementChange_revision_order" CHECK ("fromRevision" > 0 AND "toRevision" > "fromRevision" AND "scopeVersion" > 0);
CREATE FUNCTION requirement_change_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Requirement changes are append-only' USING ERRCODE = '23514';
END;
$$;
CREATE TRIGGER "RequirementChange_append_only" BEFORE UPDATE ON "RequirementChange" FOR EACH ROW EXECUTE FUNCTION requirement_change_append_only();
