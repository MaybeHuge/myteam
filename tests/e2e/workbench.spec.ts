import { expect, test } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
test('工作台与应用框架：待办状态、筛选刷新、分页、项目切换、错误恢复和会话隔离', async ({
  page,
}) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(10000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      errors.push(message.text());
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Keep fixture assertions stable when other browser scenarios retain their iterations.
  await page.goto('/?wk=ITERATION_FOLLOW_UP&wq=工作台');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  const todo = page.getByRole('region', { name: '我的待办', exact: true });
  // section 的 aria-label 提供 region，所有操作按可见业务名称定位。
  await expect(
    todo.getByRole('link', { name: '跟进迭代 工作台 · 准备本轮计划', exact: true }),
  ).toBeVisible();
  await expect(
    todo.getByRole('link', { name: '跟进迭代 工作台 · 核对逾期目标', exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/workbench-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: 'test-results/workbench-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await todo.getByRole('button', { name: /^已逾期 / }).click();
  await expect(
    todo.getByRole('link', { name: '跟进迭代 工作台 · 完成本轮收尾', exact: true }),
  ).toHaveCount(0);
  await page.getByLabel('搜索待办', { exact: true }).fill('没有这个待办');
  await expect(page.getByText('没有符合条件的待办', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByLabel('搜索待办', { exact: true })).toHaveValue('没有这个待办');
  await expect(todo.getByRole('button', { name: /^已逾期 / })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page.getByRole('button', { name: '清除待办筛选', exact: true }).click();
  await page.goto('/?wp=100000');
  await expect(todo.getByText('当前页已无记录', { exact: true })).toBeVisible();
  await todo.getByRole('button', { name: '返回第一页', exact: true }).click();
  await todo.getByRole('link', { name: '跟进迭代 工作台 · 完成本轮收尾', exact: true }).click();
  const projectId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('dialog', { name: '迭代计划', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '关闭迭代', exact: true }).click();
  await page.getByLabel('迭代总结', { exact: true }).fill('从工作台确认本轮已处理完毕。');
  await page.getByRole('button', { name: '确认关闭迭代', exact: true }).click();
  await expect(page.getByRole('heading', { name: '迭代总结', exact: true })).toBeVisible();
  await page
    .getByRole('dialog', { name: '迭代计划', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '迭代计划', exact: true })).toHaveCount(0);
  await page.getByLabel('搜索迭代', { exact: true }).fill('准备本轮');
  const switcher = page.getByRole('combobox', { name: '切换项目', exact: true });
  await switcher.click();
  await switcher.fill('没有这个项目');
  await expect(page.getByText('没有匹配的项目', { exact: true })).toBeVisible();
  await switcher.fill('品牌官网');
  await page
    .locator('.project-switcher-popup')
    .getByText('品牌官网体验升级', { exact: true })
    .click();
  const inaccessibleProjectId = new URL(page.url()).pathname.split('/').pop()!;
  await expect(page.getByRole('heading', { name: '品牌官网体验升级', exact: true })).toBeVisible();
  await expect(page).toHaveURL(/tab=iterations/);
  expect(new URL(page.url()).searchParams.has('iteration')).toBe(false);
  await expect(page.getByLabel('搜索迭代', { exact: true })).toHaveValue('');
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole('tab', { name: '迭代计划', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await switcher.click();
  await switcher.fill('MyTeam');
  await page
    .locator('.project-switcher-popup')
    .getByText('MyTeam 协作平台', { exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`/projects/${projectId}\\?tab=iterations`));
  await page.getByRole('link', { name: '工作台', exact: true }).click();
  await expect(
    todo.getByRole('link', { name: '跟进迭代 工作台 · 完成本轮收尾', exact: true }),
  ).toHaveCount(0);

  await page.getByRole('link', { name: '项目空间', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill('MyTeam');
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await page
    .locator('main')
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  await expect(page).toHaveURL(/list=/);
  await page.getByRole('tab', { name: /成员与权限/ }).click();
  await page.getByLabel('搜索项目成员', { exact: true }).fill('浏览器测试成员');
  await page.reload();
  await expect(page.getByLabel('搜索项目成员', { exact: true })).toHaveValue('浏览器测试成员');
  await page.getByRole('link', { name: '返回项目空间', exact: true }).click();
  await expect(page.getByLabel('搜索项目', { exact: true })).toHaveValue('MyTeam');
  await expect(page.getByRole('button', { name: '列表视图', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  let fail = true;
  await page.route('**/api/v1/workbench/todos?**', async (route) =>
    fail
      ? route.fulfill({
          status: 503,
          json: {
            code: 'SERVICE_UNAVAILABLE',
            message: '待办暂时不可用，请重试',
            requestId: 'browser-recovery',
          },
        })
      : route.continue(),
  );
  await page.goto('/');
  await expect(page.getByText('暂时无法加载待办', { exact: true })).toBeVisible();
  fail = false;
  await page.getByRole('button', { name: '重试加载待办', exact: true }).click();
  // Recovery returns the current first page, which may contain retained test data.
  await expect(todo.locator('article').first()).toBeVisible();
  await expect(page.getByText('暂时无法加载待办', { exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/workbench/todos?**');
  await page.route('**/api/v1/workbench/todos?**', (route) =>
    route.fulfill({
      status: 401,
      json: { code: 'UNAUTHENTICATED', message: '登录已失效', requestId: 'browser-session' },
    }),
  );
  await page.getByRole('button', { name: '刷新待办', exact: true }).click();
  await expect(page.getByRole('heading', { name: '欢迎回来', exact: true })).toBeVisible();
  await expect(page.getByRole('region', { name: '我的待办', exact: true })).toHaveCount(0);
  await page.unroute('**/api/v1/workbench/todos?**');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-member@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByText('当前没有需要处理的待办', { exact: true })).toBeVisible();
  await expect(
    page.getByRole('link', { name: '跟进迭代 工作台 · 准备本轮计划', exact: true }),
  ).toHaveCount(0);
  await page.goto(`/projects/${inaccessibleProjectId}`);
  await expect(page.getByText('项目暂不可访问', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: '品牌官网体验升级', exact: true })).toHaveCount(0);
  await page.getByRole('combobox', { name: '切换项目', exact: true }).click();
  await page.getByRole('combobox', { name: '切换项目', exact: true }).fill('品牌官网');
  await expect(page.getByText('没有匹配的项目', { exact: true })).toBeVisible();
  await page.goto('/no-such-page');
  await expect(page.getByText('页面不存在', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '返回工作台', exact: true }).click();
  await expect(page.getByText('当前没有需要处理的待办', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});
