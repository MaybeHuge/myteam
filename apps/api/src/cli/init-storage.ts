import { readConfig } from '../config.js';
import { S3Storage } from '../infrastructure/s3-storage.js';
const storage = new S3Storage(readConfig());
try {
  await storage.initialize();
  process.stdout.write('SeaweedFS S3 存储桶已就绪。\n');
} finally {
  storage.onModuleDestroy();
}
