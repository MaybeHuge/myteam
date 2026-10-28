import { readConfig } from '../config.js';
import { createDatabase } from '../infrastructure/database.js';
import { S3Storage } from '../infrastructure/s3-storage.js';
const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
const storage = new S3Storage(config);
try {
  const removed = await storage.prune(
    async (storageKey) => !!(await db.attachment.findUnique({ where: { storageKey } })),
  );
  process.stdout.write(`已清理 ${removed} 个超过 24 小时且未被引用的资源对象。\n`);
} finally {
  storage.onModuleDestroy();
  await db.$disconnect();
}
