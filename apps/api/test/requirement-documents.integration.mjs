import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
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
const db = createDatabase(process.env.DATABASE_URL);
const people = {},
  sessions = {},
  projects = [];
let app, http, project;
const nonce = randomUUID();
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
  'base64',
);
const post = (s, path, body, key = randomUUID()) =>
  s.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .send(body);
const reqPath = (id, p = project) => `/projects/${p}/requirements/${id}`;
const docPath = (id, p = project) => `${reqPath(id, p)}/document`;
const get = async (path, s = sessions.owner) =>
  (await s.agent.get(`/api/v1${path}`).expect(200)).body;
const document = (text, imageId) => ({
  type: 'doc',
  content: [
    { type: 'paragraph', content: [{ type: 'text', text }] },
    ...(imageId
      ? [{ type: 'image', attrs: { attachmentId: imageId, alt: '原始截图', width: 600 } }]
      : []),
  ],
});
async function newProject() {
  const id = (
    await post(sessions.owner, '/projects', {
      key: `D${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      name: '文档隔离项目',
    }).expect(201)
  ).body.id;
  projects.push(id);
  await db.project.update({ where: { id }, data: { status: 'ACTIVE' } });
  return id;
}
async function requirement(p = project) {
  return (
    await post(sessions.owner, `/projects/${p}/requirements`, {
      title: `文档需求 ${randomUUID()}`,
      description: '用户填写的背景',
      acceptanceCriteria: '保留原始图文',
      ownerId: people.owner.id,
    }).expect(201)
  ).body.id;
}
async function create(id, template = 'blank') {
  return post(sessions.product, docPath(id), { template }).expect(201);
}
async function save(id, content, key = randomUUID()) {
  const d = await get(docPath(id));
  return post(
    sessions.product,
    `${docPath(id)}/save`,
    { version: d.draft.version, content },
    key,
  ).expect(201);
}
async function apply(id, extra = {}, key = randomUUID()) {
  const d = await get(docPath(id));
  return post(
    sessions.owner,
    `${docPath(id)}/apply`,
    { version: d.draft.version, requirementVersion: d.requirement.version, ...extra },
    key,
  ).expect(201);
}
function image(id, s = sessions.product, key = randomUUID()) {
  return s.agent
    .post(`/api/v1${docPath(id)}/images?filename=example.png`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .set('Content-Type', 'application/octet-stream')
    .send(png);
}
async function confirm(id) {
  let r = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/submit`, {
    version: r.version,
    reviewerId: people.owner.id,
  }).expect(201);
  r = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/approve`, { version: r.version }).expect(201);
}
before(async () => {
  const passwordHash = await argon2.hash(testPassword);
  for (const role of ['owner', 'product', 'developer', 'tester', 'viewer', 'outsider'])
    people[role] = await db.user.create({
      data: {
        name: role,
        email: `${role}-${nonce}@documents.test`,
        passwordHash,
        isSystemAdmin: role === 'owner',
      },
    });
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
  for (const [role, user] of Object.entries(people)) {
    const agent = request.agent(http),
      csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', process.env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: user.email, password: testPassword })
      .expect(201);
    sessions[role] = { agent, csrf: login.body.csrfToken };
  }
  project = await newProject();
  for (const role of ['product', 'developer', 'tester', 'viewer'])
    await post(sessions.owner, `/projects/${project}/members`, {
      email: people[role].email,
      roles: [role.toUpperCase()],
    }).expect(201);
});
after(async () => {
  await app?.close();
  await clearTestStorage(storage);
  if (process.env.KEEP_TEST_DATA !== 'true') {
    await db.project.deleteMany({ where: { id: { in: projects } } });
    await db.activityLog.deleteMany({ where: { projectId: { in: projects } } });
    await db.idempotencyRecord.deleteMany({
      where: { actorId: { in: Object.values(people).map((p) => p.id) } },
    });
    await db.user.deleteMany({ where: { id: { in: Object.values(people).map((p) => p.id) } } });
  }
  await db.$disconnect();
});
test('字号和文字颜色可保存、应用及在历史版本中完整读取', async () => {
  const id = await requirement();
  await create(id);
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          {
            type: 'text',
            text: '样式正文',
            marks: [{ type: 'textStyle', attrs: { fontSize: '24px', color: '#dc2626' } }],
          },
        ],
      },
    ],
  };
  await save(id, content);
  await apply(id);
  const current = (await get(docPath(id))).current;
  await confirm(id);
  assert.deepEqual(
    (await get(`${docPath(id)}?versionId=${current.id}`, sessions.viewer)).current.content,
    content,
  );
});
test('已上传图片可找回并重新引用，图片库仅对当前需求的编写者开放', async () => {
  const id = await requirement(),
    other = await requirement();
  await create(id);
  await create(other);
  const asset = (await image(id).expect(201)).body;
  const library = await get(`${docPath(id)}/images`);
  assert.equal(library.total, 1);
  assert.equal(library.items[0].id, asset.id);
  assert.deepEqual(Object.keys(library.items[0]).sort(), ['createdAt', 'filename', 'id', 'size']);
  assert.equal((await get(`${docPath(other)}/images`)).total, 0);
  for (const role of ['viewer', 'tester', 'developer'])
    await sessions[role].agent.get(`/api/v1${docPath(id)}/images`).expect(403);
  await sessions.outsider.agent.get(`/api/v1${docPath(id)}/images`).expect(404);
  await save(id, document('找回的图片', asset.id));
  await apply(id);
  const requirementRow = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/submit`, {
    version: requirementRow.version,
    reviewerId: people.owner.id,
  }).expect(201);
  await sessions.product.agent.get(`/api/v1${docPath(id)}/images`).expect(403);
});
test('编辑器链接标题和带格式换行可保存、应用、送审并保留原文', async () => {
  const id = await requirement();
  await create(id);
  const link = {
    type: 'link',
    attrs: {
      href: 'https://example.test/requirement',
      target: '_blank',
      rel: 'noopener noreferrer nofollow',
      class: null,
      title: '需求说明',
    },
  };
  const content = {
    type: 'doc',
    content: [
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '需求链接', marks: [link] },
          { type: 'hardBreak', marks: [{ type: 'bold' }, link] },
          { type: 'text', text: '换行后的说明', marks: [{ type: 'bold' }] },
        ],
      },
    ],
  };
  await save(id, content);
  assert.deepEqual((await get(docPath(id))).draft.content, content);
  await apply(id);
  await confirm(id);
  assert.deepEqual((await get(docPath(id), sessions.viewer)).current.content, content);
});
test('文档读取、创建和图片上传按项目及需求编写权限授权', async () => {
  const id = await requirement();
  await request(http)
    .get(`/api/v1${docPath(id)}`)
    .expect(401);
  await sessions.outsider.agent.get(`/api/v1${docPath(id)}`).expect(404);
  assert.equal((await get(docPath(id), sessions.viewer)).canEdit, false);
  for (const role of ['viewer', 'developer', 'tester']) {
    await post(sessions[role], docPath(id), {}).expect(403);
    await image(id, sessions[role]).expect(403);
  }
  await create(id, 'requirement');
  const dto = await get(docPath(id));
  assert.match(JSON.stringify(dto.draft.content), /用户填写的背景/);
  assert.equal((await get(docPath(id), sessions.viewer)).draft, null);
});
test('自动保存不改变需求修订、状态与测试轮次；并发和幂等不会覆盖草稿', async () => {
  const id = await requirement();
  await create(id);
  const before = await db.requirement.findUniqueOrThrow({ where: { id } }),
    draft = (await get(docPath(id))).draft;
  const key = randomUUID(),
    input = { version: draft.version, content: document('第一次自动保存') };
  const a = await post(sessions.product, `${docPath(id)}/save`, input, key).expect(201);
  const b = await post(sessions.product, `${docPath(id)}/save`, input, key).expect(201);
  assert.deepEqual(a.body, b.body);
  const after = await db.requirement.findUniqueOrThrow({ where: { id } });
  for (const field of ['revision', 'version', 'testCycle', 'scopeVersion', 'status'])
    assert.equal(after[field], before[field]);
  const input2 = { version: a.body.version, content: document('并发编辑') };
  const results = await Promise.all([
    post(sessions.product, `${docPath(id)}/save`, input2),
    post(sessions.owner, `${docPath(id)}/save`, { ...input2, content: document('其他成员编辑') }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});
test('图片真实上传、授权展示、重试幂等，拒绝跨需求图片和远端或脚本节点', async () => {
  const id = await requirement(),
    other = await requirement();
  await create(id);
  await create(other);
  const key = randomUUID(),
    uploaded = await image(id, sessions.product, key).expect(201),
    repeated = await image(id, sessions.product, key).expect(201);
  assert.equal(uploaded.body.id, repeated.body.id);
  const preview = `${docPath(id)}/images/${uploaded.body.id}/preview`;
  const response = await sessions.product.agent.get(`/api/v1${preview}`).expect(200);
  assert.match(response.headers['content-type'], /image\/png/);
  await sessions.viewer.agent.get(`/api/v1${preview}`).expect(404);
  await sessions.outsider.agent.get(`/api/v1${preview}`).expect(404);
  await sessions.owner.agent
    .get(`/api/v1${docPath(other)}/images/${uploaded.body.id}/preview`)
    .expect(404);
  const d = await get(docPath(other));
  await post(sessions.product, `${docPath(other)}/save`, {
    version: d.draft.version,
    content: document('错误引用', uploaded.body.id),
  }).expect(422);
  await post(sessions.product, `${docPath(other)}/save`, {
    version: d.draft.version,
    content: {
      type: 'doc',
      content: [
        {
          type: 'image',
          attrs: { attachmentId: uploaded.body.id, src: 'https://example.test/x.png' },
        },
      ],
    },
  }).expect(400);
  await post(sessions.product, `${docPath(other)}/save`, {
    version: d.draft.version,
    content: {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    },
  }).expect(400);
  await save(id, document('带图片的正文', uploaded.body.id));
  await apply(id);
  await sessions.viewer.agent.get(`/api/v1${preview}`).expect(200);
});
test('应用文档生成固定版本且命令可重放；评审冻结文档引用并阻止修改', async () => {
  const id = await requirement();
  await create(id);
  await save(id, document('正式文档 V1'));
  const d = await get(docPath(id)),
    key = randomUUID(),
    input = { version: d.draft.version, requirementVersion: d.requirement.version };
  const a = await post(sessions.owner, `${docPath(id)}/apply`, input, key).expect(201);
  const b = await post(sessions.owner, `${docPath(id)}/apply`, input, key).expect(201);
  assert.deepEqual(a.body, b.body);
  assert.equal((await get(`${docPath(id)}/versions`)).total, 1);
  const applied = await get(docPath(id));
  assert.equal(applied.current.number, 1);
  assert.equal(applied.hasPendingChanges, false);
  await confirm(id);
  const r = await get(reqPath(id));
  assert.equal(r.baseline.document.id, applied.current.id);
  const submitted = r.history.items.find((h) => h.action === 'SUBMITTED');
  assert.equal(submitted.snapshot.document.id, applied.current.id);
  // Enter another review and prove that neither document saves nor image upload can mutate it.
  await post(sessions.owner, `${reqPath(id)}/revise`, {
    title: r.title,
    description: r.description + '变化',
    acceptanceCriteria: r.acceptanceCriteria,
    type: r.type,
    priority: r.priority,
    ownerId: r.ownerId,
    iterationId: null,
    version: r.version,
    reason: '业务变化',
    impact: '重新评审',
  }).expect(201);
  let latest = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/submit`, {
    version: latest.version,
    reviewerId: people.owner.id,
  }).expect(201);
  await post(sessions.product, `${docPath(id)}/save`, {
    version: applied.draft.version,
    content: document('不得修改'),
  }).expect(403);
  await image(id).expect(403);
});
test('已完成需求的文档修订沿用任务、用例和测试依据失效流程，历史图文不变', async () => {
  const id = await requirement();
  await create(id);
  const asset = (await image(id).expect(201)).body.id;
  await save(id, document('已评审正文', asset));
  await apply(id);
  await confirm(id);
  const old = await get(docPath(id));
  const task = (
    await post(sessions.owner, `/projects/${project}/tasks`, {
      title: '文档开发任务',
      requirementId: id,
      assigneeId: people.owner.id,
    }).expect(201)
  ).body.id;
  for (const action of ['start', 'complete']) {
    const r = await get(`/projects/${project}/tasks/${task}`);
    await post(sessions.owner, `/projects/${project}/tasks/${task}/${action}`, {
      version: r.version,
      reason: '开发完成',
    }).expect(201);
  }
  const testCase = (
    await post(sessions.tester, `/projects/${project}/test-cases`, {
      title: '文档测试',
      requirementIds: [id],
      ownerId: people.tester.id,
      steps: [{ action: '查看图文', expected: '保持一致' }],
    }).expect(201)
  ).body.id;
  await post(sessions.tester, `/projects/${project}/test-cases/${testCase}/submit`, {
    version: 1,
    reviewerId: people.tester.id,
  }).expect(201);
  await post(sessions.tester, `/projects/${project}/test-cases/${testCase}/approve`, {
    version: 2,
  }).expect(201);
  const record = (
    await post(sessions.tester, `/projects/${project}/quality/records`, {
      testCaseId: testCase,
      requirementId: id,
      environment: 'qa',
    }).expect(201)
  ).body.id;
  await post(sessions.tester, `/projects/${project}/quality/records/${record}/finish`, {
    version: 1,
    outcome: 'PASSED',
    actual: '符合文档',
  }).expect(201);
  assert.equal((await get(reqPath(id))).status, 'COMPLETED');
  await save(id, document('新的文档内容'));
  assert.equal((await get(reqPath(id))).status, 'COMPLETED');
  await apply(id, { reason: '调整文档业务规则', impact: '开发重新核对、用例重新评审' });
  const changed = await get(reqPath(id));
  assert.equal(changed.status, 'DRAFT');
  assert.equal(changed.changes.items[0].before.document.id, old.current.id);
  assert.notEqual(changed.changes.items[0].after.document.id, old.current.id);
  assert.equal((await get(`/projects/${project}/tasks/${task}`)).status, 'IN_PROGRESS');
  assert.equal((await get(`/projects/${project}/test-cases/${testCase}`)).needsReview, true);
  assert.equal((await get(`/projects/${project}/quality/records/${record}`)).current, false);
  assert.deepEqual((await get(`${docPath(id)}?versionId=${old.current.id}`)).current, old.current);
  await sessions.viewer.agent.get(`/api/v1${docPath(id)}/images/${asset}/preview`).expect(200);
});
test('未应用正文阻止送审；空白可忽略；需求基线变化后拒绝旧草稿并支持显式重置', async () => {
  const id = await requirement();
  await create(id);
  await save(id, document('尚未应用'));
  let r = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/submit`, {
    version: r.version,
    reviewerId: people.owner.id,
  }).expect(422);
  const stale = await get(docPath(id));
  await post(sessions.owner, `${reqPath(id)}/update`, {
    title: r.title,
    description: r.description,
    acceptanceCriteria: r.acceptanceCriteria + '变更',
    ownerId: r.ownerId,
    version: r.version,
  }).expect(201);
  await post(sessions.product, `${docPath(id)}/save`, {
    version: stale.draft.version,
    content: document('旧基线编辑'),
  }).expect(409);
  await post(sessions.product, `${docPath(id)}/reset`, { version: stale.draft.version }).expect(
    201,
  );
  assert.equal((await get(docPath(id))).hasPendingChanges, false);
  r = await get(reqPath(id));
  await post(sessions.owner, `${reqPath(id)}/submit`, {
    version: r.version,
    reviewerId: people.owner.id,
  }).expect(201);
});
test('事务事件失败回滚应用的正文、图片引用、草稿代次和需求版本', async () => {
  const id = await requirement();
  await create(id);
  await save(id, document('待应用'));
  const before = await get(docPath(id)),
    events = app.get(CollaborationEvents),
    original = events.record;
  events.record = async function (tx, e) {
    if (e.action === 'requirement.updated') throw new Error('document rollback test');
    return original.call(this, tx, e);
  };
  try {
    await post(sessions.owner, `${docPath(id)}/apply`, {
      version: before.draft.version,
      requirementVersion: before.requirement.version,
    }).expect(500);
  } finally {
    events.record = original;
  }
  assert.deepEqual(await get(docPath(id)), before);
  assert.equal((await get(`${docPath(id)}/versions`)).total, 0);
});
test('固定版本、历史图片受数据库保护；项目级联删除可在事务内完整执行', async () => {
  const id = await requirement();
  await create(id);
  const asset = (await image(id).expect(201)).body.id;
  await save(id, document('历史不覆盖', asset));
  await apply(id);
  const d = await get(docPath(id));
  await assert.rejects(
    db.requirementDocumentVersion.update({
      where: { id: d.current.id },
      data: { plainText: '覆盖' },
    }),
  );
  await assert.rejects(db.requirementDocumentVersion.delete({ where: { id: d.current.id } }));
  await assert.rejects(
    db.requirementDocumentImage.update({
      where: { id: asset },
      data: { storageKey: `tests/${randomUUID()}.bin` },
    }),
  );
  await assert.rejects(db.requirementDocumentImage.delete({ where: { id: asset } }));
  const rollback = new Error('keep cascade fixture');
  await assert.rejects(
    db.$transaction(async (tx) => {
      await tx.project.delete({ where: { id: project } });
      assert.equal(await tx.requirementDocumentVersion.count({ where: { requirementId: id } }), 0);
      throw rollback;
    }),
    (e) => e === rollback,
  );
  assert.ok(await db.requirementDocumentVersion.findUnique({ where: { id: d.current.id } }));
});
test('清理仅释放超过保留期且没有草稿或历史引用的文档图片', async () => {
  const id = await requirement();
  await create(id);
  const oldImage = async () =>
    db.requirementDocumentImage.create({
      data: {
        projectId: project,
        requirementId: id,
        uploaderId: people.product.id,
        ...(await storage.put('old.png', png)),
        createdAt: new Date(Date.now() - 48 * 3600000),
      },
    });
  const historical = await oldImage(),
    current = await oldImage(),
    orphan = await oldImage();
  await save(id, document('历史引用', historical.id));
  await apply(id);
  await save(id, document('草稿引用', current.id));
  const result = spawnSync(process.execPath, ['apps/api/dist/cli/prune-storage.js'], {
    cwd: process.cwd(),
    env: process.env,
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(await db.requirementDocumentImage.findUnique({ where: { id: orphan.id } }), null);
  assert.ok(await db.requirementDocumentImage.findUnique({ where: { id: historical.id } }));
  assert.ok(await db.requirementDocumentImage.findUnique({ where: { id: current.id } }));
});
