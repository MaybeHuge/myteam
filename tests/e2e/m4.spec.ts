import { test, expect, type Page, type Locator } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
async function login(page: Page, email: string, url = '/') {
  const csrf = await (await page.request.get('/api/v1/auth/csrf')).json();
  const response = await page.request.post('/api/v1/auth/login', {
    headers: { Origin: 'http://localhost:5174', 'X-CSRF-Token': csrf.csrfToken },
    data: { email, password },
  });
  expect(response.status(), await response.text()).toBe(201);
  await page.goto(url);
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
}
async function post(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function pick(page: Page, field: Locator, label: string) {
  await field.click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: label })
    .first()
    .click();
}
async function act(page: Page, title: string) {
  await page.getByRole('button', { name: title, exact: true }).click();
  const modal = page.getByRole('dialog', { name: title, exact: true });
  await modal.getByLabel('处理说明', { exact: true }).fill('已核对本次测试和修复');
  await modal.getByRole('button', { name: title, exact: true }).click();
  await expect(modal).toHaveCount(0);
}

test('轻量测试闭环：开发完成任务、用例发起记录、截图、失败自动建缺陷、修复复测通过、需求完成', async ({
  page,
  browser,
}) => {
  test.setTimeout(180000);
  page.setDefaultTimeout(12000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => {
      if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:'))
        errors.push(m.text());
    });
  };
  watch(page);
  await login(page, 'browser-admin@example.test');
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const project = await post(page, '/projects', {
    key: `E2EL${stamp.slice(-6)}`.toUpperCase(),
    name: `轻量测试 ${stamp}`,
  });
  const p = project.id;
  await post(page, `/projects/${p}/status`, { version: 1, status: 'ACTIVE' });
  for (const [email, role] of [
    ['browser-collaborator@example.test', 'DEVELOPER'],
    ['browser-tester@example.test', 'TESTER'],
    ['browser-member@example.test', 'VIEWER'],
  ])
    await post(page, `/projects/${p}/members`, { email, roles: [role] });
  const people = await (
    await page.request.get(`/api/v1/projects/${p}/quality/people?purpose=assignee`)
  ).json();
  const developer = people.items.find((u: { label: string }) => u.label === '陈青').id;
  const testers = await (
    await page.request.get(`/api/v1/projects/${p}/quality/people?purpose=retester`)
  ).json();
  const tester = testers.items.find((u: { label: string }) => u.label === '周宁').id;
  const req = await post(page, `/projects/${p}/requirements`, {
    title: `验证码需求 ${stamp}`,
    description: '验证码不能重复使用',
    acceptanceCriteria: '重复验证码应拒绝',
    ownerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/approve`, { version: 2 });
  const task = await post(page, `/projects/${p}/tasks`, {
    title: '实现验证码校验',
    requirementId: req.id,
    assigneeId: developer,
  });
  const testCase = await post(page, `/projects/${p}/test-cases`, {
    title: `验证码不可复用 ${stamp}`,
    ownerId: tester,
    requirementIds: [req.id],
    preconditions: '已成功使用验证码',
    steps: [{ action: '再次提交该验证码', expected: '拒绝登录' }],
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/submit`, {
    version: 1,
    reviewerId: tester,
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/approve`, {
    version: 2,
    comment: '已核对场景',
  });
  const devContext = await browser.newContext(),
    dev = await devContext.newPage();
  watch(dev);
  await login(dev, 'browser-collaborator@example.test', `/projects/${p}?tab=tasks&task=${task.id}`);
  await dev.getByRole('button', { name: '开始任务', exact: true }).click();
  await dev
    .getByRole('dialog', { name: '开始任务', exact: true })
    .getByRole('button', { name: '开始任务', exact: true })
    .click();
  await dev.getByRole('button', { name: '完成任务', exact: true }).click();
  const complete = dev.getByRole('dialog', { name: '完成任务', exact: true });
  await complete.getByLabel('完成说明', { exact: true }).fill('开发自测完成');
  await complete.getByRole('button', { name: '完成任务', exact: true }).click();
  await expect(complete).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/v1/projects/${p}/requirements/${req.id}`)).json()).status,
  ).toBe('ACCEPTING');
  const qaContext = await browser.newContext(),
    qa = await qaContext.newPage();
  watch(qa);
  await login(
    qa,
    'browser-tester@example.test',
    `/projects/${p}?tab=test-cases&case=${testCase.id}`,
  );
  await expect(qa.getByRole('tab', { name: '提测管理', exact: true })).toHaveCount(0);
  await expect(qa.getByRole('tab', { name: '测试执行', exact: true })).toHaveCount(0);
  await expect(qa.getByRole('tab', { name: '测试记录', exact: true }).first()).toBeVisible();
  await qa.getByRole('button', { name: '添加测试记录', exact: true }).click();
  let create = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
  await create.getByLabel('测试环境', { exact: true }).fill('QA / Chrome');
  await qa.screenshot({ path: 'test-results/test-record-form-desktop.png' });
  await qa.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await create.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 391;
    })
    .toBe(true);
  await expect(create.getByRole('button', { name: '保存测试结果', exact: true })).toBeInViewport();
  await qa.screenshot({ path: 'test-results/test-record-form-mobile.png' });
  await qa.setViewportSize({ width: 1280, height: 720 });
  await pick(qa, create.getByRole('combobox', { name: /测试结果$/ }), '未通过');
  await create.getByLabel('实际表现', { exact: true }).fill('第二次请求依然登录成功');
  await create.locator('input[type=file]').setInputFiles({
    name: '验证码失败截图.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  const thumbnail = create.locator('.ant-upload-list-item-thumbnail img');
  await expect(thumbnail).toBeVisible();
  await expect
    .poll(() => thumbnail.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  const thumbnailBox = await thumbnail.boundingBox();
  expect(thumbnailBox?.width).toBeGreaterThanOrEqual(90);
  expect(thumbnailBox?.height).toBeGreaterThanOrEqual(65);
  await qa.route(
    '**/quality/records/*/finish',
    (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{}' }),
    { times: 1 },
  );
  await create.getByRole('button', { name: '保存测试结果', exact: true }).click();
  await expect(create.getByText('测试记录已创建，基本信息已锁定。')).toBeVisible();
  await expect(create.getByLabel('测试环境', { exact: true })).toBeDisabled();
  await expect(create.getByLabel('实际表现', { exact: true })).toHaveValue(
    '第二次请求依然登录成功',
  );
  await create.getByRole('button', { name: '保存测试结果', exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(qa).toHaveURL(/tab=records&record=/);
  const firstRecord = new URL(qa.url()).searchParams.get('record')!;
  await expect(qa.getByText('测试结果已保存', { exact: true })).toBeVisible();
  const record = await (
    await page.request.get(`/api/v1/projects/${p}/quality/records/${firstRecord}`)
  ).json();
  expect(record.attachmentIds).toHaveLength(1);
  const recordDetail = qa.getByRole('dialog', { name: '测试记录详情', exact: true });
  const screenshot = recordDetail.getByRole('img', { name: '验证码失败截图.png' });
  await expect(screenshot).toBeVisible();
  await expect
    .poll(() => screenshot.evaluate((img: HTMLImageElement) => img.naturalWidth))
    .toBeGreaterThan(0);
  await screenshot.click();
  await expect(qa.locator('.ant-image-preview-img')).toBeVisible();
  await qa.keyboard.press('Escape');
  const bug = record.defects[0].id;
  await qa.goto(`/projects/${p}?tab=defects&defect=${bug}`);
  await qa.getByRole('tab', { name: '关联与处理记录', exact: true }).click();
  await expect(qa.getByText('关联测试记录', { exact: true })).toBeVisible();
  await act(qa, '确认缺陷');
  await dev.goto(`/projects/${p}?tab=defects&defect=${bug}`);
  await act(dev, '开始修复');
  await dev.getByRole('button', { name: '提交修复', exact: true }).click();
  const fix = dev.getByRole('dialog', { name: '提交修复', exact: true });
  await expect(fix.getByLabel('修复证据说明（选填）', { exact: true })).toBeVisible();
  await expect(fix.getByLabel('修复说明（选填）', { exact: true })).toBeVisible();
  await fix.getByRole('button', { name: '提交修复', exact: true }).click();
  await expect(fix).toHaveCount(0);
  await qa.reload();
  await qa.getByRole('button', { name: '发起复测', exact: true }).click();
  create = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
  await create.getByLabel('测试环境', { exact: true }).fill('QA / Chrome');
  await pick(qa, create.getByRole('combobox', { name: /测试结果$/ }), '通过');
  await create.getByLabel('实际表现', { exact: true }).fill('重复验证码已经被拒绝');
  await create.getByRole('button', { name: '保存测试结果', exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(qa.getByText('测试结果已保存', { exact: true })).toBeVisible();
  expect(
    (await (await page.request.get(`/api/v1/projects/${p}/requirements/${req.id}`)).json()).status,
  ).toBe('COMPLETED');
  expect(
    (await (await page.request.get(`/api/v1/projects/${p}/quality/defects/${bug}`)).json()).status,
  ).toBe('CLOSED');
  await qa.screenshot({ path: 'test-results/lightweight-test-record-desktop.png', fullPage: true });
  await qa.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await qa.getByRole('dialog', { name: '测试记录详情', exact: true }).boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 391;
    })
    .toBe(true);
  await expect(
    qa.getByRole('heading', { name: `验证码不可复用 ${stamp}`, exact: true }),
  ).toBeInViewport();
  await expect
    .poll(() => qa.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await qa.screenshot({ path: 'test-results/lightweight-test-record-mobile.png', fullPage: true });
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  await login(viewer, 'browser-member@example.test', qa.url());
  await expect(viewer.getByRole('button', { name: '保存测试结果', exact: true })).toHaveCount(0);
  await qa.setViewportSize({ width: 1440, height: 1000 });
  await qa.goto(`/projects/${p}?tab=test-cases&case=${testCase.id}`);
  await qa.getByRole('button', { name: '添加测试记录', exact: true }).click();
  create = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
  await create.getByLabel('测试环境', { exact: true }).fill('待测试环境');
  await create
    .locator('input[type=file]')
    .setInputFiles({ name: '说明.txt', mimeType: 'text/plain', buffer: Buffer.from('测试附件') });
  await create.getByRole('button', { name: '保存待测试', exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(qa).toHaveURL(/tab=records&record=/);
  const draftId = new URL(qa.url()).searchParams.get('record')!;
  const draft = await (
    await page.request.get(`/api/v1/projects/${p}/quality/records/${draftId}`)
  ).json();
  expect(draft.outcome).toBe('NOT_RUN');
  await expect(qa.getByText('说明.txt', { exact: true })).toBeVisible();
  await pick(qa, qa.getByRole('combobox', { name: /测试结果$/ }), '通过');
  await qa.getByLabel('实际表现', { exact: true }).fill('待测试记录补充结果');
  await qa.getByRole('button', { name: '保存测试结果', exact: true }).click();
  await expect(qa.getByText('测试结果已保存', { exact: true })).toBeVisible();
  const finishedDraft = await (
    await page.request.get(`/api/v1/projects/${p}/quality/records/${draftId}`)
  ).json();
  expect(finishedDraft.outcome).toBe('PASSED');
  expect(finishedDraft.attachmentIds).toHaveLength(1);
  expect(errors).toEqual([]);
  await viewerContext.close();
  await qaContext.close();
  await devContext.close();
});

test('报告缺陷分步填写并查看分区详情', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(12000);
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page, 'browser-admin@example.test');
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const project = await post(page, '/projects', {
    key: `BUG${stamp.slice(-6)}`.toUpperCase(),
    name: `缺陷界面 ${stamp}`,
  });
  const p = project.id;
  await post(page, `/projects/${p}/status`, { version: 1, status: 'ACTIVE' });
  await post(page, `/projects/${p}/members`, {
    email: 'browser-collaborator@example.test',
    roles: ['DEVELOPER'],
  });
  await post(page, `/projects/${p}/members`, {
    email: 'browser-tester@example.test',
    roles: ['TESTER'],
  });
  const req = await post(page, `/projects/${p}/requirements`, {
    title: `登录需求 ${stamp}`,
    description: '登录页面',
    acceptanceCriteria: '登录成功',
    ownerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/approve`, { version: 2 });
  await page.goto(`/projects/${p}?tab=defects`);
  await page.getByRole('button', { name: /报告缺陷/ }).click();
  const modal = page.getByRole('dialog', { name: '报告缺陷', exact: true });
  await modal.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(modal.getByLabel('缺陷标题')).toBeVisible();
  await modal.getByLabel('缺陷标题').fill(`登录失败 ${stamp}`);
  await pick(page, modal.getByLabel('缺陷关联需求'), `登录需求 ${stamp}`);
  await pick(page, modal.getByLabel('开发负责人'), '陈青');
  await pick(page, modal.getByLabel('复测负责人'), '周宁');
  await pick(page, modal.getByLabel('发现来源'), '生产发现');
  await expect(modal.getByLabel('发现构建', { exact: true })).toBeVisible();
  await modal.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(modal.getByLabel('发现构建', { exact: true })).toBeVisible();
  await pick(page, modal.getByLabel('发现来源'), '测试发现');
  await page.screenshot({ path: 'test-results/defect-create-desktop.png', fullPage: true });
  await expect(modal.getByLabel('关联测试用例（可选）')).toBeHidden();
  await modal.getByText('更多关联（可选）').click();
  await expect(modal.getByLabel('关联测试用例（可选）')).toBeVisible();
  await modal.getByText('更多关联（可选）').click();
  await modal.getByRole('button', { name: '下一步', exact: true }).click();
  await modal.getByLabel('发现环境').fill('Chrome 测试环境');
  await modal.getByLabel('复现步骤').fill('输入正确账号后点击登录');
  await modal.getByLabel('预期表现').fill('进入首页');
  await modal.getByLabel('实际表现').fill('提示登录失败');
  await modal.getByRole('button', { name: '上一步', exact: true }).click();
  await expect(modal.getByLabel('缺陷标题')).toHaveValue(`登录失败 ${stamp}`);
  await modal.getByRole('button', { name: '下一步', exact: true }).click();
  await expect(modal.getByLabel('复现步骤')).toHaveValue('输入正确账号后点击登录');
  const image = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
    'base64',
  );
  await modal.locator('input[type=file]').setInputFiles([
    { name: '截图一.png', mimeType: 'image/png', buffer: image },
    { name: '截图二.png', mimeType: 'image/png', buffer: image },
  ]);
  await expect(modal.locator('.ant-upload-list-item')).toHaveCount(2);
  let uploads = 0;
  await page.route('**/collaboration/DEFECT/*/attachments?*', async (route) => {
    if (++uploads === 2)
      await route.fulfill({ status: 500, contentType: 'application/json', body: '{}' });
    else await route.continue();
  });
  await modal.getByRole('button', { name: '报告缺陷', exact: true }).click();
  await expect(modal.getByText('缺陷已创建，基本信息已锁定，可重试上传图片。')).toBeVisible();
  await expect(modal.getByText('服务暂时无法处理请求', { exact: true })).toBeVisible();
  await page.unroute('**/collaboration/DEFECT/*/attachments?*');
  await modal.getByRole('button', { name: '报告缺陷', exact: true }).click();
  await expect(modal).toHaveCount(0);
  const detail = page.getByRole('dialog', { name: '缺陷详情', exact: true });
  await expect(detail.getByRole('heading', { name: `登录失败 ${stamp}` })).toBeVisible();
  await expect(detail.getByRole('heading', { name: '问题描述' })).toBeVisible();
  await expect(detail.getByRole('heading', { name: '处理概览' })).toBeVisible();
  await expect(detail.getByRole('img', { name: '截图一.png' })).toBeVisible();
  await expect(detail.getByRole('img', { name: '截图二.png' })).toBeVisible();
  await expect
    .poll(() =>
      detail
        .getByRole('img', { name: '截图一.png' })
        .evaluate((img: HTMLImageElement) => img.naturalWidth),
    )
    .toBeGreaterThan(0);
  await detail.getByRole('img', { name: '截图一.png' }).click();
  await expect(page.locator('.ant-image-preview-img')).toBeVisible();
  await page.keyboard.press('Escape');
  const defectId = new URL(page.url()).searchParams.get('defect');
  const attachments = await (
    await page.request.get(`/api/v1/projects/${p}/collaboration/DEFECT/${defectId}/attachments`)
  ).json();
  expect(attachments.total).toBe(2);
  await detail.getByRole('tab', { name: '关联与处理记录' }).click();
  await expect(detail.getByText('未关联测试记录')).toBeVisible();
  await detail.getByRole('tab', { name: '问题详情' }).click();
  await page.screenshot({ path: 'test-results/defect-detail-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(async () => {
      const box = await detail.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 391;
    })
    .toBe(true);
  await page.screenshot({ path: 'test-results/defect-detail-mobile.png', fullPage: true });
});

test('简化发布：检查、失败重试、上线验证和回滚', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  await login(page, 'browser-admin@example.test');
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const project = await post(page, '/projects', {
    key: `REL${stamp.slice(-6)}`.toUpperCase(),
    name: `发布测试 ${stamp}`,
  });
  const p = project.id;
  await post(page, `/projects/${p}/status`, { version: 1, status: 'ACTIVE' });
  const req = await post(page, `/projects/${p}/requirements`, {
    title: '发布验证需求',
    description: '覆盖发布流程',
    acceptanceCriteria: '功能可用',
    ownerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/approve`, { version: 2 });
  const task = await post(page, `/projects/${p}/tasks`, {
    title: '交付任务',
    requirementId: req.id,
    assigneeId: session.user.id,
  });
  await post(page, `/projects/${p}/tasks/${task.id}/start`, { version: 1 });
  await post(page, `/projects/${p}/tasks/${task.id}/complete`, { version: 2, reason: '开发完成' });
  const testCase = await post(page, `/projects/${p}/test-cases`, {
    title: '交付测试用例',
    ownerId: session.user.id,
    requirementIds: [req.id],
    preconditions: '测试环境可用',
    steps: [{ action: '执行测试', expected: '功能正常' }],
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/approve`, {
    version: 2,
    comment: '确认场景',
  });
  const release = await post(page, `/projects/${p}/quality/releases`, {
    name: '测试版本',
    requirementIds: [req.id],
    taskIds: [task.id],
  });
  const build = await post(page, `/projects/${p}/quality/builds`, {
    releaseId: release.id,
    identifier: 'release-build-01',
  });
  const record = await post(page, `/projects/${p}/quality/records`, {
    testCaseId: testCase.id,
    requirementId: req.id,
    buildId: build.id,
    environment: 'QA',
  });
  await post(page, `/projects/${p}/quality/records/${record.id}/finish`, {
    version: 1,
    outcome: 'PASSED',
    actual: '功能正常',
  });
  await page.goto(`/projects/${p}?tab=releases&release=${release.id}`);
  const detail = page.getByRole('dialog', { name: '版本详情', exact: true });
  await expect(detail.getByText('发布前需要处理')).toBeVisible();
  await expect(detail.getByRole('button', { name: '登记发布', exact: true })).toBeDisabled();
  await pick(page, detail.getByRole('combobox').first(), 'release-build-01');
  await expect(detail.getByText('发布检查通过', { exact: true })).toBeVisible();
  await page.keyboard.press('Escape');
  await detail.getByText('发布检查通过', { exact: true }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/m5-release-desktop.png' });
  await detail.getByRole('button', { name: '登记发布', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '登记发布', exact: true });
  await pick(page, modal.getByLabel('发布结果', { exact: true }), '失败');
  await modal.getByLabel('发布说明（选填）').fill('第一次发布失败');
  await modal.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(detail.getByText('发布失败', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '登记发布', exact: true }).click();
  modal = page.getByRole('dialog', { name: '登记发布', exact: true });
  await modal.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(detail.getByText('已登记发布', { exact: true })).toBeVisible();
  await expect(detail.getByRole('button', { name: '登记构建', exact: true })).toHaveCount(0);
  await detail.getByRole('button', { name: '登记上线验证', exact: true }).click();
  modal = page.getByRole('dialog', { name: '登记上线验证', exact: true });
  await pick(page, modal.getByLabel('验证结果', { exact: true }), '失败');
  await modal.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(detail.getByText('上线验证失败', { exact: true })).toBeVisible();
  await detail.getByRole('button', { name: '登记回滚', exact: true }).click();
  modal = page.getByRole('dialog', { name: '登记回滚', exact: true });
  await modal.getByLabel('回滚说明（选填）').fill('回到上一版本');
  await modal.getByRole('button', { name: '保存记录', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(detail.getByText('已回滚', { exact: true })).toBeVisible();
  await expect(detail.getByText('未发布', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.reload();
  await expect(detail.getByRole('heading', { name: '发布与上线' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await expect
    .poll(() =>
      detail.locator('.ant-drawer-body').evaluate((el) => el.scrollWidth <= el.clientWidth),
    )
    .toBe(true);
  await detail.getByRole('heading', { name: '发布与上线' }).scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'test-results/m5-release-mobile.png' });
  await expect
    .poll(async () => {
      const box = await detail.boundingBox();
      return !!box && box.x >= 0 && box.x + box.width <= 391;
    })
    .toBe(true);
});

test('更新失效修复构建后从缺陷发起复测', async ({ page, browser }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  await login(page, 'browser-admin@example.test');
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const project = await post(page, '/projects', {
    key: `FIX${stamp.slice(-6)}`.toUpperCase(),
    name: `修复构建 ${stamp}`,
  });
  const p = project.id;
  await post(page, `/projects/${p}/status`, { version: 1, status: 'ACTIVE' });
  for (const [email, role] of [
    ['browser-collaborator@example.test', 'DEVELOPER'],
    ['browser-tester@example.test', 'TESTER'],
  ])
    await post(page, `/projects/${p}/members`, { email, roles: [role] });
  const developers = await (
    await page.request.get(`/api/v1/projects/${p}/quality/people?purpose=assignee`)
  ).json();
  const testers = await (
    await page.request.get(`/api/v1/projects/${p}/quality/people?purpose=retester`)
  ).json();
  const developer = developers.items.find((item: { label: string }) => item.label === '陈青').id;
  const tester = testers.items.find((item: { label: string }) => item.label === '周宁').id;
  const req = await post(page, `/projects/${p}/requirements`, {
    title: '失效构建复测需求',
    description: '验证修复构建',
    acceptanceCriteria: '修复后测试通过',
    ownerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await post(page, `/projects/${p}/requirements/${req.id}/approve`, { version: 2 });
  const task = await post(page, `/projects/${p}/tasks`, {
    title: '开发修复',
    requirementId: req.id,
    assigneeId: developer,
  });
  await post(page, `/projects/${p}/tasks/${task.id}/start`, {
    version: 1,
    reason: '管理员代为准备测试',
  });
  await post(page, `/projects/${p}/tasks/${task.id}/complete`, { version: 2, reason: '开发完成' });
  const testCase = await post(page, `/projects/${p}/test-cases`, {
    title: '复测构建用例',
    ownerId: tester,
    requirementIds: [req.id],
    preconditions: '测试环境可用',
    steps: [{ action: '运行功能', expected: '结果正确' }],
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/submit`, {
    version: 1,
    reviewerId: tester,
  });
  await post(page, `/projects/${p}/test-cases/${testCase.id}/approve`, {
    version: 2,
    comment: '核对场景',
  });
  const release = await post(page, `/projects/${p}/quality/releases`, {
    name: '复测版本',
    requirementIds: [req.id],
    taskIds: [task.id],
  });
  const makeBuild = (identifier: string) =>
    post(page, `/projects/${p}/quality/builds`, { releaseId: release.id, identifier });
  const firstBuild = await makeBuild('旧测试构建');
  const firstRecord = await post(page, `/projects/${p}/quality/records`, {
    testCaseId: testCase.id,
    requirementId: req.id,
    buildId: firstBuild.id,
    environment: 'QA',
  });
  const result = await post(page, `/projects/${p}/quality/records/${firstRecord.id}/finish`, {
    version: 1,
    outcome: 'FAILED',
    actual: '出现错误',
    assigneeId: developer,
    retesterId: tester,
  });
  const bug = result.defectIds[0];
  await post(page, `/projects/${p}/quality/defects/${bug}/confirm`, {
    version: 1,
    reason: '确认问题',
  });
  await post(page, `/projects/${p}/quality/defects/${bug}/start`, {
    version: 2,
    reason: '开始修复',
  });
  const oldFix = await makeBuild('旧修复构建');
  await post(page, `/projects/${p}/quality/defects/${bug}/fix`, { version: 3, buildId: oldFix.id });
  const releaseRow = await (
    await page.request.get(`/api/v1/projects/${p}/quality/releases/${release.id}`)
  ).json();
  await post(page, `/projects/${p}/quality/releases/${release.id}/update`, {
    version: releaseRow.version,
    name: releaseRow.name,
    description: '范围调整',
    requirementIds: [req.id],
    taskIds: [],
  });
  const newFix = await makeBuild('当前修复构建');
  const qaContext = await browser.newContext(),
    qa = await qaContext.newPage();
  await login(qa, 'browser-tester@example.test', `/projects/${p}?tab=defects&defect=${bug}`);
  await expect(qa.getByRole('button', { name: '更新修复构建', exact: true })).toHaveCount(0);
  const devContext = await browser.newContext(),
    dev = await devContext.newPage();
  await login(dev, 'browser-collaborator@example.test', `/projects/${p}?tab=defects&defect=${bug}`);
  await dev.getByRole('button', { name: '更新修复构建', exact: true }).click();
  const modal = dev.getByRole('dialog', { name: '更新修复构建', exact: true });
  await modal.getByLabel('实际修复构建', { exact: true }).click();
  const options = dev.locator('.ant-select-dropdown:visible .ant-select-item-option');
  const stale = options.filter({ hasText: '旧修复构建（范围已失效）' });
  await expect(stale).toHaveAttribute('aria-disabled', 'true');
  await options.filter({ hasText: '当前修复构建' }).click();
  await modal.getByRole('button', { name: '更新修复构建', exact: true }).click();
  await expect(modal).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/v1/projects/${p}/quality/defects/${bug}`)).json())
      .fixedBuildId,
  ).toBe(newFix.id);
  await qa.reload();
  await qa.getByRole('button', { name: '发起复测', exact: true }).click();
  const create = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
  await create.getByLabel('测试环境', { exact: true }).fill('QA');
  await pick(qa, create.getByRole('combobox', { name: /测试结果$/ }), '通过');
  await create.getByLabel('实际表现', { exact: true }).fill('问题已修复');
  await create.getByRole('button', { name: '保存测试结果', exact: true }).click();
  await expect(create).toHaveCount(0);
  expect(
    (await (await page.request.get(`/api/v1/projects/${p}/quality/defects/${bug}`)).json()).status,
  ).toBe('CLOSED');
  await devContext.close();
  await qaContext.close();
});
