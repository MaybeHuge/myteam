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
const db = createDatabase(process.env.DATABASE_URL);
const nonce = randomUUID();
const suffix = `${nonce}@projects-integration.test`;
const prefix = `P${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}`;
const email = (name) => `${name}-${suffix}`;
let app, http, users, sessions, a, b;
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
const updateData = (p, extra = {}) => ({
  name: p.name,
  description: p.description,
  color: p.color,
  icon: p.icon,
  startDate: p.startDate,
  endDate: p.endDate,
  version: p.version,
  ...extra,
});
const detail = async (session, id) =>
  (await session.agent.get(`/api/v1/projects/${id}`).expect(200)).body;
async function member(session, project, userId, roles) {
  const record = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: project, userId } },
  });
  return post(session, `/projects/${project}/members/${userId}/roles`, {
    version: record.version,
    roles,
  });
}

before(async () => {
  users = {};
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  for (const role of ['admin', 'owner', 'viewer', 'developer', 'outsider'])
    users[role] = await db.user.create({
      data: { email: email(role), name: role, passwordHash, isSystemAdmin: role === 'admin' },
    });
  app = await createApp();
  http = app.getHttpServer();
  sessions = {};
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  const first = await post(sessions.admin, '/projects', {
    key: `${prefix}A`,
    name: '隔离项目 A',
    ownerId: users.owner.id,
    description: '仅 A 项目成员可见',
  }).expect(201);
  const second = await post(sessions.admin, '/projects', {
    key: `${prefix}B`,
    name: '隔离项目 B',
    ownerId: users.outsider.id,
  }).expect(201);
  a = first.body.id;
  b = second.body.id;
  await post(sessions.owner, `/projects/${a}/members`, {
    email: users.viewer.email,
    roles: ['VIEWER'],
  }).expect(201);
  await post(sessions.owner, `/projects/${a}/members`, {
    email: users.developer.email,
    roles: ['DEVELOPER'],
  }).expect(201);
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    testStorage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  const all = await db.user.findMany({
    where: { email: { endsWith: suffix } },
    select: { id: true },
  });
  const ids = all.map((user) => user.id);
  const projects = await db.project.findMany({
    where: { key: { startsWith: prefix } },
    select: { id: true },
  });
  await db.activityLog.deleteMany({
    where: { OR: [{ actorId: { in: ids } }, { projectId: { in: projects.map((p) => p.id) } }] },
  });
  await db.project.deleteMany({ where: { id: { in: projects.map((p) => p.id) } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: ids } } });
  await db.loginAttempt.deleteMany({ where: { email: { endsWith: suffix } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});

test('未登录不能访问项目；普通成员仅看到授权项目及相应统计', async () => {
  await request(http).get('/api/v1/projects').expect(401);
  const owner = await sessions.owner.agent.get('/api/v1/projects').expect(200);
  assert.deepEqual(
    owner.body.items.map((p) => p.id),
    [a],
  );
  assert.equal(owner.body.stats.total, 1);
  assert.equal(owner.body.canCreate, false);
  const outsider = await sessions.outsider.agent.get('/api/v1/projects').expect(200);
  assert.deepEqual(
    outsider.body.items.map((p) => p.id),
    [b],
  );
  assert.equal(outsider.body.stats.total, 1);
});
test('非成员直接访问详情、成员、动态和写入均不能越过项目隔离', async () => {
  for (const path of [`/projects/${b}`, `/projects/${b}/members`, `/projects/${b}/activity`])
    await sessions.owner.agent.get(`/api/v1${path}`).expect(404);
  const hidden = await sessions.owner.agent.get(`/api/v1/projects/${b}`).expect(404);
  const absent = await sessions.owner.agent.get(`/api/v1/projects/${randomUUID()}`).expect(404);
  assert.equal(hidden.body.message, absent.body.message);
  const p = await detail(sessions.outsider, b);
  await post(sessions.owner, `/projects/${b}/update`, updateData(p, { name: '越权修改' })).expect(
    404,
  );
  assert.equal((await detail(sessions.outsider, b)).name, '隔离项目 B');
});
test('只读成员可查看但不能编辑、启停项目或管理成员', async () => {
  const p = await detail(sessions.viewer, a);
  assert.deepEqual(p.allowedActions, []);
  await sessions.viewer.agent.get(`/api/v1/projects/${a}/members`).expect(200);
  for (const [path, body] of [
    [`/projects/${a}/update`, updateData(p)],
    [`/projects/${a}/status`, { status: 'ACTIVE', version: p.version }],
    [`/projects/${a}/members`, { email: users.outsider.email, roles: ['VIEWER'] }],
    [`/projects/${a}/members/${users.developer.id}/roles`, { roles: ['OWNER'], version: 1 }],
    [`/projects/${a}/members/${users.developer.id}/remove`, { version: 1 }],
  ])
    await post(sessions.viewer, path, body).expect(403);
});
test('只有管理员可以创建项目，管理员跨项目访问保留审计', async () => {
  await post(sessions.owner, '/projects', { key: `${prefix}X`, name: '不应创建' }).expect(403);
  const result = await sessions.admin.agent.get('/api/v1/projects').expect(200);
  assert.ok(result.body.items.some((p) => p.id === a));
  assert.ok(result.body.items.some((p) => p.id === b));
  assert.equal((await detail(sessions.admin, b)).access, 'ADMIN');
  assert.ok(
    await db.activityLog.count({
      where: { actorId: users.admin.id, projectId: b, action: 'project.admin.access' },
    }),
  );
});
test('创建校验日期和标识，拒绝重复，重试不重复创建', async () => {
  await post(sessions.admin, '/projects', { key: 'BAD-KEY', name: '错误标识' }).expect(400);
  await post(sessions.admin, '/projects', {
    key: `${prefix}D`,
    name: '错误日期',
    startDate: '2026-11-30',
    endDate: '2026-11-01',
  }).expect(400);
  await post(sessions.admin, '/projects', { key: `${prefix}A`, name: '重复' }).expect(409);
  const key = randomUUID();
  const input = { key: `${prefix}R`, name: '幂等创建' };
  const [first, second] = await Promise.all([
    post(sessions.admin, '/projects', input, key),
    post(sessions.admin, '/projects', input, key),
  ]);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.equal(first.body.id, second.body.id);
  assert.equal(await db.project.count({ where: { key: input.key } }), 1);
});
test('搜索、状态与负责人筛选仍遵循可见范围', async () => {
  const query = await sessions.owner.agent.get(`/api/v1/projects?q=${prefix}B`).expect(200);
  assert.equal(query.body.total, 0);
  const own = await sessions.owner.agent.get('/api/v1/projects?scope=owned').expect(200);
  assert.deepEqual(
    own.body.items.map((p) => p.id),
    [a],
  );
  await sessions.owner.agent.get('/api/v1/projects?pageSize=101').expect(400);
  const search = await sessions.owner.agent
    .get(`/api/v1/projects?q=${prefix}A&status=PENDING`)
    .expect(200);
  assert.equal(search.body.total, 1);
});
test('成员检索仅在当前项目内进行，不能用于枚举其他项目成员', async () => {
  const matched = await sessions.owner.agent
    .get(`/api/v1/projects/${a}/members?q=viewer`)
    .expect(200);
  assert.equal(matched.body.total, 1);
  assert.equal(matched.body.items[0].user.id, users.viewer.id);
  const hidden = await sessions.owner.agent
    .get(`/api/v1/projects/${a}/members?q=outsider`)
    .expect(200);
  assert.equal(hidden.body.total, 0);
  await sessions.owner.agent.get(`/api/v1/projects/${b}/members?q=outsider`).expect(404);
});
test('候选成员支持姓名/邮箱搜索和分页，只列出未加入的可用账号与必要字段', async () => {
  const path = `/api/v1/projects/${a}/member-options`;
  const first = await sessions.owner.agent.get(path).query({ q: suffix, pageSize: 1 }).expect(200);
  const second = await sessions.owner.agent
    .get(path)
    .query({ q: suffix, pageSize: 1, page: 2 })
    .expect(200);
  assert.equal(first.body.total, 2);
  assert.equal(first.body.items.length, 1);
  assert.equal(second.body.items.length, 1);
  assert.notEqual(first.body.items[0].id, second.body.items[0].id);
  assert.deepEqual(
    new Set([...first.body.items, ...second.body.items].map((u) => u.id)),
    new Set([users.admin.id, users.outsider.id]),
  );
  assert.deepEqual(Object.keys(first.body.items[0]).sort(), ['email', 'id', 'name']);
  const byName = await sessions.owner.agent.get(path).query({ q: 'OUTSIDER' }).expect(200);
  assert.ok(byName.body.items.some((u) => u.id === users.outsider.id));
  const byEmail = await sessions.owner.agent
    .get(path)
    .query({ q: users.outsider.email.toUpperCase() })
    .expect(200);
  assert.deepEqual(
    byEmail.body.items.map((u) => u.id),
    [users.outsider.id],
  );
  const joined = await sessions.owner.agent.get(path).query({ q: users.viewer.email }).expect(200);
  assert.equal(joined.body.total, 0);
  const missing = await sessions.owner.agent
    .get(path)
    .query({ q: `missing-${nonce}` })
    .expect(200);
  assert.equal(missing.body.total, 0);
  await db.user.update({ where: { id: users.outsider.id }, data: { active: false } });
  try {
    const inactive = await sessions.owner.agent
      .get(path)
      .query({ q: users.outsider.email })
      .expect(200);
    assert.equal(inactive.body.total, 0);
  } finally {
    await db.user.update({ where: { id: users.outsider.id }, data: { active: true } });
  }
  await sessions.owner.agent.get(path).query({ pageSize: 101 }).expect(400);
});
test('候选账号仅开放给当前项目的成员管理者或管理员', async () => {
  const path = `/api/v1/projects/${a}/member-options`;
  await request(http).get(path).expect(401);
  await sessions.viewer.agent.get(path).expect(403);
  await sessions.developer.agent.get(path).expect(403);
  await sessions.outsider.agent.get(path).expect(404);
  await sessions.owner.agent.get(`/api/v1/projects/${b}/member-options`).expect(404);
  await sessions.admin.agent.get(path).expect(200);
});
test('更新校验版本，项目标识不可通过普通编辑更改', async () => {
  const p = await detail(sessions.owner, a);
  const results = await Promise.all([
    post(
      sessions.owner,
      `/projects/${a}/update`,
      updateData(p, { name: '并发修改一', key: 'ILLEGAL' }),
    ),
    post(sessions.owner, `/projects/${a}/update`, updateData(p, { name: '并发修改二' })),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await detail(sessions.owner, a)).key, `${prefix}A`);
});
test('生命周期支持启动、暂停与继续，不能跳到已完成', async () => {
  let p = await detail(sessions.owner, a);
  await post(sessions.owner, `/projects/${a}/status`, {
    status: 'ACTIVE',
    version: p.version,
  }).expect(201);
  p = await detail(sessions.owner, a);
  await post(sessions.owner, `/projects/${a}/status`, {
    status: 'PAUSED',
    version: p.version,
  }).expect(400);
  await post(sessions.owner, `/projects/${a}/status`, {
    status: 'PAUSED',
    reason: '等待评审',
    version: p.version,
  }).expect(201);
  p = await detail(sessions.owner, a);
  await post(sessions.owner, `/projects/${a}/status`, {
    status: 'ACTIVE',
    version: p.version,
  }).expect(201);
  p = await detail(sessions.owner, a);
  await post(sessions.owner, `/projects/${a}/status`, {
    status: 'COMPLETED',
    version: p.version,
  }).expect(400);
});
test('主负责人不能移除或失去负责人角色；外项目成员 ID 不能被修改', async () => {
  const owner = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.owner.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.owner.id}/remove`, {
    version: owner.version,
  }).expect(422);
  await member(sessions.owner, a, users.owner.id, ['VIEWER']).then((r) =>
    assert.equal(r.status, 422),
  );
  await post(sessions.owner, `/projects/${a}/members/${users.outsider.id}/roles`, {
    roles: ['VIEWER'],
    version: 1,
  }).expect(404);
  const outsider = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: b, userId: users.outsider.id } },
  });
  assert.deepEqual(outsider.roles, ['OWNER']);
});
test('成员可以兼任角色，降权后旧幂等键也不能重放管理操作', async () => {
  assert.equal(
    (await member(sessions.owner, a, users.developer.id, ['OWNER', 'DEVELOPER'])).status,
    201,
  );
  const p = await detail(sessions.developer, a);
  const key = randomUUID();
  const input = updateData(p, { description: '授权管理操作' });
  await post(sessions.developer, `/projects/${a}/update`, input, key).expect(201);
  assert.equal((await member(sessions.owner, a, users.developer.id, ['VIEWER'])).status, 201);
  await post(sessions.developer, `/projects/${a}/update`, input, key).expect(403);
  assert.deepEqual((await detail(sessions.developer, a)).allowedActions, []);
});
test('添加成员拒绝重复及停用账号，移除后旧会话不能继续读取项目', async () => {
  await post(sessions.owner, `/projects/${a}/members`, {
    email: users.viewer.email,
    roles: ['VIEWER'],
  }).expect(409);
  const record = await db.user.findUniqueOrThrow({ where: { id: users.developer.id } });
  await post(sessions.admin, `/users/${users.developer.id}/status`, {
    active: false,
    version: record.version,
  }).expect(201);
  await post(sessions.owner, `/projects/${b}/members`, {
    email: users.developer.email,
    roles: ['VIEWER'],
  }).expect(404);
  const ownProject = await post(sessions.admin, '/projects', {
    key: `${prefix}I`,
    name: '停用成员检查',
  }).expect(201);
  await post(sessions.admin, `/projects/${ownProject.body.id}/members`, {
    email: users.developer.email,
    roles: ['VIEWER'],
  }).expect(422);
  const view = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.viewer.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.viewer.id}/remove`, {
    version: view.version,
  }).expect(201);
  await sessions.viewer.agent.get(`/api/v1/projects/${a}`).expect(404);
  const list = await sessions.viewer.agent.get('/api/v1/projects').expect(200);
  assert.equal(list.body.total, 0);
  await post(sessions.owner, `/projects/${a}/members`, {
    email: users.viewer.email,
    roles: ['VIEWER'],
  }).expect(201);
  const rejoined = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.viewer.id } },
  });
  assert.ok(rejoined.version > view.version);
  await post(sessions.owner, `/projects/${a}/members/${users.viewer.id}/roles`, {
    roles: ['OWNER'],
    version: view.version,
  }).expect(409);
});
test('已归档项目对负责人和管理员都只读', async () => {
  const result = await post(sessions.admin, '/projects', {
    key: `${prefix}C`,
    name: '归档检查',
    ownerId: users.owner.id,
  }).expect(201);
  await db.project.update({ where: { id: result.body.id }, data: { status: 'ARCHIVED' } });
  const p = await detail(sessions.owner, result.body.id);
  assert.deepEqual(p.allowedActions, []);
  await sessions.owner.agent.get(`/api/v1/projects/${p.id}/member-options`).expect(403);
  await sessions.admin.agent.get(`/api/v1/projects/${p.id}/member-options`).expect(403);
  await post(sessions.owner, `/projects/${p.id}/update`, updateData(p)).expect(403);
  await post(sessions.admin, `/projects/${p.id}/members`, {
    email: users.viewer.email,
    roles: ['VIEWER'],
  }).expect(403);
});
test('管理员创建普通账号，密码受哈希保护，命令重试仍保持单次效果', async () => {
  const input = {
    email: email('created'),
    name: '新成员',
    password: testPassword,
    isSystemAdmin: true,
  };
  const key = randomUUID();
  const first = await post(sessions.admin, '/users', input, key).expect(201);
  const second = await post(sessions.admin, '/users', input, key).expect(201);
  assert.equal(first.body.id, second.body.id);
  const stored = await db.user.findUniqueOrThrow({ where: { id: first.body.id } });
  assert.equal(stored.isSystemAdmin, false);
  assert.ok(await argon2.verify(stored.passwordHash, testPassword));
  await post(
    sessions.admin,
    '/users',
    { ...input, password: 'A-different-password-2026!' },
    key,
  ).expect(409);
  await post(sessions.owner, '/users', { ...input, email: email('denied') }).expect(403);
  assert.equal(
    JSON.stringify(
      await db.idempotencyRecord.findMany({ where: { actorId: users.admin.id } }),
    ).includes(testPassword),
    false,
  );
});
test('主负责人移交前不能停用；移交后角色保留并收回停用账号会话', async () => {
  let user = await db.user.findUniqueOrThrow({ where: { id: users.owner.id } });
  await post(sessions.admin, `/users/${user.id}/status`, {
    active: false,
    version: user.version,
  }).expect(422);
  const p = await detail(sessions.owner, a);
  await post(
    sessions.owner,
    `/projects/${a}/update`,
    updateData(p, { ownerId: users.viewer.id }),
  ).expect(201);
  const changed = await detail(sessions.viewer, a);
  assert.equal(changed.owner.id, users.viewer.id);
  assert.ok(changed.myRoles.includes('OWNER'));
  const former = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.owner.id } },
  });
  assert.ok(former.roles.includes('OWNER'));
  user = await db.user.findUniqueOrThrow({ where: { id: users.owner.id } });
  await post(sessions.admin, `/users/${user.id}/status`, {
    active: false,
    version: user.version,
  }).expect(201);
  await sessions.owner.agent.get(`/api/v1/projects/${a}`).expect(401);
});

after(async () => {
  await clearTestStorage(testStorage);
});
