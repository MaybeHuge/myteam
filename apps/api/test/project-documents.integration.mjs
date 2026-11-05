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
const db = createDatabase(process.env.DATABASE_URL);
const users = [],
  sessions = [],
  projects = [];
let app;
const post = (s, path, data, key = randomUUID()) =>
  s.agent
    .post(`/api/v1${path}`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', s.csrf)
    .set('Idempotency-Key', key)
    .send(data);
before(async () => {
  const passwordHash = await argon2.hash(testPassword);
  for (const name of ['owner', 'viewer', 'outsider'])
    users.push(
      await db.user.create({
        data: {
          email: `${randomUUID()}@project-docs.test`,
          name,
          passwordHash,
          isSystemAdmin: name === 'owner',
        },
      }),
    );
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  for (const user of users) {
    const agent = request.agent(app.getHttpServer());
    const csrf = (await agent.get('/api/v1/auth/csrf')).body.csrfToken;
    const login = await agent
      .post('/api/v1/auth/login')
      .set('Origin', process.env.APP_ORIGIN)
      .set('X-CSRF-Token', csrf)
      .send({ email: user.email, password: testPassword })
      .expect(201);
    sessions.push({ agent, csrf: login.body.csrfToken });
  }
});
after(async () => {
  await app?.close();
  await clearTestStorage(storage);
  await db.project.deleteMany({ where: { id: { in: projects } } });
  await db.activityLog.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: users.map((u) => u.id) } } });
  await db.user.deleteMany({ where: { id: { in: users.map((u) => u.id) } } });
  await db.$disconnect();
});
test('project list combines requirement and project documents and protects duplicate binding and permissions', async () => {
  const [owner, viewer, outsider] = sessions;
  const tables =
    await db.$queryRaw`SELECT to_regclass('"ProjectDocument"')::text AS document, to_regclass('"ProjectDocumentImage"')::text AS image`;
  assert.deepEqual(tables[0], { document: null, image: null });
  const project = (
    await post(owner, '/projects', {
      key: `D${randomUUID().replaceAll('-', '').slice(0, 8).toUpperCase()}`,
      name: '项目文档测试',
    }).expect(201)
  ).body.id;
  projects.push(project);
  await db.project.update({ where: { id: project }, data: { status: 'ACTIVE' } });
  await post(owner, `/projects/${project}/members`, {
    email: users[1].email,
    roles: ['VIEWER'],
  }).expect(201);
  const requirement = (
    await post(owner, `/projects/${project}/requirements`, {
      title: '独有需求',
      description: '背景',
      acceptanceCriteria: '验收',
      ownerId: users[0].id,
    }).expect(201)
  ).body.id;
  const base = `/projects/${project}/documents`,
    requirementBase = `/projects/${project}/requirements/${requirement}/document`;
  const options = (await owner.agent.get(`/api/v1${base}/requirements`).expect(200)).body.items;
  assert.equal(options.find((x) => x.id === requirement).canCreate, true);
  const race = await Promise.all([
    post(owner, requirementBase, { template: 'blank' }),
    post(owner, requirementBase, { template: 'blank' }),
  ]);
  assert.deepEqual(race.map((r) => r.status).sort(), [201, 409]);
  assert.equal(
    (await owner.agent.get(`/api/v1${base}/requirements`).expect(200)).body.items.find(
      (x) => x.id === requirement,
    ).hasDocument,
    true,
  );
  const id = (await post(owner, base, { title: '部署说明' }).expect(201)).body.id;
  const list = (await owner.agent.get(`/api/v1${base}`).expect(200)).body;
  assert.equal(list.total, 2);
  assert.ok(list.items.some((x) => x.kind === 'requirement' && x.id === requirement));
  assert.ok(list.items.some((x) => x.kind === 'project' && x.id === id));
  assert.equal((await viewer.agent.get(`/api/v1${base}`).expect(200)).body.total, 1);
  assert.equal(
    (await owner.agent.get(`/api/v1${base}?page=99&pageSize=1`).expect(200)).body.total,
    2,
  );
  assert.equal((await owner.agent.get(`/api/v1${base}?q=部署`).expect(200)).body.total, 1);
  await outsider.agent.get(`/api/v1${base}`).expect(404);
  await post(viewer, base, { title: 'no access' }).expect(403);
  await post(viewer, `${base}/${id}/save`, {
    title: 'no',
    version: 1,
    content: { type: 'doc', content: [{ type: 'paragraph' }] },
  }).expect(403);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
    'base64',
  );
  const upload = await owner.agent
    .post(`/api/v1${base}/${id}/images?filename=test.png`)
    .set('Origin', process.env.APP_ORIGIN)
    .set('X-CSRF-Token', owner.csrf)
    .set('Idempotency-Key', randomUUID())
    .set('Content-Type', 'application/octet-stream')
    .send(png)
    .expect(201);
  const imageId = upload.body.id,
    preview = `/api/v1${base}/${id}/images/${imageId}/preview`;
  await viewer.agent.get(preview).expect(404);
  const content = {
    type: 'doc',
    content: [
      { type: 'paragraph', content: [{ type: 'text', text: '发布', marks: [{ type: 'bold' }] }] },
      { type: 'image', attrs: { attachmentId: imageId, alt: 'test', title: null, width: null } },
    ],
  };
  await post(owner, `${base}/${id}/save`, { title: '部署说明', version: 1, content }).expect(201);
  const stored = await db.requirementDocumentDraft.findUniqueOrThrow({ where: { id } });
  assert.equal(stored.requirementId, null);
  assert.equal(stored.plainText, '发布\ntest');
  const storedImage = await db.requirementDocumentImage.findUniqueOrThrow({
    where: { id: imageId },
  });
  assert.equal(storedImage.documentDraftId, id);
  assert.equal(storedImage.requirementId, null);
  await assert.rejects(db.requirementDocumentImage.delete({ where: { id: imageId } }));
  const requirementDraft = await db.requirementDocumentDraft.findUniqueOrThrow({
    where: { requirementId: requirement },
  });
  await assert.rejects(
    db.requirementDocumentImage.create({
      data: {
        projectId: project,
        documentDraftId: requirementDraft.id,
        uploaderId: users[0].id,
        filename: 'forged.png',
        storageKey: `tests/${randomUUID()}.bin`,
        storageBucket: 'project-docs-test',
        contentType: 'image/png',
        size: 1,
        sha256: 'a'.repeat(64),
      },
    }),
  );
  await viewer.agent.get(preview).expect(200);
  await outsider.agent.get(preview).expect(404);
  assert.deepEqual(
    (await viewer.agent.get(`/api/v1${base}/${id}`).expect(200)).body.content,
    content,
  );
  await post(owner, `${base}/${id}/save`, { title: '部署说明', version: 1, content }).expect(409);
  const other = (await post(owner, base, { title: '其他文档' }).expect(201)).body.id;
  await post(owner, `${base}/${other}/save`, { title: '其他文档', version: 1, content }).expect(
    422,
  );
  await db.project.update({ where: { id: project }, data: { status: 'COMPLETED' } });
  await post(owner, base, { title: '关闭后文档' }).expect(403);
});
