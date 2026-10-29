import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
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
const { readConfig } = await import('../dist/config.js');
const { createDatabase } = await import('../dist/infrastructure/database.js');
const db = createDatabase(process.env.DATABASE_URL);
const suffix = `${randomUUID()}@myteam-integration.test`;
const email = (name) => `${name}-${suffix}`;
const origin = process.env.APP_ORIGIN;
let app, http, admin, member;

before(async () => {
  const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
  admin = await db.user.create({
    data: { email: email('admin'), name: '测试管理员', passwordHash, isSystemAdmin: true },
  });
  member = await db.user.create({
    data: { email: email('member'), name: '测试成员', passwordHash },
  });
  app = await createApp();
  http = app.getHttpServer();
});
after(async () => {
  if (process.env.KEEP_TEST_DATA === 'true') {
    await app?.close();
    testStorage.onModuleDestroy();
    await db.$disconnect();
    return;
  }
  await app?.close();
  const users = await db.user.findMany({
    where: { email: { endsWith: suffix } },
    select: { id: true },
  });
  const ids = users.map((user) => user.id);
  await db.activityLog.deleteMany({ where: { targetId: { in: ids } } });
  await db.idempotencyRecord.deleteMany({ where: { actorId: { in: ids } } });
  await db.loginAttempt.deleteMany({ where: { email: { endsWith: suffix } } });
  await db.user.deleteMany({ where: { id: { in: ids } } });
  await db.$disconnect();
});
async function signIn(user = member, password = testPassword, agent = request.agent(http)) {
  const csrf = await agent.get('/api/v1/auth/csrf').expect(200);
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: user.email, password });
  return { agent, result, csrfToken: result.body.csrfToken };
}
const status = (agent, csrf, id, body, key = randomUUID()) =>
  agent
    .post(`/api/v1/users/${id}/status`)
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf)
    .set('Idempotency-Key', key)
    .send(body);

test('六位密码可创建和修改，修改密码验证原密码并撤销其他会话', async () => {
  const administrator = await signIn(admin);
  const userEmail = email('password-change');
  const create = (password) =>
    administrator.agent
      .post('/api/v1/users')
      .set('Origin', origin)
      .set('X-CSRF-Token', administrator.csrfToken)
      .set('Idempotency-Key', randomUUID())
      .send({ name: '密码测试成员', email: userEmail, password });
  await create('12345').expect(400);
  const created = await create('123456').expect(201);
  const user = await db.user.findUniqueOrThrow({ where: { id: created.body.id } });
  const first = await signIn(user, '123456');
  const second = await signIn(user, '123456');
  assert.equal(first.result.status, 201);
  assert.equal(second.result.status, 201);
  const change = (body, csrf = first.csrfToken) =>
    first.agent
      .post('/api/v1/auth/password')
      .set('Origin', origin)
      .set('X-CSRF-Token', csrf)
      .send(body);
  await change({ currentPassword: '123456', newPassword: '654321' }, 'bad').expect(403);
  await change({ currentPassword: '123456', newPassword: '12345' }).expect(400);
  await change({ currentPassword: 'incorrect', newPassword: '654321' }).expect(422);
  await first.agent.get('/api/v1/auth/me').expect(200);
  await second.agent.get('/api/v1/auth/me').expect(200);
  await change({ currentPassword: '123456', newPassword: '654321' }).expect(201);
  await first.agent.get('/api/v1/auth/me').expect(200);
  await second.agent.get('/api/v1/auth/me').expect(401);
  assert.equal((await signIn(user, '123456')).result.status, 401);
  assert.equal((await signIn(user, '654321')).result.status, 201);
  const activity = await db.activityLog.findFirstOrThrow({
    where: { targetId: user.id, action: 'identity.password.changed' },
  });
  assert.equal(JSON.stringify(activity).includes('654321'), false);
  await db.loginAttempt.deleteMany({ where: { email: userEmail } });
  for (let i = 0; i < 5; i++)
    await change({ currentPassword: 'incorrect', newPassword: '654321' }).expect(422);
  await change({ currentPassword: '654321', newPassword: 'another' }).expect(429);
  await db.loginAttempt.deleteMany({ where: { email: userEmail } });
});
test('健康检查区分存活与数据库就绪', async () => {
  await request(http).get('/api/v1/health/live').expect(200);
  const ready = await request(http).get('/api/v1/health/ready').expect(200);
  assert.equal(ready.body.database, 'up');
});
test('未登录统一返回 401 和请求编号，不泄露内部错误', async () => {
  const result = await request(http).get('/api/v1/auth/me').expect(401);
  assert.equal(result.body.code, 'UNAUTHENTICATED');
  assert.equal(result.body.requestId, result.headers['x-request-id']);
  assert.equal('stack' in result.body, false);
});
test('OpenAPI 使用共享 schema，不包含密码哈希字段', async () => {
  const result = await request(http).get('/api/v1/openapi.json').expect(200);
  assert.equal(result.body.components.schemas.Login.type, 'object');
  assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);
});
test('登录拒绝无 CSRF 或不匹配来源', async () => {
  await request(http)
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .send({ email: member.email, password: testPassword })
    .expect(403);
  const agent = request.agent(http);
  const csrf = await agent.get('/api/v1/auth/csrf');
  await agent
    .post('/api/v1/auth/login')
    .set('Origin', 'https://untrusted.example')
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email: member.email, password: testPassword })
    .expect(403);
});
async function withEnvironment(values, run) {
  const previous = Object.fromEntries(Object.keys(values).map((key) => [key, process.env[key]]));
  Object.assign(process.env, values);
  try {
    return await run();
  } finally {
    for (const [key, value] of Object.entries(previous))
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
  }
}
test('通配来源允许不同域名/IP/端口登录及写入，仍拒绝无效 Origin 和错误 CSRF', async () => {
  const wildcard = await withEnvironment({ APP_ORIGIN: '*' }, createApp);
  try {
    const server = wildcard.getHttpServer();
    for (const pageOrigin of [
      'http://localhost:5173',
      'http://127.0.0.1:18333',
      'https://team.example.test',
    ]) {
      const agent = request.agent(server);
      const csrf = (await agent.get('/api/v1/auth/csrf').expect(200)).body.csrfToken;
      for (const invalidOrigin of [
        undefined,
        'null',
        '*',
        'file://host',
        'ftp://host',
        'https://team.example.test/path',
      ]) {
        const invalid = agent.post('/api/v1/auth/login').set('X-CSRF-Token', csrf);
        if (invalidOrigin !== undefined) invalid.set('Origin', invalidOrigin);
        await invalid.send({ email: member.email, password: testPassword }).expect(403);
      }
      await agent
        .post('/api/v1/auth/login')
        .set('Origin', pageOrigin)
        .set('X-CSRF-Token', 'invalid')
        .send({ email: member.email, password: testPassword })
        .expect(403);
      const signed = await agent
        .post('/api/v1/auth/login')
        .set('Origin', pageOrigin)
        .set('X-CSRF-Token', csrf)
        .send({ email: member.email, password: testPassword })
        .expect(201);
      await agent.get('/api/v1/auth/me').expect(200);
      await agent
        .post('/api/v1/auth/logout')
        .set('Origin', pageOrigin)
        .set('X-CSRF-Token', 'invalid')
        .expect(403);
      await agent.get('/api/v1/auth/me').expect(200);
      await agent
        .post('/api/v1/auth/logout')
        .set('Origin', 'https://another.example.test')
        .set('X-CSRF-Token', signed.body.csrfToken)
        .expect(201);
      await agent.get('/api/v1/auth/me').expect(401);
    }
  } finally {
    await wildcard.close();
  }
});
test('生产通配模式仍要求 Secure Cookie 和 HTTPS 请求来源', async () => {
  await withEnvironment(
    { APP_ORIGIN: '*', NODE_ENV: 'production', COOKIE_SECURE: 'false' },
    async () => {
      assert.throws(readConfig, /HTTPS 和 Secure Cookie/);
    },
  );
  const secure = await withEnvironment(
    { APP_ORIGIN: '*', NODE_ENV: 'production', COOKIE_SECURE: 'true' },
    createApp,
  );
  try {
    const server = secure.getHttpServer();
    const csrf = await request(server).get('/api/v1/auth/csrf').expect(200);
    const cookies = csrf.headers['set-cookie'].map((value) => value.split(';')[0]).join('; ');
    for (const pageOrigin of ['http://team.example.test', 'https://team.example.test']) {
      const result = await request(server)
        .post('/api/v1/auth/login')
        .set('Origin', pageOrigin)
        .set('Cookie', cookies)
        .set('X-CSRF-Token', csrf.body.csrfToken)
        .send({ email: member.email, password: testPassword })
        .expect(pageOrigin.startsWith('https:') ? 201 : 403);
      if (result.status === 201)
        assert.ok(result.headers['set-cookie'].every((value) => value.includes('; Secure')));
    }
  } finally {
    await secure.close();
  }
});
test('无效输入返回字段问题，但不回显密码', async () => {
  const { result } = await signIn({ email: 'not-an-email' });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'VALIDATION_ERROR');
  assert.equal(JSON.stringify(result.body).includes(testPassword), false);
});
test('未知账号与错误密码返回相同信息', async () => {
  const wrong = await signIn(member, 'incorrect-password');
  const missing = await signIn({ email: email('missing') });
  assert.equal(wrong.result.status, 401);
  assert.equal(missing.result.status, 401);
  assert.equal(wrong.result.body.message, missing.result.body.message);
});
test('登录持久化摘要会话，Cookie HttpOnly，响应只返回公开字段', async () => {
  const { agent, result } = await signIn();
  assert.equal(result.status, 201);
  assert.deepEqual(Object.keys(result.body.user).sort(), ['email', 'id', 'isSystemAdmin', 'name']);
  const cookie = result.headers['set-cookie'].find((value) =>
    value.startsWith('myteam_test_session='),
  );
  assert.match(cookie, /HttpOnly/);
  assert.match(cookie, /SameSite=Lax/);
  const token = cookie.split(';')[0].split('=')[1];
  const stored = await db.session.findUnique({
    where: { tokenHash: createHash('sha256').update(token).digest('hex') },
  });
  assert.equal(stored.userId, member.id);
  assert.notEqual(stored.tokenHash, token);
  const me = await agent.get('/api/v1/auth/me').expect(200);
  assert.equal(me.body.user.id, member.id);
});
test('重新登录轮换旧会话，旧 Cookie 不再可用', async () => {
  const first = await signIn();
  const oldCookie = first.result.headers['set-cookie']
    .map((value) => value.split(';')[0])
    .join('; ');
  const second = await signIn(member, testPassword, first.agent);
  assert.equal(second.result.status, 201);
  await request(http).get('/api/v1/auth/me').set('Cookie', oldCookie).expect(401);
});
test('退出需要正确 CSRF，退出后原会话立即失效', async () => {
  const { agent, csrfToken } = await signIn();
  await agent
    .post('/api/v1/auth/logout')
    .set('Origin', origin)
    .set('X-CSRF-Token', 'invalid')
    .expect(403);
  await agent.get('/api/v1/auth/me').expect(200);
  await agent
    .post('/api/v1/auth/logout')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrfToken)
    .expect(201);
  await agent.get('/api/v1/auth/me').expect(401);
});
test('超过有效期的会话拒绝访问', async () => {
  const user = await signIn();
  await db.session.updateMany({
    where: { userId: member.id },
    data: { expiresAt: new Date(Date.now() - 1000) },
  });
  await user.agent.get('/api/v1/auth/me').expect(401);
});
test('普通成员不能读取用户管理或停用他人，管理员不能停用自己', async () => {
  const ordinary = await signIn();
  await ordinary.agent.get('/api/v1/users').expect(403);
  await status(ordinary.agent, ordinary.csrfToken, admin.id, { active: false, version: 1 }).expect(
    403,
  );
  const owner = await signIn(admin);
  await status(owner.agent, owner.csrfToken, admin.id, { active: false, version: 1 }).expect(422);
});
test('账号列表分页且限制大小，不返回密码或会话字段', async () => {
  const owner = await signIn(admin);
  const result = await owner.agent.get('/api/v1/users?page=1&pageSize=1').expect(200);
  assert.equal(result.body.items.length, 1);
  assert.ok(result.body.total >= 2);
  assert.equal(JSON.stringify(result.body).includes('passwordHash'), false);
  await owner.agent.get('/api/v1/users?pageSize=101').expect(400);
});
test('停用账号撤销全部会话，停用后无法登录，启用后恢复', async () => {
  const owner = await signIn(admin);
  const ordinary = await signIn();
  await status(owner.agent, owner.csrfToken, member.id, { active: false, version: 1 }).expect(201);
  await ordinary.agent.get('/api/v1/auth/me').expect(401);
  const disabled = await signIn();
  assert.equal(disabled.result.status, 401);
  await status(owner.agent, owner.csrfToken, member.id, { active: true, version: 2 }).expect(201);
  const enabled = await signIn();
  assert.equal(enabled.result.status, 201);
});
test('同一版本并发修改只成功一次，其他返回 409', async () => {
  const owner = await signIn(admin);
  const user = await db.user.findUniqueOrThrow({ where: { id: member.id } });
  const results = await Promise.all([
    status(owner.agent, owner.csrfToken, member.id, { active: true, version: user.version }),
    status(owner.agent, owner.csrfToken, member.id, { active: true, version: user.version }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [201, 409]);
});
test('幂等请求并发重试只写一次，相同键不同内容被拒绝', async () => {
  const owner = await signIn(admin);
  const user = await db.user.findUniqueOrThrow({ where: { id: member.id } });
  const key = randomUUID();
  const body = { active: true, version: user.version };
  const results = await Promise.all([
    status(owner.agent, owner.csrfToken, member.id, body, key),
    status(owner.agent, owner.csrfToken, member.id, body, key),
  ]);
  assert.deepEqual(
    results.map((r) => r.status),
    [201, 201],
  );
  const changed = await db.user.findUniqueOrThrow({ where: { id: member.id } });
  assert.equal(changed.version, user.version + 1);
  await status(owner.agent, owner.csrfToken, member.id, { ...body, active: false }, key).expect(
    409,
  );
});
test('审计写入失败时，登录会话随事务回滚', async () => {
  const before = await db.session.count({ where: { userId: member.id } });
  await db.$executeRawUnsafe(
    'ALTER TABLE "ActivityLog" ADD CONSTRAINT integration_reject_login CHECK (action <> \'identity.login\') NOT VALID',
  );
  try {
    const result = await signIn();
    assert.equal(result.result.status, 500);
    assert.equal(await db.session.count({ where: { userId: member.id } }), before);
  } finally {
    await db.$executeRawUnsafe(
      'ALTER TABLE "ActivityLog" DROP CONSTRAINT integration_reject_login',
    );
  }
});
test('连续错误登录达到阈值后返回 429', async () => {
  const unknown = { email: email('rate-limit') };
  for (let i = 0; i < 5; i++) {
    const result = await signIn(unknown);
    assert.equal(result.result.status, 401);
  }
  const result = await signIn(unknown);
  assert.equal(result.result.status, 429);
  assert.equal(result.result.headers['retry-after'], '900');
});
test('SeaweedFS 保存与流式读取真实对象，拒绝伪造格式和路径穿越', async () => {
  const content = Buffer.from('测试日志\n');
  const file = await testStorage.put('test.txt', content);
  assert.deepEqual(await testStorage.get(file.storageKey), content);
  await assert.rejects(testStorage.put('fake.png', content));
  await assert.rejects(testStorage.put('page.svg', Buffer.from('<svg/>')));
  await assert.rejects(testStorage.get('../../etc/passwd'));
  await assert.rejects(testStorage.put('large.txt', Buffer.alloc(20 * 1024 * 1024 + 1)));
});
after(async () => {
  await clearTestStorage(testStorage);
});
