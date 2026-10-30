import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { readFile, writeFile } from 'node:fs/promises';

const password = 'MyTeam-test-only-2026!';
type Person = { email: string; name: string; page: Page };
type Item = { id: string; title: string; url: string; tasks: Item[]; caseUrl?: string };
type Project = {
  id: string;
  key: string;
  name: string;
  requirements: Item[];
  product: string;
  viewer: string;
};

async function pick(page: Page, field: string | Locator, value: string, search = false) {
  const input = typeof field === 'string' ? page.getByLabel(field, { exact: true }) : field;
  await input.click();
  if (search) await input.fill(value);
  await page
    .locator('.ant-select-dropdown:visible .ant-select-item-option')
    .filter({ hasText: value })
    .first()
    .click();
}
async function go(page: Page, url: string) {
  // Preserve isolated role cookies while unloading inactive React workspaces.
  const others =
    page
      .context()
      .browser()
      ?.contexts()
      .flatMap((context) => context.pages()) ?? [];
  for (const other of others)
    if (other !== page && !other.isClosed() && other.url() !== 'about:blank')
      await other.goto('about:blank', { waitUntil: 'commit' });
  await page.bringToFront();
  const target = new URL(url, 'http://local.test');
  const tabs: Record<string, string> = {
    requirements: '需求管理',
    tasks: '任务管理',
    'test-cases': '测试用例',
    records: '测试记录',
    releases: '版本与构建',
    defects: '缺陷管理',
  };
  if (
    page.url().startsWith('http') &&
    new URL(page.url()).pathname === target.pathname &&
    [...target.searchParams.keys()].every((key) => key === 'tab') &&
    tabs[target.searchParams.get('tab') ?? '']
  ) {
    for (const dialog of await page.getByRole('dialog').all())
      await dialog.getByRole('button', { name: '关闭', exact: true }).click();
    await page
      .getByRole('tab', { name: tabs[target.searchParams.get('tab')!]!, exact: true })
      .click();
    return;
  }
  await page.goto(url, { waitUntil: 'domcontentloaded' });
}
async function login(page: Page, email: string) {
  page.setDefaultTimeout(20000);
  page.setDefaultNavigationTimeout(30000);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await go(page, '/');
  await page.getByLabel('邮箱', { exact: true }).fill(email);
  await page.getByLabel('密码', { exact: true }).fill(password);
  await page.getByRole('button', { name: '登录工作空间' }).click();
  await expect(page.getByRole('button', { name: '退出登录', exact: true })).toBeVisible();
}
async function confirm(page: Page, label: string, reasonLabel?: string) {
  await page.getByRole('button', { name: label, exact: true }).click();
  const dialog = page.getByRole('dialog', { name: label, exact: true });
  if (reasonLabel)
    await dialog.getByLabel(reasonLabel, { exact: true }).fill('多项目界面回归，已核对交付结果');
  await dialog.getByRole('button', { name: label, exact: true }).click();
  await expect(dialog).toHaveCount(0);
}
async function read(page: Page, path: string) {
  const response = await page.request.get(`/api/v1${path}`);
  expect(response.status(), await response.text()).toBe(200);
  return response.json();
}

test('多项目多角色：纯界面创建3项目9需求18任务，评审开发测试发布与权限可见性', async ({
  page,
  browser,
}, info) => {
  test.setTimeout(900000);
  // A retained UI-created checkpoint lets a long manual audit resume without duplicating data.
  const resumePath = process.env.MYTEAM_UI_AUDIT_RESUME;
  const resume = resumePath
    ? (JSON.parse(await readFile(resumePath, 'utf8')) as {
        stamp: string;
        accounts: Record<string, { email: string; name: string }>;
        projects: Project[];
      })
    : null;
  const stamp = resume?.stamp ?? Date.now().toString(36);
  const contexts: BrowserContext[] = [];
  const errors: string[] = [];
  const projects: Project[] = [];
  const visibility: {
    project: string;
    actor: string;
    area: string;
    button: string;
    expected: boolean;
    visible: boolean;
  }[] = [];
  const people: Record<string, Person> = {};
  const events: string[] = [];
  const watch = (p: Page) => {
    p.on('pageerror', (error) => errors.push(`${p.url()}: ${error.message}`));
    p.on('console', (message) => {
      if (message.type() === 'error' && !message.text().startsWith('Failed to load resource:'))
        errors.push(message.text());
    });
  };
  watch(page);
  const save = async () =>
    writeFile(
      info.outputPath('audit.json'),
      JSON.stringify(
        {
          stamp,
          accounts: Object.fromEntries(
            Object.entries(people).map(([key, person]) => [
              key,
              { email: person.email, name: person.name },
            ]),
          ),
          projects,
          visibility,
          events,
          errors,
        },
        null,
        2,
      ),
    );
  const step = async (label: string, action: () => Promise<void>) => {
    await test.step(label, action);
    events.push(label);
    console.log(`UI_AUDIT ${label}`);
    await save();
  };
  const buttons = async (
    project: Project,
    actor: string,
    area: string,
    shown: string[],
    hidden: string[],
  ) => {
    const p = people[actor]!.page;
    await expect(
      p.getByRole('heading', { name: project.name, exact: true, includeHidden: true }),
    ).toHaveCount(1);
    if (['测试记录列表', '版本列表', '缺陷列表'].includes(area)) {
      await expect(p.getByRole('table')).toBeVisible();
      await expect(p.locator('.ant-spin-spinning')).toHaveCount(0);
    }
    if (area.includes('任务') && !area.includes('列表') && !area.includes('草稿')) {
      const taskId = new URL(p.url()).searchParams.get('task');
      const task = project.requirements
        .flatMap((item) => item.tasks)
        .find((item) => item.id === taskId);
      if (task)
        await expect(p.getByRole('heading', { name: task.title, exact: true })).toBeVisible();
    }
    if (area === '评审中的需求详情')
      await expect(
        p.getByRole('heading', { name: project.requirements[2]!.title, exact: true }),
      ).toBeVisible();
    for (const [expected, names] of [
      [true, shown],
      [false, hidden],
    ] as const) {
      for (const name of names) {
        const locator = p.getByRole('button', { name });
        if (expected) {
          await expect.soft(locator, `${project.key}/${actor}/${area}/${name}`).toBeVisible();
          await expect
            .soft(locator, `${project.key}/${actor}/${area}/${name}/enabled`)
            .toBeEnabled();
        } else await expect.soft(locator, `${project.key}/${actor}/${area}/${name}`).toHaveCount(0);
        visibility.push({
          project: project.key,
          actor,
          area,
          button: name,
          expected,
          visible: await locator
            .first()
            .isVisible()
            .catch(() => false),
        });
      }
    }
  };
  try {
    if (resume) {
      await step('通过界面重新登录保留的测试账号，核对已创建的3项目9需求18任务', async () => {
        expect(Object.keys(resume.accounts)).toHaveLength(9);
        expect(resume.projects).toHaveLength(3);
        for (const [key, account] of Object.entries(resume.accounts)) {
          let actor = page;
          if (key !== 'admin') {
            const context = await browser.newContext({ baseURL: info.project.use.baseURL });
            contexts.push(context);
            actor = await context.newPage();
            watch(actor);
          }
          await login(actor, account.email);
          people[key] = { ...account, page: actor };
        }
        projects.push(...resume.projects);
        for (const project of projects) {
          expect(project.requirements).toHaveLength(3);
          expect(project.requirements.flatMap((item) => item.tasks)).toHaveLength(6);
          expect((await read(page, `/projects/${project.id}/requirements`)).total).toBe(3);
          expect((await read(page, `/projects/${project.id}/tasks`)).total).toBe(6);
        }
      });
    } else {
      await step('管理员通过界面创建负责人、第二开发、发布及非成员账号', async () => {
        await login(page, 'browser-admin@example.test');
        people.admin = { email: 'browser-admin@example.test', name: '浏览器测试管理员', page };
        for (const [key, name] of [
          ['owner', '回归负责人'],
          ['devB', '回归开发乙'],
          ['release', '回归发布'],
          ['outsider', '回归非成员'],
        ]) {
          const email = `${key.toLowerCase()}-${stamp}@role-ui.test`,
            fullName = `${name}${stamp}`;
          await go(page, '/settings/users');
          await page.getByRole('button', { name: '新建账号', exact: true }).click();
          await page.getByLabel('姓名', { exact: true }).fill(fullName);
          await page.getByLabel('登录邮箱', { exact: true }).fill(email);
          await page.getByLabel('初始密码', { exact: true }).fill(password);
          await page.getByRole('button', { name: '创建账号', exact: true }).click();
          await expect(page.getByLabel('登录邮箱', { exact: true })).toHaveCount(0);
          const context = await browser.newContext({ baseURL: info.project.use.baseURL });
          contexts.push(context);
          const actor = await context.newPage();
          watch(actor);
          await login(actor, email);
          expect((await read(actor, '/auth/me')).user.isSystemAdmin).toBe(false);
          await expect(actor.getByRole('link', { name: '账号管理', exact: true })).toHaveCount(0);
          people[key!] = { email, name: fullName, page: actor };
        }
        for (const [key, email, name] of [
          ['product', 'browser-product@example.test', '林悦'],
          ['devA', 'browser-collaborator@example.test', '陈青'],
          ['qa', 'browser-tester@example.test', '周宁'],
          ['viewer', 'browser-member@example.test', '浏览器测试成员'],
        ]) {
          const context = await browser.newContext({ baseURL: info.project.use.baseURL });
          contexts.push(context);
          const actor = await context.newPage();
          watch(actor);
          await login(actor, email!);
          people[key!] = { email: email!, name: name!, page: actor };
        }
      });

      for (let index = 1; index <= 3; index++) {
        const project: Project = {
          id: '',
          key: `U${stamp.slice(-7)}${index}`.toUpperCase(),
          name: `界面角色回归${stamp}·项目${index}`,
          requirements: [],
          product: index === 3 ? 'viewer' : 'product',
          viewer: index === 3 ? 'product' : 'viewer',
        };
        await step(`界面创建项目${index}、配置7名成员并移交普通负责人`, async () => {
          await go(page, '/projects');
          await page.getByRole('button', { name: '新建项目', exact: true }).click();
          await page.getByLabel('项目名称', { exact: true }).fill(project.name);
          await page.getByLabel('项目标识', { exact: true }).fill(project.key);
          await page
            .getByLabel(/^项目简介/)
            .fill('通过真实浏览器操作验证需求、任务、评审与项目级角色隔离。');
          await page.getByRole('button', { name: '创建项目', exact: true }).click();
          await expect(
            page.getByRole('heading', { name: project.name, exact: true }),
          ).toBeVisible();
          project.id = new URL(page.url()).pathname.split('/').at(-1)!;
          projects.push(project);
          await save();
          await page.getByRole('button', { name: '启动项目', exact: true }).click();
          await page.getByRole('button', { name: '确认启动', exact: true }).click();
          await expect(page.getByRole('button', { name: '暂停项目', exact: true })).toBeVisible();
          await page.getByRole('tab', { name: /成员与权限/ }).click();
          const assignments = [
            ['owner', '只读'],
            [project.product, '产品'],
            [project.viewer, '只读'],
            ['devA', '开发'],
            ['devB', '开发'],
            ['qa', '测试'],
            ['release', '发布'],
          ];
          for (const [actor, role] of assignments) {
            await page.getByRole('button', { name: '添加成员', exact: true }).click();
            const picker = page.getByRole('combobox', { name: '选择成员', exact: true });
            await pick(page, picker, people[actor!]!.email, true);
            const modal = page.getByRole('dialog');
            for (const checkbox of await modal.getByRole('checkbox').all()) {
              if ((await checkbox.isChecked()) && role !== '开发') await checkbox.uncheck();
            }
            await modal.getByRole('checkbox', { name: role!, exact: true }).check();
            await modal.getByRole('button', { name: '添加到项目', exact: true }).click();
            await expect(modal).toHaveCount(0);
            await expect(
              page.getByRole('row').filter({ hasText: people[actor!]!.email }),
            ).toBeVisible();
          }
          await page.getByRole('button', { name: '项目设置', exact: true }).click();
          const settings = page.getByRole('dialog', { name: /项目设置/ });
          await pick(
            page,
            settings.getByRole('combobox', { name: /^项目负责人/ }),
            people.owner!.name,
            true,
          );
          await settings.getByRole('button', { name: '保存修改', exact: true }).click();
          await expect(settings).toHaveCount(0);
          const ownerRow = page.getByRole('row').filter({ hasText: people.owner!.email });
          await ownerRow.getByRole('button', { name: '调整角色', exact: true }).click();
          const roles = page.getByRole('dialog', { name: '调整项目角色' });
          await roles.getByRole('checkbox', { name: '只读', exact: true }).uncheck();
          await roles.getByRole('button', { name: '保存角色', exact: true }).click();
          await expect(roles).toHaveCount(0);
          expect((await read(page, `/projects/${project.id}`)).owner.name).toBe(people.owner!.name);
        });

        for (let r = 1; r <= 3; r++) {
          const requirement: Item = { id: '', title: `${project.key}需求${r}`, url: '', tasks: [] };
          await step(`${project.key} 产品界面创建需求${r}并由负责人拆分两项任务`, async () => {
            const product = people[project.product]!.page,
              owner = people.owner!.page;
            await go(product, `/projects/${project.id}?tab=requirements`);
            await product.getByRole('button', { name: '新建需求', exact: true }).click();
            await product.getByLabel('需求标题', { exact: true }).fill(requirement.title);
            await product
              .getByLabel('需求描述', { exact: true })
              .fill(`项目${index}的业务需求${r}，由产品编写、负责人评审、开发实现、测试验证。`);
            await product
              .getByLabel('验收标准', { exact: true })
              .fill('两项开发任务完成，相关用例通过，其他角色不能越权修改。');
            await product.getByRole('button', { name: '创建需求', exact: true }).click();
            await expect(
              product.getByRole('heading', { name: requirement.title, exact: true }),
            ).toBeVisible();
            requirement.url = product.url();
            requirement.id = new URL(product.url()).searchParams.get('requirement')!;
            project.requirements.push(requirement);
            await buttons(
              project,
              project.product,
              '需求草稿',
              ['编辑需求', '提交评审'],
              ['确认需求', '拆分任务'],
            );
            for (const [j, actor] of ['devA', 'devB'].entries()) {
              await go(owner, requirement.url);
              await owner.getByRole('button', { name: '拆分任务', exact: true }).click();
              const taskTitle = `${project.key}需求${r}任务${j + 1}`;
              await owner.getByLabel('任务标题', { exact: true }).fill(taskTitle);
              await owner
                .getByLabel('任务说明', { exact: true })
                .fill('界面创建并分配给对应开发人员，保留工作量及交付说明。');
              await owner.getByLabel('估算工时（小时）', { exact: true }).fill('2');
              await pick(owner, '任务负责人', people[actor]!.name);
              await owner.getByRole('button', { name: '创建任务', exact: true }).click();
              await expect(
                owner.getByRole('heading', { name: taskTitle, exact: true }),
              ).toBeVisible();
              requirement.tasks.push({
                id: new URL(owner.url()).searchParams.get('task')!,
                title: taskTitle,
                url: owner.url(),
                tasks: [],
              });
            }
            await go(product, requirement.url);
            await product.getByRole('button', { name: '提交评审', exact: true }).click();
            const review = product.getByRole('dialog', { name: '提交评审', exact: true });
            await pick(
              product,
              review.getByLabel('指定评审人', { exact: true }),
              people.owner!.name,
            );
            await review.getByRole('button', { name: '提交评审', exact: true }).click();
            await expect(review).toHaveCount(0);
            await buttons(project, project.product, '需求评审中', [], ['编辑需求', '确认需求']);
            if (r < 3) {
              await go(owner, requirement.url);
              await confirm(owner, '确认需求');
              await expect(
                owner.getByText('需求已确认，评审基线已保留', { exact: true }),
              ).toBeVisible();
              for (const [j, actor] of ['devA', 'devB'].entries()) {
                const developer = people[actor]!.page;
                await go(developer, requirement.tasks[j]!.url);
                await confirm(developer, '开始任务');
                if (r === 1) await confirm(developer, '完成任务', '完成说明');
                else break;
              }
            } else {
              await go(people.devA!.page, requirement.tasks[0]!.url);
              await buttons(project, 'devA', '评审未通过前任务', [], ['开始任务', '完成任务']);
            }
          });
        }

        await step(
          `${project.key} 测试人员创建用例、负责人评审并通过实际测试完成需求`,
          async () => {
            const requirement = project.requirements[0]!,
              qa = people.qa!.page,
              owner = people.owner!.page;
            await go(qa, requirement.url);
            await qa.getByRole('button', { name: '为此需求创建用例', exact: true }).click();
            const title = `${project.key}验收用例`;
            await qa.getByLabel('用例标题', { exact: true }).fill(title);
            await qa.getByLabel('前置条件', { exact: true }).fill('两项任务均已完成');
            await pick(qa, '用例负责人', people.qa!.name);
            await qa.getByRole('button', { name: '添加步骤', exact: true }).click();
            await qa.getByLabel('步骤 1 操作', { exact: true }).fill('验证当前需求的实际业务流程');
            await qa.getByLabel('步骤 1 预期', { exact: true }).fill('与验收标准一致');
            await qa.getByRole('button', { name: '创建用例', exact: true }).click();
            await expect(qa.getByRole('heading', { name: title, exact: true })).toBeVisible();
            requirement.caseUrl = qa.url();
            await qa.getByRole('button', { name: '提交用例评审', exact: true }).click();
            let modal = qa.getByRole('dialog', { name: '提交用例评审', exact: true });
            await pick(qa, modal.getByLabel('用例评审人', { exact: true }), people.owner!.name);
            await modal.getByRole('button', { name: '提交用例评审', exact: true }).click();
            await expect(modal).toHaveCount(0);
            await buttons(project, 'qa', '指定他人评审的用例', [], ['通过用例评审']);
            await go(owner, requirement.caseUrl);
            await confirm(owner, '通过用例评审');
            await go(qa, requirement.caseUrl);
            await qa.getByRole('button', { name: '添加测试记录', exact: true }).click();
            modal = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
            await modal
              .getByLabel('测试环境', { exact: true })
              .fill('Headless Chromium UI regression');
            await pick(qa, modal.getByRole('combobox', { name: /测试结果$/ }), '通过');
            await modal
              .getByLabel('实际表现', { exact: true })
              .fill('通过界面完成两项任务并验证业务流程，符合预期');
            await modal.getByRole('button', { name: '保存测试结果', exact: true }).click();
            await expect(modal).toHaveCount(0);
            expect(
              (await read(qa, `/projects/${project.id}/requirements/${requirement.id}`)).status,
            ).toBe('COMPLETED');
            await qa.screenshot({
              path: info.outputPath(`${project.key}-test-record.png`),
              fullPage: true,
              animations: 'disabled',
            });
          },
        );
      }
    }
    for (const project of projects) {
      await step(`${project.key} 检查七类项目成员与非成员的按钮、列表及越权拒绝`, async () => {
        const requirement = project.requirements[1]!,
          task = requirement.tasks[0]!;
        for (const [actor, role] of [
          ['owner', 'OWNER'],
          [project.product, 'PRODUCT'],
          ['devA', 'DEVELOPER'],
          ['devB', 'OTHER_DEVELOPER'],
          ['qa', 'TESTER'],
          ['release', 'RELEASE_MANAGER'],
          [project.viewer, 'VIEWER'],
        ]) {
          const p = people[actor!]!.page;
          await go(p, `/projects/${project.id}`);
          await expect(p.getByRole('heading', { name: project.name, exact: true })).toBeVisible();
          await buttons(
            project,
            actor!,
            '项目',
            role === 'OWNER' ? ['项目设置', '暂停项目'] : [],
            role === 'OWNER' ? [] : ['项目设置', '暂停项目'],
          );
          await go(p, `/projects/${project.id}?tab=requirements`);
          const canWriteReq = ['OWNER', 'PRODUCT'].includes(role!);
          await buttons(
            project,
            actor!,
            '需求列表',
            canWriteReq ? ['新建需求'] : [],
            canWriteReq ? [] : ['新建需求'],
          );
          for (const item of project.requirements)
            await expect(p.getByRole('button', { name: item.title, exact: true })).toBeVisible();
          await go(p, project.requirements[2]!.url);
          await buttons(
            project,
            actor!,
            '评审中的需求详情',
            role === 'OWNER' ? ['确认需求', '退回修改'] : [],
            role === 'OWNER' ? ['编辑需求'] : ['确认需求', '编辑需求'],
          );
          await go(p, `/projects/${project.id}?tab=tasks`);
          const canWriteTask = ['OWNER', 'DEVELOPER', 'OTHER_DEVELOPER'].includes(role!);
          await buttons(
            project,
            actor!,
            '任务列表',
            canWriteTask ? ['新建任务'] : [],
            canWriteTask ? [] : ['新建任务'],
          );
          expect((await read(p, `/projects/${project.id}/tasks`)).total).toBe(6);
          await go(p, task.url);
          await buttons(
            project,
            actor!,
            '他人或本人进行中任务',
            ['OWNER', 'DEVELOPER'].includes(role!) ? ['编辑任务', '完成任务'] : [],
            ['OWNER', 'DEVELOPER'].includes(role!) ? [] : ['编辑任务', '完成任务', '开始任务'],
          );
          await p.screenshot({
            path: info.outputPath(`${project.key}-${role}-task.png`),
            fullPage: true,
            animations: 'disabled',
          });
          await go(p, `/projects/${project.id}?tab=test-cases`);
          const canWriteCase = ['OWNER', 'TESTER'].includes(role!);
          await buttons(
            project,
            actor!,
            '用例列表',
            canWriteCase ? ['新建用例'] : [],
            canWriteCase ? [] : ['新建用例'],
          );
          await go(p, `/projects/${project.id}?tab=records`);
          await buttons(
            project,
            actor!,
            '测试记录列表',
            canWriteCase ? ['添加测试记录'] : [],
            canWriteCase ? [] : ['添加测试记录'],
          );
          await go(p, `/projects/${project.id}?tab=releases`);
          const canRelease = ['OWNER', 'RELEASE_MANAGER'].includes(role!);
          await buttons(
            project,
            actor!,
            '版本列表',
            canRelease ? ['新建版本'] : [],
            canRelease ? [] : ['新建版本'],
          );
          await go(p, `/projects/${project.id}?tab=defects`);
          await buttons(
            project,
            actor!,
            '缺陷列表',
            role !== 'VIEWER' ? ['报告缺陷'] : [],
            role === 'VIEWER' ? ['报告缺陷'] : [],
          );
          if (role === 'VIEWER') {
            const session = await read(p, '/auth/me');
            const denied = await p.request.post(`/api/v1/projects/${project.id}/requirements`, {
              headers: {
                Origin: new URL(p.url()).origin,
                'X-CSRF-Token': session.csrfToken,
                'Idempotency-Key': crypto.randomUUID(),
              },
              data: { title: '越权创建必须拒绝' },
            });
            expect(denied.status(), await denied.text()).toBe(403);
          }
          await p.screenshot({
            path: info.outputPath(`${project.key}-${role}.png`),
            fullPage: true,
            animations: 'disabled',
          });
        }
        const outsider = people.outsider!.page;
        await go(outsider, `/projects/${project.id}`);
        await expect(outsider.getByText('项目暂不可访问', { exact: true })).toBeVisible();
        expect((await outsider.request.get(`/api/v1/projects/${project.id}`)).status()).toBe(404);
        const other = projects.find((candidate) => candidate.id !== project.id)!;
        expect(
          (
            await people[project.viewer]!.page.request.get(
              `/api/v1/projects/${other.id}/requirements/${requirement.id}`,
            )
          ).status(),
        ).toBe(404);
        expect((await read(page, `/projects/${project.id}/requirements`)).total).toBe(3);
      });
    }

    await step('发布人员创建版本和构建，测试验证该构建后登记发布与上线验证', async () => {
      const project = projects[0]!,
        release = people.release!.page;
      await go(release, `/projects/${project.id}?tab=releases`);
      await release.getByRole('button', { name: '新建版本' }).click();
      let modal = release.getByRole('dialog', { name: '新建版本', exact: true });
      const name = `${project.key}回归版本`;
      await modal.getByLabel('版本名称', { exact: true }).fill(name);
      await pick(
        release,
        modal.getByLabel('关联需求', { exact: true }),
        project.requirements[0]!.title,
      );
      await modal.getByRole('button', { name: '新建版本', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(release.getByRole('heading', { name, exact: true })).toBeVisible();
      const releaseUrl = release.url();
      await release.getByRole('button', { name: '登记构建', exact: true }).click();
      modal = release.getByRole('dialog', { name: '登记构建', exact: true });
      await modal.getByLabel('构建标识', { exact: true }).fill(`${project.key}-build-1`);
      await modal.getByRole('button', { name: '登记构建', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(
        release.getByText(`${project.key}-build-1`, { exact: true }).first(),
      ).toBeVisible();
      await release.screenshot({
        path: info.outputPath('release-manager-build.png'),
        fullPage: true,
        animations: 'disabled',
      });
      const qa = people.qa!.page;
      await go(qa, project.requirements[0]!.caseUrl!);
      await qa.getByRole('button', { name: '添加测试记录', exact: true }).click();
      modal = qa.getByRole('dialog', { name: '添加测试记录', exact: true });
      await modal.getByLabel('测试环境', { exact: true }).fill('发布构建验收 / Chromium');
      await pick(
        qa,
        modal.getByLabel('测试构建（可选）', { exact: true }),
        `${project.key}-build-1`,
      );
      await pick(qa, modal.getByRole('combobox', { name: /测试结果$/ }), '通过');
      await modal.getByLabel('实际表现', { exact: true }).fill('当前发布构建通过已评审用例验证');
      await modal.getByRole('button', { name: '保存测试结果', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await go(release, releaseUrl);
      const detail = release.getByRole('dialog', { name: '版本详情', exact: true });
      await pick(release, detail.getByRole('combobox').first(), `${project.key}-build-1`);
      await expect(detail.getByText('发布检查通过', { exact: true })).toBeVisible();
      await detail.getByRole('button', { name: '登记发布', exact: true }).click();
      modal = release.getByRole('dialog', { name: '登记发布', exact: true });
      await modal.getByRole('button', { name: '保存记录', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(detail.getByText('已登记发布', { exact: true })).toBeVisible();
      await detail.getByRole('button', { name: '登记上线验证', exact: true }).click();
      modal = release.getByRole('dialog', { name: '登记上线验证', exact: true });
      await modal.getByRole('button', { name: '保存记录', exact: true }).click();
      await expect(modal).toHaveCount(0);
      await expect(detail.getByText('上线验证通过', { exact: true })).toBeVisible();
      await release.screenshot({
        path: info.outputPath('release-manager-published.png'),
        fullPage: true,
        animations: 'disabled',
      });
    });
    expect(errors).toEqual([]);
    await save();
    await info.attach('role-audit', {
      path: info.outputPath('audit.json'),
      contentType: 'application/json',
    });
  } finally {
    await save();
    for (const context of contexts) await context.close();
  }
});
