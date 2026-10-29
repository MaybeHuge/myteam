import { expect, test } from '@playwright/test';

const password = 'MyTeam-test-only-2026!';
test('项目与成员完整交互：创建账号/项目、启动、只读隔离、移除访问、桌面与窄屏', async ({
  page,
  browser,
}) => {
  test.setTimeout(90000);
  const memberStamp = Date.now().toString(36);
  const memberEmail = `new-member-${memberStamp}@browser-e2e.test`;
  const memberName = `林小禾 ${memberStamp}`;
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('邮箱', { exact: true }).fill('browser-admin@example.test');
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('heading', { name: '你好，浏览器测试管理员。' })).toBeVisible();
  await page.screenshot({
    path: 'test-results/workspace-polished.png',
    fullPage: true,
    animations: 'disabled',
  });

  await page.getByRole('link', { name: '账号管理', exact: true }).click();
  await page.getByRole('button', { name: '新建账号', exact: true }).click();
  await page.getByLabel('姓名', { exact: true }).fill(memberName);
  await page.getByLabel('登录邮箱', { exact: true }).fill(memberEmail);
  await page.getByLabel('初始密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '创建账号', exact: true }).click();
  await expect(page.getByText('账号已创建，可以将该成员加入项目')).toBeVisible();
  await expect(page.getByText('账号已创建，可以将该成员加入项目')).not.toBeVisible();

  await page.getByRole('link', { name: '项目空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目空间', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/projects-grid-polished.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '列表视图', exact: true }).click();
  await expect(page.getByRole('table')).toBeVisible();
  await page.getByRole('button', { name: '卡片视图', exact: true }).click();
  await page.getByLabel('搜索项目', { exact: true }).fill('没有这个项目');
  await expect(page.getByText('没有找到符合条件的项目')).toBeVisible();
  await page.getByRole('button', { name: '清除筛选', exact: true }).click();
  await page.getByRole('button', { name: '新建项目', exact: true }).click();
  const code = `E2E${Date.now().toString(36).slice(-6).toUpperCase()}`;
  await page.getByLabel('项目名称', { exact: true }).fill('下一站，协作体验');
  await page.getByLabel('项目标识', { exact: true }).fill(code);
  await page
    .getByLabel(/^项目简介/)
    .fill('从清晰的目标与细腻的体验开始，让每个伙伴在项目里找到自己的位置。');
  await page.getByRole('button', { name: '选择玫瑰主题' }).click();
  await page.getByLabel(/^计划开始/).fill('2026-10-27');
  await page.getByLabel(/^计划结束/).fill('2026-12-31');
  await page.screenshot({
    path: 'test-results/project-editor-polished.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('button', { name: '创建项目', exact: true }).click();
  await expect(page).toHaveURL(/\/projects\/[a-f0-9-]+$/);
  await expect(page.getByRole('heading', { name: '下一站，协作体验', exact: true })).toBeVisible();
  const projectUrl = page.url();
  const id = projectUrl.split('/').pop()!;
  const saved = await page.request.get(`/api/v1/projects/${id}`);
  expect((await saved.json()).color).toBe('rose');
  await page.getByRole('button', { name: '启动项目', exact: true }).click();
  await page.getByRole('button', { name: '确认启动', exact: true }).click();
  await expect(page.getByRole('button', { name: '暂停项目', exact: true })).toBeVisible();
  await page.getByRole('tab', { name: /成员与权限/ }).click();
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  const picker = page.getByRole('combobox', { name: '选择成员', exact: true });
  await picker.click();
  await picker.fill(memberEmail);
  await expect(page.getByText(memberName, { exact: true })).toBeVisible();
  await picker.fill('不存在的候选账号');
  await expect(page.getByText('没有匹配的可添加账号', { exact: true })).toBeVisible();
  await picker.fill(memberEmail);
  await expect(page.getByText(memberName, { exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/project-member-picker.png',
    fullPage: true,
    animations: 'disabled',
  });
  await picker.fill(memberName);
  await expect(page.locator('small').filter({ hasText: memberEmail })).toBeVisible();
  await picker.press('ArrowDown');
  await picker.press('Enter');
  await expect(
    page.getByRole('dialog').getByTitle(`${memberName} · ${memberEmail}`, { exact: true }),
  ).toBeVisible();
  await page.getByRole('checkbox', { name: '开发', exact: true }).uncheck();
  await page.getByRole('checkbox', { name: '只读', exact: true }).check();
  await page.getByRole('button', { name: '添加到项目', exact: true }).click();
  const member = page.getByRole('row').filter({ hasText: memberEmail });
  await expect(member.getByText('只读', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByTitle(`${memberName} · ${memberEmail}`, { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole('checkbox', { name: '开发', exact: true })).toBeChecked();
  await picker.fill(memberEmail);
  await expect(page.getByText('没有匹配的可添加账号', { exact: true })).toBeVisible();
  await picker.press('Escape');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await member.getByRole('button', { name: '调整角色', exact: true }).click();
  let roles = page.getByRole('dialog', { name: '调整项目角色' });
  await expect(roles.getByRole('checkbox', { name: '只读', exact: true })).toBeChecked();
  await expect(roles.getByRole('checkbox', { name: '开发', exact: true })).not.toBeChecked();
  await roles.getByRole('checkbox', { name: '产品', exact: true }).check();
  await roles.getByRole('button', { name: '取消', exact: true }).click();
  await member.getByRole('button', { name: '调整角色', exact: true }).click();
  roles = page.getByRole('dialog', { name: '调整项目角色' });
  await expect(roles.getByRole('checkbox', { name: '只读', exact: true })).toBeChecked();
  await expect(roles.getByRole('checkbox', { name: '产品', exact: true })).not.toBeChecked();
  await roles.getByRole('checkbox', { name: '产品', exact: true }).check();
  await roles.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(member.getByText('产品', { exact: true })).toBeVisible();
  await member.getByRole('button', { name: '调整角色', exact: true }).click();
  roles = page.getByRole('dialog', { name: '调整项目角色' });
  await expect(roles.getByRole('checkbox', { name: '只读', exact: true })).toBeChecked();
  await expect(roles.getByRole('checkbox', { name: '产品', exact: true })).toBeChecked();
  await roles.getByRole('checkbox', { name: '产品', exact: true }).uncheck();
  await roles.getByRole('button', { name: '保存角色', exact: true }).click();
  await expect(member.getByText('产品', { exact: true })).toHaveCount(0);
  const owner = page.getByRole('row').filter({ hasText: 'browser-admin@example.test' });
  await owner.getByRole('button', { name: '调整角色', exact: true }).click();
  roles = page.getByRole('dialog', { name: '调整项目角色' });
  await expect(roles.getByRole('checkbox', { name: '负责人', exact: true })).toBeChecked();
  await expect(roles.getByRole('checkbox', { name: '负责人', exact: true })).toBeDisabled();
  await expect(roles.getByRole('checkbox', { name: '只读', exact: true })).not.toBeChecked();
  await roles.getByRole('button', { name: '取消', exact: true }).click();
  await page.screenshot({
    path: 'test-results/project-members-polished.png',
    fullPage: true,
    animations: 'disabled',
  });

  const context = await browser.newContext();
  const viewer = await context.newPage();
  await viewer.goto(projectUrl);
  await viewer.getByLabel('邮箱', { exact: true }).fill(memberEmail);
  await viewer.getByLabel('密码', { exact: true }).fill(password);
  await viewer.getByRole('button', { name: '登录工作空间' }).click();
  await expect(viewer.getByText('只读访问', { exact: true })).toBeVisible();
  await expect(viewer.getByRole('button', { name: '项目设置', exact: true })).toHaveCount(0);
  const session = await (await viewer.request.get('/api/v1/auth/me')).json();
  const current = await (await viewer.request.get(`/api/v1/projects/${id}`)).json();
  const denied = await viewer.request.post(`/api/v1/projects/${id}/update`, {
    headers: {
      Origin: 'http://localhost:5174',
      'X-CSRF-Token': session.csrfToken,
      'Idempotency-Key': crypto.randomUUID(),
    },
    data: {
      name: '不应成功',
      description: '',
      color: 'teal',
      icon: 'layers',
      startDate: null,
      endDate: null,
      version: current.version,
    },
  });
  expect(denied.status()).toBe(403);
  await viewer.getByRole('tab', { name: /成员与权限/ }).click();
  await expect(viewer.getByRole('button', { name: '添加成员', exact: true })).toHaveCount(0);

  await member.getByRole('button', { name: '移除', exact: true }).click();
  await page.getByRole('button', { name: '移除成员', exact: true }).click();
  await expect(member).toHaveCount(0);
  expect((await viewer.request.get(`/api/v1/projects/${id}`)).status()).toBe(404);
  await context.close();
  await expect(page.getByText('成员已移出项目', { exact: true })).not.toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: '添加成员', exact: true }).click();
  await expect(picker).toHaveValue('');
  await picker.fill(memberName);
  await expect(page.locator('small').filter({ hasText: memberEmail })).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.screenshot({
    path: 'test-results/project-member-picker-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  await picker.press('Escape');
  await page.getByRole('button', { name: '取消', exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole('tab', { name: '项目概览', exact: true }).click();
  await expect(page.getByRole('tab', { name: '项目概览', exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  await page.screenshot({
    path: 'test-results/project-overview-polished.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('link', { name: '返回项目空间', exact: true }).click();
  await expect(page.getByRole('heading', { name: '项目空间', exact: true })).toBeVisible();
  await page.screenshot({
    path: 'test-results/projects-mobile-polished.png',
    fullPage: true,
    animations: 'disabled',
  });
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  expect(errors).toEqual([]);
});
