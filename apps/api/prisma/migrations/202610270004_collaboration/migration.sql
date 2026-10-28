-- CreateEnum
CREATE TYPE "CollaborationTargetType" AS ENUM ('PROJECT', 'ITERATION');

-- CreateTable
CREATE TABLE "Comment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "targetType" "CollaborationTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "authorId" UUID NOT NULL,
    "body" VARCHAR(5000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Comment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attachment" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "targetType" "CollaborationTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "uploaderId" UUID NOT NULL,
    "filename" VARCHAR(200) NOT NULL,
    "storageKey" VARCHAR(80) NOT NULL,
    "contentType" VARCHAR(80) NOT NULL,
    "size" INTEGER NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" UUID NOT NULL,
    "projectId" UUID NOT NULL,
    "recipientId" UUID NOT NULL,
    "targetType" "CollaborationTargetType" NOT NULL,
    "targetId" UUID NOT NULL,
    "title" VARCHAR(200) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Comment_projectId_targetType_targetId_createdAt_idx" ON "Comment"("projectId", "targetType", "targetId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Attachment_storageKey_key" ON "Attachment"("storageKey");

-- CreateIndex
CREATE INDEX "Attachment_projectId_targetType_targetId_createdAt_idx" ON "Attachment"("projectId", "targetType", "targetId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_recipientId_readAt_createdAt_idx" ON "Notification"("recipientId", "readAt", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_projectId_idx" ON "Notification"("projectId");

-- AddForeignKey
ALTER TABLE "Comment" ADD CONSTRAINT "Comment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_recipientId_fkey" FOREIGN KEY ("recipientId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
