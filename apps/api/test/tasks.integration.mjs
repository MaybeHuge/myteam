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
const { CollaborationEvents } = await import('../dist/common/collaboration-events.js');
const db = createDatabase(process.env.DATABASE_URL),
  nonce = randomUUID(),
  suffix = `${nonce}@tasks.test`,
  prefix = `T${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}`;
const users = {},
  sessions = {};
let app, http, a, b, requirement, maintenance, draft, active, planning, closed, foreign;
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
const update = (row, extra = {}) => ({
  title: row.title,
  description: row.description,
  priority: row.priority,
  estimatedHours: row.estimatedHours,
  dueDate: row.dueDate,
  iterationId: row.iteration?.id ?? null,
  version: row.version,
  ...extra,
});
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
const start = async (id, session = sessions.developer, extra = {}) => {
  const version = (await get(id)).version;
  return {
    expect: (status) => post(session, `${route(id)}/start`, { version, ...extra }).expect(status),
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
  planning = (
    await post(sessions.owner, `/projects/${a}/iterations`, {
      ...plan,
      name: `${plan.name} 规划`,
    }).expect(201)
  ).body.id;
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
  maintenance = await makeRequirement({ type: 'MAINTENANCE' });
  draft = await makeRequirement({}, false);
  foreign = await makeRequirement({}, true, b);
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
test('任务列表详情按项目隔离，非成员、只读、产品和测试角色不能写任务', async () => {
  const id = await create();
  await request(http).get(`/api/v1${route()}`).expect(401);
  await sessions.outsider.agent.get(`/api/v1${route()}`).expect(404);
  await sessions.owner.agent.get(`/api/v1${route(id, b)}`).expect(404);
  for (const role of ['viewer', 'product', 'tester']) {
    await post(sessions[role], route(), input()).expect(403);
    await post(sessions[role], `${route(id)}/update`, update(await get(id))).expect(403);
    await (await start(id, sessions[role])).expect(403);
    assert.deepEqual((await get(id, sessions[role])).allowedActions, []);
  }
});
test('功能及维护类需求可拆任务，沿用同 ID WorkItem 与默认迭代，编号和创建支持幂等', async () => {
  const payload = input({ status: 'COMPLETED' }),
    key = randomUUID(),
    before = (await db.project.findUniqueOrThrow({ where: { id: a } })).taskSequence;
  const first = await post(sessions.owner, route(), payload, key).expect(201);
  await post(sessions.owner, route(), payload, key).expect(201);
  await post(sessions.owner, route(), { ...payload, title: '不同请求' }, key).expect(409);
  const row = await get(first.body.id);
  assert.equal(row.number, before + 1);
  assert.equal(row.status, 'TODO');
  assert.equal(row.iteration.id, active);
  assert.equal(row.estimatedHours, 2.25);
  assert.equal(row.dueDate, '2026-11-10');
  const work = await db.workItem.findUniqueOrThrow({ where: { id: row.id } });
  assert.equal(work.kind, 'TASK');
  assert.equal(work.resolution, 'OPEN');
  assert.equal(
    await db.activityLog.count({ where: { targetId: row.id, action: 'task.created' } }),
    1,
  );
  assert.equal(
    (await get(await create({ requirementId: maintenance, iterationId: null }))).requirement.type,
    'MAINTENANCE',
  );
});
test('关联需求与负责人须同项目且可用，已结束需求和关闭迭代不能新增任务', async () => {
  const before = (await db.project.findUniqueOrThrow({ where: { id: a } })).taskSequence;
  await post(sessions.owner, route(), input({ requirementId: foreign })).expect(404);
  for (const role of ['product', 'tester', 'viewer', 'outsider'])
    await post(sessions.owner, route(), input({ assigneeId: users[role].id })).expect(422);
  await post(sessions.owner, route(), input({ iterationId: closed })).expect(422);
  await db.user.update({ where: { id: users.developer2.id }, data: { active: false } });
  try {
    await post(sessions.owner, route(), input({ assigneeId: users.developer2.id })).expect(422);
  } finally {
    await db.user.update({ where: { id: users.developer2.id }, data: { active: true } });
  }
  await db.requirement.update({ where: { id: draft }, data: { status: 'CANCELLED' } });
  try {
    await post(sessions.owner, route(), input({ requirementId: draft })).expect(422);
  } finally {
    await db.requirement.update({ where: { id: draft }, data: { status: 'DRAFT' } });
  }
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: a } })).taskSequence, before);
});
test('开发可创建本人或未分配任务，不能指派他人或维护其他负责人的任务', async () => {
  const own = await create({ assigneeId: users.developer.id }, sessions.developer),
    empty = await create({ assigneeId: null }, sessions.developer);
  await post(sessions.developer, route(), input({ assigneeId: users.developer2.id })).expect(403);
  await post(sessions.developer2, `${route(own)}/update`, update(await get(own))).expect(403);
  await post(sessions.developer2, `${route(empty)}/update`, update(await get(empty))).expect(403);
  await post(
    sessions.developer,
    `${route(empty)}/update`,
    update(await get(empty), { title: '由创建者补齐未分配任务' }),
  ).expect(201);
  await (await assign(own, users.developer2.id, sessions.developer)).expect(403);
});
test('认领任务校验原因，并发认领仅一人成功，认领后可幂等重放且他人不能抢占', async () => {
  const id = await create({ assigneeId: null }),
    version = (await get(id)).version;
  await post(sessions.developer, `${route(id)}/assign`, {
    version,
    assigneeId: users.developer.id,
    reason: ' ',
  }).expect(400);
  const results = await Promise.all(
    ['developer', 'developer2'].map((role) =>
      post(sessions[role], `${route(id)}/assign`, {
        version,
        assigneeId: users[role].id,
        reason: '认领实现',
      }),
    ),
  );
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 403]);
  const other =
    (await get(id)).assignee.id === users.developer.id ? sessions.developer2 : sessions.developer;
  await post(other, `${route(id)}/assign`, {
    version: (await get(id)).version,
    assigneeId: users.developer2.id,
    reason: '抢占',
  }).expect(403);
  const second = await create({ assigneeId: null }),
    key = randomUUID(),
    payload = { version: 1, assigneeId: users.developer.id, reason: '主动认领' };
  await post(sessions.developer, `${route(second)}/assign`, payload, key).expect(201);
  await (await start(second)).expect(201);
  await post(sessions.developer, `${route(second)}/assign`, payload, key).expect(201);
});
test('改派记录前后值和原因，只写一次审计，并通知新旧负责人', async () => {
  const id = await create(),
    before = await db.notification.count({ where: { targetId: id } });
  await (await assign(id, users.developer2.id)).expect(201);
  const row = await get(id);
  assert.equal(row.assignee.id, users.developer2.id);
  assert.equal(row.history.total, 2);
  const event = row.history.items.find((item) => item.action === 'task.assigned');
  assert.equal(event.details.before.assigneeId, users.developer.id);
  assert.equal(event.details.after.assigneeId, users.developer2.id);
  assert.equal(event.details.reason, '调整实现安排');
  assert.equal(await db.notification.count({ where: { targetId: id } }), before + 2);
  await post(sessions.developer, `${route(id)}/update`, update(row)).expect(403);
  await post(
    sessions.developer2,
    `${route(id)}/update`,
    update(row, { description: '新负责人继续实现' }),
  ).expect(201);
});
test('开始检查确认需求、负责人、项目和任务迭代状态，失败无部分写入', async () => {
  const unconfirmed = await create({ requirementId: draft }),
    unassigned = await create({ assigneeId: null }),
    unstarted = await create({ iterationId: planning }),
    paused = await create();
  await (await start(unconfirmed)).expect(422);
  await post(sessions.owner, `/projects/${a}/requirements/${draft}/cancel`, {
    version: 1,
    comment: '不能遗留未结束任务',
  }).expect(422);
  await (await start(unassigned, sessions.owner, { reason: '尝试开始未分配任务' })).expect(422);
  await (await start(unstarted)).expect(422);
  await db.project.update({ where: { id: a }, data: { status: 'PAUSED' } });
  try {
    await (await start(paused)).expect(422);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  }
  for (const id of [unconfirmed, unassigned, unstarted, paused]) {
    const row = await get(id);
    assert.equal(row.status, 'TODO');
    assert.equal(row.version, 1);
    assert.equal(row.history.total, 1);
  }
});
test('任务开始由本人或负责人代理，需求同步实现中且基线不变，不能人工跳到测试或完成', async () => {
  const reqId = await makeRequirement(),
    id = await create({ requirementId: reqId, iterationId: null });
  await (await start(id, sessions.developer2)).expect(403);
  await (await start(id, sessions.owner)).expect(422);
  const payload = { version: 1, reason: '负责人代为登记已开始' },
    key = randomUUID();
  await post(sessions.owner, `${route(id)}/start`, payload, key).expect(201);
  await post(sessions.owner, `${route(id)}/start`, payload, key).expect(201);
  const row = await get(id);
  assert.equal(row.status, 'IN_PROGRESS');
  assert.ok(row.startedAt);
  assert.equal(row.requirement.status, 'IMPLEMENTING');
  const startedEvent = row.history.items.find((event) => event.action === 'task.started');
  assert.equal(startedEvent.details.onBehalf, true);
  assert.equal(startedEvent.details.adminOverride, false);
  const reqRow = await db.requirement.findUniqueOrThrow({ where: { id: reqId } });
  assert.equal(reqRow.revision, 1);
  assert.equal(await db.requirementReview.count({ where: { requirementId: reqId } }), 2);
  await post(
    sessions.developer,
    `${route(id)}/update`,
    update(row, { status: 'COMPLETED', assigneeId: users.developer2.id, requirementId: foreign }),
  ).expect(201);
  const unchanged = await get(id);
  assert.equal(unchanged.status, 'IN_PROGRESS');
  assert.equal(unchanged.assignee.id, users.developer.id);
  assert.equal(unchanged.requirement.id, reqId);
  await post(sessions.owner, `${route(id)}/complete`, { version: unchanged.version }).expect(400);
  await (await assign(id, null)).expect(422);
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'OPEN');
});
test('任务说明与计划同版本并发更新仅一项成功，不能清空已纳入迭代或无原因调整', async () => {
  const id = await create(),
    row = await get(id);
  const updates = await Promise.all(
    ['A', 'B'].map((title) =>
      post(sessions.developer, `${route(id)}/update`, update(row, { title })),
    ),
  );
  assert.deepEqual(updates.map((result) => result.status).sort(), [201, 409]);
  const current = await get(id);
  await post(
    sessions.developer,
    `${route(id)}/update`,
    update(current, { iterationId: null }),
  ).expect(422);
  await post(
    sessions.developer,
    `${route(id)}/update`,
    update(current, { iterationId: planning }),
  ).expect(422);
  await post(
    sessions.developer,
    `${route(id)}/update`,
    update(current, { iterationId: planning, changeReason: '改至下一轮实现' }),
  ).expect(201);
  const running = await create();
  await (await start(running)).expect(201);
  await post(
    sessions.developer,
    `${route(running)}/update`,
    update(await get(running), { iterationId: planning, changeReason: '不能移到规划迭代' }),
  ).expect(422);
});
test('筛选与分页一致，候选成员和需求可搜索并分页且开发只能分配本人', async () => {
  const marker = `检索${nonce}`,
    id = await create({ description: marker, priority: 'URGENT' });
  const list = (
    await sessions.viewer.agent
      .get(`/api/v1${route()}`)
      .query({
        q: marker,
        status: 'TODO',
        priority: 'URGENT',
        assigneeId: users.developer.id,
        requirementId: requirement,
        iterationId: active,
        pageSize: 1,
      })
      .expect(200)
  ).body;
  assert.equal(list.total, 1);
  assert.equal(list.items[0].id, id);
  assert.equal(list.canCreate, false);
  const code = (
    await sessions.owner.agent
      .get(`/api/v1${route()}`)
      .query({ q: (await get(id)).code })
      .expect(200)
  ).body;
  assert.deepEqual(
    code.items.map((item) => item.id),
    [id],
  );
  const empty = await sessions.owner.agent
    .get(`/api/v1${route()}`)
    .query({ assigneeId: users.developer.id, unassigned: 'true' })
    .expect(200);
  assert.equal(empty.body.total, 0);
  const people = (await sessions.developer.agent.get(`/api/v1${route('people')}`).expect(200)).body;
  assert.deepEqual(
    people.items.map((item) => item.id),
    [users.developer.id],
  );
  assert.equal(people.canAssignOthers, false);
  const candidates = (
    await sessions.owner.agent
      .get(`/api/v1${route('people')}`)
      .query({ q: users.developer2.email, pageSize: 1 })
      .expect(200)
  ).body;
  assert.equal(candidates.total, 1);
  assert.equal(candidates.items[0].id, users.developer2.id);
  const reqs = (
    await sessions.owner.agent
      .get(`/api/v1${route('requirements')}`)
      .query({ q: '任务关联需求', pageSize: 1 })
      .expect(200)
  ).body;
  assert.ok(reqs.total >= 3);
  assert.equal(reqs.items.length, 1);
  const requirementCode = (await get(id)).requirement.code;
  const exactRequirement = await sessions.owner.agent
    .get(`/api/v1${route('requirements')}`)
    .query({ q: requirementCode })
    .expect(200);
  assert.deepEqual(
    exactRequirement.body.items.map((item) => item.id),
    [requirement],
  );
  await sessions.viewer.agent.get(`/api/v1${route('people')}`).expect(403);
  await sessions.owner.agent.get(`/api/v1${route()}`).query({ pageSize: 101 }).expect(400);
  const history = (
    await sessions.owner.agent
      .get(`/api/v1${route(id)}`)
      .query({ page: 2, pageSize: 1 })
      .expect(200)
  ).body;
  assert.equal(history.history.total, 1);
  assert.deepEqual(history.history.items, []);
});
test('未结束任务负责人移出、停用及失去任务权限受保护，改派后可退场', async () => {
  const id = await create({ assigneeId: users.handoff.id }),
    member = await db.projectMember.findUniqueOrThrow({
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
  await (await assign(id, users.developer.id)).expect(201);
  await post(sessions.owner, `/projects/${a}/members/${users.handoff.id}/remove`, {
    version: member.version,
  }).expect(201);
  await post(sessions.admin, `/users/${users.handoff.id}/status`, {
    version: users.handoff.version,
    active: false,
  }).expect(201);
});
test('任务、编号、需求状态、审计、通知及幂等在事务中回滚，可修复后重试', async () => {
  const service = app.get(CollaborationEvents),
    original = service.record,
    key = randomUUID(),
    payload = input(),
    before = (await db.project.findUniqueOrThrow({ where: { id: a } })).taskSequence;
  service.record = async (...args) => {
    await original.apply(service, args);
    throw new Error('模拟审计故障');
  };
  try {
    await post(sessions.owner, route(), payload, key).expect(500);
  } finally {
    service.record = original;
  }
  assert.equal(
    await db.task.count({ where: { projectId: a, workItem: { title: payload.title } } }),
    0,
  );
  assert.equal(await db.workItem.count({ where: { projectId: a, title: payload.title } }), 0);
  assert.equal((await db.project.findUniqueOrThrow({ where: { id: a } })).taskSequence, before);
  await post(sessions.owner, route(), payload, key).expect(201);
  const reqId = await makeRequirement(),
    id = await create({ requirementId: reqId, iterationId: null }),
    startKey = randomUUID();
  service.record = async (...args) => {
    await original.apply(service, args);
    if (args[1].action === 'task.started') throw new Error('模拟开始通知失败');
  };
  try {
    await post(sessions.developer, `${route(id)}/start`, { version: 1 }, startKey).expect(500);
  } finally {
    service.record = original;
  }
  assert.equal((await get(id)).status, 'TODO');
  assert.equal((await get(id)).history.total, 1);
  assert.equal(
    (await db.requirement.findUniqueOrThrow({ where: { id: reqId } })).status,
    'CONFIRMED',
  );
  await post(sessions.developer, `${route(id)}/start`, { version: 1 }, startKey).expect(201);
});
test('改派双向通知故障时整次改派回滚，原负责人未失去任务', async () => {
  const id = await create(),
    service = app.get(CollaborationEvents),
    original = service.record,
    before = await db.notification.count({ where: { targetId: id } });
  service.record = async (...args) => {
    await original.apply(service, args);
    if (args[1].action === 'task.assigned') throw new Error('模拟通知事务失败');
  };
  try {
    await (await assign(id, users.developer2.id)).expect(500);
  } finally {
    service.record = original;
  }
  const row = await get(id);
  assert.equal(row.assignee.id, users.developer.id);
  assert.equal(row.version, 1);
  assert.equal(row.history.total, 1);
  assert.equal(await db.notification.count({ where: { targetId: id } }), before);
});
test('任务始终参与迭代关闭门禁，数据库拒绝跨项目需求与错误工作项类型', async () => {
  const id = await create();
  await post(sessions.owner, `/projects/${a}/iterations/${active}/close`, {
    version: 2,
    summary: '仍有真实未完成任务',
  }).expect(422);
  const work = await db.workItem.create({
    data: { projectId: a, kind: 'REQUIREMENT', title: '不能冒充任务' },
  });
  await assert.rejects(
    db.task.create({
      data: {
        id: work.id,
        projectId: a,
        requirementId: requirement,
        number: 999,
        createdById: users.owner.id,
      },
    }),
    /TASK/,
  );
  await assert.rejects(
    db.workItem.update({ where: { id }, data: { kind: 'REQUIREMENT' } }),
    /cannot change kind/,
  );
  await assert.rejects(
    db.task.update({ where: { id }, data: { requirementId: foreign } }),
    (error) => error.code === 'P2003',
  );
});
test('任务协作使用真实 SeaweedFS 和目标授权，结束或关闭后只读，非成员无法下载', async () => {
  const id = await create(),
    path = `/projects/${a}/collaboration/TASK/${id}`;
  await post(sessions.developer, `${path}/comments`, { body: '记录任务实现细节' }).expect(201);
  const uploaded = await sessions.developer.agent
    .post(`/api/v1${path}/attachments`)
    .query({ filename: 'task.txt' })
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', sessions.developer.csrf)
    .set('Idempotency-Key', randomUUID())
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('任务附件'))
    .expect(201);
  const download = `/api/v1/projects/${a}/attachments/${uploaded.body.id}/download`;
  assert.equal((await sessions.viewer.agent.get(download).expect(200)).text, '任务附件');
  await sessions.outsider.agent.get(download).expect(404);
  await post(sessions.viewer, `${path}/comments`, { body: '越权' }).expect(403);
  await db.task.update({ where: { id }, data: { status: 'CANCELLED' } });
  await post(sessions.developer, `${path}/comments`, { body: '已结束只读' }).expect(403);
  await sessions.viewer.agent.get(download).expect(200);
});
test('角色收回后旧成功命令不能重放，项目进入验收后任务只读', async () => {
  const id = await create({ assigneeId: users.developer2.id }),
    row = await get(id),
    payload = update(row),
    key = randomUUID();
  await post(sessions.developer2, `${route(id)}/update`, payload, key).expect(201);
  await db.projectMember.update({
    where: { projectId_userId: { projectId: a, userId: users.developer2.id } },
    data: { roles: ['VIEWER'] },
  });
  try {
    await post(sessions.developer2, `${route(id)}/update`, payload, key).expect(403);
  } finally {
    await db.projectMember.update({
      where: { projectId_userId: { projectId: a, userId: users.developer2.id } },
      data: { roles: ['DEVELOPER'] },
    });
  }
  await db.project.update({ where: { id: a }, data: { status: 'ACCEPTING' } });
  try {
    await post(sessions.owner, route(), input()).expect(403);
    assert.deepEqual((await get(id)).allowedActions, []);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  }
});
