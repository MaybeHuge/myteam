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

test('普通成员使用六位密码登录并修改密码', async ({ page, browser }) => {
  test.setTimeout(90000);
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page.getByRole('link', { name: '账号管理', exact: true }).click();
  await page.getByRole('button', { name: '新建账号', exact: true }).click();
  const email = `change-password-${Date.now().toString(36)}@browser-e2e.test`;
  await page.getByLabel('姓名', { exact: true }).fill('密码测试账号');
  await page.getByLabel('登录邮箱', { exact: true }).fill(email);
  await page.getByLabel('初始密码', { exact: true }).fill('123456');
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByText('账号已创建，可以将该成员加入项目')).toBeVisible();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const member = await context.newPage();
  await member.goto('/');
  await member.getByLabel('邮箱', { exact: true }).fill(email);
  await member.getByLabel('密码', { exact: true }).fill('123456');
  await member.getByRole('button', { name: '登录工作空间' }).click();
  await member.getByRole('button', { name: '修改密码', exact: true }).click();
  const dialog = member.getByRole('dialog', { name: '修改密码', exact: true });
  await dialog.getByLabel('原密码', { exact: true }).fill('wrong-password');
  await dialog.getByLabel('新密码', { exact: true }).fill('654321');
  await dialog.getByLabel('确认新密码', { exact: true }).fill('654321');
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog.getByText('原密码不正确')).toBeVisible();
  await dialog.getByLabel('原密码', { exact: true }).fill('123456');
  await dialog.getByLabel('确认新密码', { exact: true }).fill('different');
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog.getByText('两次输入的密码不一致')).toBeVisible();
  await dialog.getByLabel('确认新密码', { exact: true }).fill('654321');
  await dialog.getByRole('button', { name: '保存新密码', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(member.getByText('密码已修改，其他登录设备已退出')).toBeVisible();
  await member.getByRole('button', { name: '退出登录' }).click();
  await member.getByLabel('邮箱', { exact: true }).fill(email);
  await member.getByLabel('密码', { exact: true }).fill('654321');
  await member.getByRole('button', { name: '登录工作空间' }).click();
  await expect(member.getByRole('button', { name: '修改密码', exact: true })).toBeVisible();
  await context.close();
});
