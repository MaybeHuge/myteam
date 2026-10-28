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
const db = createDatabase(process.env.DATABASE_URL);
const nonce = randomUUID();
const suffix = `${nonce}@requirements.test`;
const prefix = `R${nonce.replaceAll('-', '').slice(0, 7).toUpperCase()}`;
let app, http, a, b, iteration, foreignIteration, closedIteration;
const users = {},
  sessions = {};
const route = (id = '', projectId = a) =>
  `/projects/${projectId}/requirements${id ? `/${id}` : ''}`;
const post = (s, path, input, key = randomUUID()) =>
  s.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .send(input);
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
const input = (extra = {}) => ({
  title: `需求 ${randomUUID()}`,
  description: '为授权项目成员提供客户资料搜索',
  acceptanceCriteria: '输入名称仅显示当前用户有权访问的资料，无结果时提示',
  ownerId: users.developer.id,
  type: 'FUNCTIONAL',
  priority: 'MEDIUM',
  iterationId: null,
  ...extra,
});
const get = async (id, s = sessions.owner) =>
  (await s.agent.get(`/api/v1${route(id)}`).expect(200)).body;
const update = (item, extra = {}) => ({
  title: item.title,
  description: item.description,
  acceptanceCriteria: item.acceptanceCriteria,
  ownerId: item.ownerId,
  type: item.type,
  priority: item.priority,
  iterationId: item.iterationId,
  version: item.version,
  ...extra,
});
const create = async (extra = {}, s = sessions.owner) =>
  (await post(s, route(), input(extra)).expect(201)).body.id;
const act = async (id, action, extra = {}, s = sessions.owner, status = 201) =>
  post(s, `${route(id)}/${action}`, { version: (await get(id)).version, ...extra }).expect(status);
const submit = (id, extra = {}) => act(id, 'submit', { reviewerId: users.product.id, ...extra });
before(async () => {
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  for (const role of [
    'admin',
    'owner',
    'product',
    'product2',
    'developer',
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
      name: `需求隔离 ${key}`,
      ownerId: key === 'A' ? users.owner.id : users.outsider.id,
    }).expect(201);
    await db.project.update({ where: { id: result.body.id }, data: { status: 'ACTIVE' } });
    if (key === 'A') a = result.body.id;
    else b = result.body.id;
  }
  for (const role of ['product', 'product2', 'developer', 'tester', 'viewer'])
    await post(sessions.owner, `/projects/${a}/members`, {
      email: users[role].email,
      roles: [role.startsWith('product') ? 'PRODUCT' : role.toUpperCase()],
    }).expect(201);
  const plan = {
    name: `计划 ${nonce}`,
    goal: '交付本轮范围',
    ownerId: users.owner.id,
    startDate: '2026-11-01',
    endDate: '2026-11-14',
  };
  iteration = (await post(sessions.owner, `/projects/${a}/iterations`, plan).expect(201)).body.id;
  foreignIteration = (
    await post(sessions.admin, `/projects/${b}/iterations`, {
      ...plan,
      ownerId: users.outsider.id,
    }).expect(201)
  ).body.id;
  closedIteration = (
    await post(sessions.owner, `/projects/${a}/iterations`, {
      ...plan,
      name: `${plan.name} closed`,
    }).expect(201)
  ).body.id;
  await post(sessions.owner, `/projects/${a}/iterations/${closedIteration}/start`, {
    version: 1,
  }).expect(201);
  await post(sessions.owner, `/projects/${a}/iterations/${closedIteration}/close`, {
    version: 2,
    summary: '无范围事项',
  }).expect(201);
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
    people = Object.values(users).map((u) => u.id);
  await db.activityLog.deleteMany({ where: { projectId: { in: ids } } });
  await db.project.deleteMany({ where: { id: { in: ids } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: people } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: people } } });
  await db.loginAttempt.deleteMany({ where: { email: { endsWith: suffix } } });
  await db.user.deleteMany({ where: { id: { in: people } } });
  await db.$disconnect();
});
test('项目隔离、读写角色和指定评审人的权限均在服务端校验', async () => {
  const id = await create();
  await request(http).get(`/api/v1${route()}`).expect(401);
  await sessions.outsider.agent.get(`/api/v1${route()}`).expect(404);
  await sessions.owner.agent.get(`/api/v1${route(id, b)}`).expect(404);
  for (const role of ['developer', 'tester', 'viewer']) {
    await post(sessions[role], route(), input()).expect(403);
    await post(sessions[role], `${route(id)}/update`, update(await get(id))).expect(403);
    assert.deepEqual((await get(id, sessions[role])).allowedActions, []);
  }
  await submit(id);
  await act(id, 'approve', {}, sessions.product2, 403);
  await act(id, 'approve', {}, sessions.developer, 403);
  await act(id, 'approve', {}, sessions.owner, 403);
  await act(id, 'approve', {}, sessions.admin, 422);
  await act(id, 'approve', { comment: '代指定评审人复核验收标准' }, sessions.admin);
  const item = await get(id);
  assert.equal(item.status, 'CONFIRMED');
  const audit = await db.activityLog.findFirstOrThrow({
    where: { targetId: id, action: 'requirement.approve' },
  });
  assert.equal(audit.details.adminOverride, true);
});
test('草稿允许不完整，输入不能跳状态，创建幂等且编号项目内连续', async () => {
  const data = { title: '不完整草稿', status: 'CONFIRMED' },
    key = randomUUID();
  const sequence = (await db.project.findUniqueOrThrow({ where: { id: a } })).requirementSequence;
  const first = await post(sessions.product, route(), data, key).expect(201);
  const again = await post(sessions.product, route(), data, key).expect(201);
  assert.equal(first.body.id, again.body.id);
  const item = await get(first.body.id);
  assert.equal(item.status, 'DRAFT');
  assert.equal(item.owner, null);
  assert.equal(item.number, sequence + 1);
  await act(item.id, 'submit', { reviewerId: users.product.id }, sessions.owner, 422);
  await post(sessions.product, route(), { ...data, title: '变化' }, key).expect(409);
  assert.equal(
    await db.workItem.count({
      where: { id: item.id, projectId: a, kind: 'REQUIREMENT', resolution: 'OPEN' },
    }),
    1,
  );
  assert.equal(
    await db.activityLog.count({ where: { targetId: item.id, action: 'requirement.created' } }),
    1,
  );
});
test('负责人、评审人及迭代候选限制在本项目可用成员与可分配计划', async () => {
  const sequence = (await db.project.findUniqueOrThrow({ where: { id: a } })).requirementSequence;
  for (const extra of [{ ownerId: users.outsider.id }, { iterationId: closedIteration }])
    await post(sessions.owner, route(), input(extra)).expect(422);
  await post(sessions.owner, route(), input({ iterationId: foreignIteration })).expect(404);
  assert.equal(
    (await db.project.findUniqueOrThrow({ where: { id: a } })).requirementSequence,
    sequence,
  );
  const id = await create();
  for (const role of ['outsider', 'developer', 'tester', 'viewer'])
    await act(id, 'submit', { reviewerId: users[role].id }, sessions.owner, 422);
  await db.user.update({ where: { id: users.product2.id }, data: { active: false } });
  try {
    await act(id, 'submit', { reviewerId: users.product2.id }, sessions.owner, 422);
    const people = await sessions.owner.agent
      .get(`/api/v1${route('people')}`)
      .query({ purpose: 'reviewer', pageSize: 1 })
      .expect(200);
    assert.equal(people.body.total, 2);
    assert.equal(people.body.items.length, 1);
    const searched = await sessions.owner.agent
      .get(`/api/v1${route('people')}`)
      .query({ purpose: 'reviewer', q: users.product.email })
      .expect(200);
    assert.deepEqual(
      searched.body.items.map((u) => u.id),
      [users.product.id],
    );
  } finally {
    await db.user.update({ where: { id: users.product2.id }, data: { active: true } });
  }
  await sessions.viewer.agent.get(`/api/v1${route('people')}`).expect(403);
});
test('标题编号描述及状态、负责人、优先级、类型、迭代可组合筛选并分页', async () => {
  const marker = `搜索${nonce}`;
  const id = await create({
    description: marker,
    priority: 'URGENT',
    type: 'MAINTENANCE',
    iterationId: iteration,
  });
  const query = {
    q: marker,
    status: 'DRAFT',
    priority: 'URGENT',
    type: 'MAINTENANCE',
    ownerId: users.developer.id,
    iterationId: iteration,
    pageSize: 1,
  };
  const list = await sessions.viewer.agent.get(`/api/v1${route()}`).query(query).expect(200);
  assert.equal(list.body.canCreate, false);
  assert.equal(list.body.total, 1);
  assert.equal(list.body.items[0].id, id);
  const code = await sessions.owner.agent
    .get(`/api/v1${route()}`)
    .query({ q: (await get(id)).code })
    .expect(200);
  assert.deepEqual(
    code.body.items.map((i) => i.id),
    [id],
  );
  await sessions.owner.agent.get(`/api/v1${route()}`).query({ pageSize: 101 }).expect(400);
  await sessions.owner.agent.get(`/api/v1${route()}`).query({ status: 'FAKE' }).expect(400);
});
test('评审退回需原因，修改后新轮次保留旧快照，确认只读且仍是迭代未完成项', async () => {
  const id = await create({ iterationId: iteration });
  const original = await get(id);
  await submit(id, { comment: '请核对验收标准' });
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { description: '越过评审修改' }),
  ).expect(422);
  await act(id, 'return', { comment: '   ' }, sessions.product, 400);
  await act(id, 'return', { comment: '补充权限不足场景的提示' }, sessions.product);
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { acceptanceCriteria: '新版标准：无权限返回拒绝提示' }),
  ).expect(201);
  await submit(id);
  await db.user.update({ where: { id: users.developer.id }, data: { name: '更名的开发成员' } });
  await db.iteration.update({ where: { id: iteration }, data: { name: `重命名 ${nonce}` } });
  await act(id, 'approve', { comment: '满足本轮标准' }, sessions.product);
  const final = await get(id);
  assert.equal(final.status, 'CONFIRMED');
  assert.equal(final.reviewRound, 2);
  assert.equal(final.revision, 2);
  assert.equal(final.history.total, 4);
  const old = final.history.items.filter((r) => r.round === 1);
  assert.ok(old.every((r) => r.snapshot.acceptanceCriteria === original.acceptanceCriteria));
  const current = final.history.items.filter((r) => r.round === 2);
  assert.ok(current.every((r) => r.snapshot.owner.name === 'developer'));
  assert.deepEqual(final.allowedActions, ['revise']);
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'OPEN');
  await post(sessions.owner, `${route(id)}/update`, update(final)).expect(422);
  await act(id, 'cancel', { comment: '已确认不能随意取消' }, sessions.owner, 422);
  const paged = await sessions.viewer.agent
    .get(`/api/v1${route(id)}`)
    .query({ page: 2, pageSize: 2 })
    .expect(200);
  assert.equal(paged.body.history.total, 4);
  assert.ok(paged.body.history.items.every((r) => r.round === 1));
  await assert.rejects(
    db.requirementReview.update({ where: { id: old[0].id }, data: { comment: '篡改旧意见' } }),
    /append-only/,
  );
});
test('确认时再次校验完整性和本轮基线，失败不写入结论，退回仍可恢复流程', async () => {
  const id = await create();
  await submit(id);
  const baseline = await get(id);
  await db.requirement.update({ where: { id }, data: { acceptanceCriteria: '' } });
  await act(id, 'approve', {}, sessions.product, 422);
  assert.equal((await get(id)).history.total, 1);
  assert.equal((await get(id)).version, baseline.version);
  await db.requirement.update({
    where: { id },
    data: { acceptanceCriteria: baseline.acceptanceCriteria },
  });
  await db.workItem.update({ where: { id }, data: { title: '模拟外部写入变更基线' } });
  await act(id, 'approve', {}, sessions.product, 409);
  await act(id, 'return', { comment: '基线变化，请重新核对并送审' }, sessions.product);
  assert.equal((await get(id)).history.items[0].snapshot.title, baseline.title);
});
test('同版本并发写入和确认/退回竞争只产生一次状态及历史变更，成功命令可幂等重放', async () => {
  const id = await create(),
    item = await get(id);
  const edits = await Promise.all(
    ['A', 'B'].map((title) =>
      post(sessions.product, `${route(id)}/update`, update(item, { title })),
    ),
  );
  assert.deepEqual(edits.map((r) => r.status).sort(), [201, 409]);
  const data = { version: (await get(id)).version, reviewerId: users.product.id },
    key = randomUUID();
  await post(sessions.owner, `${route(id)}/submit`, data, key).expect(201);
  await post(sessions.owner, `${route(id)}/submit`, data, key).expect(201);
  const version = (await get(id)).version;
  const results = await Promise.all(
    ['approve', 'return'].map((action) =>
      post(sessions.product, `${route(id)}/${action}`, { version, comment: '并发结论' }),
    ),
  );
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
  assert.equal((await get(id)).history.total, 2);
  assert.equal(
    await db.notification.count({
      where: { targetType: 'REQUIREMENT', targetId: id, recipientId: users.product.id },
    }),
    1,
  );
});
test('撤回冻结同轮快照，重新分配评审后角色可以移交；需求负责人移出和停用受保护', async () => {
  const id = await create({ ownerId: users.tester.id });
  await submit(id);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.product.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.product.id}/roles`, {
    version: member.version,
    roles: ['DEVELOPER'],
  }).expect(422);
  await post(sessions.owner, `/projects/${a}/members/${users.product.id}/remove`, {
    version: member.version,
  }).expect(422);
  await post(sessions.admin, `/users/${users.product.id}/status`, {
    version: users.product.version,
    active: false,
  }).expect(422);
  const ownerMember = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.tester.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.tester.id}/remove`, {
    version: ownerMember.version,
  }).expect(422);
  await post(sessions.admin, `/users/${users.tester.id}/status`, {
    version: users.tester.version,
    active: false,
  }).expect(422);
  await act(id, 'withdraw', { comment: '重新安排评审人' });
  const item = await get(id);
  assert.equal(item.status, 'DRAFT');
  assert.equal(item.history.items[0].action, 'WITHDRAWN');
  await submit(id, { reviewerId: users.product2.id });
  await post(sessions.owner, `/projects/${a}/members/${users.product.id}/roles`, {
    version: member.version,
    roles: ['DEVELOPER'],
  }).expect(201);
  await post(sessions.owner, `/projects/${a}/members/${users.product.id}/roles`, {
    version: member.version + 1,
    roles: ['PRODUCT'],
  }).expect(201);
  await act(id, 'return', { comment: '移交完成' }, sessions.product2);
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { ownerId: users.developer.id }),
  ).expect(201);
  await post(sessions.owner, `/projects/${a}/members/${users.tester.id}/remove`, {
    version: ownerMember.version,
  }).expect(201);
});
test('计划归属不能清空逃避关闭检查，草稿取消后统一计划记录标记取消', async () => {
  const id = await create({ iterationId: iteration });
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { iterationId: null }),
  ).expect(422);
  const freshPlan = await db.iteration.create({
    data: {
      projectId: a,
      name: `取消校验 ${nonce}`,
      goal: '核对关闭门禁',
      ownerId: users.owner.id,
      startDate: new Date('2026-11-01'),
      endDate: new Date('2026-11-14'),
    },
  });
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { iterationId: freshPlan.id }),
  ).expect(422);
  await post(
    sessions.owner,
    `${route(id)}/update`,
    update(await get(id), { iterationId: freshPlan.id, changeReason: '延期进入下一轮' }),
  ).expect(201);
  await post(sessions.owner, `/projects/${a}/iterations/${freshPlan.id}/start`, {
    version: 1,
  }).expect(201);
  await post(sessions.owner, `/projects/${a}/iterations/${freshPlan.id}/close`, {
    version: 2,
    summary: '未完成不得关闭',
  }).expect(422);
  await act(id, 'cancel', { comment: '不再需要此范围' });
  assert.equal((await get(id)).status, 'CANCELLED');
  assert.equal((await db.workItem.findUniqueOrThrow({ where: { id } })).resolution, 'CANCELED');
  await post(sessions.owner, `/projects/${a}/iterations/${freshPlan.id}/close`, {
    version: 2,
    summary: '本轮范围已取消，保留记录',
  }).expect(201);
});
test('业务修改、通知、审计、幂等和编号在同一事务，事件失败完整回滚', async () => {
  const service = app.get(CollaborationEvents),
    original = service.record;
  const key = randomUUID(),
    before = (await db.project.findUniqueOrThrow({ where: { id: a } })).requirementSequence,
    data = input();
  service.record = async (...args) => {
    await original.apply(service, args);
    throw new Error('模拟记录失败');
  };
  try {
    await post(sessions.owner, route(), data, key).expect(500);
  } finally {
    service.record = original;
  }
  assert.equal(
    await db.requirement.count({ where: { projectId: a, workItem: { title: data.title } } }),
    0,
  );
  assert.equal(await db.workItem.count({ where: { projectId: a, title: data.title } }), 0);
  assert.equal(
    (await db.project.findUniqueOrThrow({ where: { id: a } })).requirementSequence,
    before,
  );
  const result = await post(sessions.owner, route(), data, key).expect(201);
  assert.equal((await get(result.body.id)).number, before + 1);
  const id = result.body.id,
    version = (await get(id)).version;
  service.record = async () => {
    throw new Error('模拟通知失败');
  };
  try {
    await post(sessions.owner, `${route(id)}/submit`, {
      version,
      reviewerId: users.product.id,
    }).expect(500);
  } finally {
    service.record = original;
  }
  const item = await get(id);
  assert.equal(item.status, 'DRAFT');
  assert.equal(item.version, version);
  assert.equal(item.history.total, 0);
});
test('评审人失权后不能重放旧成功命令，项目只读状态阻止继续写需求', async () => {
  const id = await create(),
    key = randomUUID();
  await submit(id, { reviewerId: users.product2.id });
  const payload = { version: (await get(id)).version, comment: '确认' };
  await post(sessions.product2, `${route(id)}/approve`, payload, key).expect(201);
  const member = await db.projectMember.findUniqueOrThrow({
    where: { projectId_userId: { projectId: a, userId: users.product2.id } },
  });
  await post(sessions.owner, `/projects/${a}/members/${users.product2.id}/roles`, {
    version: member.version,
    roles: ['VIEWER'],
  }).expect(201);
  await post(sessions.product2, `${route(id)}/approve`, payload, key).expect(403);
  await db.project.update({ where: { id: a }, data: { status: 'ACCEPTING' } });
  try {
    await post(sessions.owner, route(), input()).expect(403);
    assert.equal((await get(id)).allowedActions.length, 0);
  } finally {
    await db.project.update({ where: { id: a }, data: { status: 'PENDING' } });
  }
});
test('统一计划数据层拒绝跨项目需求和错误工作项类型', async () => {
  const work = await db.workItem.create({
    data: { projectId: a, kind: 'TASK', title: '不能冒充需求' },
  });
  await assert.rejects(
    db.requirement.create({
      data: { id: work.id, projectId: a, number: 999, createdById: users.owner.id },
    }),
    /REQUIREMENT/,
  );
  const id = await create();
  await assert.rejects(
    db.workItem.update({ where: { id }, data: { kind: 'TASK' } }),
    /cannot change kind/,
  );
  await assert.rejects(db.requirement.update({ where: { id }, data: { projectId: b } }));
});
test('需求评论和 SeaweedFS 附件复用授权；取消后只读，非成员无法下载', async () => {
  const id = await create(),
    path = `/projects/${a}/collaboration/REQUIREMENT/${id}`;
  await post(sessions.developer, `${path}/comments`, { body: '补充搜索场景' }).expect(201);
  const uploaded = await sessions.developer.agent
    .post(`/api/v1${path}/attachments`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', sessions.developer.csrf)
    .set('Idempotency-Key', randomUUID())
    .query({ filename: 'requirement.txt' })
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from('需求附件内容'))
    .expect(201);
  const comments = await sessions.viewer.agent.get(`/api/v1${path}/comments`).expect(200);
  assert.equal(comments.body.total, 1);
  assert.equal(comments.body.canWrite, false);
  const attachment = uploaded.body.id;
  const downloaded = await sessions.viewer.agent
    .get(`/api/v1/projects/${a}/attachments/${attachment}/download`)
    .expect(200);
  assert.equal(downloaded.text ?? downloaded.body.toString(), '需求附件内容');
  await sessions.outsider.agent
    .get(`/api/v1/projects/${a}/attachments/${attachment}/download`)
    .expect(404);
  await post(sessions.viewer, `${path}/comments`, { body: '越权' }).expect(403);
  await act(id, 'cancel', { comment: '停止需求' });
  await post(sessions.developer, `${path}/comments`, { body: '取消后写入' }).expect(403);
  await sessions.viewer.agent
    .get(`/api/v1/projects/${a}/attachments/${attachment}/download`)
    .expect(200);
});
