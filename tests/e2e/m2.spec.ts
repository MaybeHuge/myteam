import { expect, test, type Page } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
async function login(page: Page, email = 'browser-admin@example.test', url = '/') {
  await page.goto(url);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('button', { name: '退出登录' })).toBeVisible();
}
async function pick(page: Page, label: string, text: string) {
  await page.getByLabel(label, { exact: true }).click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: text })
    .click();
}
async function workspace(page: Page) {
  await page.getByRole('link', { name: '项目空间', exact: true }).click();
  await page
    .getByRole('link', { name: /MyTeam 协作平台/ })
    .first()
    .click();
  return new URL(page.url()).pathname.split('/').at(-1)!;
}
async function post(page: Page, path: string, data: unknown) {
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
function errors(page: Page) {
  const list: string[] = [];
  page.on('pageerror', (error) => list.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
      list.push(message.text());
  });
  return list;
}
test('M2 阶段退出：需求评审、拆分两任务、看板拖动失败恢复、阻塞协助、恢复完成与当前工作台', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  const runtime = errors(page);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await login(page);
  const projectId = await workspace(page),
    marker = Date.now().toString(36),
    reqTitle = `E2E需求 · ${marker} M2阶段交付`;
  await page.getByRole('tab', { name: '需求管理', exact: true }).click();
  await page.getByRole('button', { name: '新建需求', exact: true }).click();
  await page.getByLabel('需求标题', { exact: true }).fill(reqTitle);
  await page.getByLabel('需求描述', { exact: true }).fill('完成团队任务与业务边界核对。');
  await page.getByLabel('验收标准', { exact: true }).fill('授权任务可开始，阻塞与恢复保留历史。');
  await page.getByRole('button', { name: '创建需求', exact: true }).click();
  await expect(page.getByRole('heading', { name: reqTitle, exact: true })).toBeVisible();
  const reqUrl = page.url();
  await page.getByRole('button', { name: '提交评审', exact: true }).click();
  await pick(page, '指定评审人', '浏览器测试管理员');
  await page
    .getByRole('dialog', { name: '提交评审', exact: true })
    .getByRole('button', { name: '提交评审', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '提交评审', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '确认需求', exact: true }).click();
  await page
    .getByRole('dialog', { name: '确认需求', exact: true })
    .getByRole('button', { name: '确认需求', exact: true })
    .click();
  await expect(page.getByText('需求已确认，评审基线已保留', { exact: true })).toBeVisible();
  const titles = [`E2E任务 · ${marker} 核心实现`, `E2E任务 · ${marker} 重复范围`];
  const taskIds: string[] = [];
  for (const title of titles) {
    await page.goto(reqUrl);
    await page.getByRole('button', { name: '拆分任务', exact: true }).click();
    await page.getByLabel('任务标题', { exact: true }).fill(title);
    await pick(page, '任务负责人', '浏览器测试管理员');
    await page.getByRole('button', { name: '创建任务', exact: true }).click();
    await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(page).toHaveURL(/[?&]task=/);
    taskIds.push(new URL(page.url()).searchParams.get('task')!);
  }
  const boardUrl = `/projects/${projectId}?tab=tasks&tv=board&tq=${encodeURIComponent(marker)}`;
  await page.goto(boardUrl);
  const board = page.getByRole('region', { name: '任务看板', exact: true }),
    todo = board.getByRole('region', { name: '待开始列', exact: true }),
    progress = board.getByRole('region', { name: '进行中列', exact: true }),
    completed = board.getByRole('region', { name: '完成列', exact: true });
  const card = () => board.getByRole('article', { name: `任务卡片 ${titles[0]}`, exact: true });
  await card().dragTo(progress);
  const startDialog = page.getByRole('dialog', { name: '开始任务', exact: true });
  await expect(startDialog).toBeVisible();
  const current = await (
    await page.request.get(`/api/v1/projects/${projectId}/tasks/${taskIds[0]}`)
  ).json();
  await post(page, `/projects/${projectId}/tasks/${taskIds[0]}/update`, {
    title: current.title,
    description: '并发补充任务说明',
    priority: current.priority,
    estimatedHours: current.estimatedHours,
    dueDate: current.dueDate,
    iterationId: current.iteration?.id ?? null,
    version: current.version,
  });
  await startDialog.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(startDialog.getByText('任务已被更新，请刷新后重试', { exact: true })).toBeVisible();
  await startDialog.getByRole('button', { name: /取\s*消/ }).click();
  await expect(todo.getByRole('button', { name: titles[0], exact: true })).toBeVisible();
  await card().dragTo(progress);
  await page
    .getByRole('dialog', { name: '开始任务', exact: true })
    .getByRole('button', { name: '开始任务', exact: true })
    .click();
  await expect(progress.getByRole('button', { name: titles[0], exact: true })).toBeVisible();
  await card().dragTo(todo);
  const reset = page.getByRole('dialog', { name: '退回待开始', exact: true });
  await expect(reset).toBeVisible();
  await reset.getByRole('button', { name: /取\s*消/ }).click();
  await expect(progress.getByRole('button', { name: titles[0], exact: true })).toBeVisible();
  await card().getByRole('button', { name: titles[0], exact: true }).click();
  await page.getByRole('button', { name: '标记阻塞', exact: true }).click();
  const blocked = page.getByRole('dialog', { name: '标记阻塞', exact: true });
  await pick(page, '协助人', '林悦');
  await blocked.getByLabel('阻塞原因', { exact: true }).fill('等待业务边界核对');
  await blocked.getByRole('button', { name: '标记阻塞', exact: true }).click();
  await expect(blocked).toHaveCount(0);
  await expect(page.getByText('阻塞 · 协助人：林悦', { exact: true })).toBeVisible();
  const helperContext = await browser.newContext(),
    helper = await helperContext.newPage();
  await login(helper, 'browser-product@example.test', '/?wk=TASK_ASSIST');
  await expect(
    helper.getByRole('link', { name: `协助任务 ${titles[0]}`, exact: true }),
  ).toBeVisible();
  await helper.getByRole('link', { name: `协助任务 ${titles[0]}`, exact: true }).click();
  await expect(helper.getByRole('button', { name: '恢复任务', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  const resume = page.getByRole('dialog', { name: '恢复任务', exact: true });
  await resume.getByLabel('恢复说明', { exact: true }).fill('业务边界已确认，继续实现');
  await resume.getByRole('button', { name: '恢复任务', exact: true }).click();
  await expect(resume).toHaveCount(0);
  await expect(page.getByText('阻塞 · 协助人：林悦', { exact: true })).toHaveCount(0);
  await helper.goto('/?wk=TASK_ASSIST');
  await expect(
    helper.getByRole('link', { name: `协助任务 ${titles[0]}`, exact: true }),
  ).toHaveCount(0);
  await page.goto(boardUrl);
  const duplicateCard = board.getByRole('article', {
    name: `任务卡片 ${titles[1]}`,
    exact: true,
  });
  await duplicateCard.dragTo(progress);
  const startSecond = page.getByRole('dialog', { name: '开始任务', exact: true });
  await startSecond.getByRole('button', { name: '开始任务', exact: true }).click();
  await expect(startSecond).toHaveCount(0);
  await duplicateCard.dragTo(completed);
  const finish = page.getByRole('dialog', { name: '完成任务', exact: true });
  await finish.getByLabel('完成说明', { exact: true }).fill('开发实现完成');
  await finish.getByRole('button', { name: '完成任务', exact: true }).click();
  await expect(completed.getByRole('button', { name: titles[1], exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/m2-board-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'test-results/m2-board-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(`/?wk=TASK&wq=${encodeURIComponent(marker)}`);
  await expect(
    page.getByRole('link', { name: `处理任务 ${titles[0]}`, exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('link', { name: `处理任务 ${titles[1]}`, exact: true })).toHaveCount(
    0,
  );
  await page.screenshot({
    path: 'test-results/m2-workbench-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await helperContext.close();
  expect(runtime).toEqual([]);
});
test('需求新修订：旧快照及影响追溯、待评审工作台、重新确认与任务影响核对后恢复', async ({
  page,
  browser,
}) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  const runtime = errors(page);
  await login(page);
  const projectId = await workspace(page),
    marker = Date.now().toString(36),
    auth = await (await page.request.get('/api/v1/auth/me')).json(),
    root = `/projects/${projectId}`;
  const reqId = (
    await post(page, `${root}/requirements`, {
      title: `E2E需求 · ${marker} 修订范围`,
      description: '原需求范围',
      acceptanceCriteria: '原标准：按名称返回授权客户',
      ownerId: auth.user.id,
    })
  ).id;
  await post(page, `${root}/requirements/${reqId}/submit`, {
    version: 1,
    reviewerId: auth.user.id,
  });
  await post(page, `${root}/requirements/${reqId}/approve`, { version: 2 });
  const taskId = (
    await post(page, `${root}/tasks`, {
      title: `E2E任务 · ${marker} 修订核对`,
      requirementId: reqId,
      assigneeId: auth.user.id,
    })
  ).id;
  await post(page, `${root}/tasks/${taskId}/start`, { version: 1 });
  const taskUrl = `${root}?tab=tasks&task=${taskId}`;
  await page.goto(taskUrl);
  await page.getByRole('button', { name: '标记阻塞', exact: true }).click();
  await pick(page, '协助人', '林悦');
  await page.getByLabel('阻塞原因', { exact: true }).fill('等待业务确认');
  await page
    .getByRole('dialog', { name: '标记阻塞', exact: true })
    .getByRole('button', { name: '标记阻塞', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '标记阻塞', exact: true })).toHaveCount(0);
  const reqUrl = `${root}?tab=requirements&requirement=${reqId}`;
  await page.goto(reqUrl);
  await page.getByRole('button', { name: '修订需求', exact: true }).click();
  const revision = page.getByRole('dialog', { name: '修订需求', exact: true });
  await revision.getByLabel('修订原因', { exact: true }).fill('补充异常与权限边界');
  await revision
    .getByLabel('影响范围与处理安排', { exact: true })
    .fill('开发补齐异常分支；测试复审用例，并重新建立验收和发布依据。');
  await revision
    .getByLabel('验收标准', { exact: true })
    .fill('新标准：授权客户可查，无权限明确拒绝，无结果显示空态。');
  await revision.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(revision).toHaveCount(0);
  await page.getByRole('tab', { name: '修订与影响 (1)', exact: true }).click();
  await expect(page.getByText('补充异常与权限边界', { exact: true })).toBeVisible();
  await page.locator('summary').filter({ hasText: '查看修订前后快照' }).click();
  await expect(
    page.locator('details[open]').getByText('原标准：按名称返回授权客户', { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: 'test-results/m2-revision-impact.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.goto(taskUrl);
  await expect(
    page.getByText('需求已发生修订，请等待重新确认并核对任务影响', { exact: true }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: '恢复任务', exact: true })).toHaveCount(0);
  await page.goto(reqUrl);
  await page.getByRole('button', { name: '提交评审', exact: true }).click();
  await pick(page, '指定评审人', '林悦');
  await page
    .getByRole('dialog', { name: '提交评审', exact: true })
    .getByRole('button', { name: '提交评审', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '提交评审', exact: true })).toHaveCount(0);
  const reviewContext = await browser.newContext(),
    reviewer = await reviewContext.newPage();
  await login(reviewer, 'browser-product@example.test', '/?wk=REQUIREMENT_REVIEW');
  await reviewer
    .getByRole('link', { name: `评审需求 E2E需求 · ${marker} 修订范围`, exact: true })
    .click();
  await reviewer.getByRole('button', { name: '确认需求', exact: true }).click();
  await reviewer
    .getByRole('dialog', { name: '确认需求', exact: true })
    .getByRole('button', { name: '确认需求', exact: true })
    .click();
  await expect(reviewer.getByRole('dialog', { name: '确认需求', exact: true })).toHaveCount(0);
  await page.goto(taskUrl);
  await page.getByRole('button', { name: '核对需求变更', exact: true }).click();
  const ack = page.getByRole('dialog', { name: '核对需求变更', exact: true });
  await ack.getByLabel('核对说明', { exact: true }).fill('已对照新标准安排异常分支实现');
  await ack.getByRole('button', { name: '核对需求变更', exact: true }).click();
  await expect(ack).toHaveCount(0);
  await page.getByRole('button', { name: '恢复任务', exact: true }).click();
  await page.getByLabel('恢复说明', { exact: true }).fill('新基线已核对，继续实现');
  await page
    .getByRole('dialog', { name: '恢复任务', exact: true })
    .getByRole('button', { name: '恢复任务', exact: true })
    .click();
  await expect(page.getByRole('dialog', { name: '恢复任务', exact: true })).toHaveCount(0);
  await expect(
    page.getByText('需求已发生修订，请等待重新确认并核对任务影响', { exact: true }),
  ).toHaveCount(0);
  await page.goto(reqUrl);
  const taskTab = page.getByRole('tab', { name: '关联任务 (1)', exact: true });
  await taskTab.click();
  await expect(taskTab).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.getByText('待开始 0 · 进行中 1 · 完成 0 · 阻塞 0', {
      exact: true,
    }),
  ).toBeVisible();
  await reviewer.goto('/?wk=REQUIREMENT_REVIEW');
  await expect(
    reviewer.getByRole('link', { name: `评审需求 E2E需求 · ${marker} 修订范围`, exact: true }),
  ).toHaveCount(0);
  await reviewContext.close();
  expect(runtime).toEqual([]);
});
