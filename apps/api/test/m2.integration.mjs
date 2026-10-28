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
const storage = await prepareTestStorage();
const { createApp } = await import('../dist/app.js');
const { createDatabase } = await import('../dist/infrastructure/database.js');
const { RequirementValidity } = await import('../dist/common/requirement-validity.js');
const { CollaborationEvents } = await import('../dist/common/collaboration-events.js');
const db = createDatabase(process.env.DATABASE_URL),
  nonce = randomUUID(),
  suffix = `${nonce}@m2.test`,
  prefix = `M${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}`;
const users = {},
  sessions = {};
let app, http, a, b, requirement, active, closed;
const route = (id = '', projectId = a) => `/projects/${projectId}/tasks${id ? `/${id}` : ''}`;
const post = (session, path, input, key = randomUUID()) =>
  session.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', session.csrf)
    .set('Idempotency-Key', key)
    .send(input);
async function login(user) {
  const agent = request.agent(http),
    csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: user.email, password: testPassword })
    .expect(201);
  return { agent, csrf: result.body.csrfToken };
}
const input = (extra = {}) => ({
  title: `实现任务 ${randomUUID()}`,
  requirementId: requirement,
  description: '实现权限校验和客户搜索，并记录自测结果',
  priority: 'HIGH',
  estimatedHours: 2.25,
  dueDate: '2026-11-10',
  assigneeId: users.developer.id,
  ...extra,
});
const get = async (id, session = sessions.owner) =>
  (await session.agent.get(`/api/v1${route(id)}`).expect(200)).body;
const create = async (extra = {}, session = sessions.owner) =>
  (await post(session, route(), input(extra)).expect(201)).body.id;
const assign = async (id, assigneeId, session = sessions.owner, extra = {}) => {
  const version = (await get(id)).version;
  return {
    expect: (status) =>
      post(session, `${route(id)}/assign`, {
        version,
        assigneeId,
        reason: '调整实现安排',
        ...extra,
      }).expect(status),
  };
};
async function makeRequirement(extra = {}, confirmed = true, projectId = a) {
  const id = (
    await post(sessions.admin, `/projects/${projectId}/requirements`, {
      title: `任务关联需求 ${randomUUID()}`,
      description: '客户搜索的业务场景',
      acceptanceCriteria: '搜索仅返回授权客户数据',
      ownerId: projectId === a ? users.product.id : users.outsider.id,
      ...extra,
    }).expect(201)
  ).body.id;
  if (confirmed) {
    const path = `/projects/${projectId}/requirements/${id}`;
    await post(sessions.admin, `${path}/submit`, {
      version: 1,
      reviewerId: projectId === a ? users.owner.id : users.outsider.id,
    }).expect(201);
    await post(sessions.admin, `${path}/approve`, {
      version: 2,
      comment: '代为核对本轮任务拆解依据',
    }).expect(201);
  }
  return id;
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  for (const role of [
    'admin',
    'owner',
    'product',
    'developer',
    'developer2',
    'handoff',
    'tester',
    'viewer',
    'outsider',
  ])
    users[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${suffix}`,
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
      key: `${prefix}${key}`,
      name: `任务隔离 ${key}`,
      ownerId: key === 'A' ? users.owner.id : users.outsider.id,
    }).expect(201);
    await db.project.update({ where: { id: result.body.id }, data: { status: 'ACTIVE' } });
    if (key === 'A') a = result.body.id;
    else b = result.body.id;
  }
  for (const role of ['product', 'developer', 'developer2', 'handoff', 'tester', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [
        role.startsWith('developer') || role === 'handoff' ? 'DEVELOPER' : role.toUpperCase(),
      ],
    }).expect(201);
  const plan = {
    name: `任务迭代 ${nonce}`,
    goal: '核对任务基础',
    ownerId: users.owner.id,
    startDate: '2026-11-01',
    endDate: '2026-11-14',
  };
  active = (await post(sessions.owner, `/projects/${a}/iterations`, plan).expect(201)).body.id;
  await post(sessions.owner, `/projects/${a}/iterations/${active}/start`, { version: 1 }).expect(
    201,
  );
  closed = (
    await post(sessions.owner, `/projects/${a}/iterations`, {
      ...plan,
      name: `${plan.name} 关闭`,
    }).expect(201)
  ).body.id;
  await post(sessions.owner, `/projects/${a}/iterations/${closed}/start`, { version: 1 }).expect(
    201,
  );
  await post(sessions.owner, `/projects/${a}/iterations/${closed}/close`, {
    version: 2,
    summary: '空迭代关闭夹具',
  }).expect(201);
  requirement = await makeRequirement({ iterationId: active });
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    storage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  await clearTestStorage(storage);
  const ids = [a, b].filter(Boolean),
    people = Object.values(users).map((user) => user.id);
  await db.activityLog.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: people } } });
  await db.loginAttempt.deleteMany({ where: { email: { endsWith: suffix } } });
  await db.user.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
});
const change = async (
  id,
  action,
  extra = {},
  expected = 201,
  session = sessions.developer,
  key = randomUUID(),
) =>
  post(
    session,
    `${route(id)}/${action}`,
    { version: (await get(id)).version, ...extra },
    key,
  ).expect(expected);
const reqGet = async (id) =>
  (await sessions.owner.agent.get(`/api/v1/projects/${a}/requirements/${id}`).expect(200)).body;
const reqInput = (row, extra = {}) => ({
  title: row.title,
  description: row.description,
  acceptanceCriteria: row.acceptanceCriteria,
  type: row.type,
  priority: row.priority,
  ownerId: row.ownerId,
  iterationId: row.iterationId,
  version: row.version,
  ...extra,
});
const revise = async (id, extra = {}, key = randomUUID()) =>
  post(
    sessions.owner,
    `/projects/${a}/requirements/${id}/revise`,
    reqInput(await reqGet(id), {
      acceptanceCriteria: '修订标准：新增边界场景和权限提示',
      reason: '新增明确的权限边界',
      impact: '开发核对实现，测试复审用例并重新确认验收依据',
      ...extra,
    }),
    key,
  ).expect(201);
const approve = async (id) => {
  const row = await reqGet(id),
    path = `/projects/${a}/requirements/${id}`;
  await post(sessions.owner, `${path}/submit`, {
    version: row.version,
    reviewerId: users.product.id,
  }).expect(201);
  await post(sessions.product, `${path}/approve`, { version: row.version + 1 }).expect(201);
};
const wb = async (session = sessions.developer, query = {}) =>
  (
    await session.agent
      .get('/api/v1/workbench/todos')
      .query({ projectId: a, ...query })
      .expect(200)
  ).body;
test('阻塞独立于业务状态，要求原因与合资格协助人，恢复保留责任和完整历史', async () => {
  const id = await create();
  await change(id, 'block', { reason: '', helperId: users.product.id }, 400);
  for (const role of ['outsider', 'viewer'])
    await change(id, 'block', { reason: '缺少业务说明', helperId: users[role].id }, 422);
  await db.user.update({ where: { id: users.developer2.id }, data: { active: false } });
  try {
    await change(id, 'block', { reason: '等待协助', helperId: users.developer2.id }, 422);
  } finally {
    await db.user.update({ where: { id: users.developer2.id }, data: { active: true } });
  }
  await change(id, 'block', { reason: '等待确认查询边界', helperId: users.product.id });
  let row = await get(id);
  assert.equal(row.status, 'TODO');
  assert.equal(row.blocked, true);
  assert.equal(row.helper.id, users.product.id);
  assert.ok(row.blockedAt);
  assert.ok(!row.allowedActions.includes('start'));
  await change(id, 'start', {}, 422);
  await change(id, 'resume', { reason: '业务边界已核对' });
  row = await get(id);
  assert.equal(row.status, 'TODO');
  assert.equal(row.blocked, false);
  assert.equal(row.helper, null);
  assert.equal(row.history.total, 3);
  await change(id, 'start');
  await change(id, 'block', { reason: '等待接口依赖', helperId: users.product.id });
  await change(id, 'resume', { reason: '接口依赖已经就绪' });
  assert.equal((await get(id)).status, 'IN_PROGRESS');
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'OPEN');
});
test('完成与重新开始遵守对象责任、版本和幂等，阻塞任务不能完成', async () => {
  const id = await create();
  await change(id, 'start');
  for (const role of ['product', 'developer2', 'viewer', 'outsider'])
    await change(
      id,
      'complete',
      { reason: '越权' },
      role === 'outsider' ? 404 : 403,
      sessions[role],
    );
  await change(id, 'block', { reason: '接口需协作', helperId: users.product.id });
  await change(id, 'complete', { reason: '未解除阻塞' }, 422);
  await change(id, 'resume', { reason: '依赖已就绪' });
  const row = await get(id),
    results = await Promise.all(
      ['A', 'B'].map((reason) =>
        post(sessions.developer, `${route(id)}/complete`, { version: row.version, reason }),
      ),
    );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  const completed = await get(id);
  assert.equal(completed.status, 'COMPLETED');
  assert.equal(completed.blocked, false);
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'DONE');
  const key = randomUUID(),
    payload = { version: completed.version, reason: '补充实现' };
  await post(sessions.developer, `${route(id)}/reopen`, payload, key).expect(201);
  await post(sessions.developer, `${route(id)}/reopen`, payload, key).expect(201);
  assert.equal((await get(id)).status, 'IN_PROGRESS');
});
test('看板分列分页、筛选和统计覆盖全部记录，拖动对应命令失败时状态不变', async () => {
  const marker = `看板 ${nonce}`;
  const ids = [];
  for (let index = 0; index < 13; index++)
    ids.push(
      await create({ title: `${marker} ${index}`, dueDate: index === 0 ? '2000-01-01' : null }),
    );
  await change(ids[0], 'block', { reason: '统计第二页以外的阻塞', helperId: users.product.id });
  const board = (
    await sessions.viewer.agent
      .get(`/api/v1${route('board')}`)
      .query({ q: marker, pageSize: 5, todoPage: 3 })
      .expect(200)
  ).body;
  assert.equal(board.summary.total, 13);
  assert.equal(board.summary.blocked, 1);
  assert.equal(board.summary.overdue, 1);
  assert.equal(board.columns[0].total, 13);
  assert.equal(board.columns[0].items.length, 3);
  assert.ok(board.columns[0].items.every((item) => item.allowedActions.length === 0));
  const filtered = (
    await sessions.owner.agent
      .get(`/api/v1${route('board')}`)
      .query({ q: marker, blocked: 'true', overdue: 'true' })
      .expect(200)
  ).body;
  assert.equal(filtered.summary.total, 1);
  assert.equal(filtered.columns[0].items[0].id, ids[0]);
  const version = (await get(ids[1])).version;
  await change(ids[1], 'start');
  await post(sessions.developer, `${route(ids[1])}/complete`, {
    version,
    reason: '旧卡片版本',
  }).expect(409);
  assert.equal((await get(ids[1])).status, 'IN_PROGRESS');
  await sessions.outsider.agent.get(`/api/v1${route('board')}`).expect(404);
});
test('协助人受移出停用及协作失权保护，可通过调整阻塞安排移交', async () => {
  const id = await create();
  await change(id, 'block', { reason: '请帮忙核对', helperId: users.handoff.id });
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.handoff.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.handoff.id}/remove`, {
    version: member.version,
  }).expect(422);
  await post(sessions.owner, `/projects/${a}/members/${users.handoff.id}/roles`, {
    version: member.version,
    roles: ['VIEWER'],
  }).expect(422);
  await post(sessions.admin, `/users/${users.handoff.id}/status`, {
    version: users.handoff.version,
    active: false,
  }).expect(422);
  await change(id, 'block', { reason: '改由产品核对', helperId: users.product.id });
  await post(sessions.owner, `/projects/${a}/members/${users.handoff.id}/roles`, {
    version: member.version,
    roles: ['VIEWER'],
  }).expect(201);
});
test('已确认需求修订保存不可覆盖的前后快照、影响和任务范围，旧评审不变且须重新评审', async () => {
  const reqId = await makeRequirement(),
    first = await create({ requirementId: reqId, iterationId: null }),
    second = await create({ requirementId: reqId, iterationId: null });
  await change(first, 'start');
  const original = await reqGet(reqId),
    key = randomUUID(),
    payload = reqInput(original, {
      acceptanceCriteria: '修订标准：增加无权限的响应',
      reason: '扩展异常场景',
      impact: '两项任务需核对，测试需复审用例',
    });
  await post(sessions.owner, `/projects/${a}/requirements/${reqId}/revise`, payload, key).expect(
    201,
  );
  await post(sessions.owner, `/projects/${a}/requirements/${reqId}/revise`, payload, key).expect(
    201,
  );
  let row = await reqGet(reqId);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.scopeVersion, 1);
  assert.equal(row.acceptedRevision, 1);
  assert.equal(row.changes.total, 1);
  assert.deepEqual(new Set(row.changes.items[0].affectedTaskIds), new Set([first, second]));
  assert.equal(row.baseline.acceptanceCriteria, original.acceptanceCriteria);
  assert.equal(row.history.total, 2);
  assert.equal((await get(first)).needsRequirementReview, true);
  await change(second, 'start', {}, 422);
  await change(first, 'acknowledge', { reason: '尚未确认', requirementRevision: 2 }, 422);
  await approve(reqId);
  row = await reqGet(reqId);
  assert.equal(row.status, 'IMPLEMENTING');
  assert.equal(row.acceptedRevision, 2);
  assert.equal(row.history.total, 4);
  assert.equal(
    row.history.items.find((item) => item.round === 1).snapshot.acceptanceCriteria,
    original.acceptanceCriteria,
  );
  await change(
    first,
    'acknowledge',
    { reason: '按新标准补齐异常分支', requirementRevision: 1 },
    409,
  );
  await change(first, 'acknowledge', { reason: '按新标准补齐异常分支', requirementRevision: 2 });
  assert.equal((await get(first)).needsRequirementReview, false);
  await assert.rejects(
    db.requirementChange.update({
      where: { id: row.changes.items[0].id },
      data: { reason: '篡改影响' },
    }),
    /append-only/,
  );
});
test('修订权限、原因、影响、真实改动和并发版本均校验，普通编辑不能覆盖确认基线', async () => {
  const reqId = await makeRequirement(),
    row = await reqGet(reqId),
    path = `/projects/${a}/requirements/${reqId}`,
    data = reqInput(row, {
      acceptanceCriteria: '新标准',
      reason: '改进',
      impact: '涉及实现和验收',
    });
  for (const role of ['developer', 'viewer', 'outsider'])
    await post(sessions[role], `${path}/revise`, data).expect(role === 'outsider' ? 404 : 403);
  await post(sessions.owner, `${path}/revise`, { ...data, impact: '' }).expect(400);
  await post(sessions.owner, `${path}/revise`, { ...data, reason: ' ' }).expect(400);
  await post(sessions.owner, `${path}/revise`, {
    ...data,
    acceptanceCriteria: row.acceptanceCriteria,
  }).expect(422);
  await post(sessions.owner, `${path}/update`, reqInput(row, { description: '绕过修订' })).expect(
    422,
  );
  const results = await Promise.all(
    ['一', '二'].map((acceptanceCriteria) =>
      post(sessions.owner, `${path}/revise`, { ...data, acceptanceCriteria }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 409]);
  assert.equal((await reqGet(reqId)).changes.total, 1);
});
test('失效契约拒绝旧验收和发布依据，重新确认或撤回均不能使旧依据复活', async () => {
  const reqId = await makeRequirement(),
    validity = app.get(RequirementValidity);
  const tokens = await db.$transaction((tx) => validity.capture(tx, a, [reqId]));
  await db.$transaction((tx) => validity.assertCurrent(tx, a, tokens));
  await revise(reqId);
  await assert.rejects(
    db.$transaction((tx) => validity.assertCurrent(tx, a, tokens)),
    /重新确认|失效/,
  );
  const path = `/projects/${a}/requirements/${reqId}`,
    row = await reqGet(reqId);
  await post(sessions.owner, `${path}/submit`, {
    version: row.version,
    reviewerId: users.product.id,
  }).expect(201);
  await post(sessions.owner, `${path}/withdraw`, {
    version: row.version + 1,
    comment: '继续核对影响',
  }).expect(201);
  await assert.rejects(db.$transaction((tx) => validity.assertCurrent(tx, a, tokens)));
  await approve(reqId);
  await assert.rejects(
    db.$transaction((tx) => validity.assertCurrent(tx, a, tokens)),
    /失效/,
  );
  const current = await db.$transaction((tx) => validity.capture(tx, a, [reqId]));
  await db.$transaction((tx) => validity.assertCurrent(tx, a, current));
  assert.equal(current[0].scopeVersion, 1);
  assert.equal(current[0].revision, 2);
  await assert.rejects(db.$transaction((tx) => validity.capture(tx, b, [reqId])));
  await assert.rejects(db.$transaction((tx) => validity.capture(tx, a, [])));
});
test('修订后的运行中阻塞任务须重新确认及核对影响后恢复，不会自动恢复或清空阻塞', async () => {
  const reqId = await makeRequirement(),
    id = await create({ requirementId: reqId, iterationId: null });
  await change(id, 'start');
  await change(id, 'block', { reason: '等待业务依赖', helperId: users.product.id });
  await revise(reqId);
  await change(id, 'resume', { reason: '旧依据不可恢复' }, 422);
  await approve(reqId);
  await change(id, 'resume', { reason: '未核对任务影响' }, 422);
  await change(id, 'acknowledge', { reason: '核对新标准并安排补充实现', requirementRevision: 2 });
  assert.equal((await get(id)).blocked, true);
  await change(id, 'resume', { reason: '业务依赖已解决且修订已核对' });
  assert.equal((await get(id)).status, 'IN_PROGRESS');
  assert.equal((await get(id)).blocked, false);
});
test('需求关联任务分页及统计与任务列表一致，完成更新计划结论和关联计数', async () => {
  const reqId = await makeRequirement(),
    one = await create({ requirementId: reqId, iterationId: null }),
    two = await create({ requirementId: reqId, iterationId: null });
  await change(one, 'start');
  await change(two, 'start');
  await change(two, 'complete', { reason: '实现完成' });
  const req = (
    await sessions.viewer.agent
      .get(`/api/v1/projects/${a}/requirements/${reqId}`)
      .query({ pageSize: 1, taskPage: 2 })
      .expect(200)
  ).body;
  assert.equal(req.taskSummary.total, 2);
  assert.equal(req.taskSummary.inProgress, 1);
  assert.equal(req.taskSummary.completed, 1);
  assert.equal(req.tasks.items.length, 1);
  assert.equal(req.tasks.total, 2);
  const list = (
    await sessions.viewer.agent.get(`/api/v1${route()}`).query({ requirementId: reqId }).expect(200)
  ).body;
  assert.equal(list.total, req.taskSummary.total);
});
test('工作台任务和协助事项即时随改派、恢复及完成变化，历史通知不充当当前待办', async () => {
  const id = await create({ dueDate: '2000-01-01' });
  assert.ok(
    (await wb(sessions.developer, { kind: 'TASK', status: 'overdue' })).items.some(
      (item) => item.id === id,
    ),
  );
  await change(id, 'block', { reason: '需要核对业务', helperId: users.product.id });
  assert.ok(
    (await wb(sessions.product, { kind: 'TASK_ASSIST' })).items.some((item) => item.id === id),
  );
  await (await assign(id, users.developer2.id)).expect(201);
  assert.ok(!(await wb(sessions.developer, { kind: 'TASK' })).items.some((item) => item.id === id));
  assert.ok((await wb(sessions.developer2, { kind: 'TASK' })).items.some((item) => item.id === id));
  await change(id, 'resume', { reason: '业务已核对' }, 201, sessions.developer2);
  assert.ok(
    !(await wb(sessions.product, { kind: 'TASK_ASSIST' })).items.some((item) => item.id === id),
  );
  await change(id, 'start', {}, 201, sessions.developer2);
  await change(id, 'complete', { reason: '实现完成' }, 201, sessions.developer2);
  assert.ok(
    !(await wb(sessions.developer2, { kind: 'TASK' })).items.some((item) => item.id === id),
  );
  assert.ok((await db.notification.count({ where: { targetId: id } })) > 0);
});
test('待评审仅给当前指定评审人，退回、重提、撤回、确认及跨项目即时更新', async () => {
  const reqId = await makeRequirement({}, false),
    path = `/projects/${a}/requirements/${reqId}`;
  await post(sessions.owner, `${path}/submit`, { version: 1, reviewerId: users.product.id }).expect(
    201,
  );
  assert.ok(
    (await wb(sessions.product, { kind: 'REQUIREMENT_REVIEW' })).items.some(
      (item) => item.id === reqId,
    ),
  );
  assert.ok(
    !(await wb(sessions.owner, { kind: 'REQUIREMENT_REVIEW' })).items.some(
      (item) => item.id === reqId,
    ),
  );
  await post(sessions.product, `${path}/return`, { version: 2, comment: '补充边界' }).expect(201);
  assert.ok(
    !(await wb(sessions.product, { kind: 'REQUIREMENT_REVIEW' })).items.some(
      (item) => item.id === reqId,
    ),
  );
  await approve(reqId);
  assert.ok(
    !(await wb(sessions.product, { kind: 'REQUIREMENT_REVIEW' })).items.some(
      (item) => item.id === reqId,
    ),
  );
  assert.equal((await wb(sessions.outsider)).total, 0);
});
test('统一工作台分页和总数在同一筛选范围，管理员只聚合本人责任且角色撤回立即隐藏', async () => {
  const marker = `工作台${nonce}`;
  for (let index = 0; index < 8; index++)
    await create({
      title: `${marker} ${index}`,
      assigneeId: users.developer2.id,
      iterationId: null,
      dueDate: index < 2 ? '2000-01-01' : null,
    });
  const first = await wb(sessions.developer2, { q: marker, pageSize: 3 }),
    second = await wb(sessions.developer2, { q: marker, pageSize: 3, page: 2 });
  assert.equal(first.total, 8);
  assert.equal(first.summary.total, 8);
  assert.equal(first.summary.tasks, 8);
  assert.equal(first.summary.overdue, 2);
  assert.equal(second.items.length, 3);
  assert.equal(new Set([...first.items, ...second.items].map((item) => item.id)).size, 6);
  assert.equal((await wb(sessions.admin, { q: marker })).total, 0);
  await db.projectMember.delete({
    where: { projectId_userId: { projectId: a, userId: users.developer2.id } },
  });
  try {
    assert.equal((await wb(sessions.developer2, { q: marker })).total, 0);
  } finally {
    await db.projectMember.create({
      data: { projectId: a, userId: users.developer2.id, roles: ['DEVELOPER'] },
    });
  }
});
test('修订、阻塞、开始及影响事件失败时业务、任务版本、通知和幂等共同回滚', async () => {
  const reqId = await makeRequirement(),
    id = await create({ requirementId: reqId, iterationId: null }),
    service = app.get(CollaborationEvents),
    original = service.record;
  const prior = await get(id),
    key = randomUUID(),
    row = await reqGet(reqId),
    data = reqInput(row, { description: '新范围', reason: '修订', impact: '涉及任务和验收依据' });
  service.record = async (...args) => {
    await original.apply(service, args);
    throw new Error('模拟M2事件故障');
  };
  try {
    await post(sessions.owner, `/projects/${a}/requirements/${reqId}/revise`, data, key).expect(
      500,
    );
    await change(id, 'block', { reason: '事务故障', helperId: users.product.id }, 500);
    await change(id, 'start', { reason: '事务故障' }, 500);
  } finally {
    service.record = original;
  }
  assert.equal((await get(id)).version, prior.version);
  assert.equal((await get(id)).blocked, false);
  assert.equal((await reqGet(reqId)).status, 'CONFIRMED');
  assert.equal((await reqGet(reqId)).changes.total, 0);
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'OPEN');
  await post(sessions.owner, `/projects/${a}/requirements/${reqId}/revise`, data, key).expect(201);
});
