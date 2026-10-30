import { readConfig } from '../config.js';
import { createDatabase } from '../infrastructure/database.js';
import { S3Storage } from '../infrastructure/s3-storage.js';
const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
const storage = new S3Storage(config);
try {
  // Release only unused document images in this configured bucket/prefix. The project lock
  // serializes cleanup with draft saves, revision application, and image reference checks.
  const candidates = await db.requirementDocumentImage.findMany({
    where: {
      storageBucket: storage.bucket,
      storageKey: { startsWith: storage.prefix },
      createdAt: { lt: new Date(Date.now() - 24 * 3600000) },
      draftReferenced: false,
      versions: { none: {} },
    },
    select: { id: true, projectId: true },
  });
  for (const candidate of candidates)
    await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id=${candidate.projectId}::uuid FOR UPDATE`;
      await tx.requirementDocumentImage.deleteMany({
        where: { id: candidate.id, draftReferenced: false, versions: { none: {} } },
      });
    });
  const removed = await storage.prune(
    async (storageKey) =>
      !!(await db.attachment.findUnique({ where: { storageKey } })) ||
      !!(await db.requirementDocumentImage.findUnique({ where: { storageKey } })),
  );
  process.stdout.write(`已清理 ${removed} 个超过 24 小时且未被引用的资源对象。\n`);
} finally {
  storage.onModuleDestroy();
  await db.$disconnect();
}
