import { expect, test } from '@playwright/test';

test('侧边栏折叠后可导航，刷新保留选择并可重新展开', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  const navigation = page.getByRole('navigation', { name: '主导航' });
  await expect(navigation.getByText('项目空间', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '折叠侧边栏' }).click();
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toHaveAttribute(
    'aria-expanded',
    'false',
  );
  await expect(navigation.getByText('项目空间', { exact: true })).toBeHidden();
  await navigation.getByRole('link', { name: '项目空间' }).click();
  await expect(page).toHaveURL(/\/projects/);
  await page.reload();
  await expect(page.getByRole('button', { name: '展开侧边栏' })).toBeVisible();
  await page.getByRole('button', { name: '展开侧边栏' }).focus();
  await page.keyboard.press('Enter');
  await expect(page.getByRole('button', { name: '折叠侧边栏' })).toHaveAttribute(
    'aria-expanded',
    'true',
  );
  await expect(navigation.getByText('项目空间', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
  await page.getByRole('button', { name: '折叠侧边栏' }).click();
  await expect(navigation.getByRole('link', { name: '工作台' })).toBeVisible();
  await expect(page.locator('body')).toHaveJSProperty('scrollWidth', 390);
});
