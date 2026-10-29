import { test, expect, type Page } from '@playwright/test';

const password = 'MyTeam-test-only-2026!';
async function language(page: Page, value: 'English' | '简体中文') {
  await page.getByRole('combobox', { name: /界面语言|Interface language/ }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: value })
    .click();
  await expect(page.locator('html')).toHaveAttribute(
    'lang',
    value === 'English' ? 'en-US' : 'zh-CN',
  );
}

async function post(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
      'Accept-Language': 'en-US',
    },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}

test('语言切换：登录文案、保留输入、错误提示、刷新持久化和窄屏', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByText('请输入邮箱', { exact: true })).toBeVisible();
  await language(page, 'English');
  await expect(page.getByText('Enter your email', { exact: true })).toBeVisible();
  await language(page, '简体中文');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  await language(page, 'English');
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page).toHaveTitle('MyTeam · Team collaboration');
  await expect(page.getByLabel('Email', { exact: true })).toHaveValue('browser-admin@example.test');
  await expect(page.getByLabel('Password', { exact: true })).toHaveValue('incorrect-password');
  const response = page.waitForResponse(
    (r) => r.url().endsWith('/auth/login') && r.request().method() === 'POST',
  );
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  expect((await response).headers()['content-language']).toBe('en-US');
  await expect(page.getByRole('alert')).toContainText('Incorrect email or password');
  await language(page, '简体中文');
  await expect(page.getByRole('alert')).toContainText('邮箱或密码错误');
  await language(page, 'English');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  await expect(page.locator('html')).toHaveAttribute('lang', 'en-US');
  await page.setViewportSize({ width: 390, height: 844 });
  await language(page, '简体中文');
  await expect(page.getByRole('button', { name: '登录工作空间' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
});

test('英文工作区：业务页面、状态、发布检查、数据原文与表单输入保持', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await language(page, 'English');
  await page.getByLabel('Email', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign in to workspace' }).click();
  await expect(page.getByRole('heading', { name: 'My to-dos' })).toBeVisible();
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const projectName = `中文项目保留原文 ${stamp}`;
  const project = await post(page, '/projects', {
    key: `E2EI${stamp.slice(-6)}`.toUpperCase(),
    name: projectName,
    description: '用户填写的中文简介不翻译',
  });
  const base = `/projects/${project.id}`;
  await post(page, `${base}/status`, { version: 1, status: 'ACTIVE' });
  const iteration = await post(page, `${base}/iterations`, {
    name: '中文迭代名称',
    goal: '用户填写的目标',
    ownerId: me.user.id,
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  });
  const requirement = await post(page, `${base}/requirements`, {
    title: '用户填写的中文需求',
    description: '中文需求描述',
    acceptanceCriteria: '中文验收标准',
    ownerId: me.user.id,
    iterationId: iteration.id,
  });
  await post(page, `${base}/requirements/${requirement.id}/submit`, {
    version: 1,
    reviewerId: me.user.id,
  });
  await post(page, `${base}/requirements/${requirement.id}/approve`, { version: 2 });
  await post(page, `${base}/tasks`, { title: '用户填写的中文任务', requirementId: requirement.id });
  const testCase = await post(page, `${base}/test-cases`, {
    title: '用户填写的中文用例',
    requirementIds: [requirement.id],
    ownerId: me.user.id,
    steps: [{ action: '用户填写的步骤', expected: '用户填写的预期' }],
  });
  await post(page, `${base}/test-cases/${testCase.id}/submit`, {
    version: 1,
    reviewerId: me.user.id,
  });
  await post(page, `${base}/test-cases/${testCase.id}/approve`, { version: 2 });
  await post(page, `${base}/quality/records`, {
    requirementId: requirement.id,
    testCaseId: testCase.id,
    environment: '中文测试环境',
  });
  const release = await post(page, `${base}/quality/releases`, {
    name: '用户填写的中文版本',
    requirementIds: [requirement.id],
  });
  await page.goto(base);
  await expect(page.getByRole('heading', { name: projectName, exact: true })).toBeVisible();
  await expect(page.getByText('用户填写的中文简介不翻译', { exact: true })).toBeVisible();
  const tabs: Array<[string, string]> = [
    ['iterations', 'Turn goals into progress'],
    ['requirements', 'Requirements'],
    ['tasks', 'Tasks'],
    ['test-cases', 'Test case library'],
    ['records', 'Test records'],
    ['defects', 'Defects'],
    ['releases', 'Releases and builds'],
    ['members', 'The people moving this project forward'],
  ];
  for (const [tab, heading] of tabs) {
    await page.goto(`${base}?tab=${tab}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator('.ant-skeleton')).toHaveCount(0);
  }
  await page.goto(`${base}?tab=iterations`);
  await expect(page.getByText('Planning', { exact: true }).first()).toBeVisible();
  await expect(page.getByText('中文迭代名称', { exact: true })).toBeVisible();
  await page.goto(`${base}?tab=requirements&requirement=${requirement.id}`);
  await expect(page.getByRole('dialog')).toContainText('Confirmed');
  await expect(page.getByRole('dialog')).toContainText('用户填写的中文需求');
  await page.goto(`${base}?tab=records`);
  await expect(page.getByText('Pending testing', { exact: true }).first()).toBeVisible();
  await page.goto(`${base}?tab=releases&release=${release.id}`);
  await expect(page.getByRole('heading', { name: 'Deployment and verification' })).toBeVisible();
  await expect(page.getByText('Select a build for this deployment', { exact: true })).toBeVisible();
  await expect(
    page.getByText('Requirement “用户填写的中文需求” is not complete', { exact: true }),
  ).toBeVisible();

  await page.goto(`${base}?tab=requirements`);
  await page.getByRole('button', { name: 'New requirement', exact: true }).click();
  const editor = page.getByRole('dialog');
  await editor.getByLabel('Requirement title', { exact: true }).fill('Unsaved 中文输入');
  // A preference change from another tab must update this open editor without resetting it.
  await page.evaluate(() => {
    localStorage.setItem('myteam.locale', 'zh-CN');
    window.dispatchEvent(new StorageEvent('storage', { key: 'myteam.locale', newValue: 'zh-CN' }));
  });
  await expect(editor.getByLabel('需求标题', { exact: true })).toHaveValue('Unsaved 中文输入');
  await editor.getByRole('button', { name: /取\s*消/ }).click();
  await language(page, 'English');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('combobox', { name: 'Interface language' })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    .toBe(true);
  await page.screenshot({ path: 'test-results/i18n-english-mobile.png', fullPage: true });
  for (const [tab, heading] of tabs) {
    await page.goto(`${base}?tab=${tab}`);
    await expect(page.getByRole('heading', { name: heading })).toBeVisible();
    await expect(page.locator('.ant-skeleton')).toHaveCount(0);
    await expect
      .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), {
        message: tab,
      })
      .toBe(true);
  }
  expect(errors).toEqual([]);
});
