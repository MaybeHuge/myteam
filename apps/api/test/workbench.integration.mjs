import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import request from 'supertest';
import * as argon2 from 'argon2';
import {
  configureTestEnvironment,
  migrateTestDatabase,
  prepareTestStorage,
  clearTestStorage,
  testPassword,
} from './helpers.mjs';
configureTestEnvironment();
migrateTestDatabase();
const storage = await prepareTestStorage();
const { createApp } = await import('../dist/app.js');
const { createDatabase } = await import('../dist/infrastructure/database.js');
const { workbenchDate } = await import('../dist/modules/workbench/workbench.service.js');
const db = createDatabase(process.env.DATABASE_URL);
const nonce = randomUUID();
const users = {},
  sessions = {},
  items = {};
let app, http, a, b;
const today = workbenchDate();
const shifted = (days) =>
  new Date(new Date(today).getTime() + days * 86400000).toISOString().slice(0, 10);
const post = (session, path, data) =>
  session.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', session.csrf)
    .set('Idempotency-Key', randomUUID())
    .send(data);
const list = async (query = '', session = sessions.developer) =>
  (await session.agent.get(`/api/v1/workbench/todos?${query}`).expect(200)).body;
async function login(user) {
  const agent = request.agent(http);
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const response = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: user.email, password: testPassword })
    .expect(201);
  return { agent, csrf: response.body.csrfToken };
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword);
  for (const role of [
    'admin',
    'owner',
    'product',
    'developer',
    'tester',
    'release',
    'viewer',
    'outsider',
  ])
    users[role] = await db.user.create({
      data: {
        email: `${role}-${nonce}@workbench.test`,
        name: role,
        passwordHash,
        isSystemAdmin: role === 'admin',
      },
    });
  app = await createApp();
  http = app.getHttpServer();
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  for (const key of ['A', 'B']) {
    const p = await post(sessions.admin, '/projects', {
      name: key === 'A' ? '工作台可见项目' : '不可见隐私项目',
      key: `W${nonce.slice(0, 7)}${key}`,
      ownerId: key === 'A' ? users.owner.id : users.outsider.id,
    }).expect(201);
    await db.project.update({ where: { id: p.body.id }, data: { status: 'ACTIVE' } });
    if (key === 'A') a = p.body.id;
    else b = p.body.id;
  }
  for (const role of ['product', 'developer', 'tester', 'release', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [role === 'release' ? 'RELEASE_MANAGER' : role.toUpperCase()],
    }).expect(201);
  // 当前模块聚合真实迭代；跨项目无成员关系的负责人记录用于模拟历史异常/权限撤回。
  for (const [key, status, endDate, ownerId, projectId] of [
    ['planning', 'PLANNING', shifted(-1), users.developer.id, a],
    ['today', 'ACTIVE', today, users.developer.id, a],
    ['future', 'ACTIVE', shifted(3), users.developer.id, a],
    ['closed', 'CLOSED', shifted(-2), users.developer.id, a],
    ['other', 'PLANNING', shifted(2), users.owner.id, a],
    ['product', 'PLANNING', shifted(2), users.product.id, a],
    ['tester', 'PLANNING', shifted(2), users.tester.id, a],
    ['release', 'PLANNING', shifted(2), users.release.id, a],
    ['viewer', 'PLANNING', shifted(2), users.viewer.id, a],
    ['foreign', 'ACTIVE', shifted(-1), users.developer.id, b],
  ])
    items[key] = await db.iteration.create({
      data: {
        projectId,
        name: `工作台 ${key} ${nonce}`,
        goal: '跟进本轮交付',
        ownerId,
        status,
        startDate: new Date(shifted(-10)),
        endDate: new Date(endDate),
      },
    });
  await db.notification.create({
    data: {
      projectId: a,
      recipientId: users.developer.id,
      targetType: 'ITERATION',
      targetId: items.closed.id,
      title: '旧的迭代安排消息',
    },
  });
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    storage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  const projects = [a, b].filter(Boolean),
    people = Object.values(users).map((user) => user.id);
  await db.activityLog.deleteMany({ where: { projectId: { in: projects } } });
  await db.project.deleteMany({ where: { id: { in: projects } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: people } } });
  await db.user.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
  await clearTestStorage(storage);
});
test('待办未登录不可读，仅返回本人负责且仍为成员的未关闭迭代', async () => {
  await request(http).get('/api/v1/workbench/todos').expect(401);
  const data = await list();
  assert.equal(data.total, 3);
  assert.deepEqual(
    data.items.map((item) => item.id),
    [items.planning.id, items.today.id, items.future.id],
  );
  assert.deepEqual(data.summary, {
    total: 3,
    planning: 1,
    active: 2,
    overdue: 1,
    tasks: 0,
    reviews: 0,
    caseReviews: 0,
    caseRechecks: 0,
    assistance: 0,
    blocked: 0,
  });
  assert.equal(data.timeZone, 'Asia/Shanghai');
  assert.equal(data.today, today);
  assert.equal('ownerId' in data.items[0], false);
  assert.equal((await list(`ownerId=${users.owner.id}`)).total, 3);
});
test('按状态、逾期、项目和关键词筛选，统计与列表不泄露不可见项目', async () => {
  assert.equal((await list('status=PLANNING')).total, 1);
  const active = await list('status=ACTIVE');
  assert.equal(active.total, 2);
  assert.equal(active.summary.total, 3);
  const overdue = await list('status=overdue');
  assert.deepEqual(
    overdue.items.map((item) => item.id),
    [items.planning.id],
  );
  assert.equal((await list(`projectId=${b}`)).summary.total, 0);
  assert.equal((await list('q=不可见隐私')).total, 0);
  assert.equal((await list('q=工作台可见')).total, 3);
  assert.equal((await list(`q=${encodeURIComponent('future ' + nonce)}`)).summary.total, 1);
});
test('分页稳定、计数完整、越界页为空，拒绝非法分页和筛选', async () => {
  const first = await list('pageSize=1&page=1'),
    second = await list('pageSize=1&page=2');
  assert.equal(first.total, 3);
  assert.equal(second.total, 3);
  assert.notEqual(first.items[0].id, second.items[0].id);
  const empty = await list('page=100&pageSize=1');
  assert.equal(empty.total, 3);
  assert.deepEqual(empty.items, []);
  for (const query of [
    'page=0',
    'page=1.5',
    'page=100001',
    'pageSize=101',
    'projectId=invalid',
    'status=CLOSED',
    `q=${'a'.repeat(101)}`,
  ])
    await sessions.developer.agent.get(`/api/v1/workbench/todos?${query}`).expect(400);
});
test('系统管理员也只查看我的范围，只读成员可跟进自己负责的迭代', async () => {
  assert.equal((await list('', sessions.admin)).total, 0);
  const viewer = await list('', sessions.viewer);
  assert.equal(viewer.total, 1);
  assert.equal(viewer.items[0].id, items.viewer.id);
  await post(sessions.viewer, `/projects/${a}/iterations/${items.viewer.id}/start`, {
    version: 1,
  }).expect(403);
});
test('M1 多角色退出检查：产品、开发、测试、发布和只读账号仅可见授权项目与自己的跟进', async () => {
  for (const role of ['product', 'developer', 'tester', 'release', 'viewer']) {
    const projects = await sessions[role].agent.get('/api/v1/projects').expect(200);
    assert.equal(projects.body.total, 1);
    assert.equal(projects.body.items[0].id, a);
    await sessions[role].agent.get(`/api/v1/projects/${b}`).expect(404);
    const mine = await list('', sessions[role]);
    assert.equal(mine.total, role === 'developer' ? 3 : 1);
    if (role !== 'developer') assert.equal(mine.items[0].id, items[role].id);
  }
});
test('待验收/完成/归档项目不再产生迭代跟进，暂停项目仍保留安排', async () => {
  try {
    for (const status of ['ACCEPTING', 'COMPLETED', 'ARCHIVED']) {
      await db.project.update({ where: { id: a }, data: { status } });
      const result = await list();
      assert.equal(result.total, 0);
      assert.equal(result.summary.overdue, 0);
    }
    await db.project.update({ where: { id: a }, data: { status: 'PAUSED' } });
    assert.equal((await list()).total, 3);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  }
});
test('正式改派和关闭命令即时更新待办，旧未读通知不会让已关闭事项复现', async () => {
  const item = items.future;
  try {
    await post(sessions.owner, `/projects/${a}/iterations/${item.id}/update`, {
      name: item.name,
      goal: item.goal,
      ownerId: users.owner.id,
      startDate: item.startDate.toISOString().slice(0, 10),
      endDate: item.endDate.toISOString().slice(0, 10),
      version: item.version,
    }).expect(201);
    assert.equal((await list()).total, 2);
    assert.ok((await list('', sessions.owner)).items.some((row) => row.id === item.id));
    await post(sessions.owner, `/projects/${a}/iterations/${item.id}/close`, {
      version: 2,
      summary: '本轮已核对',
    }).expect(201);
    assert.ok(!(await list('', sessions.owner)).items.some((row) => row.id === item.id));
    const messages = await sessions.developer.agent.get('/api/v1/notifications').expect(200);
    assert.ok(messages.body.unread > 0);
    assert.ok(!(await list()).items.some((row) => row.id === items.closed.id));
  } finally {
    await db.iteration.update({
      where: { id: item.id },
      data: {
        status: 'ACTIVE',
        ownerId: users.developer.id,
        version: 1,
        closedAt: null,
        closeSummary: null,
      },
    });
  }
});
test('成员权限撤回后同一会话的列表、筛选与统计立即隐藏项目', async () => {
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.developer.id } },
  });
  await db.projectMember.delete({
    where: { projectId_userId: { projectId: a, userId: users.developer.id } },
  });
  try {
    const result = await list();
    assert.equal(result.total, 0);
    assert.equal(result.summary.total, 0);
    assert.equal((await list(`projectId=${a}`)).summary.total, 0);
  } finally {
    await db.projectMember.create({ data: member });
  }
});
test('停用账号后原会话不可继续访问工作台', async () => {
  await post(sessions.owner, `/projects/${a}/iterations/${items.viewer.id}/update`, {
    name: items.viewer.name,
    goal: items.viewer.goal,
    ownerId: users.owner.id,
    startDate: items.viewer.startDate.toISOString().slice(0, 10),
    endDate: items.viewer.endDate.toISOString().slice(0, 10),
    version: 1,
  }).expect(201);
  await post(sessions.admin, `/users/${users.viewer.id}/status`, {
    active: false,
    version: 1,
  }).expect(201);
  await sessions.viewer.agent.get('/api/v1/workbench/todos').expect(401);
});
test('截止日按上海时区计算，UTC 日期不同也不会提前算逾期', () => {
  assert.equal(workbenchDate(new Date('2026-10-26T15:59:59Z')), '2026-10-26');
  assert.equal(workbenchDate(new Date('2026-10-26T16:00:00Z')), '2026-10-27');
});
