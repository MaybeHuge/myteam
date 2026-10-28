import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
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
const { createDatabase } = await import('../dist/infrastructure/database.js');
const { IterationsService } = await import('../dist/modules/iterations/iterations.service.js');
const db = createDatabase(process.env.DATABASE_URL);
const nonce = randomUUID();
const suffix = `${nonce}@iterations.test`;
const prefix = `I${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}`;
let app, http, users, sessions, a, b, base, foreign;
let sequence = 0;
const route = (id, projectId = a) => `/projects/${projectId}/iterations${id ? `/${id}` : ''}`;
async function login(user) {
  const agent = request.agent(http);
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: user.email, password: testPassword })
    .expect(201);
  return { agent, csrf: result.body.csrfToken };
}
const post = (session, path, input, key = randomUUID()) =>
  session.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', session.csrf)
    .set('Idempotency-Key', key)
    .send(input);
const plan = (extra = {}) => ({
  name: `计划 ${++sequence} ${nonce}`,
  goal: '完成本轮目标',
  ownerId: users.owner.id,
  startDate: '2026-11-01',
  endDate: '2026-11-14',
  ...extra,
});
const detail = async (id, session = sessions.owner, projectId = a) =>
  (await session.agent.get(`/api/v1${route(id, projectId)}`).expect(200)).body;
const update = (item, extra = {}) => ({
  name: item.name,
  goal: item.goal,
  ownerId: item.owner.id,
  startDate: item.startDate,
  endDate: item.endDate,
  version: item.version,
  ...extra,
});
async function create(extra = {}, projectId = a) {
  return (await post(sessions.owner, route(null, projectId), plan(extra)).expect(201)).body.id;
}
before(async () => {
  users = {};
  sessions = {};
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  for (const role of ['admin', 'owner', 'developer', 'viewer', 'outsider'])
    users[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${suffix}`,
        passwordHash,
        isSystemAdmin: role === 'admin',
      },
    });
  app = await createApp();
  http = app.getHttpServer();
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  for (const key of ['A', 'B']) {
    const p = await post(sessions.admin, '/projects', {
      key: `${prefix}${key}`,
      name: `迭代隔离 ${key}`,
      ownerId: key === 'A' ? users.owner.id : users.outsider.id,
      startDate: '2026-10-01',
      endDate: '2026-12-31',
    }).expect(201);
    await db.project.update({ where: { id: p.body.id }, data: { status: 'ACTIVE' } });
    if (key === 'A') a = p.body.id;
    else b = p.body.id;
  }
  for (const role of ['developer', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [role.toUpperCase()],
    }).expect(201);
  base = await create();
  foreign = (
    await post(sessions.admin, route(null, b), plan({ ownerId: users.outsider.id })).expect(201)
  ).body.id;
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    testStorage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  const projects = await db.project.findMany({ where: { key: { startsWith: prefix } } });
  const ids = projects.map((p) => p.id);
  await db.activityLog.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  const people = Object.values(users ?? {}).map((user) => user.id);
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: people } } });
  await db.loginAttempt.deleteMany({ where: { email: { endsWith: suffix } } });
  await db.user.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
});
test('迭代列表、详情与统计依项目授权，跨项目标识和非成员访问被拒绝', async () => {
  await request(http).get(`/api/v1${route()}`).expect(401);
  await sessions.outsider.agent.get(`/api/v1${route()}`).expect(404);
  await sessions.owner.agent.get(`/api/v1${route(foreign)}`).expect(404);
  await sessions.owner.agent.get(`/api/v1${route(base, b)}`).expect(404);
  const list = await sessions.viewer.agent.get(`/api/v1${route()}`).expect(200);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.stats.total, 1);
  assert.equal(list.body.canCreate, false);
  assert.deepEqual(list.body.items[0].allowedActions, []);
  assert.deepEqual((await detail(base)).work, { total: 0, open: 0, done: 0, canceled: 0 });
});
test('开发与只读角色不能绕过界面进行迭代写入', async () => {
  for (const role of ['developer', 'viewer']) {
    await post(sessions[role], route(), plan()).expect(403);
    await post(sessions[role], `${route(base)}/update`, update(await detail(base))).expect(403);
    await post(sessions[role], `${route(base)}/start`, { version: 1 }).expect(403);
    await post(sessions[role], `${route(base)}/close`, { version: 1, summary: '越权' }).expect(403);
  }
});
test('创建校验日期、项目边界、负责人，且不能通过输入提前设置状态', async () => {
  await post(
    sessions.owner,
    route(),
    plan({ startDate: '2026-11-15', endDate: '2026-11-01' }),
  ).expect(400);
  await post(sessions.owner, route(), plan({ startDate: '2026-02-30' })).expect(400);
  await post(sessions.owner, route(), plan({ startDate: '2026-09-30' })).expect(422);
  await post(sessions.owner, route(), plan({ endDate: '2027-01-01' })).expect(422);
  await post(sessions.owner, route(), plan({ ownerId: users.outsider.id })).expect(422);
  await db.user.update({ where: { id: users.developer.id }, data: { active: false } });
  try {
    await post(sessions.owner, route(), plan({ ownerId: users.developer.id })).expect(422);
  } finally {
    await db.user.update({ where: { id: users.developer.id }, data: { active: true } });
  }
  const id = await create({ status: 'CLOSED' });
  assert.equal((await detail(id)).status, 'PLANNING');
});
test('创建幂等、项目内名称唯一，相同名称在不同项目允许', async () => {
  const input = plan();
  const key = randomUUID();
  const first = await post(sessions.owner, route(), input, key).expect(201);
  const second = await post(sessions.owner, route(), input, key).expect(201);
  assert.equal(first.body.id, second.body.id);
  await post(sessions.owner, route(), { ...input, goal: '变更' }, key).expect(409);
  await post(sessions.owner, route(), input).expect(409);
  await post(sessions.admin, route(null, b), { ...input, ownerId: users.outsider.id }).expect(201);
  assert.equal(
    await db.activityLog.count({ where: { targetId: first.body.id, action: 'iteration.created' } }),
    1,
  );
});
test('关键词、状态、负责人筛选与分页不改变项目范围', async () => {
  const unique = `特定目标${nonce}`;
  const id = await create({ goal: unique });
  const result = await sessions.owner.agent
    .get(`/api/v1${route()}`)
    .query({ q: unique, status: 'PLANNING', ownerId: users.owner.id, pageSize: 1 })
    .expect(200);
  assert.deepEqual(
    result.body.items.map((i) => i.id),
    [id],
  );
  assert.equal(result.body.total, 1);
  const hidden = await sessions.owner.agent
    .get(`/api/v1${route()}`)
    .query({ ownerId: users.outsider.id })
    .expect(200);
  assert.equal(hidden.body.total, 0);
  await sessions.owner.agent.get(`/api/v1${route()}`).query({ pageSize: 101 }).expect(400);
});
test('同版本并发编辑只有一项成功，保留计划前后值审计', async () => {
  const id = await create();
  const item = await detail(id);
  const results = await Promise.all(
    ['目标一', '目标二'].map((goal) =>
      post(sessions.owner, `${route(id)}/update`, update(item, { goal })),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const audit = await db.activityLog.findFirstOrThrow({
    where: { targetId: id, action: 'iteration.updated' },
  });
  assert.equal(audit.details.before.goal, item.goal);
  assert.ok(['目标一', '目标二'].includes(audit.details.after.goal));
});
test('启动须有目标与进行中的项目，禁止跳过规划直接关闭', async () => {
  const id = await create({ goal: '' });
  await post(sessions.owner, `${route(id)}/start`, { version: 1 }).expect(422);
  await post(sessions.owner, `${route(id)}/close`, { version: 1, summary: '不允许跳过' }).expect(
    422,
  );
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await detail(id), { goal: '准备好目标' }),
  ).expect(201);
  await db.project.update({ where: { id: a }, data: { status: 'PAUSED' } });
  try {
    await post(sessions.owner, `${route(id)}/start`, { version: 2 }).expect(422);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  }
  await post(sessions.owner, `${route(id)}/start`, { version: 2 }).expect(201);
  assert.ok((await detail(id)).startedAt);
});
test('未完成事项阻止关闭，完成和取消后可关闭，关闭只读并保留总结', async () => {
  const id = await create();
  await post(sessions.owner, `${route(id)}/start`, { version: 1 }).expect(201);
  const work = await db.workItem.create({
    data: { projectId: a, iterationId: id, kind: 'TASK', title: '关闭规则的未完成夹具' },
  });
  await db.workItem.create({
    data: {
      projectId: a,
      iterationId: id,
      kind: 'REQUIREMENT',
      title: '已取消的范围夹具',
      resolution: 'CANCELED',
    },
  });
  const failed = await post(sessions.owner, `${route(id)}/close`, {
    version: 2,
    summary: '本轮结束',
  }).expect(422);
  assert.equal(failed.body.details.open, 1);
  assert.equal((await detail(id)).version, 2);
  assert.equal(
    await db.activityLog.count({ where: { targetId: id, action: 'iteration.closed' } }),
    0,
  );
  await db.workItem.update({ where: { id: work.id }, data: { resolution: 'DONE' } });
  await post(sessions.owner, `${route(id)}/close`, {
    version: 2,
    summary: '  全部范围处理完毕  ',
  }).expect(201);
  const closed = await detail(id);
  assert.equal(closed.closeSummary, '全部范围处理完毕');
  assert.ok(closed.closedAt);
  assert.deepEqual(closed.allowedActions, []);
  assert.equal(closed.work.done, 1);
  assert.equal(closed.work.canceled, 1);
  await post(sessions.owner, `${route(id)}/update`, update(closed)).expect(422);
  await post(sessions.owner, `${route(id)}/start`, { version: closed.version }).expect(422);
  await db.$transaction((tx) =>
    assert.rejects(app.get(IterationsService).assertAssignable(tx, a, id), /已关闭迭代/),
  );
});
test('范围详情分页与关闭门禁统计全部事项，数据库拒绝跨项目关联', async () => {
  const id = await create();
  await db.workItem.createMany({
    data: Array.from({ length: 22 }, (_, index) => ({
      projectId: a,
      iterationId: id,
      kind: 'TASK',
      title: `计划夹具 ${index}`,
      resolution: index === 21 ? 'OPEN' : 'DONE',
    })),
  });
  const page = await sessions.owner.agent
    .get(`/api/v1${route(id)}`)
    .query({ page: 2, pageSize: 20 })
    .expect(200);
  assert.equal(page.body.items.items.length, 2);
  assert.equal(page.body.work.total, 22);
  assert.equal(page.body.work.open, 1);
  await assert.rejects(
    db.workItem.create({
      data: { projectId: a, iterationId: foreign, kind: 'TASK', title: '非法跨项目' },
    }),
    (error) => error.code === 'P2003',
  );
  await db.$transaction((tx) =>
    assert.rejects(app.get(IterationsService).assertAssignable(tx, a, foreign), /不属于当前项目/),
  );
  await post(sessions.owner, `${route(id)}/start`, { version: 1 }).expect(201);
  await post(sessions.owner, `${route(id)}/close`, {
    version: 2,
    summary: '不能忽略第二页未完成事项',
  }).expect(422);
});
test('未关闭迭代负责人受移出和停用保护，移交后可正常移出', async () => {
  const id = await create({ ownerId: users.developer.id });
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.developer.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/remove`, {
    version: member.version,
  }).expect(422);
  await post(sessions.admin, `/users/${users.developer.id}/status`, {
    active: false,
    version: users.developer.version,
  }).expect(422);
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await detail(id), { ownerId: users.owner.id }),
  ).expect(201);
  await post(sessions.owner, `/projects/${a}/members/${users.developer.id}/remove`, {
    version: member.version,
  }).expect(201);
});
test('收回迭代管理角色后不能重放旧幂等结果', async () => {
  const view = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.viewer.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.viewer.id}/roles`, {
    version: view.version,
    roles: ['OWNER'],
  }).expect(201);
  const input = plan();
  const key = randomUUID();
  await post(sessions.viewer, route(), input, key).expect(201);
  await post(sessions.owner, `/projects/${a}/members/${users.viewer.id}/roles`, {
    version: view.version + 1,
    roles: ['VIEWER'],
  }).expect(201);
  await post(sessions.viewer, route(), input, key).expect(403);
});
test('项目日期收缩不能排除已有迭代，归档或完成项目只读', async () => {
  const p = await db.project.findUniqueOrThrow({ where: { id: a } });
  await post(sessions.owner, `/projects/${a}/update`, {
    name: p.name,
    description: p.description,
    color: p.color,
    icon: p.icon,
    version: p.version,
    startDate: '2026-11-10',
    endDate: '2026-12-31',
  }).expect(422);
  for (const status of ['ARCHIVED', 'COMPLETED']) {
    await db.project.update({ where: { id: a }, data: { status } });
    try {
      const list = await sessions.admin.agent.get(`/api/v1${route()}`).expect(200);
      assert.equal(list.body.canCreate, false);
      await post(sessions.admin, route(), plan()).expect(403);
      await post(sessions.owner, `${route(base)}/update`, update(await detail(base))).expect(403);
    } finally {
      await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
    }
  }
});
test('审计写入失败时迭代创建也回滚', async () => {
  const database = app.get((await import('../dist/infrastructure/database.js')).Database);
  const original = database.$transaction.bind(database);
  database.$transaction = (callback, ...options) =>
    original(
      (tx) =>
        callback(
          new Proxy(tx, {
            get(target, property) {
              if (property === 'activityLog')
                return {
                  ...target.activityLog,
                  create: async () => {
                    throw new Error('模拟审计故障');
                  },
                };
              const value = Reflect.get(target, property);
              return typeof value === 'function' ? value.bind(target) : value;
            },
          }),
        ),
      ...options,
    );
  const input = plan();
  try {
    await post(sessions.owner, route(), input).expect(500);
  } finally {
    database.$transaction = original;
  }
  assert.equal(await db.iteration.count({ where: { projectId: a, name: input.name } }), 0);
});
test('关闭和纳入新事项并发时互斥，不能出现已关闭但仍纳入未完成事项', async () => {
  const id = await create();
  await post(sessions.owner, `${route(id)}/start`, { version: 1 }).expect(201);
  const [assign, close] = await Promise.allSettled([
    db.$transaction(async (tx) => {
      await app.get(IterationsService).assertAssignable(tx, a, id);
      return tx.workItem.create({
        data: { projectId: a, iterationId: id, kind: 'TASK', title: '并发纳入夹具' },
      });
    }),
    post(sessions.owner, `${route(id)}/close`, { version: 2, summary: '并发关闭' }).then(
      (response) => response.status,
    ),
  ]);
  assert.equal(close.status, 'fulfilled');
  if (assign.status === 'fulfilled') {
    assert.equal(close.value, 422);
    assert.equal((await detail(id)).status, 'ACTIVE');
  } else {
    assert.match(assign.reason.message, /已关闭迭代/);
    assert.equal(close.value, 201);
    assert.equal((await detail(id)).work.open, 0);
  }
});

after(async () => {
  await clearTestStorage(testStorage);
});
