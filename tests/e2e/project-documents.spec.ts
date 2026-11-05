import { expect, test } from '@playwright/test';

test('project documents create and edit, and requirements can only be bound once', async ({
  page,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const post = async (path: string, data: unknown) => {
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
  };
  const project = await post('/projects', {
    key: `P${Date.now().toString(36).slice(-8)}`.toUpperCase(),
    name: '项目文档浏览器验证',
  });
  await post(`/projects/${project.id}/status`, { version: 1, status: 'ACTIVE' });
  const requirement = await post(`/projects/${project.id}/requirements`, {
    title: '关联用需求',
    description: '需求背景',
    acceptanceCriteria: '验收标准',
    ownerId: session.user.id,
  });
  await page.goto(`/projects/${project.id}?tab=documents`);
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  let modal = page.getByRole('dialog', { name: '新建文档' });
  await modal.getByLabel('文档标题').fill('部署说明');
  await modal.getByRole('button', { name: /确\s*定/ }).click();
  const editor = page.getByRole('textbox', { name: '文档正文' });
  await editor.fill('发布步骤');
  await editor.press('ControlOrMeta+a');
  await page.getByRole('button', { name: '加粗', exact: true }).click();
  await editor.press('ArrowRight');
  await editor.press('Enter');
  await page.getByLabel('选择文档图片').setInputFiles({
    name: 'test.png',
    mimeType: 'image/png',
    buffer: Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
      'base64',
    ),
  });
  await expect(editor.locator('img[data-document-image]')).toHaveCount(1);
  await page.getByRole('button', { name: '保存文档' }).click();
  await expect(page.locator('strong').filter({ hasText: '发布步骤' })).toBeVisible();
  await expect(page.locator('.ant-image img')).toHaveJSProperty('naturalWidth', 1);
  const otherPage = await page.context().newPage();
  await otherPage.goto(page.url());
  await page.getByRole('button', { name: '编辑文档' }).click();
  await otherPage.getByRole('button', { name: '编辑文档' }).click();
  const firstEditor = page.getByRole('textbox', { name: '文档正文' });
  const secondEditor = otherPage.getByRole('textbox', { name: '文档正文' });
  await firstEditor.fill('第一个编辑');
  await secondEditor.fill('第二个编辑未保存');
  await page.getByRole('button', { name: '保存文档' }).click();
  await expect(page.getByText('第一个编辑', { exact: true })).toBeVisible();
  await otherPage.getByRole('button', { name: '保存文档' }).click();
  await expect(otherPage.getByText('文档已更新，请刷新后重试')).toBeVisible();
  await expect(secondEditor).toContainText('第二个编辑未保存');
  await otherPage.getByRole('button', { name: /取\s*消/ }).click();
  const warning = otherPage.getByRole('dialog', { name: '仍有未保存的文档内容' });
  await expect(warning).toBeVisible();
  await warning.getByRole('button', { name: '继续编辑' }).click();
  await expect(secondEditor).toContainText('第二个编辑未保存');
  await otherPage.close();
  await page.getByRole('link', { name: '返回项目文档' }).click();
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  modal = page.getByRole('dialog', { name: '新建文档' });
  await modal.getByText('关联需求', { exact: true }).click();
  const row = modal.getByRole('row').filter({ hasText: '关联用需求' });
  await row.getByRole('radio').check();
  await modal.getByRole('button', { name: /确\s*定/ }).click();
  await expect(page).toHaveURL(new RegExp(`/requirements/${requirement.id}/document`));
  await expect(page.getByRole('textbox', { name: '文档正文' })).toBeVisible();
  await page.goto(`/projects/${project.id}?tab=documents`);
  await expect(page.getByRole('button', { name: '关联用需求' })).toBeVisible();
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  modal = page.getByRole('dialog', { name: '新建文档' });
  await modal.getByText('关联需求', { exact: true }).click();
  const used = modal.getByRole('row').filter({ hasText: '关联用需求' });
  await expect(used.getByRole('radio')).toBeDisabled();
  await expect(used).toContainText('已有文档');
});

test('read-only project members see applied content without editing or unpublished requirement drafts', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const post = async (path: string, data: unknown) => {
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
  };
  const project = await post('/projects', {
    key: `R${Date.now().toString(36).slice(-8)}`.toUpperCase(),
    name: '文档只读验证',
  });
  await post(`/projects/${project.id}/status`, { version: 1, status: 'ACTIVE' });
  await post(`/projects/${project.id}/members`, {
    email: 'browser-member@example.test',
    roles: ['VIEWER'],
  });
  const requirement = await post(`/projects/${project.id}/requirements`, {
    title: '仅草稿的需求',
    description: '背景',
    acceptanceCriteria: '验收',
    ownerId: session.user.id,
  });
  await post(`/projects/${project.id}/requirements/${requirement.id}/document`, {
    template: 'blank',
  });
  const document = await post(`/projects/${project.id}/documents`, { title: '团队文档' });
  await post(`/projects/${project.id}/documents/${document.id}/save`, {
    title: '团队文档',
    version: 1,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '可以查看的正文' }] }],
    },
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/projects/${project.id}?tab=documents`);
  await page.getByRole('button', { name: '新建文档', exact: true }).click();
  const chooser = page.getByRole('dialog', { name: '新建文档' });
  await chooser.getByText('关联需求', { exact: true }).click();
  await expect(chooser.getByRole('row').filter({ hasText: '仅草稿的需求' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await chooser.getByRole('button', { name: /取\s*消/ }).click();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  try {
    const viewer = await context.newPage();
    await viewer.goto('/');
    await viewer.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
    await viewer.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
    await viewer.getByRole('button', { name: '登录工作空间' }).click();
    await expect(viewer.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
    await viewer.goto(`/projects/${project.id}?tab=documents`);
    await expect(viewer.getByRole('button', { name: '团队文档', exact: true })).toBeVisible();
    expect(
      await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
    await expect(viewer.getByRole('button', { name: '仅草稿的需求', exact: true })).toHaveCount(0);
    await expect(viewer.getByRole('button', { name: '新建文档', exact: true })).toHaveCount(0);
    await viewer.getByRole('button', { name: '团队文档', exact: true }).click();
    await expect(viewer.getByText('可以查看的正文')).toBeVisible();
    await expect(viewer.getByRole('button', { name: '编辑文档', exact: true })).toHaveCount(0);
    await viewer.goto(`/projects/${project.id}/requirements/${requirement.id}/document`);
    await expect(viewer.getByText('此需求尚无文档')).toBeVisible();
    await expect(viewer.getByRole('button', { name: '编辑文档草稿' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
