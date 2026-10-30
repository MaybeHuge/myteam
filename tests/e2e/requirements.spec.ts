import { expect, test, type Page } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
async function login(page: Page, email: string, url = '/') {
  await page.goto(url);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
}
test('需求：不完整草稿、指定评审、退回修改、重新提交、快照、确认与只读访问', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page, 'browser-admin@example.test');
  await page.getByRole('link', { name: '项目空间', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill('VTEAM');
  await page
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  await page.getByRole('tab', { name: '需求管理', exact: true }).click();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const title = `E2E需求 · ${Date.now().toString(36)} 客户资料搜索`;
  await page.getByLabel('需求标题', { exact: true }).fill(title);
  await page.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=requirements.*requirement=/);
  const detailUrl = page.url();
  async function send() {
    await page.getByRole('button', { name: '提交评审', exact: true }).click();
    const modal = page.getByRole('dialog', { name: '提交评审', exact: true });
    await modal.getByLabel('指定评审人', { exact: true }).click();
    await page
      .locator('.ant-select-dropdown:visible .ant-select-item-option')
      .filter({ hasText: '林悦' })
      .click();
    await modal.getByRole('button', { name: '提交评审', exact: true }).click();
  }
  await send();
  await expect(
    page.getByText('请先补齐需求描述、负责人和可判断的验收标准', { exact: true }),
  ).toBeVisible();
  await page
    .getByRole('dialog', { name: '提交评审', exact: true })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await page.getByRole('button', { name: '编辑需求', exact: true }).click();
  await page.getByLabel('需求描述', { exact: true }).fill('项目成员可以按名称搜索客户资料。');
  await page.getByLabel('验收标准', { exact: true }).fill('原始标准：输入名称显示匹配资料。');
  await page.getByRole('button', { name: '保存需求', exact: true }).click();
  await expect(page.getByText('原始标准：输入名称显示匹配资料。', { exact: true })).toBeVisible();
  await send();
  await expect(page.getByRole('dialog', { name: '提交评审', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: '编辑需求', exact: true })).toHaveCount(0);
  const reviewContext = await browser.newContext();
  const reviewer = await reviewContext.newPage();
  await login(reviewer, 'browser-product@example.test', detailUrl);
  await expect(reviewer.getByRole('button', { name: '确认需求', exact: true })).toBeVisible();
  await reviewer.getByRole('button', { name: '退回修改', exact: true }).click();
  await reviewer
    .getByRole('dialog', { name: '退回修改', exact: true })
    .getByLabel('原因 / 评审意见', { exact: true })
    .fill('补充权限边界和无结果时的提示。');
  await reviewer
    .getByRole('dialog', { name: '退回修改', exact: true })
    .getByRole('button', { name: '退回修改', exact: true })
    .click();
  await expect(reviewer.getByRole('dialog', { name: '退回修改', exact: true })).toHaveCount(0);
  await page.reload();
  await page.getByRole('button', { name: '编辑需求', exact: true }).click();
  await page
    .getByLabel('验收标准', { exact: true })
    .fill('修订标准：仅显示授权资料；无结果显示空态提示。');
  await page.getByRole('button', { name: '保存需求', exact: true }).click();
  await expect(
    page.getByText('修订标准：仅显示授权资料；无结果显示空态提示。', { exact: true }),
  ).toBeVisible();
  await send();
  await expect(page.getByRole('dialog', { name: '提交评审', exact: true })).toHaveCount(0);
  await reviewer.reload();
  await reviewer.getByRole('button', { name: '确认需求', exact: true }).click();
  await reviewer
    .getByRole('dialog', { name: '确认需求', exact: true })
    .getByRole('button', { name: '确认需求', exact: true })
    .click();
  await expect(reviewer.getByText('需求已确认，评审基线已保留', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('button', { name: '编辑需求', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '评审历史 (4)', exact: true }).click();
  await expect(page.getByText('补充权限边界和无结果时的提示。', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: '版本 2' }).first().click();
  await expect(
    page.locator('details[open]').getByText('原始标准：输入名称显示匹配资料。', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/requirement-review-history.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: '讨论与附件', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: '评论内容', exact: true })).toBeVisible();
  const viewerContext = await browser.newContext();
  const viewer = await viewerContext.newPage();
  await login(viewer, 'browser-member@example.test', detailUrl);
  await expect(viewer.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: '确认需求', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: '编辑需求', exact: true })).toHaveCount(0);
  await viewer
    .getByRole('dialog', { name: '需求详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(viewer.getByRole('button', { name: '新建需求', exact: true })).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '需求详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await page.getByRole('textbox', { name: '搜索需求', exact: true }).fill(title);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.reload();
  await expect(page.getByRole('textbox', { name: '搜索需求', exact: true })).toHaveValue(title);
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/requirements-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/requirements-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await reviewContext.close();
  await viewerContext.close();
  expect(errors).toEqual([]);
});
