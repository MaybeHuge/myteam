import { expect, test } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
test('迭代计划：创建、编辑、启动、关闭检查、总结、刷新上下文与窄屏只读', async ({
  page,
  browser,
}) => {
  test.setTimeout(60000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await page.getByRole('link', { name: '项目空间', exact: true }).click();
  await page
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  await page.getByRole('tab', { name: '迭代计划', exact: true }).click();
  await page.getByRole('button', { name: '查看迭代 交付准备与验收', exact: true }).click();
  await expect(page.getByText('仍有 1 项未完成事项，暂不能关闭')).toBeVisible();
  await page.getByRole('button', { name: '关闭迭代', exact: true }).click();
  await page.getByLabel('迭代总结', { exact: true }).fill('验证服务端关闭门禁');
  await page.getByRole('button', { name: '确认关闭迭代', exact: true }).click();
  await expect(page.getByText('仍有 1 项未完成事项，请先完成或处理后再关闭')).toBeVisible();
  await page
    .getByRole('dialog')
    .filter({ hasText: '关闭本轮迭代' })
    .getByRole('button', { name: /取\s*消/ })
    .click();
  await page
    .getByRole('dialog', { name: '迭代计划', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '迭代计划', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '新建迭代', exact: true }).click();
  const name = `E2E · ${Date.now().toString(36)} 账号体验完善`;
  await page.getByLabel('迭代名称', { exact: true }).fill(name);
  await page
    .getByLabel('迭代目标', { exact: true })
    .fill('完善账号与项目协作体验，明确本轮交付范围。');
  await page.getByLabel('开始日期', { exact: true }).fill('2026-11-01');
  await page.getByLabel('结束日期', { exact: true }).fill('2026-10-31');
  await page.getByRole('button', { name: '创建迭代', exact: true }).click();
  await expect(page.getByText('结束日期不能早于开始日期', { exact: true })).toBeVisible();
  await page.getByLabel('结束日期', { exact: true }).fill('2026-11-14');
  await page.getByRole('button', { name: '创建迭代', exact: true }).click();
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=iterations.*iteration=/);
  const detailUrl = page.url();
  await page.reload();
  await expect(page.getByRole('dialog').getByRole('heading', { name, exact: true })).toBeVisible();
  await page.getByRole('button', { name: '编辑迭代', exact: true }).click();
  await page.getByLabel('迭代目标', { exact: true }).fill('调整目标：完成可回溯的协作计划。');
  await page.getByRole('button', { name: '保存迭代', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('调整目标：完成可回溯的协作计划。', { exact: true }),
  ).toBeVisible();
  await page.getByRole('button', { name: '启动迭代', exact: true }).click();
  await page.getByRole('button', { name: '确认启动迭代', exact: true }).click();
  await expect(page.getByRole('button', { name: '关闭迭代', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/iteration-detail.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '关闭迭代', exact: true }).click();
  await page.getByLabel('迭代总结', { exact: true }).fill('本轮没有遗留事项，计划记录已核对。');
  await page.getByRole('button', { name: '确认关闭迭代', exact: true }).click();
  await expect(page.getByRole('heading', { name: '迭代总结', exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: '编辑迭代', exact: true })).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '迭代计划', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '迭代计划', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索迭代', { exact: true }).fill(name);
  await expect(page.getByRole('button', { name: `查看迭代 ${name}`, exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('搜索迭代', { exact: true })).toHaveValue(name);
  await page.getByLabel('搜索迭代', { exact: true }).fill('没有这个迭代');
  await expect(page.getByText('没有符合条件的迭代', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '清除迭代筛选', exact: true }).click();
  await page.screenshot({
    path: 'test-results/iterations-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({
    path: 'test-results/iterations-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  const context = await browser.newContext();
  const viewer = await context.newPage();
  await viewer.goto(detailUrl);
  await viewer.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
  await viewer.getByLabel('密码', { exact: true }).fill(password);
  await viewer.getByRole('button', { name: '登录工作空间' }).click();
  await expect(
    viewer.getByRole('dialog').getByRole('heading', { name, exact: true }),
  ).toBeVisible();
  await expect(viewer.getByRole('button', { name: '编辑迭代', exact: true })).toHaveCount(0);
  await viewer
    .getByRole('dialog', { name: '迭代计划', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(viewer.getByRole('button', { name: '新建迭代', exact: true })).toHaveCount(0);
  await context.close();
  expect(errors).toEqual([]);
});
