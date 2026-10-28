import { spawnSync } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (
  !process.env.TEST_DATABASE_URL ||
  !new URL(process.env.TEST_DATABASE_URL).pathname.endsWith('_test')
) {
  throw new Error(
    'CI 必须显式提供 TEST_DATABASE_URL，且数据库名称以 _test 结尾；不会迁移业务数据库',
  );
}
if (!process.env.TEST_S3_ENDPOINT || !process.env.TEST_S3_BUCKET?.endsWith('-test'))
  throw new Error('CI 必须显式提供 TEST_S3_ENDPOINT 和以 -test 结尾的 TEST_S3_BUCKET');
for (const args of [
  ['install', '--frozen-lockfile'],
  ['db:generate'],
  ['format:check'],
  ['check'],
  ['test:integration'],
  ['test:e2e'],
]) {
  const result = spawnSync(resolve(root, 'scripts/pnpm.sh'), args, {
    cwd: root,
    env: { ...process.env, CI: 'true' },
    stdio: 'inherit',
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}
