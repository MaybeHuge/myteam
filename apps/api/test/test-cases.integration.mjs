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
const { TestCasesService } = await import('../dist/modules/test-cases/test-cases.service.js');
const { CollaborationEvents } = await import('../dist/common/collaboration-events.js');
const { testCaseExecutionSnapshotSchema } = await import('@myteam/contracts');
const db = createDatabase(process.env.DATABASE_URL),
  nonce = randomUUID();
const users = {},
  sessions = {};
let app, http, a, b, reqA, reqB, foreignReq, service;
const post = (s, path, input, key = randomUUID()) =>
  s.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .send(input);
const route = (id = '', projectId = a) => `/projects/${projectId}/test-cases${id ? `/${id}` : ''}`;
const get = async (id, s = sessions.tester) =>
  (await s.agent.get(`/api/v1${route(id)}`).expect(200)).body;
const input = (extra = {}) => ({
  title: `登录场景 ${randomUUID()}`,
  preconditions: '已获得有效验证码',
  priority: 'HIGH',
  ownerId: users.tester.id,
  steps: [{ action: '输入正确手机号和验证码', expected: '登录成功，进入工作台' }],
  requirementIds: [reqA],
  ...extra,
});
const create = async (extra = {}) =>
  (await post(sessions.tester, route(), input(extra)).expect(201)).body.id;
const fields = (row, extra = {}) => ({
  title: row.title,
  preconditions: row.preconditions,
  priority: row.priority,
  ownerId: row.ownerId,
  steps: row.steps,
  requirementIds: row.requirements.map((r) => r.id),
  version: row.version,
  ...extra,
});
const act = async (id, action, extra = {}, s = sessions.tester, status = 201) =>
  post(s, `${route(id)}/${action}`, { version: (await get(id)).version, ...extra }).expect(status);
const submit = (id) => act(id, 'submit', { reviewerId: users.reviewer.id });
const ready = async (extra) => {
  const id = await create(extra);
  await submit(id);
  await act(id, 'approve', {}, sessions.reviewer);
  return id;
};
const select = (id, revision) =>
  db.$transaction((tx) => service.selectUsableRevision(tx, a, id, revision));
async function login(user) {
  const agent = request.agent(http),
    csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ email: user.email, password: testPassword })
    .expect(201);
  return { agent, csrf: result.body.csrfToken };
}
async function requirement(projectId, title = `手机号登录 ${randomUUID()}`) {
  const path = `/projects/${projectId}/requirements`;
  const id = (
    await post(sessions.owner, path, {
      title,
      description: '手机验证码只能使用一次',
      acceptanceCriteria: '有效且未使用验证码可登录，否则明确提示',
      ownerId: users.owner.id,
    }).expect(201)
  ).body.id;
  await post(sessions.owner, `${path}/${id}/submit`, {
    version: 1,
    reviewerId: users.owner.id,
  }).expect(201);
  await post(sessions.owner, `${path}/${id}/approve`, { version: 2 }).expect(201);
  return id;
}
async function reviseRequirement(id) {
  const path = `/projects/${a}/requirements/${id}`,
    row = (await sessions.owner.agent.get(`/api/v1${path}`).expect(200)).body;
  await post(sessions.owner, `${path}/revise`, {
    title: row.title,
    description: `${row.description}；新增过期处理`,
    acceptanceCriteria: row.acceptanceCriteria,
    ownerId: row.ownerId,
    version: row.version,
    reason: '补充安全边界',
    impact: '关联用例重新评审',
  }).expect(201);
}
async function reconfirm(id) {
  const path = `/projects/${a}/requirements/${id}`,
    row = (await sessions.owner.agent.get(`/api/v1${path}`).expect(200)).body;
  await post(sessions.owner, `${path}/submit`, {
    version: row.version,
    reviewerId: users.owner.id,
  }).expect(201);
  await post(sessions.owner, `${path}/approve`, { version: row.version + 1 }).expect(201);
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  for (const role of [
    'owner',
    'tester',
    'reviewer',
    'developer',
    'product',
    'viewer',
    'outsider',
    'admin',
  ])
    users[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${nonce}@cases.test`,
        passwordHash,
        isSystemAdmin: role === 'admin',
      },
    });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  service = app.get(TestCasesService);
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  for (const key of ['A', 'B']) {
    const id = (
      await post(sessions.admin, '/projects', {
        key: `C${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}${key}`,
        name: `用例测试${key}`,
        ownerId: users.owner.id,
      }).expect(201)
    ).body.id;
    await db.project.update({ where: { id }, data: { status: 'ACTIVE' } });
    if (key === 'A') a = id;
    else b = id;
  }
  for (const role of ['tester', 'reviewer', 'developer', 'product', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [role === 'reviewer' ? 'TESTER' : role.toUpperCase()],
    }).expect(201);
  reqA = await requirement(a);
  reqB = await requirement(a);
  foreignReq = await requirement(b);
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    storage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await clearTestStorage(storage);
  await db.project.deleteMany({ where: { id: { in: [a, b].filter(Boolean) } } });
  await db.activityLog.deleteMany({
    where: { actorId: { in: Object.values(users).map((u) => u.id) } },
  });
  await db.idempotencyRecord.deleteMany({
    where: { actorId: { in: Object.values(users).map((u) => u.id) } },
  });
  await db.user.deleteMany({ where: { id: { in: Object.values(users).map((u) => u.id) } } });
  if (app) await app.close();
  await db.$disconnect();
});
test('不完整草稿、多需求关联、负责人和步骤排序持久化，缺项不能送审', async () => {
  const id = await create({
    ownerId: null,
    steps: [],
    preconditions: '',
    requirementIds: [reqA, reqB],
  });
  let row = await get(id);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.requirements.length, 2);
  assert.equal(row.usable, false);
  await act(id, 'submit', { reviewerId: users.reviewer.id }, sessions.tester, 422);
  row = await get(id);
  await post(
    sessions.tester,
    `${route(id)}/update`,
    fields(row, {
      ownerId: users.tester.id,
      steps: [
        { action: '步骤 B', expected: '预期 B' },
        { action: '步骤 A', expected: '' },
      ],
    }),
  ).expect(201);
  await act(id, 'submit', { reviewerId: users.reviewer.id }, sessions.tester, 422);
  row = await get(id);
  assert.equal(row.revision, 2);
  assert.deepEqual(
    row.steps.map((s) => s.action),
    ['步骤 B', '步骤 A'],
  );
  assert.equal(row.revisions.items.at(-1).snapshot.steps.length, 0);
});
test('角色和项目隔离：开发/产品/只读不可写；非成员不可读；非法成员及跨项目需求被拒', async () => {
  for (const role of ['developer', 'product', 'viewer'])
    await post(sessions[role], route(), input()).expect(403);
  const id = await create();
  await sessions.outsider.agent.get(`/api/v1${route(id)}`).expect(404);
  await sessions.tester.agent.get(`/api/v1${route(id, b)}`).expect(404);
  await post(sessions.tester, route(), input({ requirementIds: [foreignReq] })).expect(422);
  await post(sessions.tester, route(), input({ requirementIds: [reqA, reqA] })).expect(400);
  for (const role of ['viewer', 'outsider', 'developer'])
    await post(sessions.tester, route(), input({ ownerId: users[role].id })).expect(422);
  await act(id, 'submit', { reviewerId: users.product.id }, sessions.tester, 422);
  await assert.rejects(
    db.requirementCaseLink.create({
      data: { projectId: a, requirementId: foreignReq, testCaseId: id },
    }),
    /Foreign key|constraint/i,
  );
});
test('需求尚未确认时不能创建用例；候选需求和人员只返回同项目可用对象', async () => {
  const draft = (
    await post(sessions.owner, `/projects/${a}/requirements`, { title: '待确认需求' }).expect(201)
  ).body.id;
  await post(sessions.tester, route(), input({ requirementIds: [draft] })).expect(422);
  const options = (
    await sessions.tester.agent.get(`/api/v1${route()}/requirements?pageSize=1`).expect(200)
  ).body;
  assert.equal(options.items.length, 1);
  assert.ok(options.total >= 2);
  assert.ok(!options.items.some((r) => [draft, foreignReq].includes(r.id)));
  for (const purpose of ['owner', 'reviewer']) {
    const result = (
      await sessions.tester.agent.get(`/api/v1${route()}/people?purpose=${purpose}`).expect(200)
    ).body;
    assert.deepEqual(
      new Set(result.items.map((r) => r.id)),
      new Set([users.owner.id, users.tester.id, users.reviewer.id]),
    );
  }
});
test('指定评审、退回原因、冻结送审内容、新轮次通过后方可使用', async () => {
  const id = await create();
  await submit(id);
  const submitted = await get(id);
  await post(sessions.tester, `${route(id)}/update`, fields(submitted)).expect(422);
  await act(id, 'approve', {}, sessions.tester, 403);
  await act(id, 'return', { comment: ' ' }, sessions.reviewer, 400);
  await act(id, 'return', { comment: '补充验证码重复使用场景' }, sessions.reviewer);
  let row = await get(id);
  assert.equal(row.status, 'DRAFT');
  await post(
    sessions.tester,
    `${route(id)}/update`,
    fields(row, { steps: [{ action: '再次输入同一验证码', expected: '拒绝重复登录' }] }),
  ).expect(201);
  await submit(id);
  await act(id, 'approve', { comment: '边界完整' }, sessions.reviewer);
  row = await get(id);
  assert.equal(row.usable, true);
  assert.equal(row.reviewRound, 2);
  assert.equal(row.history.total, 4);
  assert.equal(
    row.revisions.items.find((r) => r.revision === 1).snapshot.steps[0].expected,
    '登录成功，进入工作台',
  );
  assert.equal(row.revisions.items[0].snapshot.editedBy.id, users.tester.id);
  const selected = await select(id, row.revision);
  assert.equal(selected.revision, 2);
  await assert.rejects(select(id, 1), /只能选择/);
});
test('已通过内容修订即退出可用；旧修订和通过结论不可覆盖', async () => {
  const id = await ready(),
    old = await get(id),
    oldRevision = old.revisions.items[0];
  await post(sessions.tester, `${route(id)}/update`, fields(old)).expect(422);
  await post(
    sessions.tester,
    `${route(id)}/revise`,
    fields(old, { reason: '新增错误验证码', title: '错误验证码不会登录' }),
  ).expect(201);
  const row = await get(id);
  assert.equal(row.status, 'DRAFT');
  assert.equal(row.usable, false);
  assert.equal(row.revision, old.revision + 1);
  assert.deepEqual(
    row.revisions.items.find((r) => r.revision === old.revision),
    oldRevision,
  );
  await assert.rejects(select(id, old.revision), /只能选择/);
  await assert.rejects(
    db.testCaseRevision.update({ where: { id: oldRevision.id }, data: { reason: '篡改历史' } }),
    /append-only/,
  );
  await assert.rejects(
    db.testCaseReview.update({
      where: { id: old.history.items[0].id },
      data: { comment: '篡改结论' },
    }),
    /append-only/,
  );
  await submit(id);
  await act(id, 'approve', {}, sessions.reviewer);
  assert.equal((await get(id)).usable, true);
});
test('撤回与废弃必须留原因；废弃不删除历史且不得编辑、送审或选择', async () => {
  const id = await create();
  await submit(id);
  await act(id, 'withdraw', { comment: '' }, sessions.tester, 400);
  await act(id, 'withdraw', { comment: '补齐前置数据' });
  assert.equal((await get(id)).status, 'DRAFT');
  await act(id, 'deprecate', { comment: '场景已移除' });
  const row = await get(id);
  assert.equal(row.status, 'DEPRECATED');
  assert.equal(row.deprecation.reason, '场景已移除');
  assert.equal(row.deprecation.actor.id, users.tester.id);
  assert.equal(row.allowedActions.length, 0);
  assert.equal(row.history.total, 2);
  assert.equal(row.revisions.total, 1);
  await post(sessions.tester, `${route(id)}/update`, fields(row)).expect(422);
  await act(id, 'submit', { reviewerId: users.reviewer.id }, sessions.tester, 422);
  await assert.rejects(select(id, row.revision), /只能选择/);
  const log = await db.activityLog.findFirstOrThrow({
    where: { targetId: id, action: 'testCase.deprecate' },
  });
  assert.equal(log.details.comment, '场景已移除');
});
test('多需求任一修订立即失效：待评审不能通过、可用筛选剔除，重新确认不会复活旧修订', async () => {
  const req = await requirement(a),
    id = await ready({ requirementIds: [reqA, req] });
  const pending = await create({ requirementIds: [req] });
  await submit(pending);
  const old = await get(id),
    frozen = old.revisions.items[0];
  await reviseRequirement(req);
  let row = await get(id);
  assert.equal(row.needsReview, true);
  assert.equal(row.usable, false);
  assert.equal(row.version, old.version + 1);
  assert.equal((await get(pending)).needsReview, true);
  await act(pending, 'approve', {}, sessions.reviewer, 422);
  await assert.rejects(select(id, old.revision), /只能选择/);
  const list = (
    await sessions.tester.agent
      .get(`/api/v1${route()}?usable=true&requirementId=${req}`)
      .expect(200)
  ).body;
  assert.equal(list.total, 0);
  await post(sessions.tester, `${route(id)}/revise`, fields(old, { reason: '旧页面提交' })).expect(
    409,
  );
  await reconfirm(req);
  assert.equal((await get(id)).usable, false);
  row = await get(id);
  await post(
    sessions.tester,
    `${route(id)}/revise`,
    fields(row, { reason: '核对新需求基线' }),
  ).expect(201);
  await submit(id);
  await act(id, 'approve', {}, sessions.reviewer);
  row = await get(id);
  assert.equal(row.usable, true);
  assert.equal(row.needsReview, false);
  assert.deepEqual(
    row.revisions.items.find((r) => r.revision === old.revision),
    frozen,
  );
  await assert.rejects(select(id, old.revision), /只能选择/);
  await select(id, row.revision);
  await act(pending, 'return', { comment: '基线已变化' }, sessions.reviewer);
  const p = await get(pending);
  await post(sessions.tester, `${route(pending)}/update`, fields(p)).expect(201);
  await submit(pending);
  await act(pending, 'approve', {}, sessions.reviewer);
  assert.equal((await get(pending)).usable, true);
});
test('服务选择契约重新校验实际需求令牌，不能仅依赖用例状态', async () => {
  const req = await requirement(a),
    id = await ready({ requirementIds: [req] });
  await db.requirement.update({ where: { id: req }, data: { scopeVersion: { increment: 1 } } });
  await assert.rejects(select(id, 1), /需求基线已变化/);
});
test('并发更新只能一个成功；幂等重放只有一份修订、日志和通知', async () => {
  const id = await create(),
    row = await get(id),
    key = randomUUID(),
    payload = fields(row, { title: '幂等修改' });
  const [first, replay] = await Promise.all([
    post(sessions.tester, `${route(id)}/update`, payload, key),
    post(sessions.tester, `${route(id)}/update`, payload, key),
  ]);
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, replay.body);
  assert.equal(await db.testCaseRevision.count({ where: { testCaseId: id } }), 2);
  assert.equal(
    await db.activityLog.count({ where: { targetId: id, action: 'testCase.updated' } }),
    1,
  );
  await post(sessions.tester, `${route(id)}/update`, { ...payload, title: '不同请求' }, key).expect(
    409,
  );
  const latest = await get(id),
    [x, y] = await Promise.all([
      post(sessions.tester, `${route(id)}/update`, fields(latest, { title: '并发 A' })),
      post(sessions.reviewer, `${route(id)}/update`, fields(latest, { title: '并发 B' })),
    ]);
  assert.deepEqual([x.status, y.status].sort(), [201, 409]);
  const submitKey = randomUUID(),
    data = { version: (await get(id)).version, reviewerId: users.reviewer.id };
  await post(sessions.tester, `${route(id)}/submit`, data, submitKey).expect(201);
  await post(sessions.tester, `${route(id)}/submit`, data, submitKey).expect(201);
  assert.equal(
    await db.notification.count({ where: { targetId: id, recipientId: users.reviewer.id } }),
    1,
  );
});
test('审计或通知失败回滚用例、内容修订、关联及幂等记录', async () => {
  const id = await create(),
    row = await get(id),
    key = randomUUID(),
    events = app.get(CollaborationEvents),
    original = events.record;
  events.record = async () => {
    throw new Error('injected audit failure');
  };
  try {
    await post(
      sessions.tester,
      `${route(id)}/update`,
      fields(row, { title: '必须回滚', requirementIds: [reqB] }),
      key,
    ).expect(500);
  } finally {
    events.record = original;
  }
  const after = await get(id);
  assert.equal(after.version, row.version);
  assert.equal(after.title, row.title);
  assert.deepEqual(after.requirements, row.requirements);
  assert.equal(after.revisions.total, 1);
  assert.equal(await db.idempotencyRecord.count({ where: { actorId: users.tester.id, key } }), 0);
});
test('人员职责保护：待评审不能收回评审权限；负责人移交前不能停用或移除', async () => {
  const id = await create();
  await submit(id);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.reviewer.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.reviewer.id}/roles`, {
    version: member.version,
    roles: ['VIEWER'],
  }).expect(422);
  await post(sessions.admin, `/users/${users.tester.id}/status`, {
    active: false,
    version: users.tester.version,
  }).expect(422);
});
test('管理员代评必须说明并留审计；重放先检查当前角色', async () => {
  const id = await create();
  await submit(id);
  await act(id, 'approve', {}, sessions.admin, 422);
  await act(id, 'approve', { comment: '代评检查完毕' }, sessions.admin);
  assert.equal(
    (await db.activityLog.findFirstOrThrow({ where: { targetId: id, action: 'testCase.approve' } }))
      .details.adminOverride,
    true,
  );
  const key = randomUUID(),
    draft = await create(),
    row = await get(draft),
    payload = fields(row);
  await post(sessions.tester, `${route(draft)}/update`, payload, key).expect(201);
  await db.projectMember.update({
    where: { projectId_userId: { projectId: a, userId: users.tester.id } },
    data: { roles: ['VIEWER'] },
  });
  try {
    await post(sessions.tester, `${route(draft)}/update`, payload, key).expect(403);
  } finally {
    await db.projectMember.update({
      where: { projectId_userId: { projectId: a, userId: users.tester.id } },
      data: { roles: ['TESTER'] },
    });
  }
});
test('分页筛选与详情一致，历史独立翻页，项目归档后只读', async () => {
  const title = `唯一检索 ${randomUUID()}`,
    id = await ready({ title });
  const result = (
    await sessions.viewer.agent
      .get(`/api/v1${route()}?q=${encodeURIComponent(title)}&usable=true&pageSize=1`)
      .expect(200)
  ).body;
  assert.equal(result.total, 1);
  assert.equal(result.items[0].id, id);
  assert.equal(result.items[0].allowedActions.length, 0);
  assert.equal(result.canCreate, false);
  const history = (
    await sessions.viewer.agent
      .get(`/api/v1${route(id)}?pageSize=1&page=2&revisionPage=1`)
      .expect(200)
  ).body;
  assert.equal(history.history.total, 2);
  assert.equal(history.history.items.length, 1);
  assert.equal(history.revisions.total, 1);
  await db.project.update({ where: { id: a }, data: { status: 'ARCHIVED' } });
  try {
    assert.equal((await get(id)).allowedActions.length, 0);
    await act(id, 'deprecate', { comment: '归档写入' }, sessions.tester, 403);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
  }
});
test('用例讨论附件使用 SeaweedFS，同项目授权，废弃后只读且保留下载', async () => {
  const id = await create(),
    path = `/projects/${a}/collaboration/TEST_CASE/${id}`;
  await post(sessions.tester, `${path}/comments`, { body: '检查错误验证码场景' }).expect(201);
  const upload = await sessions.tester.agent
    .post(`/api/v1${path}/attachments`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', sessions.tester.csrf)
    .set('Idempotency-Key', randomUUID())
    .query({ filename: 'case.txt' })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('用例测试数据'))
    .expect(201);
  const download = `/api/v1/projects/${a}/attachments/${upload.body.id}/download`;
  assert.equal((await sessions.viewer.agent.get(download).expect(200)).text, '用例测试数据');
  await sessions.outsider.agent.get(download).expect(404);
  await post(sessions.viewer, `${path}/comments`, { body: '无权评论' }).expect(403);
  await post(sessions.tester, `/projects/${b}/collaboration/TEST_CASE/${id}/comments`, {
    body: '跨项目',
  }).expect(404);
  await act(id, 'deprecate', { comment: '场景失效' });
  await post(sessions.tester, `${path}/comments`, { body: '废弃后评论' }).expect(403);
  await sessions.viewer.agent.get(download).expect(200);
});

test('用例编写与开发任务独立推进，任务开始不使已确认需求令牌失效', async () => {
  const req = await requirement(a),
    taskPath = `/projects/${a}/tasks`;
  const task = (
    await post(sessions.developer, taskPath, {
      requirementId: req,
      title: '验证码开发',
      assigneeId: users.developer.id,
    }).expect(201)
  ).body.id;
  const id = await create({ requirementIds: [req] });
  await post(sessions.developer, `${taskPath}/${task}/start`, { version: 1 }).expect(201);
  await submit(id);
  await act(id, 'approve', {}, sessions.reviewer);
  await select(id, 1);
  await act(id, 'deprecate', { comment: '调整测试场景' });
  assert.equal(
    (await sessions.developer.agent.get(`/api/v1${taskPath}/${task}`).expect(200)).body.status,
    'IN_PROGRESS',
  );
});
test('需求修订审计失败同时回滚用例失效标记和版本，审批与需求修订并发最终不可使用旧依据', async () => {
  const req = await requirement(a),
    id = await ready({ requirementIds: [req] }),
    before = await get(id);
  const events = app.get(CollaborationEvents),
    original = events.record;
  const reqPath = `/projects/${a}/requirements/${req}`,
    row = (await sessions.owner.agent.get(`/api/v1${reqPath}`).expect(200)).body;
  const payload = {
    title: row.title,
    description: `${row.description} 增加错误处理`,
    acceptanceCriteria: row.acceptanceCriteria,
    ownerId: row.ownerId,
    version: row.version,
    reason: '补充错误处理',
    impact: '用例重新评审',
  };
  events.record = async () => {
    throw new Error('injected requirement audit failure');
  };
  try {
    await post(sessions.owner, `${reqPath}/revise`, payload).expect(500);
  } finally {
    events.record = original;
  }
  const unchanged = await get(id);
  assert.equal(unchanged.version, before.version);
  assert.equal(unchanged.usable, true);
  await select(id, 1);
  const pending = await create({ requirementIds: [req] });
  await submit(pending);
  const p = await get(pending);
  const [approve, revise] = await Promise.all([
    post(sessions.reviewer, `${route(pending)}/approve`, { version: p.version }),
    post(sessions.owner, `${reqPath}/revise`, payload),
  ]);
  assert.equal(revise.status, 201);
  assert.ok([201, 409].includes(approve.status));
  assert.equal((await get(pending)).usable, false);
  await assert.rejects(select(pending, 1), /只能选择/);
});

const preparation = async (id, query = '', session = sessions.viewer) =>
  (await session.agent.get(`/api/v1/projects/${a}/requirements/${id}?${query}`).expect(200)).body;
const caseTodos = async (kind, session, query = '') =>
  (
    await session.agent
      .get(`/api/v1/workbench/todos?projectId=${a}&kind=${kind}&${query}`)
      .expect(200)
  ).body;

test('测试准备区分无用例、仅草稿、待评审、可使用和仅废弃，明细与用例库一致', async () => {
  const req = await requirement(a);
  let row = await preparation(req);
  assert.deepEqual(row.testPreparation, {
    requirementConfirmed: true,
    total: 0,
    draft: 0,
    inReview: 0,
    usable: 0,
    needsReview: 0,
    deprecated: 0,
  });
  const id = await create({ requirementIds: [req] });
  row = await preparation(req);
  assert.equal(row.testPreparation.draft, 1);
  assert.equal(row.testPreparation.usable, 0);
  assert.equal(row.cases.items[0].id, id);
  await submit(id);
  row = await preparation(req);
  assert.equal(row.testPreparation.inReview, 1);
  assert.equal(row.testPreparation.draft, 0);
  await act(id, 'approve', {}, sessions.reviewer);
  row = await preparation(req);
  assert.equal(row.testPreparation.usable, 1);
  assert.equal(row.cases.items[0].usable, true);
  const list = (
    await sessions.viewer.agent
      .get(`/api/v1${route()}?requirementId=${req}&usable=true`)
      .expect(200)
  ).body;
  assert.equal(row.testPreparation.usable, list.total);
  await act(id, 'deprecate', { comment: '场景不再适用' });
  row = await preparation(req);
  assert.equal(row.testPreparation.total, 1);
  assert.equal(row.testPreparation.deprecated, 1);
  assert.equal(row.testPreparation.usable, 0);
  assert.equal(row.cases.total, 1);
  assert.equal(row.cases.items[0].usable, false);
});

test('关联用例独立分页且统计不受分页影响，多需求关联不重复计数或混入其他需求', async () => {
  const req = await requirement(a),
    other = await requirement(a);
  const first = await ready({ requirementIds: [req, other] });
  await create({ requirementIds: [req] });
  await create({ requirementIds: [req] });
  const page1 = await preparation(req, 'pageSize=1&casePage=1'),
    page2 = await preparation(req, 'pageSize=1&casePage=2'),
    empty = await preparation(req, 'pageSize=1&casePage=10');
  assert.equal(page1.cases.total, 3);
  assert.equal(page1.cases.items.length, 1);
  assert.notEqual(page1.cases.items[0].id, page2.cases.items[0].id);
  assert.deepEqual(page1.testPreparation, page2.testPreparation);
  assert.deepEqual(page1.testPreparation, empty.testPreparation);
  assert.equal(page1.testPreparation.draft, 2);
  assert.equal(page1.testPreparation.usable, 1);
  assert.equal(empty.cases.items.length, 0);
  assert.equal(empty.cases.total, 3);
  const linked = await preparation(other);
  assert.equal(linked.cases.total, 1);
  assert.equal(linked.cases.items[0].id, first);
  for (const query of ['casePage=0', 'casePage=1.5', 'casePage=100001'])
    await sessions.viewer.agent
      .get(`/api/v1/projects/${a}/requirements/${req}?${query}`)
      .expect(400);
  await sessions.viewer.agent.get(`/api/v1/projects/${b}/requirements/${req}`).expect(404);
  await sessions.outsider.agent.get(`/api/v1/projects/${a}/requirements/${req}`).expect(404);
});

test('用例评审待办仅归指定评审人，支持编号检索/分页/计数，退回与通过即时移除', async () => {
  const title = `评审待办 ${randomUUID()}`,
    q = `q=${encodeURIComponent(title)}`;
  const ids = [await create({ title }), await create({ title })];
  for (const id of ids) await submit(id);
  const first = await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, `${q}&pageSize=1`),
    second = await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, `${q}&pageSize=1&page=2`);
  assert.equal(first.total, 2);
  assert.equal(first.summary.total, 2);
  assert.equal(first.summary.caseReviews, 2);
  assert.equal(first.summary.reviews, 2);
  assert.equal(first.items.length, 1);
  assert.notEqual(first.items[0].id, second.items[0].id);
  assert.equal(first.items[0].status, 'IN_REVIEW');
  for (const role of ['tester', 'owner', 'admin', 'viewer', 'outsider'])
    assert.equal((await caseTodos('TEST_CASE_REVIEW', sessions[role], q)).total, 0);
  const code = (await get(ids[0])).code;
  assert.equal((await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, `q=${code}`)).total, 1);
  await act(ids[0], 'return', { comment: '补充边界' }, sessions.reviewer);
  await act(ids[1], 'approve', {}, sessions.reviewer);
  assert.equal((await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, q)).total, 0);
  assert.ok(
    await db.notification.count({
      where: { recipientId: users.reviewer.id, targetId: { in: ids } },
    }),
  );
});

test('需求变化触发当前负责人复查，重新确认不复活旧用例，修订后转为新轮评审', async () => {
  const req = await requirement(a),
    other = await requirement(a),
    title = `需求复查 ${randomUUID()}`,
    q = `q=${encodeURIComponent(title)}`;
  const id = await ready({ title, requirementIds: [req, other] });
  await reviseRequirement(other);
  let row = await preparation(req);
  assert.equal(row.testPreparation.requirementConfirmed, true);
  assert.equal(row.testPreparation.needsReview, 1);
  assert.equal(row.testPreparation.usable, 0);
  assert.equal((await preparation(other)).testPreparation.requirementConfirmed, false);
  let todo = await caseTodos('TEST_CASE_RECHECK', sessions.tester, q);
  assert.equal(todo.total, 1);
  assert.equal(todo.summary.caseRechecks, 1);
  assert.equal(todo.items[0].status, 'NEEDS_REVIEW');
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.reviewer, q)).total, 0);
  assert.equal(
    (await caseTodos('TEST_CASE_RECHECK', sessions.tester, `${q}&status=NEEDS_REVIEW`)).total,
    1,
  );
  await reconfirm(other);
  assert.equal((await preparation(other)).testPreparation.usable, 0);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.tester, q)).total, 1);
  const current = await get(id);
  await post(
    sessions.tester,
    `${route(id)}/revise`,
    fields(current, { reason: '对照新基线补充场景' }),
  ).expect(201);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.tester, q)).total, 0);
  row = await preparation(req);
  assert.equal(row.testPreparation.draft, 1);
  assert.equal(row.testPreparation.usable, 0);
  await submit(id);
  assert.equal((await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, q)).total, 1);
  await act(id, 'approve', {}, sessions.reviewer);
  assert.equal((await preparation(req)).testPreparation.usable, 1);
  assert.equal((await caseTodos('TEST_CASE_REVIEW', sessions.reviewer, q)).total, 0);
});

test('复查责任随当前负责人及项目负责人变更，未分配草稿不丢待办，废弃后退出', async () => {
  const req = await requirement(a),
    title = `复查责任 ${randomUUID()}`,
    q = `q=${encodeURIComponent(title)}`;
  const assigned = await create({ title, requirementIds: [req] }),
    unassigned = await create({ title, ownerId: null, requirementIds: [req] });
  // 模拟职责变化后需求才发生修订；待办必须查询当前责任，不读取旧通知接收人。
  await db.testCase.update({ where: { id: assigned }, data: { ownerId: users.reviewer.id } });
  await reviseRequirement(req);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.tester, q)).total, 0);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.reviewer, q)).items[0].id, assigned);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.owner, q)).items[0].id, unassigned);
  await db.project.update({ where: { id: a }, data: { ownerId: users.reviewer.id } });
  try {
    assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.owner, q)).total, 0);
    assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.reviewer, q)).total, 2);
  } finally {
    await db.project.update({ where: { id: a }, data: { ownerId: users.owner.id } });
  }
  await act(assigned, 'deprecate', { comment: '需求调整，移除场景' });
  await act(unassigned, 'deprecate', { comment: '不再需要该草稿' });
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.reviewer, q)).total, 0);
  assert.equal((await caseTodos('TEST_CASE_RECHECK', sessions.owner, q)).total, 0);
  assert.equal((await preparation(req)).testPreparation.needsReview, 0);
});

test('评审及复查待办按当前成员/角色/项目状态校验，管理员不会看到他人的责任', async () => {
  const req = await requirement(a),
    title = `待办权限 ${randomUUID()}`,
    q = `q=${encodeURIComponent(title)}`;
  const id = await create({ title, requirementIds: [req], ownerId: users.reviewer.id });
  await submit(id);
  await reviseRequirement(req);
  for (const kind of ['TEST_CASE_REVIEW', 'TEST_CASE_RECHECK'])
    assert.equal((await caseTodos(kind, sessions.reviewer, q)).total, 1);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.reviewer.id } },
  });
  await db.projectMember.update({
    where: { projectId_userId: { projectId: a, userId: users.reviewer.id } },
    data: { roles: ['VIEWER'] },
  });
  try {
    for (const kind of ['TEST_CASE_REVIEW', 'TEST_CASE_RECHECK']) {
      const list = await caseTodos(kind, sessions.reviewer, q);
      assert.equal(list.total, 0);
      assert.equal(list.summary.total, 0);
    }
  } finally {
    await db.projectMember.update({
      where: { projectId_userId: { projectId: a, userId: users.reviewer.id } },
      data: { roles: member.roles },
    });
  }
  await db.projectMember.delete({
    where: { projectId_userId: { projectId: a, userId: users.reviewer.id } },
  });
  try {
    for (const kind of ['TEST_CASE_REVIEW', 'TEST_CASE_RECHECK'])
      assert.equal((await caseTodos(kind, sessions.reviewer, q)).total, 0);
  } finally {
    await db.projectMember.create({ data: member });
  }
  for (const status of ['ACCEPTING', 'COMPLETED', 'ARCHIVED', 'PAUSED']) {
    await db.project.update({ where: { id: a }, data: { status } });
    try {
      for (const kind of ['TEST_CASE_REVIEW', 'TEST_CASE_RECHECK']) {
        assert.equal(
          (await caseTodos(kind, sessions.reviewer, q)).total,
          status === 'PAUSED' ? 1 : 0,
        );
        assert.equal((await caseTodos(kind, sessions.admin, q)).total, 0);
      }
    } finally {
      await db.project.update({ where: { id: a }, data: { status: 'ACTIVE' } });
    }
  }
});

const freeze = (id, revision = 1, projectId = a) =>
  db.$transaction((tx) =>
    service.freezeExecutionSnapshot(tx, projectId, id, revision, {
      id: users.tester.id,
      name: users.tester.name,
    }),
  );

test('执行快照绑定已通过修订、真实评审和全部需求依据，JSONB 往返完整且逐层只读', async () => {
  const req = await requirement(a),
    other = await requirement(a);
  const id = await ready({
    requirementIds: [req, other],
    steps: [
      { action: '输入手机号', expected: '展示验证码输入' },
      { action: '输入正确验证码', expected: '登录成功\n建立会话' },
    ],
  });
  const row = await get(id),
    frozen = await freeze(id),
    approval = row.history.items.find((r) => r.action === 'APPROVED');
  assert.equal(frozen.schemaVersion, 1);
  assert.equal(frozen.projectId, a);
  assert.deepEqual(frozen.source, {
    testCaseId: id,
    revisionId: row.revisions.items[0].id,
    revision: 1,
  });
  assert.deepEqual(frozen.content, {
    code: row.code,
    title: row.title,
    preconditions: row.preconditions,
    steps: row.steps,
    priority: row.priority,
    owner: row.owner,
  });
  assert.equal(frozen.requirements.length, 2);
  for (const token of row.revisions.items[0].requirementBasis) {
    const item = frozen.requirements.find((r) => r.requirementId === token.requirementId);
    assert.equal(item.revision, token.revision);
    assert.equal(item.scopeVersion, token.scopeVersion);
    assert.ok(item.code && item.title);
  }
  assert.equal(frozen.approval.reviewId, approval.id);
  assert.equal(frozen.approval.reviewer.id, users.reviewer.id);
  assert.equal(frozen.approval.decidedBy.id, users.reviewer.id);
  assert.deepEqual(frozen.capturedBy, { id: users.tester.id, name: users.tester.name });
  assert.ok(Date.parse(frozen.capturedAt) >= Date.parse(frozen.approval.approvedAt));
  assert.throws(() => {
    frozen.content.steps[0].expected = '覆盖原预期';
  }, TypeError);
  assert.throws(() => {
    frozen.requirements[0].scopeVersion += 1;
  }, TypeError);
  const [stored] = await db.$queryRaw`SELECT ${JSON.stringify(frozen)}::jsonb AS snapshot`;
  const decoded = testCaseExecutionSnapshotSchema.parse(stored.snapshot);
  assert.deepEqual(decoded, frozen);
  assert.ok(Object.isFrozen(decoded.content.steps[0]));
  const doc = (await sessions.viewer.agent.get('/api/v1/openapi.json').expect(200)).body;
  assert.ok(doc.components.schemas.TestCaseExecutionSnapshot);
  assert.equal(doc.components.schemas.TestCaseExecutionSnapshot.additionalProperties, false);
});

test('冻结内容在后续需求修订、用例新评审/改派及废弃后保持原文，旧快照无需重新依赖当前资格读取', async () => {
  const req = await requirement(a),
    id = await ready({ requirementIds: [req] });
  const original = await freeze(id),
    encoded = JSON.stringify(original);
  await reviseRequirement(req);
  await assert.rejects(freeze(id), /只能选择/);
  assert.deepEqual(testCaseExecutionSnapshotSchema.parse(JSON.parse(encoded)), original);
  await reconfirm(req);
  const row = await get(id);
  await post(
    sessions.tester,
    `${route(id)}/revise`,
    fields(row, {
      reason: '按新基线补充校验',
      title: '修订后的场景',
      ownerId: users.reviewer.id,
      preconditions: '新的测试数据',
      priority: 'URGENT',
      steps: [{ action: '提交过期验证码', expected: '拒绝登录' }],
    }),
  ).expect(201);
  await assert.rejects(freeze(id, 1), /只能选择/);
  await submit(id);
  await act(id, 'approve', {}, sessions.reviewer);
  const next = await freeze(id, 2);
  assert.equal(next.source.revision, 2);
  assert.notEqual(next.source.revisionId, original.source.revisionId);
  assert.notEqual(next.approval.reviewId, original.approval.reviewId);
  assert.equal(next.content.owner.id, users.reviewer.id);
  assert.equal(next.requirements[0].revision, original.requirements[0].revision + 1);
  await act(id, 'deprecate', { comment: '场景已合并' });
  await assert.rejects(freeze(id, 2), /只能选择/);
  assert.equal(JSON.stringify(original), encoded);
  assert.equal(
    testCaseExecutionSnapshotSchema.parse(JSON.parse(encoded)).content.title,
    original.content.title,
  );
  const history = await get(id);
  assert.deepEqual(
    history.revisions.items.find((r) => r.revision === 1).snapshot.steps,
    original.content.steps,
  );
});

test('执行快照拒绝草稿、待评审、废弃、跨项目及无真实通过记录的伪 READY，管理员代评来源可追溯', async () => {
  const id = await create();
  await assert.rejects(freeze(id), /只能选择/);
  await submit(id);
  await assert.rejects(freeze(id), /只能选择/);
  await act(id, 'approve', { comment: '代评确认测试标准' }, sessions.admin);
  const snapshot = await freeze(id);
  assert.equal(snapshot.approval.reviewer.id, users.reviewer.id);
  assert.equal(snapshot.approval.decidedBy.id, users.admin.id);
  await assert.rejects(freeze(id, 1, b), /用例不存在/);
  await act(id, 'deprecate', { comment: '移除重复场景' });
  await assert.rejects(freeze(id), /只能选择/);
  const fake = await create();
  await db.testCase.update({ where: { id: fake }, data: { status: 'READY', approvedRevision: 1 } });
  try {
    await assert.rejects(freeze(fake), /评审或关联需求不一致/);
    await db.testCase.update({ where: { id: fake }, data: { revision: 2, approvedRevision: 2 } });
    await assert.rejects(freeze(fake, 2), /修订历史缺失/);
  } finally {
    await db.testCase.update({
      where: { id: fake },
      data: { status: 'DRAFT', revision: 1, approvedRevision: null },
    });
  }
});

test('历史源内容及依据严格校验：缺项/重复/错修订/错需求不能冻结，历史步骤原文不被 trim', async () => {
  const id = await ready(),
    row = await get(id),
    saved = row.revisions.items[0];
  const rollback = new Error('rollback staged revision validation');
  const stage = async (snapshotPatch, basis, valid = false) => {
    await assert.rejects(
      db.$transaction(async (tx) => {
        const snapshot = { ...saved.snapshot, revision: 2, ...snapshotPatch };
        await tx.testCase.update({
          where: { id },
          data: { revision: 2, approvedRevision: 2, reviewRound: 2 },
        });
        await tx.testCaseRevision.create({
          data: {
            projectId: a,
            testCaseId: id,
            revision: 2,
            snapshot,
            requirementBasis: basis,
            reason: '验证损坏历史边界，事务最终回滚',
          },
        });
        await tx.testCaseReview.create({
          data: {
            projectId: a,
            testCaseId: id,
            revision: 2,
            round: 2,
            action: 'APPROVED',
            actorId: users.reviewer.id,
            reviewerId: users.reviewer.id,
          },
        });
        const capture = () =>
          service.freezeExecutionSnapshot(tx, a, id, 2, {
            id: users.tester.id,
            name: users.tester.name,
          });
        if (valid) {
          const frozen = await capture();
          assert.deepEqual(frozen.content.steps, snapshot.steps);
        } else await assert.rejects(capture(), (error) => error.getStatus?.() === 422);
        throw rollback;
      }),
      (error) => error === rollback,
    );
  };
  for (const patch of [
    { steps: [] },
    { steps: [{ action: '输入手机号' }] },
    { owner: null },
    { revision: 3 },
    { requirements: [] },
  ])
    await stage(patch, saved.requirementBasis);
  await stage({}, [...saved.requirementBasis, ...saved.requirementBasis]);
  const other = (await preparation(reqB)).id;
  const otherBasis = await db.requirement.findUniqueOrThrow({ where: { id: other } });
  await stage({}, [
    { requirementId: other, revision: otherBasis.revision, scopeVersion: otherBasis.scopeVersion },
  ]);
  await stage(
    { steps: [{ action: '  输入手机号\n', expected: '\n展示验证码输入框  ' }] },
    saved.requirementBasis,
    true,
  );
  assert.equal((await get(id)).revisions.total, 1);
});

test('冻结与需求修订使用同一项目事务锁，并发后不能继续冻结旧依据，已捕获内容不被修改', async () => {
  const req = await requirement(a),
    id = await ready({ requirementIds: [req] }),
    before = await freeze(id),
    bytes = JSON.stringify(before);
  const [capture, revise] = await Promise.allSettled([freeze(id), reviseRequirement(req)]);
  assert.equal(revise.status, 'fulfilled');
  if (capture.status === 'fulfilled') {
    assert.deepEqual(capture.value.content, before.content);
    assert.deepEqual(capture.value.requirements, before.requirements);
  } else assert.equal(capture.reason.getStatus(), 422);
  await assert.rejects(freeze(id), /只能选择/);
  assert.equal(JSON.stringify(before), bytes);
  assert.equal(testCaseExecutionSnapshotSchema.parse(JSON.parse(bytes)).source.revision, 1);
});

test('M3 阶段退出：手机号登录四场景、退回重审、完整快照与两项开发任务独立推进', async () => {
  const req = await requirement(a, `M3退出 手机号登录 ${randomUUID()}`);
  const taskPath = `/projects/${a}/tasks`,
    tasks = [];
  for (const title of ['登录接口实现', '验证码一次性校验'])
    tasks.push(
      (
        await post(sessions.developer, taskPath, {
          requirementId: req,
          title,
          assigneeId: users.developer.id,
        }).expect(201)
      ).body.id,
    );
  const scenarios = [
    ['正常验证码', '提交有效且未使用的验证码', '登录成功并建立会话'],
    ['错误验证码', '提交与手机号不匹配的验证码', '拒绝登录并提示错误'],
    ['过期验证码', '提交已超过有效期的验证码', '拒绝登录并提示重新获取'],
    ['重复使用验证码', '成功登录后再次提交同一验证码', '拒绝第二次登录，验证码不可重复使用'],
  ];
  const cases = [];
  for (const [title, action, expected] of scenarios)
    cases.push(
      await create({
        title,
        requirementIds: [req],
        steps: [{ action, expected }],
      }),
    );
  assert.equal((await preparation(req)).testPreparation.draft, 4);
  await post(sessions.developer, `${taskPath}/${tasks[0]}/start`, { version: 1 }).expect(201);
  for (const [index, id] of cases.entries()) {
    await submit(id);
    if (index === 3) {
      await act(id, 'return', { comment: '补充第二次请求不建立新会话' }, sessions.reviewer);
      const row = await get(id);
      await post(
        sessions.tester,
        `${route(id)}/update`,
        fields(row, {
          steps: [
            { action: scenarios[index][1], expected: `${scenarios[index][2]}；不建立新会话` },
          ],
        }),
      ).expect(201);
      await submit(id);
    }
    await act(id, 'approve', {}, sessions.reviewer);
  }
  const detail = await preparation(req);
  assert.equal(detail.testPreparation.usable, 4);
  assert.equal(detail.cases.total, 4);
  const snapshots = [];
  for (const id of cases) {
    const row = await get(id);
    snapshots.push(await freeze(id, row.revision));
  }
  assert.deepEqual(
    snapshots.map((s) => s.content.title),
    scenarios.map((s) => s[0]),
  );
  assert.equal(snapshots[3].source.revision, 2);
  assert.equal(snapshots[3].approval.round, 2);
  assert.equal((await get(cases[3])).history.total, 4);
  assert.equal(
    (await sessions.developer.agent.get(`/api/v1${taskPath}/${tasks[0]}`).expect(200)).body.status,
    'IN_PROGRESS',
  );
  await post(sessions.developer, `${taskPath}/${tasks[1]}/start`, { version: 1 }).expect(201);
  assert.equal(
    (await sessions.developer.agent.get(`/api/v1${taskPath}/${tasks[1]}`).expect(200)).body.status,
    'IN_PROGRESS',
  );
  assert.equal((await preparation(req)).testPreparation.usable, 4);
});
