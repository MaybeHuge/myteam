import { expect, test, type Page, type Locator } from '@playwright/test';
const password = 'MyTeam-test-only-2026!';
async function login(page: Page, email: string, url = '/') {
  await page.goto(url);
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByLabel('邮箱', { exact: true })).toHaveCount(0);
}
async function command(page: Page, path: string, input: unknown) {
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const response = await page.request.post(`/api/v1${path}`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: input,
  });
  expect(response.status(), await response.text()).toBe(201);
  return response.json();
}
async function setup(page: Page) {
  await login(page, 'browser-admin@example.test');
  const projects = await (await page.request.get('/api/v1/projects?q=VTEAM')).json();
  const project = projects.items.find((p: { key: string }) => p.key === 'VTEAM');
  expect(project).toBeTruthy();
  const session = await (await page.request.get('/api/v1/auth/me')).json();
  const path = `/projects/${project.id}/requirements`;
  const data = {
    title: `E2E需求 · ${Date.now().toString(36)} 手机号登录`,
    description: '验证码仅限本人使用一次',
    acceptanceCriteria: '正常、错误、过期及重复使用验证码均有明确结果',
    ownerId: session.user.id,
  };
  const requirement = await command(page, path, data);
  await command(page, `${path}/${requirement.id}/submit`, {
    version: 1,
    reviewerId: session.user.id,
  });
  await command(page, `${path}/${requirement.id}/approve`, { version: 2 });
  return {
    projectId: project.id as string,
    requirementId: requirement.id as string,
    adminId: session.user.id as string,
  };
}
async function option(page: Page, field: Locator, text: string) {
  await field.click();
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: text })
    .click();
}
async function send(page: Page) {
  await page.getByRole('button', { name: '提交用例评审', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '提交用例评审', exact: true });
  await option(page, modal.getByLabel('用例评审人', { exact: true }), '浏览器测试管理员');
  await expect(
    modal.getByText('浏览器测试管理员', { exact: true }).filter({ visible: true }),
  ).toBeVisible();
  await expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);
  await modal.getByRole('button', { name: '提交用例评审', exact: true }).click();
}
async function decide(
  page: Page,
  url: string,
  action: '退回用例' | '通过用例评审',
  comment?: string,
) {
  await page.goto(url);
  await page.getByRole('button', { name: action, exact: true }).click();
  const modal = page.getByRole('dialog', { name: action, exact: true });
  if (comment) await modal.getByLabel('处理原因', { exact: true }).fill(comment);
  await modal.getByRole('button', { name: action, exact: true }).click();
  await expect(modal).toHaveCount(0);
}
function watch(page: Page, errors: string[]) {
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => {
    if (m.type() === 'error' && !m.text().startsWith('Failed to load resource:'))
      errors.push(m.text());
  });
}
test('用例库：从需求创建、草稿完整性、步骤排序、指定评审退回、重新通过、修订保留与废弃', async ({
  page,
  browser,
}) => {
  test.setTimeout(150000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  watch(page, errors);
  const { projectId, requirementId } = await setup(page);
  const reqUrl = `/projects/${projectId}?tab=requirements&requirement=${requirementId}`;
  const testerContext = await browser.newContext(),
    tester = await testerContext.newPage();
  watch(tester, errors);
  tester.setDefaultTimeout(12000);
  await tester.setViewportSize({ width: 1440, height: 1000 });
  try {
    await login(tester, 'browser-tester@example.test', reqUrl);
    await tester.getByRole('button', { name: '为此需求创建用例', exact: true }).click();
    const title = `E2E用例 · ${Date.now().toString(36)} 正常验证码登录`;
    await tester.getByLabel('用例标题', { exact: true }).fill(title);
    await expect(tester.getByLabel('关联需求', { exact: true })).toBeVisible();
    await tester.getByRole('button', { name: '创建用例', exact: true }).click();
    await expect(tester.getByRole('heading', { name: title, exact: true })).toBeVisible();
    await expect(tester).toHaveURL(/case=/);
    const caseUrl = tester.url();
    await send(tester);
    await expect(
      tester.getByText('送审和通过前须补齐负责人、至少一个步骤及每步预期', { exact: true }),
    ).toBeVisible();
    await tester
      .getByRole('dialog', { name: '提交用例评审', exact: true })
      .getByRole('button', { name: /取\s*消/ })
      .click();
    await tester.getByRole('button', { name: '编辑用例', exact: true }).click();
    await tester.getByLabel('前置条件', { exact: true }).fill('账号已注册且验证码有效');
    for (const [index, action, expected] of [
      [1, '输入手机号', '允许输入验证码'],
      [2, '提交验证码', '进入工作台'],
    ] as const) {
      await tester.getByRole('button', { name: '添加步骤', exact: true }).click();
      await tester.getByLabel(`步骤 ${index} 操作`, { exact: true }).fill(action);
      await tester.getByLabel(`步骤 ${index} 预期`, { exact: true }).fill(expected);
    }
    await tester.getByRole('button', { name: '上移步骤 2', exact: true }).click();
    await expect(tester.getByLabel('步骤 1 操作', { exact: true })).toHaveValue('提交验证码');
    await tester.getByRole('button', { name: '下移步骤 1', exact: true }).click();
    await expect(tester.getByLabel('步骤 1 操作', { exact: true })).toHaveValue('输入手机号');
    await tester.getByRole('button', { name: '添加步骤', exact: true }).click();
    await tester.getByRole('button', { name: '删除步骤 3', exact: true }).click();
    await tester.getByRole('button', { name: '保存用例', exact: true }).click();
    await expect(tester.getByText('进入工作台', { exact: true })).toBeVisible();
    await send(tester);
    await expect(tester.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
    await decide(page, caseUrl, '退回用例', '补充会话状态判断');
    await tester.reload();
    await tester.getByRole('button', { name: '编辑用例', exact: true }).click();
    await tester.getByLabel('步骤 2 预期', { exact: true }).fill('进入工作台并建立会话');
    await tester.getByRole('button', { name: '保存用例', exact: true }).click();
    await expect(tester.getByText('进入工作台并建立会话', { exact: true })).toBeVisible();
    await send(tester);
    await expect(tester.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
    await decide(page, caseUrl, '通过用例评审');
    await tester.reload();
    await expect(tester.getByText('是 · 修订 3', { exact: true })).toBeVisible();
    await expect(tester.locator('.ant-drawer-content-wrapper')).toHaveCSS('transform', 'none');
    await tester.screenshot({ path: 'test-results/m3-case-desktop.png', fullPage: true });
    await tester.getByRole('button', { name: '修订用例', exact: true }).click();
    await tester.getByLabel('用例修订原因', { exact: true }).fill('补充重复登录结果');
    await tester.getByLabel('步骤 2 预期', { exact: true }).fill('进入工作台并拒绝重复使用验证码');
    await tester.getByRole('button', { name: '保存用例修订', exact: true }).click();
    await expect(tester.getByText('否，须完成当前修订评审', { exact: true })).toBeVisible();
    await tester.getByRole('tab', { name: '修订历史 (4)', exact: true }).click();
    const revision = tester.locator('article').filter({ hasText: '修订 3 ·' });
    await revision.getByText('查看此修订内容', { exact: true }).click();
    await expect(revision.getByText('进入工作台并建立会话', { exact: true })).toBeVisible();
    await tester.getByRole('button', { name: '废弃用例', exact: true }).click();
    const modal = tester.getByRole('dialog', { name: '废弃用例', exact: true });
    await modal.getByLabel('处理原因', { exact: true }).fill('场景合并到新用例');
    await modal.getByRole('button', { name: '废弃用例', exact: true }).click();
    await expect(modal).toHaveCount(0);
    await expect(tester.getByRole('button', { name: '提交用例评审', exact: true })).toHaveCount(0);
    await expect(tester.getByText('废弃原因：场景合并到新用例', { exact: true })).toBeVisible();
    await tester.setViewportSize({ width: 390, height: 844 });
    expect(await tester.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await tester
      .getByRole('dialog', { name: '用例详情', exact: true })
      .getByRole('button', { name: '关闭', exact: true })
      .click();
    await tester.getByRole('textbox', { name: '搜索用例', exact: true }).fill(title);
    await tester.getByRole('button', { name: '搜索用例列表', exact: true }).click();
    await expect(tester).toHaveURL(/cq=/);
    await tester.reload();
    await expect(tester.getByRole('button', { name: title, exact: true })).toBeVisible();
    expect(await tester.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await tester.screenshot({ path: 'test-results/m3-cases-mobile.png', fullPage: true });
    const viewerContext = await browser.newContext(),
      viewer = await viewerContext.newPage();
    try {
      await login(viewer, 'browser-member@example.test', caseUrl);
      await expect(viewer.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await expect(viewer.getByRole('button', { name: '编辑用例', exact: true })).toHaveCount(0);
      await expect(viewer.getByRole('button', { name: '新建用例', exact: true })).toHaveCount(0);
    } finally {
      await viewerContext.close();
    }
    expect(errors).toEqual([]);
  } finally {
    await testerContext.close();
  }
});

test('需求修订：原可用用例立即不可用，需求重新确认后仍需建立新修订并重新评审', async ({ page }) => {
  test.setTimeout(90000);
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  watch(page, errors);
  const { projectId, requirementId, adminId } = await setup(page),
    path = `/projects/${projectId}/test-cases`;
  const title = `E2E用例 · ${Date.now().toString(36)} 验证码过期与复用`;
  const data = {
    title,
    requirementIds: [requirementId],
    ownerId: adminId,
    steps: [{ action: '输入过期或已使用的验证码', expected: '提示验证码无效' }],
  };
  const item = await command(page, path, data);
  await command(page, `${path}/${item.id}/submit`, { version: 1, reviewerId: adminId });
  await command(page, `${path}/${item.id}/approve`, { version: 2 });
  const reqPath = `/projects/${projectId}/requirements/${requirementId}`;
  await page.goto(`/projects/${projectId}?tab=requirements&requirement=${requirementId}`);
  await page.getByRole('button', { name: '修订需求', exact: true }).click();
  await page.getByLabel('修订原因', { exact: true }).fill('增加验证码有效期边界');
  await page.getByLabel('影响范围与处理安排', { exact: true }).fill('登录用例重新确认');
  await page.getByLabel('需求描述', { exact: true }).fill('验证码仅限本人使用一次，60 秒后过期');
  await page.getByRole('button', { name: '保存修订', exact: true }).click();
  await expect(page.getByRole('button', { name: '提交评审', exact: true })).toBeVisible();
  const req = await (await page.request.get(`/api/v1${reqPath}`)).json();
  await command(page, `${reqPath}/submit`, { version: req.version, reviewerId: adminId });
  await command(page, `${reqPath}/approve`, { version: req.version + 1 });
  await page.goto(`/projects/${projectId}?tab=test-cases&case=${item.id}`);
  await expect(
    page.getByText('关联需求基线已变化，此用例当前不可用于正式测试。', { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('否，须完成当前修订评审', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '修订用例', exact: true }).click();
  await page.getByLabel('用例修订原因', { exact: true }).fill('核对新需求基线与 60 秒边界');
  await page.getByLabel('步骤 1 操作', { exact: true }).fill('等待 60 秒后输入验证码');
  await page.getByRole('button', { name: '保存用例修订', exact: true }).click();
  await expect(page.getByText('等待 60 秒后输入验证码', { exact: true })).toBeVisible();
  await send(page);
  await expect(page.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
  const caseUrl = page.url();
  await decide(page, caseUrl, '通过用例评审');
  await expect(page.getByText('是 · 修订 2', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '修订历史 (2)', exact: true }).click();
  const old = page.locator('article').filter({ hasText: '修订 1 ·' });
  await old.getByText('查看此修订内容', { exact: true }).click();
  await expect(old.getByText('输入过期或已使用的验证码', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('测试准备：需求覆盖提示、关联用例、评审待办与需求变化复查闭环', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  const errors: string[] = [];
  watch(page, errors);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const { projectId, requirementId, adminId } = await setup(page);
  const reqPath = `/projects/${projectId}/requirements/${requirementId}`,
    reqUrl = `/projects/${projectId}?tab=requirements&requirement=${requirementId}`,
    path = `/projects/${projectId}/test-cases`;
  await page.goto(reqUrl);
  await expect(page.getByText('尚无有效用例，请准备测试场景', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '关联用例 (0)', exact: true }).click();
  await expect(page.getByText('尚未关联测试用例', { exact: true })).toBeVisible();
  const title = `E2E准备 ${Date.now().toString(36)} 验证码过期`;
  const created = await command(page, path, {
    title,
    ownerId: adminId,
    requirementIds: [requirementId],
    steps: [{ action: '提交过期验证码', expected: '拒绝登录，提示重新获取' }],
  });
  const caseUrl = `/projects/${projectId}?tab=test-cases&case=${created.id}`;
  await page.reload();
  await expect(page.getByText('仅有草稿用例，尚不能用于正式测试', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '关联用例 (1)', exact: true }).click();
  const caseLink = page.getByRole('link').filter({ hasText: title });
  await expect(caseLink).toHaveCount(1);
  await caseLink.click();
  await expect(page).toHaveURL(/tab=test-cases/);
  await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
  await send(page);
  await expect(page.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
  const reviewUrl = `/?wk=TEST_CASE_REVIEW&wq=${encodeURIComponent(title)}`;
  await page.goto(reviewUrl);
  const todo = page.getByRole('region', { name: '我的待办', exact: true });
  await expect(todo.getByRole('link', { name: `评审用例 ${title}`, exact: true })).toBeVisible();
  await page.reload();
  await expect(todo.getByText('待评审用例', { exact: true })).toBeVisible();
  await todo.getByRole('link', { name: `评审用例 ${title}`, exact: true }).click();
  await decide(page, caseUrl, '通过用例评审');
  await page.goto(reviewUrl);
  await expect(todo.getByText('没有符合条件的待办', { exact: true })).toBeVisible();
  await page.goto(reqUrl);
  await expect(page.getByText('已有 1 条可使用用例', { exact: true })).toBeVisible();
  const requirement = await (await page.request.get(`/api/v1${reqPath}`)).json();
  await command(page, `${reqPath}/revise`, {
    title: requirement.title,
    description: `${requirement.description}，补充过期提示文案`,
    acceptanceCriteria: requirement.acceptanceCriteria,
    ownerId: adminId,
    version: requirement.version,
    reason: '明确提示文案',
    impact: '复查验证码场景',
  });
  await page.reload();
  await expect(page.getByText('需求已变化，关联用例需要复查', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '关联用例 (1)', exact: true }).click();
  await expect(page.getByText('需求变化待复查', { exact: true })).toBeVisible();
  await expect(page.getByText('待重新评审', { exact: true })).toBeVisible();
  await expect(page.locator('.ant-drawer-content-wrapper')).toHaveCSS('transform', 'none');
  await page.screenshot({
    path: 'test-results/m3-preparation-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/m3-preparation-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const recheckUrl = `/?wk=TEST_CASE_RECHECK&wq=${encodeURIComponent(title)}`;
  await page.goto(recheckUrl);
  await expect(todo.getByRole('link', { name: `复查用例 ${title}`, exact: true })).toBeVisible();
  await todo.getByRole('link', { name: `复查用例 ${title}`, exact: true }).click();
  await expect(
    page.getByText('关联需求基线已变化，此用例当前不可用于正式测试。', { exact: true }),
  ).toBeVisible();
  const revised = await (await page.request.get(`/api/v1${reqPath}`)).json();
  await command(page, `${reqPath}/submit`, { version: revised.version, reviewerId: adminId });
  await command(page, `${reqPath}/approve`, { version: revised.version + 1 });
  await page.reload();
  await page.getByRole('button', { name: '修订用例', exact: true }).click();
  await page.getByLabel('用例修订原因', { exact: true }).fill('已核对过期提示及新验收标准');
  await page.getByRole('button', { name: '保存用例修订', exact: true }).click();
  await expect(page.getByRole('dialog', { name: '修订用例', exact: true })).toHaveCount(0);
  await page.goto(recheckUrl);
  await expect(todo.getByText('没有符合条件的待办', { exact: true })).toBeVisible();
  await page.goto(caseUrl);
  await send(page);
  await expect(page.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
  await decide(page, caseUrl, '通过用例评审');
  await page.goto(reqUrl);
  await expect(page.getByText('已有 1 条可使用用例', { exact: true })).toBeVisible();
  expect(errors).toEqual([]);
});

test('M3 阶段退出：手机号登录四类用例、退回重审及开发任务独立推进', async ({ page }) => {
  test.setTimeout(120000);
  page.setDefaultTimeout(12000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  const errors: string[] = [];
  watch(page, errors);
  const { projectId, requirementId, adminId } = await setup(page),
    path = `/projects/${projectId}/test-cases`,
    taskPath = `/projects/${projectId}/tasks`,
    reqUrl = `/projects/${projectId}?tab=requirements&requirement=${requirementId}`;
  const taskIds: string[] = [];
  for (const title of ['手机号登录接口', '验证码一次性校验']) {
    const task = await command(page, taskPath, { title, requirementId, assigneeId: adminId });
    taskIds.push(task.id);
  }
  const scenarios = [
    ['正常验证码', '输入有效且未使用的验证码', '登录成功，建立会话'],
    ['错误验证码', '输入不匹配的验证码', '拒绝登录并提示验证码错误'],
    ['过期验证码', '输入已过期验证码', '拒绝登录并提示重新获取'],
    ['重复使用验证码', '成功登录后再次提交同一验证码', '拒绝第二次登录'],
  ];
  const cases: { id: string; title: string }[] = [];
  for (const [title, action, expected] of scenarios) {
    const created = await command(page, path, {
      title,
      ownerId: adminId,
      requirementIds: [requirementId],
      preconditions: '手机号已注册，测试环境支持验证码有效期和使用状态控制',
      steps: [{ action, expected }],
    });
    cases.push({ id: created.id, title });
  }
  await command(page, `${taskPath}/${taskIds[0]}/start`, { version: 1 });
  for (const [index, item] of cases.entries()) {
    await command(page, `${path}/${item.id}/submit`, { version: 1, reviewerId: adminId });
    if (index === 3) {
      const url = `/projects/${projectId}?tab=test-cases&case=${item.id}`;
      await decide(page, url, '退回用例', '补充第二次请求不得建立新会话');
      await page.getByRole('button', { name: '编辑用例', exact: true }).click();
      await page.getByLabel('步骤 1 预期', { exact: true }).fill('拒绝第二次登录，且不建立新会话');
      await page.getByRole('button', { name: '保存用例', exact: true }).click();
      await expect(page.getByText('拒绝第二次登录，且不建立新会话', { exact: true })).toBeVisible();
      await send(page);
      await expect(page.getByRole('dialog', { name: '提交用例评审', exact: true })).toHaveCount(0);
      await decide(page, url, '通过用例评审');
      await expect(page.getByText('是 · 修订 2', { exact: true })).toBeVisible();
      await page.getByRole('tab', { name: '评审历史 (4)', exact: true }).click();
      await expect(page.getByText('补充第二次请求不得建立新会话', { exact: true })).toBeVisible();
    } else await command(page, `${path}/${item.id}/approve`, { version: 2 });
  }
  await page.goto(reqUrl);
  await expect(page.getByText('已有 4 条可使用用例', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: '关联用例 (4)', exact: true }).click();
  for (const item of cases)
    await expect(page.getByRole('link').filter({ hasText: item.title })).toHaveCount(1);
  const drawer = page.getByRole('dialog', { name: '需求详情', exact: true });
  await expect(drawer.locator('article')).toHaveCount(4);
  await expect(page.locator('.ant-drawer-content-wrapper')).toHaveCSS('transform', 'none');
  await page.screenshot({
    path: 'test-results/m3-exit-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await drawer.getByRole('link').filter({ hasText: cases[3]!.title }).scrollIntoViewIfNeeded();
  await expect(drawer.getByRole('link').filter({ hasText: cases[3]!.title })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({
    path: 'test-results/m3-exit-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await command(page, `${taskPath}/${taskIds[1]}/start`, { version: 1 });
  for (const id of taskIds) {
    const task = await (await page.request.get(`/api/v1${taskPath}/${id}`)).json();
    expect(task.status).toBe('IN_PROGRESS');
  }
  const detail = await (
    await page.request.get(`/api/v1/projects/${projectId}/requirements/${requirementId}`)
  ).json();
  expect(detail.testPreparation.usable).toBe(4);
  expect(detail.taskSummary.inProgress).toBe(2);
  expect(errors).toEqual([]);
});
