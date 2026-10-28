import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import request from 'supertest';
import * as argon2 from 'argon2';
import {
  configureTestEnvironment,
  migrateTestDatabase,
  testPassword,
  prepareTestStorage,
  clearTestStorage,
} from './helpers.mjs';
configureTestEnvironment();
migrateTestDatabase();
const testStorage = await prepareTestStorage();
const { createApp } = await import('../dist/app.js');
const { S3Storage } = await import('../dist/infrastructure/s3-storage.js');
const { readConfig } = await import('../dist/config.js');
const { ApiException } = await import('../dist/common/http.js');
const { createDatabase, Database } = await import('../dist/infrastructure/database.js');
const db = createDatabase(process.env.DATABASE_URL);
const nonce = randomUUID();
let app, http, a, b, iteration, foreign, fileId;
const users = {},
  sessions = {};
const base = (projectId = a, type = 'PROJECT', targetId = projectId) =>
  `/projects/${projectId}/collaboration/${type}/${targetId}`;
const post = (session, path, input, key = randomUUID()) =>
  session.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', session.csrf)
    .set('Idempotency-Key', key)
    .send(input);
const upload = (
  session,
  filename = '讨论记录.md',
  content = Buffer.from('# 团队资料'),
  key = randomUUID(),
  route = base(),
) =>
  session.agent
    .post(`/api/v1${route}/attachments`)
    .query({ filename })
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', session.csrf)
    .set('Idempotency-Key', key)
    .set('Content-Type', 'application/octet-stream')
    .send(content);
const get = (session, path) => session.agent.get(`/api/v1${path}`);
const download = (session, id = fileId, projectId = a) =>
  get(session, `/projects/${projectId}/attachments/${id}/download`);
const notifications = async (session) => (await get(session, '/notifications').expect(200)).body;
async function objects() {
  const items = [];
  for await (const object of testStorage.objects()) items.push(object.key);
  return items;
}
async function login(user) {
  const agent = request.agent(http);
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: user.email, password: testPassword })
    .expect(201);
  return {
    agent,
    csrf: result.body.csrfToken,
    cookie: result.headers['set-cookie'].map((value) => value.split(';')[0]).join('; '),
  };
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword);
  for (const role of ['admin', 'owner', 'developer', 'viewer', 'outsider'])
    users[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${nonce}@collaboration.test`,
        passwordHash,
        isSystemAdmin: role === 'admin',
      },
    });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  for (const key of ['A', 'B']) {
    const result = await post(sessions.admin, '/projects', {
      key: `C${nonce.slice(0, 7)}${key}`,
      name: `协作 ${key}`,
      ownerId: key === 'A' ? users.owner.id : users.outsider.id,
    }).expect(201);
    if (key === 'A') a = result.body.id;
    else b = result.body.id;
  }
  for (const role of ['developer', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [role.toUpperCase()],
    }).expect(201);
  for (const projectId of [a, b]) {
    const item = await db.iteration.create({
      data: {
        projectId,
        name: `迭代 ${projectId}`,
        ownerId: projectId === a ? users.owner.id : users.outsider.id,
        startDate: new Date('2026-11-01'),
        endDate: new Date('2026-11-14'),
      },
    });
    if (projectId === a) iteration = item.id;
    else foreign = item.id;
  }
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    testStorage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  await db.activityLog.deleteMany({ where: { projectId: { in: [a, b].filter(Boolean) } } });
  await db.project.deleteMany({ where: { id: { in: [a, b].filter(Boolean) } } });
  const people = Object.values(users).map((u) => u.id);
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: people } } });
  await db.user.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
});
test('评论并发重试只生成一条评论/审计/通知，内容按纯文本返回', async () => {
  const key = randomUUID(),
    input = { body: '<script>讨论内容</script>\n保留换行' };
  const path = `${base()}/comments`;
  const results = await Promise.all([
    post(sessions.developer, path, input, key),
    post(sessions.developer, path, input, key),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  assert.equal(results[0].body.id, results[1].body.id);
  const list = (await get(sessions.viewer, path).expect(200)).body;
  assert.equal(list.total, 1);
  assert.equal(list.canWrite, false);
  assert.equal(list.items[0].body, input.body);
  assert.equal(
    await db.activityLog.count({ where: { projectId: a, action: 'comment.created' } }),
    1,
  );
  assert.equal((await notifications(sessions.owner)).unread, 1);
  assert.equal((await notifications(sessions.developer)).total, 0);
  await post(sessions.developer, path, { body: '不同内容' }, key).expect(409);
});
test('拒绝空白/超长评论与无效分页，支持稳定分页', async () => {
  for (const body of ['  ', 'a'.repeat(5001)])
    await post(sessions.developer, `${base()}/comments`, { body }).expect(400);
  await get(sessions.owner, `${base()}/comments?pageSize=101`).expect(400);
  await post(sessions.developer, `${base()}/comments`, { body: '第二条' }).expect(201);
  const one = (await get(sessions.owner, `${base()}/comments?pageSize=1`).expect(200)).body;
  const two = (await get(sessions.owner, `${base()}/comments?pageSize=1&page=2`).expect(200)).body;
  assert.equal(one.total, 2);
  assert.notEqual(one.items[0].id, two.items[0].id);
});
test('非成员/跨项目对象/只读角色直接请求均被阻止，未认证和 CSRF 同样生效', async () => {
  await request(http).get(`/api/v1${base()}/comments`).expect(401);
  await get(sessions.outsider, `${base()}/comments`).expect(404);
  await post(sessions.viewer, `${base()}/comments`, { body: '越权' }).expect(403);
  await upload(sessions.viewer).expect(403);
  await get(sessions.owner, `${base(a, 'ITERATION', foreign)}/comments`).expect(404);
  await upload(
    sessions.owner,
    'x.txt',
    Buffer.from('x'),
    randomUUID(),
    base(a, 'ITERATION', foreign),
  ).expect(404);
  await get(sessions.owner, `${base(a, 'PROJECT', b)}/comments`).expect(404);
  await get(sessions.owner, `${base(a, 'DEPLOYMENT', iteration)}/comments`).expect(400);
  await sessions.owner.agent
    .post(`/api/v1${base()}/comments`)
    .send({ body: '无 CSRF' })
    .expect(403);
});
test('迭代评论使用独立对象范围，并通知迭代负责人', async () => {
  await post(sessions.developer, `${base(a, 'ITERATION', iteration)}/comments`, {
    body: '迭代讨论',
  }).expect(201);
  const list = (
    await get(sessions.owner, `${base(a, 'ITERATION', iteration)}/comments`).expect(200)
  ).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].body, '迭代讨论');
  assert.equal((await get(sessions.owner, `${base()}/comments`).expect(200)).body.total, 2);
});
test('合法附件保留中文名、内容与哈希；幂等重试不产生多余文件或通知', async () => {
  const key = randomUUID(),
    content = Buffer.from('# 团队资料\n实际内容');
  const [first, second] = await Promise.all([
    upload(sessions.developer, '资料.md', content, key).expect(201),
    upload(sessions.developer, '资料.md', content, key).expect(201),
  ]);
  fileId = first.body.id;
  assert.equal(second.body.id, fileId);
  assert.equal(
    (await upload(sessions.developer, '资料.md', content, key).expect(201)).body.id,
    fileId,
  );
  assert.equal((await objects()).length, 1);
  const list = (await get(sessions.viewer, `${base()}/attachments`).expect(200)).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].filename, '资料.md');
  assert.equal('storageKey' in list.items[0], false);
  assert.equal('uploaderId' in list.items[0], false);
  const response = await download(sessions.viewer).expect(200);
  assert.equal(response.text, content.toString());
  assert.match(response.headers['content-disposition'], /^attachment;/);
  assert.match(response.headers['content-disposition'], /filename\*=UTF-8''/);
  assert.equal(response.headers['x-content-type-options'], 'nosniff');
  await upload(sessions.developer, '资料.md', Buffer.from('changed'), key).expect(409);
});
test('拒绝伪装内容、非法类型/编码/路径、空文件与超过 20 MiB 文件', async () => {
  for (const [filename, content] of [
    ['x.png', Buffer.from('not a png')],
    ['x.html', Buffer.from('<html>')],
    ['x.svg', Buffer.from('<svg/>')],
    ['x.txt', Buffer.from([255])],
    ['../x.txt', Buffer.from('x')],
    ['x.txt', Buffer.alloc(0)],
    ['x.pdf', Buffer.from('not PDF')],
  ])
    await upload(sessions.developer, filename, content).expect(400);
  await upload(sessions.developer, 'large.txt', Buffer.alloc(20 * 1024 * 1024 + 1, 97)).expect(400);
  const chunked = await fetch(
    `http://127.0.0.1:${http.address().port}/api/v1${base()}/attachments?filename=chunked.txt`,
    {
      method: 'POST',
      duplex: 'half',
      body: Readable.from(Array(21).fill(Buffer.alloc(1024 * 1024, 97))),
      headers: {
        'Content-Type': 'application/octet-stream',
        Origin: process.env.APP_ORIGIN,
        'X-CSRF-Token': sessions.developer.csrf,
        'Idempotency-Key': randomUUID(),
        Cookie: sessions.developer.cookie,
      },
    },
  );
  assert.equal(chunked.status, 400);
  assert.equal((await chunked.json()).code, 'VALIDATION_ERROR');
  assert.equal((await objects()).length, 1);
});
test('附件按项目与对象授权，管理员跨项目下载留痕；私有文件没有公开路径', async () => {
  await download(sessions.outsider).expect(404);
  await download(sessions.outsider, fileId, b).expect(404);
  await request(http).get(`/api/v1/projects/${a}/attachments/${fileId}/download`).expect(401);
  await download(sessions.admin).expect(200);
  assert.ok(
    await db.activityLog.count({
      where: { projectId: a, actorId: users.admin.id, action: 'project.admin.access' },
    }),
  );
  const file = await db.attachment.findUniqueOrThrow({ where: { id: fileId } });
  const anonymous = await fetch(
    `${process.env.S3_ENDPOINT}/${testStorage.bucket}/${file.storageKey}`,
  );
  assert.equal(anonymous.status, 403);
  await anonymous.arrayBuffer();
  await get(sessions.owner, `/uploads/${file.storageKey}`).expect(404);
});
test('通知仅本人可读/已读，重复已读不更改时间，筛选与未读数一致', async () => {
  const list = await notifications(sessions.owner),
    item = list.items[0];
  assert.ok(list.unread > 0);
  assert.equal('recipientId' in item, false);
  await post(sessions.developer, `/notifications/${item.id}/read`, {}).expect(404);
  await post(sessions.owner, `/notifications/${item.id}/read`, {}).expect(201);
  const first = await db.notification.findUniqueOrThrow({ where: { id: item.id } });
  await post(sessions.owner, `/notifications/${item.id}/read`, {}).expect(201);
  const second = await db.notification.findUniqueOrThrow({ where: { id: item.id } });
  assert.equal(first.readAt.toISOString(), second.readAt.toISOString());
  const unread = (await get(sessions.owner, '/notifications?unread=true').expect(200)).body;
  assert.equal(unread.total, unread.unread);
  assert.ok(unread.items.every((i) => !i.readAt));
});
async function withFailure(model, callback) {
  const database = app.get(Database),
    original = database.$transaction.bind(database);
  database.$transaction = (cb, ...options) =>
    original(
      (tx) =>
        cb(
          new Proxy(tx, {
            get(target, property) {
              if (property === model)
                return {
                  ...target[model],
                  create: async () => {
                    throw new Error('模拟事务写入故障');
                  },
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        ),
      ...options,
    );
  try {
    await callback();
  } finally {
    database.$transaction = original;
  }
}
test('审计或通知写入故障时评论、审计及幂等记录一起回滚', async () => {
  for (const model of ['activityLog', 'notification']) {
    const key = randomUUID(),
      count = await db.comment.count({ where: { projectId: a } });
    const audits = await db.activityLog.count({
      where: { projectId: a, action: 'comment.created' },
    });
    await withFailure(model, async () => {
      await post(sessions.developer, `${base()}/comments`, { body: model }, key).expect(500);
    });
    assert.equal(await db.comment.count({ where: { projectId: a } }), count);
    assert.equal(
      await db.activityLog.count({ where: { projectId: a, action: 'comment.created' } }),
      audits,
    );
    assert.equal(
      await db.idempotencyRecord.count({ where: { actorId: users.developer.id, key } }),
      0,
    );
  }
});
test('附件通知故障回滚元信息并清理文件，相同幂等键修复后可重试', async () => {
  const key = randomUUID(),
    count = await db.attachment.count({ where: { projectId: a } });
  await withFailure('notification', async () => {
    await upload(sessions.developer, 'rollback.txt', Buffer.from('rollback'), key).expect(500);
  });
  assert.equal(await db.attachment.count({ where: { projectId: a } }), count);
  assert.equal((await objects()).length, 1);
  await upload(sessions.developer, 'rollback.txt', Buffer.from('rollback'), key).expect(201);
});
test('迭代分配通知与业务在同一事务，通知故障时计划创建回滚', async () => {
  const path = `/projects/${a}/iterations`,
    data = {
      name: `分配 ${nonce}`,
      ownerId: users.developer.id,
      goal: '验证通知',
      startDate: '2026-11-01',
      endDate: '2026-11-14',
    };
  await withFailure('notification', async () => {
    await post(sessions.owner, path, data).expect(500);
  });
  assert.equal(await db.iteration.count({ where: { projectId: a, name: data.name } }), 0);
  const response = await post(sessions.owner, path, data).expect(201);
  const list = await notifications(sessions.developer);
  assert.ok(list.items.some((i) => i.targetId === response.body.id && i.title.includes('分配')));
});
test('S3 网络写入在事务外执行，上传期间收回权限后不能落库且对象被清理', async () => {
  const storage = app.get(S3Storage),
    database = app.get(Database);
  const originalPut = storage.put.bind(storage),
    originalTransaction = database.$transaction.bind(database);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.developer.id } },
  });
  const before = (await objects()).length;
  let active = 0;
  database.$transaction = async (...args) => {
    active++;
    try {
      return await originalTransaction(...args);
    } finally {
      active--;
    }
  };
  storage.put = async (...args) => {
    assert.equal(active, 0);
    const result = await originalPut(...args);
    await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/roles`, {
      version: member.version,
      roles: ['VIEWER'],
    }).expect(201);
    return result;
  };
  try {
    await upload(sessions.developer, 'revoked.txt', Buffer.from('revoked')).expect(403);
  } finally {
    storage.put = originalPut;
    database.$transaction = originalTransaction;
    await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/roles`, {
      version: member.version + 1,
      roles: ['DEVELOPER'],
    }).expect(201);
  }
  assert.equal((await objects()).length, before);
  assert.equal(await db.attachment.count({ where: { projectId: a, filename: 'revoked.txt' } }), 0);
});
test('数据库已提交但结果丢失时保留原对象，同键重试清理多余上传且保持单份附件', async () => {
  const database = app.get(Database),
    original = database.$transaction.bind(database);
  const key = randomUUID(),
    content = Buffer.from('commit response lost');
  const before = (await objects()).length;
  database.$transaction = async (...args) => {
    const result = await original(...args);
    if (result?.id) throw new Error('模拟提交成功后的连接中断');
    return result;
  };
  try {
    await upload(sessions.owner, 'uncertain.txt', content, key).expect(500);
  } finally {
    database.$transaction = original;
  }
  const row = await db.attachment.findFirstOrThrow({
    where: { projectId: a, filename: 'uncertain.txt' },
  });
  assert.deepEqual(await testStorage.get(row.storageKey), content);
  const replay = await upload(sessions.owner, 'uncertain.txt', content, key).expect(201);
  assert.equal(replay.body.id, row.id);
  assert.equal((await objects()).length, before + 1);
  assert.equal(
    await db.attachment.count({ where: { projectId: a, filename: 'uncertain.txt' } }),
    1,
  );
});
test('真实 S3 凭据错误返回可重试的 503，不写附件引用，健康检查反映存储故障', async () => {
  const broken = new S3Storage({
    ...readConfig(),
    S3_SECRET_ACCESS_KEY: 'wrong-credentials-for-test',
  });
  const storage = app.get(S3Storage),
    originalPut = storage.put.bind(storage),
    originalReady = storage.ready.bind(storage);
  const count = await db.attachment.count({ where: { projectId: a } });
  storage.put = broken.put.bind(broken);
  storage.ready = broken.ready.bind(broken);
  try {
    const response = await upload(
      sessions.developer,
      'unavailable.txt',
      Buffer.from('unavailable'),
    ).expect(503);
    assert.equal(response.body.code, 'SERVICE_UNAVAILABLE');
    assert.ok(!JSON.stringify(response.body).includes('wrong-credentials'));
    await get(sessions.owner, '/health/live').expect(200);
    await get(sessions.owner, '/health/ready').expect(503);
  } finally {
    storage.put = originalPut;
    storage.ready = originalReady;
    broken.onModuleDestroy();
  }
  assert.equal(await db.attachment.count({ where: { projectId: a } }), count);
});
test('补偿删除失败保留原错误，孤立清理可回收对象且保护业务引用', async () => {
  const storage = app.get(S3Storage),
    originalRemove = storage.remove.bind(storage);
  const before = (await objects()).length;
  storage.remove = async () => {
    throw new ApiException(503, 'SERVICE_UNAVAILABLE', '模拟删除不可用');
  };
  try {
    await withFailure('notification', async () => {
      await upload(sessions.developer, 'cleanup.txt', Buffer.from('cleanup')).expect(500);
    });
  } finally {
    storage.remove = originalRemove;
  }
  assert.equal((await objects()).length, before + 1);
  assert.equal(await db.attachment.count({ where: { projectId: a, filename: 'cleanup.txt' } }), 0);
  const removed = await testStorage.prune(
    async (storageKey) => !!(await db.attachment.findUnique({ where: { storageKey } })),
    new Date(Date.now() + 2000),
  );
  assert.equal(removed, 1);
  assert.equal((await objects()).length, before);
});
test('关闭迭代及归档/完成项目只读，保留评论和附件查询下载', async () => {
  await db.iteration.update({ where: { id: iteration }, data: { status: 'CLOSED' } });
  await post(sessions.developer, `${base(a, 'ITERATION', iteration)}/comments`, {
    body: 'closed',
  }).expect(403);
  assert.equal(
    (await get(sessions.owner, `${base(a, 'ITERATION', iteration)}/comments`).expect(200)).body
      .canWrite,
    false,
  );
  for (const status of ['ARCHIVED', 'COMPLETED']) {
    await db.project.update({ where: { id: a }, data: { status } });
    await post(sessions.admin, `${base()}/comments`, { body: status }).expect(403);
    await upload(sessions.developer).expect(403);
    await download(sessions.viewer).expect(200);
  }
  await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
});
test('降权后旧幂等评论被阻止；移除成员后附件及历史通知立即不可见', async () => {
  const key = randomUUID(),
    input = { body: '权限撤销前' };
  await post(sessions.developer, `${base()}/comments`, input, key).expect(201);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.developer.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/roles`, {
    version: member.version,
    roles: ['VIEWER'],
  }).expect(201);
  await post(sessions.developer, `${base()}/comments`, input, key).expect(403);
  // 未关闭迭代负责人先移交，再通过正式成员移除命令。
  await db.iteration.updateMany({
    where: { ownerId: users.developer.id },
    data: { ownerId: users.owner.id },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/remove`, {
    version: member.version + 1,
  }).expect(201);
  await download(sessions.developer).expect(404);
  const hidden = await notifications(sessions.developer);
  assert.equal(hidden.total, 0);
  assert.equal(hidden.unread, 0);
  const previous = await db.notification.findFirstOrThrow({
    where: { recipientId: users.developer.id },
  });
  await post(sessions.developer, `/notifications/${previous.id}/read`, {}).expect(404);
});
test('S3 孤立清理保护近期对象与数据库引用，仅清理当前前缀', async () => {
  const first = await testStorage.put('orphan.txt', Buffer.from('orphan'));
  assert.equal(await testStorage.prune(async () => false, new Date(Date.now() - 24 * 3600000)), 0);
  const second = await testStorage.put('protected.txt', Buffer.from('protected'));
  const references = new Set(
    (await db.attachment.findMany({ where: { projectId: a }, select: { storageKey: true } })).map(
      (row) => row.storageKey,
    ),
  );
  references.add(second.storageKey);
  assert.equal(
    await testStorage.prune(async (key) => references.has(key), new Date(Date.now() + 2000)),
    1,
  );
  const remaining = await objects();
  assert.ok(!remaining.includes(first.storageKey));
  assert.ok([...references].every((key) => remaining.includes(key)));
});
after(async () => {
  await clearTestStorage(testStorage);
});
