import { expect, test, type Page } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
async function login(page: Page, email: string, url = '/') {
  await page.goto(url);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
}
async function pick(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: text })
    .click();
}
test('任务拆解：需求下建任务、认领、估算、开始条件、改派、历史及只读隔离', async ({
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
  await page
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  await page.getByRole('tab', { name: '需求管理', exact: true }).click();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  const stamp = Date.now().toString(36),
    reqTitle = `E2E需求 · ${stamp} 任务拆解依据`;
  await page.getByLabel('需求标题', { exact: true }).fill(reqTitle);
  await page.getByLabel('需求描述', { exact: true }).fill('成员可以搜索当前有权访问的客户资料。');
  await page.getByLabel('验收标准', { exact: true }).fill('仅返回授权资料，无权限返回明确提示。');
  await page.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: reqTitle, exact: true })).toBeVisible();
  const requirementUrl = page.url();
  await page.getByRole('button', { name: '拆分任务', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '拆分新任务', exact: true })).toBeVisible();
  const title = `E2E任务 · ${stamp} 搜索权限校验`;
  await page.getByLabel('任务标题', { exact: true }).fill(title);
  await page
    .getByRole('textbox', { name: '任务说明', exact: true })
    .fill('实现服务端授权查询，补齐异常场景。');
  await page.getByLabel('估算工时（小时）', { exact: true }).fill('2.25');
  await page.getByLabel('截止日期', { exact: true }).fill('2026-11-10');
  await page.getByRole('button', { name: '创建任务', exact: true }).click();
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(page.getByRole('dialog', { name: '拆分新任务', exact: true })).toHaveCount(0);
  await expect(page).toHaveURL(/tab=tasks.*task=/);
  const taskUrl = page.url();
  await expect(page.getByRole('button', { name: '开始任务', exact: true })).toHaveCount(0);
  const developerContext = await browser.newContext(),
    developer = await developerContext.newPage();
  await login(developer, 'browser-collaborator@example.test', taskUrl);
  await developer.getByRole('button', { name: '认领任务', exact: true }).click();
  const claim = developer.getByRole('dialog', { name: '认领任务', exact: true });
  await claim.getByLabel('分配 / 认领原因', { exact: true }).fill('负责本轮搜索接口实现');
  await claim.getByRole('button', { name: '认领任务', exact: true }).click();
  await expect(claim).toHaveCount(0);
  await expect(developer.getByRole('button', { name: '编辑任务', exact: true })).toBeVisible();
  await expect(developer.getByRole('button', { name: '开始任务', exact: true })).toHaveCount(0);
  // 服务端也不能越过需求确认门禁。
  const currentSession = await (await developer.request.get('/api/v1/auth/me')).json(),
    taskId = new URL(taskUrl).searchParams.get('task')!,
    projectId = new URL(taskUrl).pathname.split('/').at(-1)!;
  const currentTask = await (
    await developer.request.get(`/api/v1/projects/${projectId}/tasks/${taskId}`)
  ).json();
  const rejected = await developer.request.post(
    `/api/v1/projects/${projectId}/tasks/${taskId}/start`,
    {
      headers: {
        Origin: 'http://localhost:5174',
        'X-CSRF-Token': currentSession.csrfToken,
        'Idempotency-Key': crypto.randomUUID(),
      },
      data: { version: currentTask.version },
    },
  );
  expect(rejected.status()).toBe(422);
  await page.goto(requirementUrl);
  await page.getByRole('button', { name: '提交评审', exact: true }).click();
  const review = page.getByRole('dialog', { name: '提交评审', exact: true });
  await pick(page, '指定评审人', '浏览器测试管理员');
  await review.getByRole('button', { name: '提交评审', exact: true }).click();
  await expect(review).toHaveCount(0);
  await page.getByRole('button', { name: '确认需求', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认需求', exact: true })
    .getByRole('button', { name: '确认需求', exact: true })
    .click();
  await expect(page.getByText('需求已确认，评审基线已保留', { exact: true })).toBeVisible();
  await developer.reload();
  await developer.getByRole('button', { name: '开始任务', exact: true }).click();
  await developer
    .getByRole('dialog', { name: '开始任务', exact: true })
    .getByRole('button', { name: '开始任务', exact: true })
    .click();
  await expect(developer.getByRole('dialog', { name: '开始任务', exact: true })).toHaveCount(0);
  await expect(
    developer
      .getByRole('dialog', { name: '任务详情', exact: true })
      .getByText('实现中', { exact: true }),
  ).toBeVisible();
  await developer.getByRole('button', { name: '编辑任务', exact: true }).click();
  await developer
    .getByRole('textbox', { name: '任务说明', exact: true })
    .fill('本人开始后补充自测安排。');
  await developer.getByRole('button', { name: '保存任务', exact: true }).click();
  await expect(developer.getByText('本人开始后补充自测安排。', { exact: true })).toBeVisible();
  await expect(developer.getByRole('button', { name: '分配任务', exact: true })).toHaveCount(0);
  await page.goto(taskUrl);
  await page.getByRole('button', { name: '分配任务', exact: true }).click();
  const assignment = page.getByRole('dialog', { name: '分配任务', exact: true });
  await pick(page, '任务负责人', '浏览器测试管理员');
  await assignment.getByLabel('分配 / 认领原因', { exact: true }).fill('交接后由负责人继续推进');
  await assignment.getByRole('button', { name: '分配任务', exact: true }).click();
  await expect(assignment).toHaveCount(0);
  await developer.reload();
  await expect(developer.getByRole('button', { name: '编辑任务', exact: true })).toHaveCount(0);
  await page.getByRole('tab', { name: '任务历史 (5)', exact: true }).click();
  await expect(
    page
      .getByRole('tabpanel', { name: '任务历史 (5)', exact: true })
      .getByText('交接后由负责人继续推进', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('负责人：陈青 → 浏览器测试管理员', { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/task-history.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('tab', { name: '讨论与附件', exact: true }).last().click();
  await expect(page.getByRole('textbox', { name: '评论内容', exact: true })).toBeVisible();
  const viewerContext = await browser.newContext(),
    viewer = await viewerContext.newPage();
  await login(viewer, 'browser-member@example.test', taskUrl);
  await expect(viewer.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: '编辑任务', exact: true })).toHaveCount(0);
  await expect(viewer.getByRole('button', { name: '分配任务', exact: true })).toHaveCount(0);
  await viewer
    .getByRole('dialog', { name: '任务详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(viewer.getByRole('button', { name: '新建任务', exact: true })).toHaveCount(0);
  await page
    .getByRole('dialog', { name: '任务详情', exact: true })
    .getByRole('button', { name: '关闭', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '任务详情', exact: true })).toHaveCount(0);
  await expect(page).not.toHaveURL(/[?&]task=/);
  await page.getByRole('searchbox', { name: '搜索任务', exact: true }).fill(title);
  await expect(page.getByRole('button', { name: title, exact: true })).toBeVisible();
  await expect(page).toHaveURL(/[?&]tq=/);
  await page.reload();
  await expect(page.getByRole('dialog', { name: '任务详情', exact: true })).toHaveCount(0);
  await expect(page.getByRole('searchbox', { name: '搜索任务', exact: true })).toHaveValue(title);
  await page.screenshot({
    path: 'test-results/tasks-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'test-results/tasks-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await developerContext.close();
  await viewerContext.close();
  expect(errors).toEqual([]);
});
