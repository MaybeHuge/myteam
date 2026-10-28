import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  symlinkSync,
  unlinkSync,
} from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const bundle = resolve(root, '.tools/postgres');
const data = resolve(root, '.local/postgres');
const socket = resolve(root, '.local/postgres-socket');
const archive = resolve(root, '.tools/postgres.tgz');
const integrity =
  'jVw/MdDtIX/vICH/DKIe6/mHpiCggdx6QVyza4vt/NbcZFsL0KhwglF6F1Koqx3gRBZ9XtN+vi63EsqSyqOSxA==';
const env = {
  ...process.env,
  LD_LIBRARY_PATH: `${bundle}/native/lib${process.env.LD_LIBRARY_PATH ? `:${process.env.LD_LIBRARY_PATH}` : ''}`,
  PGPASSWORD: 'myteam_local_only',
};
function run(command, args, capture = false) {
  const result = spawnSync(command, args, {
    env,
    encoding: 'utf8',
    stdio: capture ? 'pipe' : 'inherit',
  });
  if (result.status !== 0)
    throw new Error(capture ? result.stderr || `${command} 执行失败` : `${command} 执行失败`);
  return result.stdout?.trim();
}
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error(
    '此可选数据库助手仅支持 Linux x64；其他平台请使用 Compose 或自备 PostgreSQL 18。',
  );
if (process.getuid?.() === 0) throw new Error('PostgreSQL 必须以普通用户运行。');
if (!existsSync(`${bundle}/native/bin/pg_ctl`)) {
  mkdirSync(bundle, { recursive: true });
  run('curl', [
    '-fsSL',
    '--max-time',
    '120',
    'https://registry.npmjs.org/@embedded-postgres/linux-x64/-/linux-x64-18.4.0-beta.17.tgz',
    '-o',
    archive,
  ]);
  if (createHash('sha512').update(readFileSync(archive)).digest('base64') !== integrity)
    throw new Error('PostgreSQL 下载完整性校验失败');
  run('tar', ['-xzf', archive, '-C', bundle, '--strip-components=1']);
}
// npm 压缩包把共享库软链接保存成清单，这里仅重建包内链接。
for (const { source, target } of JSON.parse(
  readFileSync(`${bundle}/native/pg-symlinks.json`, 'utf8'),
)) {
  const origin = resolve(bundle, source);
  const destination = resolve(bundle, target);
  if (!origin.startsWith(`${bundle}/`) || !destination.startsWith(`${bundle}/`))
    throw new Error('数据库包包含无效链接');
  if (!existsSync(destination)) symlinkSync(relative(dirname(destination), origin), destination);
}
const bin = (name) => `${bundle}/native/bin/${name}`;
const running =
  spawnSync(bin('pg_ctl'), ['-D', data, 'status'], { env, stdio: 'ignore' }).status === 0;
if (process.argv[2] === 'stop') {
  if (running) run(bin('pg_ctl'), ['-D', data, '-m', 'fast', '-w', 'stop']);
  else console.log('项目本地数据库未运行。');
} else if (process.argv[2] === 'start') {
  mkdirSync(socket, { recursive: true });
  if (!existsSync(`${data}/PG_VERSION`)) {
    const passwordFile = resolve(root, '.local/pg-init-password');
    writeFileSync(passwordFile, 'myteam_local_only', { mode: 0o600 });
    try {
      run(bin('initdb'), [
        '-D',
        data,
        '-U',
        'myteam',
        '--pwfile',
        passwordFile,
        '--auth-host=scram-sha-256',
        '--auth-local=trust',
        '--encoding=UTF8',
        '--locale=C',
      ]);
    } finally {
      unlinkSync(passwordFile);
    }
  }
  if (!running)
    run(bin('pg_ctl'), [
      '-D',
      data,
      '-l',
      resolve(root, '.local/postgres.log'),
      '-o',
      `-h 127.0.0.1 -p 55432 -k "${socket}"`,
      '-w',
      'start',
    ]);
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const { Client } = require('pg');
  const client = new Client({
    host: '127.0.0.1',
    port: 55432,
    user: 'myteam',
    password: env.PGPASSWORD,
    database: 'postgres',
  });
  await client.connect();
  try {
    for (const database of ['myteam', 'myteam_test']) {
      const found = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [database]);
      if (found.rowCount === 0) await client.query(`CREATE DATABASE "${database}"`);
    }
  } finally {
    await client.end();
  }
  run(bin('postgres'), ['--version']);
  console.log(
    '项目本地数据库可用：127.0.0.1:55432，业务库 myteam，隔离测试库 myteam_test。仅供开发测试。',
  );
} else throw new Error('用法：local-postgres.mjs start|stop');
