import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  openSync,
  closeSync,
  rmSync,
} from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { setTimeout } from 'node:timers/promises';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
if (existsSync(resolve(root, '.env'))) process.loadEnvFile(resolve(root, '.env'));
const bundle = resolve(root, '.tools/seaweedfs');
const data = resolve(root, '.local/seaweedfs');
const pidFile = resolve(root, '.local/seaweedfs.pid');
const binary = resolve(bundle, 'weed');
const version = '4.51';
const sha256 = 'c03be37416a8ee672c77766e20b22a4e1430744c3af2668599a4b6eeaec14cee';
if (process.platform !== 'linux' || process.arch !== 'x64')
  throw new Error('此助手仅支持 Linux x64；其他平台使用 Compose 或自备 SeaweedFS。');
const action = process.argv[2];
if (!['start', 'stop'].includes(action)) throw new Error('用法：local-seaweedfs.mjs start|stop');
function running() {
  if (!existsSync(pidFile)) return false;
  const pid = Number(readFileSync(pidFile, 'utf8'));
  if (!Number.isInteger(pid) || pid < 2) throw new Error('本地 SeaweedFS PID 无效');
  try {
    const command = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    if (!command[0]) return false;
    if (command[0] !== binary || !command.includes(`-dir=${data}`))
      throw new Error('PID 已被其他进程使用，拒绝操作');
    return pid;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}
const pid = running();
if (action === 'stop') {
  if (pid) {
    process.kill(pid, 'SIGTERM');
    for (let i = 0; i < 100 && running(); i++) await setTimeout(100);
    if (running()) throw new Error('SeaweedFS 正在退出，请稍后重试');
  }
  rmSync(pidFile, { force: true });
  console.log('项目本地 SeaweedFS 已停止，数据已保留。');
} else {
  const endpoint = process.env.S3_ENDPOINT;
  if (endpoint !== 'http://127.0.0.1:8333')
    throw new Error('本地助手仅服务 http://127.0.0.1:8333；已有其他服务时直接配置 S3_ENDPOINT。');
  if (
    !process.env.S3_ACCESS_KEY_ID ||
    (process.env.S3_SECRET_ACCESS_KEY?.length ?? 0) < 12 ||
    !process.env.S3_BUCKET
  )
    throw new Error(
      '请先填写 .env 的 S3_BUCKET、S3_ACCESS_KEY_ID 和至少 12 位的 S3_SECRET_ACCESS_KEY',
    );
  mkdirSync(bundle, { recursive: true });
  mkdirSync(data, { recursive: true, mode: 0o700 });
  if (!existsSync(binary)) {
    const archive = resolve(bundle, 'seaweedfs.tgz');
    const download = spawnSync(
      'curl',
      [
        '-fsSL',
        '--max-time',
        '120',
        `https://github.com/seaweedfs/seaweedfs/releases/download/${version}/linux_amd64.tar.gz`,
        '-o',
        archive,
      ],
      { stdio: 'inherit' },
    );
    if (download.status !== 0) throw new Error('SeaweedFS 下载失败');
    if (createHash('sha256').update(readFileSync(archive)).digest('hex') !== sha256)
      throw new Error('SeaweedFS SHA-256 校验失败');
    if (spawnSync('tar', ['-xzf', archive, '-C', bundle, 'weed']).status !== 0)
      throw new Error('SeaweedFS 解压失败');
  }
  if (!pid) {
    // 不覆盖已有同端口服务；只启动项目目录内的实例。
    const { createConnection } = await import('node:net');
    const occupied = await new Promise((resolve) => {
      const socket = createConnection({ host: '127.0.0.1', port: 8333 });
      socket.setTimeout(500, () => {
        socket.destroy();
        resolve(false);
      });
      socket.once('connect', () => {
        socket.destroy();
        resolve(true);
      });
      socket.once('error', () => resolve(false));
    });
    if (occupied) throw new Error('8333 端口已有其他服务，请检查 S3_ENDPOINT');
    const log = openSync(resolve(root, '.local/seaweedfs.log'), 'a', 0o600);
    try {
      const child = spawn(
        binary,
        [
          'mini',
          `-dir=${data}`,
          '-ip=127.0.0.1',
          '-ip.bind=127.0.0.1',
          '-master.port=19333',
          '-volume.port=19340',
          '-filer.port=18888',
          '-s3.port=8333',
          '-webdav=false',
          '-admin.ui=false',
          '-admin.port.legacy=0',
          '-s3.port.iceberg=0',
          '-s3.port.lance=0',
          '-s3.autoCreateBucket=false',
          '-master.telemetry=false',
        ],
        {
          detached: true,
          cwd: data,
          stdio: ['ignore', log, log],
          env: {
            PATH: process.env.PATH,
            HOME: process.env.HOME,
            S3_BUCKET: process.env.S3_BUCKET,
            AWS_ACCESS_KEY_ID: process.env.S3_ACCESS_KEY_ID,
            AWS_SECRET_ACCESS_KEY: process.env.S3_SECRET_ACCESS_KEY,
          },
        },
      );
      await new Promise((resolve, reject) => {
        child.once('spawn', resolve);
        child.once('error', reject);
      });
      writeFileSync(pidFile, String(child.pid), { mode: 0o600 });
      child.unref();
    } finally {
      closeSync(log);
    }
  }
  const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
  const { S3Client, HeadBucketCommand, CreateBucketCommand } = require('@aws-sdk/client-s3');
  const client = new S3Client({
    endpoint,
    region: process.env.S3_REGION ?? 'us-east-1',
    forcePathStyle: true,
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
    },
    maxAttempts: 1,
    requestHandler: { connectionTimeout: 500, requestTimeout: 1000 },
  });
  let ready = false;
  try {
    for (let i = 0; i < 100; i++) {
      if (!running()) break;
      try {
        try {
          await client.send(new HeadBucketCommand({ Bucket: process.env.S3_BUCKET }));
        } catch (error) {
          if (error.$metadata?.httpStatusCode !== 404) throw error;
          await client.send(new CreateBucketCommand({ Bucket: process.env.S3_BUCKET }));
        }
        ready = true;
        break;
      } catch {
        await setTimeout(250);
      }
    }
  } finally {
    client.destroy();
  }
  if (!ready)
    throw new Error('SeaweedFS 未就绪，请检查 .local/seaweedfs.log（可能包含本地凭据，请勿公开）');
  console.log(
    `SeaweedFS ${version} 已就绪：http://127.0.0.1:8333，仅监听本机，数据保存在 .local/seaweedfs。`,
  );
}
