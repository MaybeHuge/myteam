import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readConfig } from '../config.js';
import { createDatabase } from '../infrastructure/database.js';
import { S3Storage } from '../infrastructure/s3-storage.js';
const source = process.argv.find((arg) => arg.startsWith('--source='))?.slice('--source='.length);
if (!source) throw new Error('请使用 --source=旧附件目录；迁移校验内容并保留原始文件。');
const config = readConfig();
const db = createDatabase(config.DATABASE_URL);
const storage = new S3Storage(config);
try {
  await storage.ready();
  const rows = await db.attachment.findMany({
    where: { storageBucket: null },
    orderBy: { id: 'asc' },
  });
  let migrated = 0;
  for (const row of rows) {
    if (!/^[a-f0-9-]{36}\.bin$/.test(row.storageKey))
      throw new Error(`附件 ${row.id} 的旧存储键无效`);
    const content = await readFile(resolve(source, row.storageKey));
    if (
      content.length !== row.size ||
      createHash('sha256').update(content).digest('hex') !== row.sha256
    )
      throw new Error(`附件 ${row.id} 的原始文件校验失败，未修改该记录`);
    const stored = await storage.put(row.filename, content);
    if (
      createHash('sha256')
        .update(await storage.get(stored.storageKey))
        .digest('hex') !== row.sha256
    ) {
      await storage.remove(stored.storageKey);
      throw new Error(`附件 ${row.id} 的远端内容校验失败`);
    }
    // 远端 I/O 均已完成；短事务只更新引用并记录迁移审计。提交结果不明时保留对象。
    const updated = await db.$transaction(async (tx) => {
      const result = await tx.attachment.updateMany({
        where: { id: row.id, storageKey: row.storageKey, storageBucket: null },
        data: { storageKey: stored.storageKey, storageBucket: stored.storageBucket },
      });
      if (result.count)
        await tx.activityLog.create({
          data: {
            projectId: row.projectId,
            targetId: row.targetId,
            action: 'attachment.storage.migrated',
            requestId: `storage-migration:${randomUUID()}`,
            details: {
              attachmentId: row.id,
              bucket: stored.storageBucket,
              fromStorageKey: row.storageKey,
              toStorageKey: stored.storageKey,
            },
          },
        });
      return result.count;
    });
    if (!updated) await storage.remove(stored.storageKey);
    migrated += updated;
  }
  process.stdout.write(`已迁移并校验 ${migrated} 份附件，原始文件已保留。\n`);
} finally {
  storage.onModuleDestroy();
  await db.$disconnect();
}
