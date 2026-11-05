import { before, after, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import request from 'supertest';
import { configureTestEnvironment, migrateTestDatabase } from './helpers.mjs';

configureTestEnvironment();
migrateTestDatabase();
const { createApp } = await import('../dist/app.js');
let app, http, root;
const originalPath = process.env.WEB_DIST_PATH;
before(async () => {
  root = await mkdtemp(join(tmpdir(), 'myteam-web-test-'));
  await mkdir(join(root, 'assets'));
  await writeFile(join(root, 'index.html'), '<!doctype html><title>MyTeam fixture</title>');
  await writeFile(join(root, 'assets', 'main.js'), 'console.log("fixture")');
  process.env.WEB_DIST_PATH = root;
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  http = app.getHttpServer();
});
after(async () => {
  await app?.close();
  if (originalPath === undefined) delete process.env.WEB_DIST_PATH;
  else process.env.WEB_DIST_PATH = originalPath;
  if (root) await rm(root, { recursive: true, force: true });
});
test('提供静态资源和前端路由，保留 API 与不存在资源的 404', async () => {
  const index = await request(http).get('/').expect(200).expect('Content-Type', /html/);
  assert.match(index.text, /MyTeam fixture/);
  const route = await request(http).get('/projects/123').set('Accept', 'text/html').expect(200);
  assert.equal(route.text, index.text);
  await request(http).head('/projects/123').set('Accept', 'text/html').expect(200);
  await request(http)
    .get('/assets/main.js')
    .expect(200)
    .expect('Content-Type', /javascript/);
  await request(http).get('/assets/missing.js').expect(404);
  const api = await request(http).get('/api/v1/missing').set('Accept', 'text/html').expect(404);
  assert.match(api.headers['content-type'], /json/);
  await request(http).get('/api').set('Accept', 'text/html').expect(404);
  await request(http).post('/projects/123').expect(404);
  await request(http).get('/projects/123').set('Accept', 'application/json').expect(404);
});
