import { expect, test } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
test('跨角色协作：纯文本评论、附件上传下载、通知已读与跳转、刷新及窄屏只读', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-collaborator@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  await page.getByRole('tab', { name: '讨论与附件', exact: true }).click();
  const url = page.url();
  const body = `讨论 ${Date.now()}：<script>window.injected=true</script>\n附件已整理，请负责人确认。`;
  await expect(page.getByRole('button', { name: '发布评论', exact: true })).toBeDisabled();
  await page.getByLabel('评论内容', { exact: true }).fill(body);
  await page.getByRole('button', { name: '发布评论', exact: true }).click();
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  expect(await page.evaluate(() => 'injected' in window)).toBe(false);
  await page.reload();
  await expect(page.getByRole('tab', { name: '讨论与附件', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await expect(page.getByText(body, { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/collaboration-comments.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: /共享附件/ }).click();
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: '内容不符.png', mimeType: 'image/png', buffer: Buffer.from('not png') });
  await expect(page.getByText('文件类型或内容格式不受支持', { exact: true })).toBeVisible();
  const filename = `协作资料-${Date.now()}.md`;
  const content = '# 协作资料\n本轮需要负责人确认的交付说明。';
  await page
    .locator('input[type=file]')
    .setInputFiles({ name: filename, mimeType: 'text/markdown', buffer: Buffer.from(content) });
  await expect(page.getByText(filename, { exact: true })).toBeVisible();
  const downloading = page.waitForEvent('download');
  await page.getByRole('link', { name: `下载 ${filename}`, exact: true }).click();
  const downloaded = await downloading;
  expect(downloaded.suggestedFilename()).toBe(filename);
  const stream = await downloaded.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk));
  expect(Buffer.concat(chunks).toString()).toBe(content);
  await page.screenshot({
    path: 'test-results/collaboration-files.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/collaboration-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );

  const adminContext = await browser.newContext();
  const admin = await adminContext.newPage();
  admin.on('pageerror', (e) => errors.push(e.message));
  await admin.goto('/');
  await admin.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await admin.getByLabel('密码', { exact: true }).fill(password);
  await admin.getByRole('button', { name: '登录工作空间' }).click();
  await admin.getByRole('button', { name: '站内通知', exact: true }).click();
  const drawer = admin.getByRole('dialog', { name: '站内通知', exact: true });
  await expect(
    drawer.getByRole('link', { name: '陈青 向「MyTeam 协作平台」添加了附件', exact: true }).first(),
  ).toBeVisible();
  const unread = (await (await admin.request.get('/api/v1/notifications')).json()).unread;
  await drawer.getByRole('button', { name: '标为已读', exact: true }).first().click();
  await expect
    .poll(async () => (await (await admin.request.get('/api/v1/notifications')).json()).unread)
    .toBe(unread - 1);
  await admin.screenshot({
    path: 'test-results/notifications.png',
    fullPage: true,
    animations: 'disabled',
  });
  await drawer
    .getByRole('link', { name: '陈青 评论了「MyTeam 协作平台」', exact: true })
    .first()
    .click();
  await expect(admin).toHaveURL(/tab=collaboration/);
  await expect(admin.getByText(body, { exact: true })).toBeVisible();

  const viewerContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const viewer = await viewerContext.newPage();
  await viewer.goto(url);
  await viewer.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
  await viewer.getByLabel('密码', { exact: true }).fill(password);
  await viewer.getByRole('button', { name: '登录工作空间' }).click();
  await expect(viewer.getByText(body, { exact: true })).toBeVisible();
  await expect(viewer.getByLabel('评论内容', { exact: true })).toHaveCount(0);
  await viewer.getByRole('tab', { name: /共享附件/ }).click();
  await expect(viewer.getByText(filename, { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: '上传附件', exact: true })).toHaveCount(0);
  expect(
    await viewer.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
  ).toBe(true);
  await viewer.screenshot({
    path: 'test-results/collaboration-viewer-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await viewerContext.close();
  await adminContext.close();
  expect(errors).toEqual([]);
});
