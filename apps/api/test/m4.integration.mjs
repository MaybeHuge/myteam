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
const { CollaborationEvents } = await import('../dist/common/collaboration-events.js');
const db = createDatabase(process.env.DATABASE_URL),
  nonce = randomUUID(),
  users = {},
  sessions = {};
let app, http, project, other;
const post = (s, path, data, key = randomUUID()) =>
  s.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .send(data);
const base = () => `/projects/${project}`;
const get = async (path, s = sessions.tester) =>
  (await s.agent.get(`/api/v1${path}`).expect(200)).body;
const quality = (kind, id = '') => `${base()}/quality/${kind}${id ? `/${id}` : ''}`;
const defectInput = (requirementId, extra = {}) => ({
  title: '手工缺陷',
  reproduction: '操作',
  expected: '拒绝',
  actual: '未拒绝',
  environment: 'qa',
  severity: 'MAJOR',
  requirementId,
  assigneeId: users.developer.id,
  retesterId: users.tester.id,
  ...extra,
});
async function login(u) {
  const agent = request.agent(http),
    csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
  const r = await agent
    .post('/api/v1/auth/login')
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', csrf)
    .send({ email: u.email, password: testPassword })
    .expect(201);
  return { agent, csrf: r.body.csrfToken };
}
async function reqNew() {
  const path = `${base()}/requirements`;
  const r = (
    await post(sessions.owner, path, {
      title: `需求 ${randomUUID()}`,
      description: '验证码仅使用一次',
      acceptanceCriteria: '拒绝重复使用',
      ownerId: users.owner.id,
    }).expect(201)
  ).body.id;
  await post(sessions.owner, `${path}/${r}/submit`, {
    version: 1,
    reviewerId: users.owner.id,
  }).expect(201);
  await post(sessions.owner, `${path}/${r}/approve`, { version: 2 }).expect(201);
  return r;
}
const reqGet = (id) => get(`${base()}/requirements/${id}`);
async function taskNew(r) {
  return (
    await post(sessions.developer, `${base()}/tasks`, {
      title: '开发任务',
      requirementId: r,
      assigneeId: users.developer.id,
    }).expect(201)
  ).body.id;
}
async function taskAct(id, action, s = sessions.developer) {
  const row = await get(`${base()}/tasks/${id}`);
  return post(s, `${base()}/tasks/${id}/${action}`, {
    version: row.version,
    reason: '核对本轮开发进度',
  }).expect(201);
}
async function caseNew(requirementIds, ready = true) {
  const id = (
    await post(sessions.tester, `${base()}/test-cases`, {
      title: `验证码用例 ${randomUUID()}`,
      requirementIds,
      ownerId: users.tester.id,
      preconditions: '存在有效验证码',
      steps: [{ action: '重复使用验证码', expected: '拒绝请求' }],
    }).expect(201)
  ).body.id;
  if (ready) {
    await post(sessions.tester, `${base()}/test-cases/${id}/submit`, {
      version: 1,
      reviewerId: users.tester.id,
    }).expect(201);
    await post(sessions.tester, `${base()}/test-cases/${id}/approve`, { version: 2 }).expect(201);
  }
  return id;
}
async function setup() {
  const requirement = await reqNew(),
    task = await taskNew(requirement),
    testCase = await caseNew([requirement]);
  return { requirement, task, testCase };
}
async function recordNew(f, extra = {}, s = sessions.tester) {
  return (
    await post(s, quality('records'), {
      requirementId: f.requirement,
      testCaseId: f.testCase,
      environment: 'qa-chrome',
      ...extra,
    }).expect(201)
  ).body.id;
}
async function finish(id, outcome, extra = {}, s = sessions.tester, key = randomUUID()) {
  const row = await get(quality('records', id));
  return {
    expect: (status) =>
      post(
        s,
        `${quality('records', id)}/finish`,
        {
          version: row.version,
          outcome,
          actual: outcome === 'PASSED' ? '正确拒绝' : '错误允许重复请求',
          ...extra,
        },
        key,
      ).expect(status),
  };
}
async function defectAct(id, action, extra = {}, s = sessions.tester) {
  const d = await get(quality('defects', id));
  return post(s, `${quality('defects', id)}/${action}`, {
    version: d.version,
    reason: '核对当前缺陷',
    ...extra,
  }).expect(201);
}
async function fix(id) {
  await defectAct(id, 'confirm');
  await defectAct(id, 'start', {}, sessions.developer);
  await defectAct(id, 'fix', { evidence: '已修复重复校验' }, sessions.developer);
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword);
  for (const role of [
    'owner',
    'developer',
    'developer2',
    'tester',
    'tester2',
    'viewer',
    'outsider',
  ])
    users[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${nonce}@lightweight.test`,
        passwordHash,
        isSystemAdmin: role === 'owner',
      },
    });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  for (const role of Object.keys(users)) sessions[role] = await login(users[role]);
  for (const name of ['main', 'other']) {
    const r = await post(sessions.owner, '/projects', {
      key: `L${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      name,
      ownerId: users.owner.id,
    }).expect(201);
    await db.project.update({ where: { id: r.body.id }, data: { status: 'ACTIVE' } });
    if (name === 'main') project = r.body.id;
    else other = r.body.id;
  }
  for (const role of ['developer', 'developer2', 'tester', 'tester2', 'viewer'])
    await post(sessions.owner, `${base()}/members`, {
      email: users[role].email,
      roles: [
        role.startsWith('developer')
          ? 'DEVELOPER'
          : role.startsWith('tester')
            ? 'TESTER'
            : 'VIEWER',
      ],
    }).expect(201);
});
after(async () => {
  await app?.close();
  await clearTestStorage(storage);
  if (process.env.KEEP_TEST_DATA !== 'true') {
    const ids = [project, other].filter(Boolean);
    await db.project.deleteMany({ where: { id: { in: ids } } });
    await db.activityLog.deleteMany({ where: { projectId: { in: ids } } });
    const people = Object.values(users).map((u) => u.id);
    await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
    await db.user.deleteMany({ where: { id: { in: people } } });
  }
  await db.$disconnect();
});

test('任务只有三列，负责人完成和重新开始自动汇总需求，其他开发不可代操作', async () => {
  const f = await setup();
  assert.equal((await reqGet(f.requirement)).status, 'CONFIRMED');
  await taskAct(f.task, 'start');
  assert.equal((await reqGet(f.requirement)).status, 'IMPLEMENTING');
  const t = await get(`${base()}/tasks/${f.task}`);
  await post(sessions.developer2, `${base()}/tasks/${f.task}/complete`, {
    version: t.version,
    reason: '越权',
  }).expect(403);
  await taskAct(f.task, 'complete');
  assert.equal((await reqGet(f.requirement)).status, 'ACCEPTING');
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id: f.task } })).resolution, 'DONE');
  await taskAct(f.task, 'reopen');
  assert.equal((await reqGet(f.requirement)).status, 'IMPLEMENTING');
  const board = await get(`${base()}/tasks/board`);
  assert.deepEqual(
    board.columns.map((c) => c.status),
    ['TODO', 'IN_PROGRESS', 'COMPLETED'],
  );
});
test('完整测试通过推进需求完成；无任务、无用例和未执行用例不能被算作完成', async () => {
  const empty = await reqNew();
  assert.equal((await reqGet(empty)).status, 'CONFIRMED');
  const f = await setup(),
    second = await caseNew([f.requirement]);
  await taskAct(f.task, 'start');
  await taskAct(f.task, 'complete');
  const record = await recordNew(f);
  assert.equal((await reqGet(f.requirement)).status, 'TESTING');
  await (await finish(record, 'PASSED')).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'TESTING');
  const two = await recordNew({ ...f, testCase: second });
  await (await finish(two, 'PASSED')).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
  assert.equal(
    (await db.workItem.findUniqueOrThrow({ where: { id: f.requirement } })).resolution,
    'DONE',
  );
  await taskAct(f.task, 'reopen');
  assert.equal((await reqGet(f.requirement)).status, 'IMPLEMENTING');
  assert.equal((await get(quality('records', record))).current, false);
  await taskAct(f.task, 'complete');
  assert.equal((await reqGet(f.requirement)).status, 'ACCEPTING');
});
test('提前测试不会越过开发任务；所有任务完成后才允许需求完成', async () => {
  const f = await setup();
  await taskAct(f.task, 'start');
  const record = await recordNew(f);
  await (await finish(record, 'PASSED')).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'IMPLEMENTING');
  await taskAct(f.task, 'complete');
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
});
test('未通过自动生成关联缺陷；重复失败复用缺陷；失败和通过复测保留多条记录', async () => {
  const f = await setup();
  await taskAct(f.task, 'start');
  await taskAct(f.task, 'complete');
  const first = await recordNew(f);
  const failure = (await (await finish(first, 'FAILED')).expect(201)).body;
  assert.equal(failure.defectIds.length, 1);
  const bug = failure.defectIds[0];
  const detail = await get(quality('defects', bug));
  assert.equal(detail.testCases[0].id, f.testCase);
  assert.equal(detail.testRecords[0].id, first);
  assert.equal((await reqGet(f.requirement)).status, 'TESTING');
  assert.equal((await get(`${base()}/tasks/${f.task}`)).status, 'COMPLETED');
  const duplicate = await recordNew(f);
  const again = (await (await finish(duplicate, 'FAILED')).expect(201)).body;
  assert.deepEqual(again.defectIds, [bug]);
  await fix(bug);
  const retry = await recordNew(f, { type: 'RETEST' });
  assert.equal((await get(quality('records', retry))).defects[0].id, bug);
  await (await finish(retry, 'FAILED')).expect(201);
  assert.equal((await get(quality('defects', bug))).status, 'OPEN');
  await defectAct(bug, 'start', {}, sessions.developer);
  await defectAct(bug, 'fix', { evidence: '补齐边界' }, sessions.developer);
  const passed = await recordNew(f, { type: 'RETEST' });
  await (await finish(passed, 'PASSED')).expect(201);
  assert.equal((await get(quality('defects', bug))).status, 'CLOSED');
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
  const list = await get(`${quality('records')}?testCaseId=${f.testCase}`);
  assert.equal(list.total, 4);
  assert.equal((await get(`${base()}/test-cases/${f.testCase}`)).testResult, 'PASSED');
});
test('测试截图使用真实私有存储，拒绝跨记录附件引用和非成员下载，完成后证据只读', async () => {
  const f = await setup(),
    record = await recordNew(f),
    otherRecord = await recordNew({ ...f, testCase: await caseNew([f.requirement]) });
  const upload = await sessions.tester.agent
    .post(`/api/v1${base()}/collaboration/TEST_RECORD/${record}/attachments?filename=evidence.png`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', sessions.tester.csrf)
    .set('Idempotency-Key', randomUUID())
    .set('Content-Type', 'application/octet-stream')
    .send(
      Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
        'base64',
      ),
    )
    .expect(201);
  const files = await get(`${base()}/collaboration/TEST_RECORD/${record}/attachments`);
  assert.equal(files.total, 1);
  const attachment = files.items[0].id;
  await (await finish(otherRecord, 'PASSED', { attachmentIds: [attachment] })).expect(422);
  await (await finish(record, 'PASSED', { attachmentIds: [attachment] })).expect(201);
  assert.deepEqual((await get(quality('records', record))).attachmentIds, [attachment]);
  const file = await db.attachment.findUniqueOrThrow({ where: { id: attachment } });
  assert.ok((await storage.get(file.storageKey)).length > 0);
  await sessions.outsider.agent
    .get(`/api/v1${base()}/collaboration/TEST_RECORD/${record}/attachments`)
    .expect(404);
  assert.equal(
    (await get(`${base()}/collaboration/TEST_RECORD/${record}/attachments`)).canWrite,
    false,
  );
  assert.ok(upload.body.id);
});
test('手工缺陷可以不关联用例/记录；关联记录自动补用例，拒绝不同需求或项目证据', async () => {
  const f = await setup(),
    record = await recordNew(f);
  const bug = (
    await post(sessions.tester, quality('defects'), defectInput(f.requirement)).expect(201)
  ).body.id;
  let d = await get(quality('defects', bug));
  assert.deepEqual(d.testCases, []);
  assert.deepEqual(d.testRecords, []);
  await defectAct(bug, 'link', { testRecordIds: [record] });
  d = await get(quality('defects', bug));
  assert.equal(d.testCases[0].id, f.testCase);
  const foreign = await setup();
  await post(
    sessions.tester,
    quality('defects'),
    defectInput(foreign.requirement, { testRecordIds: [record] }),
  ).expect(422);
  await post(sessions.tester, `/projects/${other}/quality/records`, {
    requirementId: f.requirement,
    testCaseId: f.testCase,
    environment: 'qa',
  }).expect(404);
});
test('共享用例的结果按需求隔离，需求修订和用例修订使旧通过结果失效', async () => {
  const one = await reqNew(),
    two = await reqNew(),
    testCase = await caseNew([one, two]),
    a = await taskNew(one),
    b = await taskNew(two);
  for (const id of [a, b]) {
    await taskAct(id, 'start');
    await taskAct(id, 'complete');
  }
  const record = await recordNew({ requirement: one, testCase });
  await (await finish(record, 'PASSED')).expect(201);
  assert.equal((await reqGet(one)).status, 'COMPLETED');
  assert.equal((await reqGet(two)).status, 'ACCEPTING');
  const c = await get(`${base()}/test-cases/${testCase}`);
  await post(sessions.tester, `${base()}/test-cases/${testCase}/revise`, {
    title: c.title,
    preconditions: c.preconditions,
    steps: c.steps,
    priority: c.priority,
    ownerId: c.ownerId,
    requirementIds: [one, two],
    version: c.version,
    reason: '增加场景',
  }).expect(201);
  assert.equal((await reqGet(one)).status, 'TESTING');
  assert.equal((await get(quality('records', record))).current, false);
  const r = await reqGet(one);
  await post(sessions.owner, `${base()}/requirements/${one}/revise`, {
    title: r.title,
    description: r.description + '更新',
    acceptanceCriteria: r.acceptanceCriteria,
    type: r.type,
    priority: r.priority,
    ownerId: r.owner.id,
    iterationId: null,
    version: r.version,
    reason: '业务变化',
    impact: '重新验证',
  }).expect(201);
  assert.equal((await reqGet(one)).status, 'DRAFT');
  assert.equal((await get(`${base()}/tasks/${a}`)).status, 'IN_PROGRESS');
});
test('新建开发任务使已完成需求和原测试结果失效；没有任务不能完成需求', async () => {
  const f = await setup();
  await taskAct(f.task, 'start');
  await taskAct(f.task, 'complete');
  const record = await recordNew(f);
  await (await finish(record, 'PASSED')).expect(201);
  await taskNew(f.requirement);
  assert.equal((await reqGet(f.requirement)).status, 'IMPLEMENTING');
  assert.equal((await get(quality('records', record))).current, false);
  const r = await reqNew(),
    c = await caseNew([r]),
    id = await recordNew({ requirement: r, testCase: c });
  await (await finish(id, 'PASSED')).expect(201);
  assert.equal((await reqGet(r)).status, 'CONFIRMED');
});
test('幂等保存不重复建缺陷；并发结论只能保存一次；已保存结果不能覆盖', async () => {
  const f = await setup(),
    record = await recordNew(f),
    key = randomUUID();
  const data = { version: 1, outcome: 'FAILED', actual: '错误重复请求' };
  await post(sessions.tester, `${quality('records', record)}/finish`, data, key).expect(201);
  await post(sessions.tester, `${quality('records', record)}/finish`, data, key).expect(201);
  assert.equal(await db.defectRecordLink.count({ where: { testRecordId: record } }), 1);
  await post(sessions.tester, `${quality('records', record)}/finish`, {
    ...data,
    version: 2,
  }).expect(422);
  const otherId = await recordNew(f);
  const results = await Promise.all(
    ['PASSED', 'FAILED'].map((outcome) =>
      post(sessions.tester, `${quality('records', otherId)}/finish`, {
        version: 1,
        outcome,
        actual: '并发结论',
      }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  await assert.rejects(db.testRecord.update({ where: { id: record }, data: { actual: '覆盖' } }));
});
test('角色/责任隔离、当前工作台和旧入口移除', async () => {
  const f = await setup();
  for (const role of ['developer', 'viewer'])
    await post(sessions[role], quality('records'), {
      requirementId: f.requirement,
      testCaseId: f.testCase,
      environment: 'qa',
    }).expect(403);
  const record = await recordNew(f);
  await (await finish(record, 'PASSED', {}, sessions.tester2)).expect(403);
  const todos = await get('/workbench/todos?kind=TEST_RECORD');
  assert.ok(todos.items.some((t) => t.id === record));
  await (await finish(record, 'PASSED')).expect(201);
  assert.ok(!(await get('/workbench/todos?kind=TEST_RECORD')).items.some((t) => t.id === record));
  await sessions.tester.agent.get(`/api/v1${quality('submissions')}`).expect(400);
  await post(sessions.developer, quality('submissions'), {}).expect(404);
});
test('严重手工缺陷阻止需求完成，复测关闭后恢复完成，开发不能代替测试关闭', async () => {
  const f = await setup();
  await taskAct(f.task, 'start');
  await taskAct(f.task, 'complete');
  const record = await recordNew(f);
  await (await finish(record, 'PASSED')).expect(201);
  const bug = (
    await post(sessions.tester, quality('defects'), defectInput(f.requirement)).expect(201)
  ).body.id;
  assert.equal((await reqGet(f.requirement)).status, 'TESTING');
  await fix(bug);
  const d = await get(quality('defects', bug));
  await post(sessions.developer, `${quality('defects', bug)}/retest`, {
    version: d.version,
    reason: '冒充复测',
    passed: true,
    evidence: '通过',
  }).expect(403);
  await defectAct(bug, 'retest', { passed: true, evidence: '手工复现通过' });
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
});
test('事件失败使测试结果、自动缺陷和需求状态在同一事务回滚', async () => {
  const f = await setup(),
    record = await recordNew(f),
    service = app.get(CollaborationEvents),
    original = service.record;
  service.record = async (...args) => {
    await original.apply(service, args);
    throw new Error('模拟测试记录事件故障');
  };
  try {
    await (await finish(record, 'FAILED')).expect(500);
  } finally {
    service.record = original;
  }
  assert.equal((await get(quality('records', record))).outcome, 'NOT_RUN');
  assert.equal(
    await db.defect.count({ where: { projectId: project, requirementId: f.requirement } }),
    0,
  );
  await (await finish(record, 'FAILED')).expect(201);
});

test('主缺陷经测试记录复测关闭后，重复缺陷所在需求同步恢复完成', async () => {
  const one = await setup(),
    two = await setup();
  for (const f of [one, two]) {
    await taskAct(f.task, 'start');
    await taskAct(f.task, 'complete');
  }
  const first = await recordNew(one);
  const bug = (await (await finish(first, 'FAILED')).expect(201)).body.defectIds[0];
  const duplicate = (
    await post(sessions.tester, quality('defects'), defectInput(two.requirement)).expect(201)
  ).body.id;
  await defectAct(duplicate, 'dispose', {
    conclusion: 'DUPLICATE',
    duplicateOfId: bug,
    evidence: '相同根因',
  });
  const passing = await recordNew(two);
  await (await finish(passing, 'PASSED')).expect(201);
  assert.equal((await reqGet(two.requirement)).status, 'TESTING');
  await fix(bug);
  const retry = await recordNew(one, { type: 'RETEST' });
  await (await finish(retry, 'PASSED')).expect(201);
  assert.equal((await reqGet(one.requirement)).status, 'COMPLETED');
  assert.equal((await reqGet(two.requirement)).status, 'COMPLETED');
});
test('有构建上下文时修复和复测必须使用新构建，版本范围变更使旧证据失效', async () => {
  const f = await setup();
  await taskAct(f.task, 'start');
  await taskAct(f.task, 'complete');
  const release = (
    await post(sessions.owner, quality('releases'), {
      name: `版本 ${randomUUID()}`,
      requirementIds: [f.requirement],
      taskIds: [f.task],
    }).expect(201)
  ).body.id;
  const build = async () =>
    (
      await post(sessions.developer, quality('builds'), {
        releaseId: release,
        identifier: randomUUID(),
        codeUrl: 'https://example.test/commit',
        artifactUrl: 'https://example.test/build',
      }).expect(201)
    ).body.id;
  const b1 = await build(),
    first = await recordNew(f, { buildId: b1 });
  const bug = (await (await finish(first, 'FAILED')).expect(201)).body.defectIds[0];
  await defectAct(bug, 'confirm');
  await defectAct(bug, 'start', {}, sessions.developer);
  const d = await get(quality('defects', bug));
  await post(sessions.developer, `${quality('defects', bug)}/fix`, {
    version: d.version,
    reason: '未引用构建',
    evidence: '说明',
  }).expect(422);
  const b2 = await build();
  await defectAct(bug, 'fix', { buildId: b2, evidence: '实际修复构建' }, sessions.developer);
  await post(sessions.tester, quality('records'), {
    requirementId: f.requirement,
    testCaseId: f.testCase,
    buildId: b1,
    environment: 'qa',
    type: 'RETEST',
    defectIds: [bug],
  }).expect(422);
  const retry = await recordNew(f, { type: 'RETEST', buildId: b2 });
  await (await finish(retry, 'PASSED')).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
  assert.equal(
    (await get(quality('defects', bug))).dispositions.items.find((d) => d.action === 'fix').buildId,
    b2,
  );
  const r = await get(quality('releases', release));
  await post(sessions.owner, `${quality('releases', release)}/update`, {
    version: r.version,
    name: r.name,
    description: '调整范围说明',
    requirementIds: [f.requirement],
    taskIds: [f.task],
  }).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'ACCEPTING');
  assert.equal((await get(quality('records', retry))).current, false);
  await post(sessions.tester, quality('records'), {
    requirementId: f.requirement,
    testCaseId: f.testCase,
    buildId: b2,
    environment: 'qa',
  }).expect(422);
  const b3 = await build(),
    latest = await recordNew(f, { buildId: b3 });
  await (await finish(latest, 'PASSED')).expect(201);
  assert.equal((await reqGet(f.requirement)).status, 'COMPLETED');
});
