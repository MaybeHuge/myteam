import { expect, test, type Page } from '@playwright/test';

const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a7ioAAAAASUVORK5CYII=',
  'base64',
);
async function login(page: Page) {
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '我的待办', exact: true })).toBeVisible();
}
async function post(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const result = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data,
  });
  expect(result.status(), await result.text()).toBe(201);
  return result.json();
}
async function setup(page: Page) {
  page.setDefaultTimeout(12000);
  await login(page);
  const me = await (await page.request.get('/api/v1/auth/me')).json();
  const stamp = Date.now().toString(36);
  const project = await post(page, '/projects', {
    key: `DOC${stamp.slice(-7)}`.toUpperCase(),
    name: `文档浏览器验证 ${stamp}`,
  });
  await post(page, `/projects/${project.id}/status`, { version: 1, status: 'ACTIVE' });
  const base = `/projects/${project.id}/requirements`;
  const requirement = await post(page, base, {
    title: '图文需求说明',
    description: '用户提交订单',
    acceptanceCriteria: '展示订单结果',
    ownerId: me.user.id,
  });
  const path = `${base}/${requirement.id}/document`;
  await page.goto(`/projects/${project.id}?tab=requirements&requirement=${requirement.id}`);
  await page.getByRole('tab', { name: '需求文档', exact: true }).click();
  await page.getByRole('button', { name: '创建或编辑需求文档', exact: true }).click();
  await page.getByRole('button', { name: '使用需求模板', exact: true }).click();
  const body = page.getByRole('textbox', { name: '文档正文', exact: true });
  await expect(body).toContainText('用户提交订单');
  return { path, body };
}
async function apply(page: Page) {
  await page.getByRole('button', { name: '应用到需求', exact: true }).click();
  await page
    .getByRole('dialog', { name: '应用到需求', exact: true })
    .getByRole('button', { name: '确认应用', exact: true })
    .click();
  await expect(page.getByRole('textbox', { name: '文档正文', exact: true })).toHaveCount(0);
}

test('字号颜色可保存；图片撤销重做、复制、图片库找回及刷新保持', async ({ page }) => {
  test.setTimeout(90000);
  const { path, body } = await setup(page);
  await body.fill('带字号与颜色的正文');
  await body.press('ControlOrMeta+a');
  await page.getByRole('combobox', { name: '字体大小', exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: /^24px$/ })
    .click();
  await page.getByRole('button', { name: '文字颜色', exact: true }).click();
  await page.locator('.ant-color-picker-presets-color:has([style*="rgb(220, 38, 38)"])').click();
  await body.press('ArrowRight');
  await body.press('Enter');
  const imageBytes = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 120;
    const context = canvas.getContext('2d')!;
    context.fillStyle = '#2563eb';
    context.fillRect(0, 0, 200, 120);
    return canvas.toDataURL('image/png').split(',')[1]!;
  });
  await page.getByLabel('选择文档图片', { exact: true }).setInputFiles({
    name: 'visible-prototype.png',
    mimeType: 'image/png',
    buffer: Buffer.from(imageBytes, 'base64'),
  });
  const images = body.locator('img[data-document-image]');
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveJSProperty('naturalWidth', 200);
  await page.getByRole('button', { name: '撤销', exact: true }).click();
  await expect(images).toHaveCount(0);
  await page.getByRole('button', { name: '重做', exact: true }).click();
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveJSProperty('naturalWidth', 200);
  const html = await images.first().evaluate((element) => element.outerHTML);
  await body.locator('p').last().click();
  await body.evaluate((element, html) => {
    const transfer = new DataTransfer();
    transfer.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
  }, html);
  await expect(images).toHaveCount(2);
  for (let i = 0; i < 2; i++) {
    await images.first().click();
    await page.keyboard.press('Backspace');
  }
  await expect(images).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
  await page.getByRole('button', { name: '已上传图片', exact: true }).click();
  const library = page.getByRole('dialog', { name: '已上传图片', exact: true });
  await expect(
    library.getByRole('img', { name: 'visible-prototype.png', exact: true }),
  ).toHaveJSProperty('naturalWidth', 200);
  await library.getByRole('button', { name: '插入此图片', exact: true }).click();
  await expect(images).toHaveCount(1);
  await expect(images.first()).toHaveJSProperty('naturalWidth', 200);
  expect((await (await page.request.get(`/api/v1${path}/images`)).json()).total).toBe(1);
  await apply(page);
  await page.reload();
  await expect(page.locator('.ant-image img').first()).toHaveJSProperty('naturalWidth', 200);
  const styled = page.getByText('带字号与颜色的正文', { exact: true });
  await expect(styled).toHaveCSS('font-size', '24px');
  await expect(styled).toHaveCSS('color', 'rgb(220, 38, 38)');
  const readingImage = await page
    .locator('.ant-image img')
    .first()
    .evaluate((element) => element.outerHTML);
  await page.getByRole('button', { name: '编辑文档草稿', exact: true }).click();
  await body.locator('p').last().click();
  await body.evaluate((element, html) => {
    const transfer = new DataTransfer();
    transfer.setData('text/html', html);
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
  }, readingImage);
  await expect(images).toHaveCount(2);
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
});

test('链接和带格式换行可自动保存、应用及刷新恢复', async ({ page }) => {
  const { path, body } = await setup(page);
  await body.fill('需求说明链接');
  await body.press('ControlOrMeta+a');
  await page.getByRole('button', { name: '插入链接', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '插入链接', exact: true });
  await dialog
    .getByRole('textbox', { name: '链接地址', exact: true })
    .fill('https://example.test/requirement');
  await dialog.getByRole('button', { name: /确\s*认/ }).click();
  await expect(body.locator('a')).toHaveAttribute('href', 'https://example.test/requirement');
  await body.press('ArrowRight');
  await body.press('Enter');
  await body.evaluate((element) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'text/html',
      '<p><a href="https://example.test/source" title="原始来源" class="external-link" target="_self" rel="noreferrer">来源链接</a><strong>第一行<br>换行后的正文</strong></p>',
    );
    transfer.setData('text/plain', '第一行\n换行后的正文');
    element.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }));
  });
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
  const doc = await (await page.request.get(`/api/v1${path}`)).json();
  const nodes = doc.draft.content.content.flatMap(
    (block: { content?: unknown[] }) => block.content ?? [],
  );
  expect(
    nodes.find((node: { type: string }) => node.type === 'text').marks[0].attrs.title,
  ).toBeNull();
  expect(nodes.find((node: { type: string }) => node.type === 'hardBreak').marks).toContainEqual({
    type: 'bold',
  });
  expect(
    nodes.find((node: { text?: string }) => node.text === '来源链接').marks[0].attrs,
  ).toMatchObject({
    title: '原始来源',
    target: '_blank',
    rel: 'noopener noreferrer nofollow',
    class: null,
  });
  await apply(page);
  await page.reload();
  await expect(page.getByRole('link', { name: '需求说明链接', exact: true })).toHaveAttribute(
    'href',
    'https://example.test/requirement',
  );
  await expect(page.getByText('换行后的正文', { exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: '来源链接', exact: true })).toHaveAttribute(
    'title',
    '原始来源',
  );
});

test('需求文档：格式、图片失败重试、自动保存、刷新、固定版本及移动端和英语', async ({ page }) => {
  test.setTimeout(100000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  const { path, body } = await setup(page);
  await body.press('ControlOrMeta+End');
  await body.press('Enter');
  await body.pressSequentially('原型截图和业务流程');
  await page.getByRole('button', { name: '插入表格', exact: true }).click();
  await expect(body.locator('table')).toHaveCount(1);
  await body.locator('th').first().click();
  await page.keyboard.type('字段');
  await body.press('ControlOrMeta+End');
  const keys: string[] = [];
  let fail = true;
  await page.route(`**/api/v1${path}/images?*`, async (route) => {
    keys.push(route.request().headers()['idempotency-key']);
    if (fail) {
      fail = false;
      await route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: JSON.stringify({ code: 'HTTP_ERROR', message: '上传重试验证', requestId: 'test' }),
      });
    } else await route.continue();
  });
  await page
    .getByLabel('选择文档图片', { exact: true })
    .setInputFiles({ name: 'prototype.png', mimeType: 'image/png', buffer: png });
  await expect(page.getByText('上传失败', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '应用到需求', exact: true })).toBeDisabled();
  await page.getByRole('button', { name: '重试上传', exact: true }).click();
  await expect(body.locator('img[data-document-image]')).toHaveCount(1);
  await expect(body.locator('[data-upload-placeholder]')).toHaveCount(0);
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
  expect(keys.length).toBe(2);
  expect(keys[0]).toBe(keys[1]);
  for (const kind of ['paste', 'drop'] as const) {
    await body.evaluate(
      (element, { kind, bytes }) => {
        const transfer = new DataTransfer();
        transfer.items.add(new File([new Uint8Array(bytes)], `${kind}.png`, { type: 'image/png' }));
        if (kind === 'paste')
          element.dispatchEvent(
            new ClipboardEvent('paste', { bubbles: true, clipboardData: transfer }),
          );
        else {
          const rect = element.getBoundingClientRect();
          element.dispatchEvent(
            new DragEvent('drop', {
              bubbles: true,
              dataTransfer: transfer,
              clientX: rect.left + 10,
              clientY: rect.top + 20,
            }),
          );
        }
      },
      { kind, bytes: [...png] },
    );
  }
  await expect(body.locator('img[data-document-image]')).toHaveCount(3);
  await expect(page.getByRole('status')).toHaveText('草稿已保存');
  const before = await (await page.request.get(`/api/v1${path}`)).json();
  expect(before.requirement.revision).toBe(1);
  expect(before.current).toBeNull();
  await page.reload();
  await page.getByRole('button', { name: '编辑文档草稿', exact: true }).click();
  await expect(body).toContainText('原型截图和业务流程');
  await expect(body.locator('table')).toHaveCount(1);
  for (const image of await body.locator('img').all()) {
    await expect(image).toHaveJSProperty('complete', true);
    await expect(image).not.toHaveJSProperty('naturalWidth', 0);
  }
  await apply(page);
  await expect(page.getByRole('link', { name: '查看文档 V1', exact: true })).toBeVisible();
  const image = page.locator('.ant-image img').first();
  await image.click();
  await expect(page.locator('.ant-image-preview')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: '编辑文档草稿', exact: true }).click();
  await body.press('ControlOrMeta+End');
  await body.press('Enter');
  await body.pressSequentially('第二版内容');
  await apply(page);
  await page.getByRole('link', { name: '查看文档 V1', exact: true }).click();
  await expect(page.getByText('历史文档版本，只读', { exact: true })).toBeVisible();
  await expect(page.getByText('第二版内容', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑文档草稿', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '返回当前文档', exact: true }).click();
  const beforeOpen = await (await page.request.get(`/api/v1${path}`)).json();
  await page.getByRole('button', { name: '编辑文档草稿', exact: true }).click();
  await page.getByRole('combobox', { name: '界面语言' }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: 'English' })
    .click();
  await expect(page.getByRole('textbox', { name: 'Document body', exact: true })).toContainText(
    '第二版内容',
  );
  await expect(page.getByRole('button', { name: 'Insert image', exact: true })).toBeVisible();
  await expect(page.getByRole('status')).toHaveText('Draft saved');
  expect((await (await page.request.get(`/api/v1${path}`)).json()).draft.version).toBe(
    beforeOpen.draft.version,
  );
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await page.setViewportSize({ width: 390, height: 844 });
  const overflow = await page.evaluate(() => ({
    width: innerWidth,
    scroll: document.documentElement.scrollWidth,
    elements: [...document.querySelectorAll('body *')]
      .filter((e) => e.getBoundingClientRect().right > innerWidth + 1)
      .map((e) => ({
        tag: e.tagName,
        class: e.className,
        width: e.getBoundingClientRect().width,
        right: e.getBoundingClientRect().right,
      }))
      .slice(-20),
  }));
  expect(overflow.scroll, JSON.stringify(overflow)).toBeLessThanOrEqual(overflow.width);
  await page.screenshot({ path: 'test-results/requirement-document-mobile.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('文档冲突保留本地输入；显式加载及放弃修改；未保存离开提示', async ({ page }) => {
  test.setTimeout(90000);
  const { path, body } = await setup(page);
  const draft = await (await page.request.get(`/api/v1${path}`)).json();
  await post(page, `${path}/save`, {
    version: draft.draft.version,
    content: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: '其他成员最新草稿' }] }],
    },
  });
  await body.press('ControlOrMeta+End');
  await body.pressSequentially('本地不能丢失的编辑');
  await expect(page.getByText('保存失败，编辑内容仍保留在本页', { exact: true })).toBeVisible();
  await expect(body).toContainText('本地不能丢失的编辑');
  await page.getByRole('link', { name: '返回当前需求', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('尚未保存的文字或上传中的图片可能丢失。');
  await page.getByRole('dialog').getByRole('button', { name: '继续编辑', exact: true }).click();
  await page.getByRole('button', { name: '加载最新草稿', exact: true }).click();
  await page
    .getByRole('dialog', { name: '加载最新草稿？', exact: true })
    .getByRole('button', { name: '加载最新草稿', exact: true })
    .click();
  await expect(body).toContainText('其他成员最新草稿');
  await expect(body).not.toContainText('本地不能丢失的编辑');
  await page.getByRole('button', { name: '放弃未应用修改', exact: true }).click();
  await page
    .getByRole('dialog', { name: '放弃未应用修改？', exact: true })
    .getByRole('button', { name: '放弃修改', exact: true })
    .click();
  await expect(body).toHaveCount(0);
  expect((await (await page.request.get(`/api/v1${path}`)).json()).hasPendingChanges).toBe(false);
});
