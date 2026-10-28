import { expect, test } from '@playwright/test';

const password = 'MyTeam-test-only-2026!';
test('登录 → 刷新保持会话 → 管理账号 → 退出，控制台无运行错误', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '你好，浏览器测试管理员。' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '你好，浏览器测试管理员。' })).toBeVisible();
  const accountEmail = `identity-status-${Date.now().toString(36)}@browser-e2e.test`;
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const created = await page.request.post('/api/v1/users', {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: { email: accountEmail, name: '账号启停验证', password },
  });
  expect(created.status(), await created.text()).toBe(201);
  await page.getByRole('link', { name: '账号管理', exact: true }).click();
  await expect(page.getByRole('heading', { name: '账号管理', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索账号' }).fill(accountEmail);
  const row = page.getByRole('row').filter({ hasText: accountEmail });
  await row.getByRole('button', { name: '停用', exact: true }).click();
  await page.getByRole('button', { name: /^确\s*认$/ }).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(row.getByText('已停用', { exact: true })).toBeVisible();
  await row.getByRole('button', { name: '启用', exact: true }).click();
  await page.getByRole('button', { name: /^确\s*认$/ }).click();
  await expect(page.getByRole('tooltip')).toHaveCount(0);
  await expect(row.getByText('可用', { exact: true })).toBeVisible();
  await page.screenshot({ path: 'test-results/account-management.png', fullPage: true });
  await page.getByRole('button', { name: '退出登录' }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: '欢迎回来' })).toBeVisible();
  await page.screenshot({ path: 'test-results/login-desktop.png', fullPage: true });
  expect(errors).toEqual([]);
});

test('窄屏登录表单可操作，错误密码有明确反馈', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
  await page.getByLabel('密码', { exact: true }).fill('incorrect-password');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('alert')).toContainText('邮箱或密码错误');
  await page.screenshot({ path: 'test-results/login-mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
