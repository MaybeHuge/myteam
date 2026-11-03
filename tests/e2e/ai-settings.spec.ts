import { expect, test } from '@playwright/test';

test('管理员配置平台，成员不能访问设置', async ({ page, browser }) => {
  let saved = false;
  await page.route('**/api/v1/settings/ai-providers**', async (route) => {
    if (route.request().method() === 'POST') {
      saved = true;
      await route.fulfill({ json: { ok: true } });
      return;
    }
    await route.fulfill({
      json: [
        {
          id: 'bailian',
          name: '阿里百炼',
          baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
          model: 'qwen3.8-flash',
          enabled: true,
          hasKey: true,
          version: 1,
        },
        {
          id: 'deepseek',
          name: 'DeepSeek',
          baseUrl: 'https://api.deepseek.com/v1',
          model: 'deepseek-chat',
          enabled: saved,
          hasKey: saved,
          version: saved ? 1 : 0,
        },
      ],
    });
  });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page.getByRole('link', { name: 'AI 平台设置', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'AI 平台设置' })).toBeVisible();
  await expect(page.getByText('阿里百炼', { exact: true })).toBeVisible();
  await page.getByLabel('界面语言').click();
  await page.getByTitle('English', { exact: true }).click();
  await expect(page.getByText('Alibaba Cloud Model Studio', { exact: true })).toBeVisible();
  const bailian = page.locator('.ant-card').filter({ hasText: 'Alibaba Cloud Model Studio' });
  await bailian.getByRole('button', { name: 'Configure', exact: true }).click();
  await expect(
    page.getByRole('dialog', { name: 'Configure AI provider · Alibaba Cloud Model Studio' }),
  ).toBeVisible();
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
  await page.getByLabel('Interface language').click();
  await page.getByTitle('简体中文', { exact: true }).click();
  const card = page.locator('.ant-card').filter({ hasText: 'DeepSeek' });
  await card.getByRole('button', { name: /配\s*置/ }).click();
  const modal = page.getByRole('dialog', { name: /配置 AI 平台/ });
  await expect(modal.getByLabel('服务地址')).toHaveValue('https://api.deepseek.com/v1');
  await modal.getByLabel('API Key').fill('browser-test-key');
  await modal.getByRole('switch', { name: '启用平台' }).check();
  await modal.getByRole('button', { name: /保\s*存/ }).click();
  await expect(modal).toHaveCount(0);
  await expect(card.getByText('已配置密钥')).toBeVisible();
  await card.getByRole('button', { name: /配\s*置/ }).click();
  await expect(page.getByLabel('API Key')).toBeEmpty();
  await page
    .getByRole('dialog')
    .getByRole('button', { name: /取\s*消/ })
    .click();
  const member = await browser.newPage();
  await member.goto('/settings/ai');
  await member.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
  await member.getByLabel('密码', { exact: true }).fill('MyTeam-test-only-2026!');
  await member.getByRole('button', { name: '登录工作空间' }).click();
  await expect(member.getByRole('link', { name: '工作台', exact: true })).toBeVisible();
  await member.goto('/settings/ai');
  await expect(member.getByText('此页面仅向系统管理员开放。')).toBeVisible();
  await member.close();
});
