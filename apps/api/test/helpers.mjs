import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
export const testPassword = 'MyTeam-test-only-2026!';
export function configureTestEnvironment(origin = 'http://localhost:5173') {
  if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
  const url = new URL(
    process.env.TEST_DATABASE_URL ??
      process.env.DATABASE_URL ??
      'postgresql://postgres@localhost:5432/myteam',
  );
  if (!process.env.TEST_DATABASE_URL) url.pathname += '_test';
  if (!url.pathname.endsWith('_test'))
    throw new Error('测试仅允许使用名称以 _test 结尾的独立数据库');
  const businessBucket = process.env.S3_BUCKET;
  const bucket = process.env.TEST_S3_BUCKET ?? `${businessBucket ?? 'my-bucket'}-test`;
  if (!bucket.endsWith('-test') || bucket === businessBucket)
    throw new Error('测试对象桶必须以 -test 结尾且不能等于业务桶');
  Object.assign(process.env, {
    NODE_ENV: 'test',
    DATABASE_URL: url.toString(),
    APP_ORIGIN: origin,
    COOKIE_SECURE: 'false',
    SESSION_COOKIE: 'myteam_test_session',
    S3_ENDPOINT: process.env.TEST_S3_ENDPOINT ?? process.env.S3_ENDPOINT ?? 'http://localhost:8333',
    S3_REGION: process.env.TEST_S3_REGION ?? process.env.S3_REGION ?? 'us-east-1',
    S3_BUCKET: bucket,
    S3_ACCESS_KEY_ID: process.env.TEST_S3_ACCESS_KEY_ID ?? process.env.S3_ACCESS_KEY_ID ?? '',
    S3_SECRET_ACCESS_KEY:
      process.env.TEST_S3_SECRET_ACCESS_KEY ?? process.env.S3_SECRET_ACCESS_KEY ?? '',
    S3_PREFIX: `tests/${randomUUID().slice(0, 12)}/`,
    S3_FORCE_PATH_STYLE: 'true',
  });
}
export function migrateTestDatabase() {
  const result = spawnSync(
    resolve(root, 'scripts/pnpm.sh'),
    ['--filter', '@myteam/api', 'db:migrate'],
    { cwd: root, env: process.env, stdio: 'inherit' },
  );
  if (result.status !== 0)
    throw new Error('测试数据库迁移失败，请先启动本地数据库或设置 TEST_DATABASE_URL');
}

export async function prepareTestStorage() {
  const { readConfig } = await import('../dist/config.js');
  const { S3Storage } = await import('../dist/infrastructure/s3-storage.js');
  if (!process.env.S3_BUCKET.endsWith('-test')) throw new Error('拒绝初始化非测试桶');
  const storage = new S3Storage(readConfig());
  await storage.initialize();
  return storage;
}
export async function clearTestStorage(storage) {
  if (!process.env.S3_BUCKET.endsWith('-test') || !storage.prefix.startsWith('tests/'))
    throw new Error('拒绝清理非测试桶或前缀');
  if (process.env.KEEP_TEST_DATA === 'true') {
    storage.onModuleDestroy();
    return;
  }
  for await (const object of storage.objects()) await storage.remove(object.key);
  storage.onModuleDestroy();
}
