import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// 显式运行：ALLOW_DEMO_SEED=true ./scripts/pnpm.sh exec node --env-file=.env scripts/demo-data.mjs
if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('演示数据只允许在非生产环境显式设置 ALLOW_DEMO_SEED=true 后生成');
const { createApp } = await import('../apps/api/dist/app.js');
const { createDatabase } = await import('../apps/api/dist/infrastructure/database.js');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const request = require('supertest');
const batch = Date.now().toString(36).slice(-6).toUpperCase();
const output = resolve('.local', `demo-${batch}`);
if (existsSync(output)) throw new Error('批次已存在，请使用新的批次');
mkdirSync(output, { mode: 0o700, recursive: true });
const password = process.env.DEMO_PASSWORD ?? `Demo-${randomBytes(12).toString('base64url')}!`;
const db = createDatabase(process.env.DATABASE_URL);
const app = await createApp();
await app.listen(0, '127.0.0.1');
const http = app.getHttpServer();
const origin = process.env.APP_ORIGIN === '*' ? 'http://localhost:5173' : process.env.APP_ORIGIN;
const manifest = {
  batch,
  createdAt: new Date().toISOString(),
  projects: [],
  users: [],
  journeys: [],
};
const save = () =>
  writeFileSync(output + '/manifest.json', JSON.stringify(manifest, null, 2), { mode: 0o600 });
const date = (offset) => new Date(Date.now() + offset * 86400000).toISOString().slice(0, 10);
let requests = 0;
async function get(actor, path) {
  const result = await actor.agent.get('/api/v1' + path);
  if (result.status !== 200) throw new Error(`${path}: ${result.status} ${result.body.message}`);
  return result.body;
}
async function post(actor, path, input) {
  const result = await actor.agent
    .post('/api/v1' + path)
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrf)
    .set('Idempotency-Key', randomUUID())
    .send(input);
  requests++;
  if (result.status !== 201)
    throw new Error(
      `${path}: ${result.status} ${result.body.message} ${JSON.stringify(result.body.details ?? '')}`,
    );
  return result.body;
}
async function login(email, secret) {
  const agent = request.agent(http);
  const csrf = await agent.get('/api/v1/auth/csrf');
  const result = await agent
    .post('/api/v1/auth/login')
    .set('Origin', origin)
    .set('X-CSRF-Token', csrf.body.csrfToken)
    .send({ email, password: secret });
  if (result.status !== 201)
    throw new Error(`登录失败: ${email} ${result.status} ${result.body.message}`);
  return { agent, csrf: result.body.csrfToken, id: result.body.user.id, email };
}
async function act(actor, path, action, values = {}) {
  const row = await get(actor, path);
  return post(actor, `${path}/${action}`, {
    version: row.version,
    reason: '演示批次：已核对当前范围与证据',
    comment: '演示批次：已核对验收标准、责任及本轮记录',
    ...values,
  });
}
async function comment(actor, projectId, type, targetId, body) {
  return post(actor, `/projects/${projectId}/collaboration/${type}/${targetId}/comments`, { body });
}
async function attach(actor, projectId, type, targetId, name, content) {
  const result = await actor.agent
    .post(`/api/v1/projects/${projectId}/collaboration/${type}/${targetId}/attachments`)
    .query({ filename: name })
    .set('Origin', origin)
    .set('X-CSRF-Token', actor.csrf)
    .set('Idempotency-Key', randomUUID())
    .set('Content-Type', 'application/octet-stream')
    .send(Buffer.from(content));
  if (result.status !== 201) throw new Error(`附件: ${result.status} ${result.body.message}`);
  return result.body;
}
const features = [
  '手机号登录与验证码核销',
  '客户资料搜索与权限隔离',
  '订单金额与优惠计算',
  '批量导入与错误行提示',
  '附件上传与授权下载',
  '站内通知与已读状态',
  '报表导出与字段映射',
  '成员邀请与角色移交',
  '库存扣减与并发保护',
  '支付回调与幂等校验',
  '审批撤回与历史追踪',
  '移动端表单与异常恢复',
  '数据列表分页和筛选',
  '项目搜索与上下文恢复',
  '应用设置与主题切换',
  '接口监控与问题追踪',
  '权限规则调整与影响复查',
  '定时任务参数与失败重试',
  '操作日志检索与导出',
  '重复需求合并整理',
  '多语言文案与空态优化',
  '下一阶段业务范围评审',
  '外部依赖和异常分支补充',
  '废止旧版访问入口',
];
const projectNames = [
  '研发协作平台',
  '客户服务与工单中心',
  '电商订单与库存系统',
  '移动端体验升级',
  '数据分析与报表平台',
  '下一代产品探索',
  '支付与对账平台',
  '统一身份认证',
  '企业知识库',
  '自动化运营中心',
  '开放 API 平台',
  '物流追踪服务',
  '设计系统与组件库',
  '财务审批平台',
  '资产管理平台',
  '质量改进计划',
];
let administrator;
const people = [];
try {
  administrator = await login(process.env.ADMIN_EMAIL, process.env.ADMIN_PASSWORD);
  const definitions = [
    ['OWNER', '李骁'],
    ['OWNER', '赵宁'],
    ['PRODUCT', '林悦'],
    ['PRODUCT', '陈曦'],
    ['DEVELOPER', '陈青'],
    ['DEVELOPER', '王哲'],
    ['DEVELOPER', '周航'],
    ['DEVELOPER', '许佳'],
    ['DEVELOPER', '刘然'],
    ['DEVELOPER', '沈卓'],
    ['TESTER', '周宁'],
    ['TESTER', '苏晴'],
    ['TESTER', '顾言'],
    ['RELEASE_MANAGER', '程远'],
    ['VIEWER', '唐可'],
    ['VIEWER', '陆晨'],
  ];
  for (const [index, [role, name]] of definitions.entries()) {
    const email = `${role.toLowerCase()}${index + 1}.${batch.toLowerCase()}@demo.myteam.test`;
    await post(administrator, '/users', {
      email,
      name: `${name} · 演示${{ OWNER: '负责人', PRODUCT: '产品', DEVELOPER: '开发', TESTER: '测试', RELEASE_MANAGER: '发布', VIEWER: '只读' }[role]}`,
      password,
    });
    const actor = await login(email, password);
    people.push({ ...actor, role, name });
    manifest.users.push({ id: actor.id, email, role, name });
    save();
  }
  writeFileSync(
    output + '/access.json',
    JSON.stringify({ batch, password, accounts: manifest.users }, null, 2),
    { mode: 0o600 },
  );
  const owners = people.filter((p) => p.role === 'OWNER'),
    products = people.filter((p) => p.role === 'PRODUCT');
  const developers = people.filter((p) => p.role === 'DEVELOPER'),
    testers = people.filter((p) => p.role === 'TESTER');
  for (const [projectIndex, name] of projectNames.entries()) {
    const owner = owners[projectIndex % owners.length],
      product = products[projectIndex % products.length];
    const developer = developers[projectIndex % developers.length],
      tester = testers[projectIndex % testers.length];
    const fields = {
      name: `【演示】${name}`,
      description: `保留演示批次 ${batch}。包含需求评审、开发、测试与缺陷追踪；用于查看界面与分页，不代表实际交付。`,
      color: ['teal', 'blue', 'violet', 'amber', 'rose'][projectIndex % 5],
      icon: ['layers', 'rocket', 'code', 'compass', 'shield', 'cube'][projectIndex % 6],
      startDate: date(-56),
      endDate: date(56),
    };
    const project = await post(administrator, '/projects', {
      key: `DEMO${batch}${projectIndex.toString(36).toUpperCase()}`,
      ownerId: owner.id,
      ...fields,
    });
    const p = project.id,
      root = `/projects/${p}`,
      q = `${root}/quality`;
    manifest.projects.push({
      id: p,
      name: fields.name,
      key: `DEMO${batch}${projectIndex.toString(36).toUpperCase()}`,
      rich: projectIndex < 5,
    });
    save();
    for (const person of people.filter((person) => person.id !== owner.id))
      await post(owner, `${root}/members`, { email: person.email, roles: [person.role] });
    if (projectIndex < 5)
      await post(administrator, `${root}/members`, {
        email: administrator.email,
        roles: ['OWNER'],
      });
    if (projectIndex === 5 || projectIndex >= 12) continue;
    await act(owner, root, 'status', { status: 'ACTIVE' });
    const iterations = [];
    for (let i = 0; i < 4; i++) {
      const iteration = await post(owner, `${root}/iterations`, {
        name: [
          '当前迭代 · 功能交付',
          '下轮计划 · 体验优化',
          '远期计划 · 能力扩展',
          '上轮回顾 · 基础准备',
        ][i],
        goal: [
          '完成核心需求开发、测试和缺陷闭环',
          '处理体验问题与下一轮评审',
          '梳理技术优化和依赖',
          '完成基础准备并保留复盘',
        ][i],
        ownerId: projectIndex === 0 && i === 0 ? administrator.id : i % 2 ? product.id : owner.id,
        startDate: date(i === 3 ? -42 : i === 0 ? -14 : i * 14 + 1),
        endDate: date(i === 3 ? -29 : i === 0 ? 14 : i * 14 + 14),
      });
      iterations.push(iteration.id);
      if (i === 0 || i === 3) await act(owner, `${root}/iterations/${iteration.id}`, 'start');
      if (i === 3)
        await act(owner, `${root}/iterations/${iteration.id}`, 'close', {
          summary: '基础准备阶段结束，交付记录和遗留项已整理。',
        });
    }
    if (projectIndex >= 5) {
      if (projectIndex % 2) await act(owner, root, 'status', { status: 'PAUSED' });
      continue;
    }
    await comment(
      product,
      p,
      'PROJECT',
      p,
      '本项目为保留的演示数据。请从当前迭代、需求、任务看板及质量页签查看各阶段效果。',
    );
    await attach(
      owner,
      p,
      'PROJECT',
      p,
      '项目演示说明.md',
      `# ${name}\n\n批次 ${batch}\n\n需求、任务、用例、提测、测试和缺陷均由真实业务命令生成。`,
    );
    const requirements = [];
    for (let i = 0; i < 24; i++) {
      const reqFields = {
        title: features[i],
        description: `【演示】${name}：${features[i]}。覆盖正常、异常、权限与重复操作，保留过程记录和责任安排。`,
        acceptanceCriteria:
          '1. 正常操作可完成且结果准确。\n2. 非授权角色无法读取或修改。\n3. 异常操作有明确反馈，重试不会产生重复记录。',
        ownerId: product.id,
        type: i % 5 === 0 ? 'MAINTENANCE' : 'FUNCTIONAL',
        priority: ['URGENT', 'HIGH', 'MEDIUM', 'LOW'][i % 4],
        iterationId: iterations[i === 13 || i === 14 || i >= 20 ? 1 : 0],
      };
      const requirement = await post(product, `${root}/requirements`, reqFields);
      const reqPath = `${root}/requirements/${requirement.id}`;
      const item = { ...requirement, fields: reqFields, tasks: [], cases: [] };
      requirements.push(item);
      if (i === 20) continue;
      await act(product, reqPath, 'submit', {
        reviewerId: projectIndex === 0 && i === 21 ? administrator.id : owner.id,
      });
      if (i === 21) continue;
      if (i === 22) {
        await act(owner, reqPath, 'return', {
          comment: '请补充异常分支、权限边界和可验证的验收标准。',
        });
        continue;
      }
      if (i === 23) {
        await act(product, reqPath, 'withdraw');
        await act(product, reqPath, 'cancel', { comment: '旧入口已被新方案替代，保留取消记录。' });
        continue;
      }
      await act(owner, reqPath, 'approve');
      for (let j = 0; j < 2; j++) {
        const assigned =
          i === 17 && j === 1
            ? null
            : projectIndex === 0 && i === 17
              ? administrator
              : developers[(projectIndex + j) % developers.length];
        const task = await post(owner, `${root}/tasks`, {
          requirementId: requirement.id,
          title: `${features[i]} · ${j ? '接口与权限校验' : '交互与功能实现'}`,
          description: '按确认的验收标准实现；保留代码、自测和异常处理说明。',
          estimatedHours: [2, 4, 6, 8][i % 4],
          dueDate: date(i % 5 === 0 ? -2 : 7 + j * 3),
          priority: reqFields.priority,
          assigneeId: assigned?.id ?? null,
        });
        item.tasks.push({ ...task, actor: assigned });
        if (i < 12 || i % 4 === 0 || (i === 18 && j === 0))
          await act(assigned, `${root}/tasks/${task.id}`, 'start');
        if (i === 18 && j === 0)
          await act(assigned, `${root}/tasks/${task.id}`, 'block', {
            reason: '等待产品确认第三方接口的异常返回约定。',
            helperId: product.id,
          });
        if (i === 19 && j === 1) {
          await act(assigned, `${root}/tasks/${task.id}`, 'start');
          await act(assigned, `${root}/tasks/${task.id}`, 'complete', { reason: '演示开发完成' });
        }
      }
      for (let j = 0; j < 2; j++) {
        const testcaseFields = {
          title: `${features[i]} · ${j ? '异常与权限回归' : '正常主流程'}`,
          requirementIds: [requirement.id],
          ownerId: tester.id,
          priority: reqFields.priority,
          preconditions: '使用有效账号，准备本需求对应的授权数据和测试环境。',
          steps: [
            { action: '准备有效输入并进入功能入口', expected: '页面及数据按权限正确展示' },
            {
              action: j ? '重复请求或改用无权限账号' : '提交有效数据并查看结果',
              expected: j ? '明确拒绝非法操作且不产生重复数据' : '操作成功，结果与验收标准一致',
            },
          ],
        };
        const testcase = await post(tester, `${root}/test-cases`, testcaseFields);
        item.cases.push({ ...testcase, fields: testcaseFields });
        const casePath = `${root}/test-cases/${testcase.id}`;
        if (i >= 12 && j === 1) continue;
        await act(tester, casePath, 'submit', {
          reviewerId: testers[(projectIndex + 1) % testers.length].id,
        });
        if (i === 13) continue;
        if (i === 15) {
          await act(testers[(projectIndex + 1) % testers.length], casePath, 'return', {
            comment: '请补充具体输入值和可观测的预期结果。',
          });
          continue;
        }
        await act(testers[(projectIndex + 1) % testers.length], casePath, 'approve');
        if (i === 14)
          await act(tester, casePath, 'revise', {
            ...testcaseFields,
            reason: '补充边界场景，保留上一轮已通过修订。',
            steps: [
              ...testcaseFields.steps,
              { action: '使用边界输入再次提交', expected: '正确处理边界并保留记录' },
            ],
          });
        if (i === 19)
          await act(tester, casePath, 'deprecate', {
            comment: '场景已由其他用例覆盖，保留废弃记录。',
          });
      }
      if (i % 4 === 0)
        await comment(
          product,
          p,
          'REQUIREMENT',
          requirement.id,
          '请关注本需求的权限边界与异常恢复，测试准备和开发任务可以并行推进。',
        );
    }
    for (let i = 0; i < 13; i++) {
      const r = requirements[i],
        taskIds = r.tasks.map((t) => t.id);
      const release = await post(owner, `${q}/releases`, {
        name: `v1.${i}.0 · ${features[i]}`,
        description: '演示目标版本，按本范围登记构建及提测。',
        requirementIds: [r.id],
        taskIds,
      });
      if (i === 12) continue;
      const build = async (round) =>
        post(developer, `${q}/builds`, {
          releaseId: release.id,
          identifier: `demo-${i + 1}-build-00${round}`,
          codeUrl: `https://git.example.test/demo/${batch}/commit/${i}-${round}`,
          artifactUrl: `https://ci.example.test/demo/${batch}/build/${i}-${round}`,
          notes: '演示构建引用，仅用于展示交接与追踪，不代表真实安装包。',
        });
      const record = async (testCase, b, outcome, type = 'INITIAL', defectIds = []) => {
        const entry = await post(tester, `${q}/records`, {
          testCaseId: testCase.id,
          requirementId: r.id,
          environment: 'QA 演示环境',
          buildId: b.id,
          type,
          defectIds,
        });
        if (!outcome) return entry;
        const evidence = await attach(
          tester,
          p,
          'TEST_RECORD',
          entry.id,
          '测试证据.txt',
          `演示批次：${batch}\n场景：${testCase.fields.title}\n结果：${outcome}`,
        );
        await act(tester, `${q}/records/${entry.id}`, 'finish', {
          outcome,
          actual:
            outcome === 'PASSED'
              ? '实际行为符合用例预期。'
              : '异常输入仍能通过，实际表现不符合预期。',
          evidence: '操作及响应见当前记录附件。',
          attachmentIds: [evidence.id],
          assigneeId: developer.id,
          retesterId: tester.id,
          severity: i === 11 ? 'MINOR' : 'MAJOR',
          defectIds,
        });
        return get(tester, `${q}/records/${entry.id}`);
      };
      for (const task of r.tasks) {
        const current = await get(owner, `${root}/tasks/${task.id}`);
        if (current.status === 'TODO') await act(task.actor, `${root}/tasks/${task.id}`, 'start');
        await act(task.actor, `${root}/tasks/${task.id}`, 'complete', {
          reason: '开发和自测已完成',
        });
      }
      const b1 = await build(1);
      if (i === 4 || i === 6) continue;
      if (i === 5) {
        await act(r.tasks[0].actor, `${root}/tasks/${r.tasks[0].id}`, 'reopen', {
          reason: '补充实现',
        });
        continue;
      }
      if (i === 3 || i === 10) {
        await record(r.cases[0], b1, null);
        continue;
      }
      if (i === 1 || i === 2) {
        await record(r.cases[0], b1, 'PASSED');
        if (i === 1) await record(r.cases[1], b1, 'PASSED');
        continue;
      }
      const first = await record(r.cases[0], b1, 'FAILED');
      await record(r.cases[1], b1, 'PASSED');
      const defect = first.defects[0];
      if (i === 7) {
        for (const conclusion of ['DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE']) {
          const special = await post(tester, `${q}/defects`, {
            title: `${features[i]} · ${conclusion}`,
            requirementId: r.id,
            foundBuildId: b1.id,
            severity: 'MINOR',
            environment: 'QA 演示环境',
            reproduction: '复核场景',
            expected: '符合约定',
            actual: '报告差异',
            assigneeId: developer.id,
            retesterId: tester.id,
          });
          await act(tester, `${q}/defects/${special.id}`, 'dispose', {
            conclusion,
            evidence: '核对当前场景与约定',
            ...(conclusion === 'DUPLICATE' ? { duplicateOfId: defect.id } : {}),
          });
        }
        continue;
      }
      if (i === 11) {
        await act(tester, `${q}/defects/${defect.id}`, 'dispose', {
          conclusion: 'DEFERRED',
          deferUntil: date(14),
          evidence: '一般问题保留跟进责任',
        });
        continue;
      }
      await act(tester, `${q}/defects/${defect.id}`, 'confirm');
      await act(developer, `${q}/defects/${defect.id}`, 'start');
      if (i === 8) continue;
      const b2 = await build(2);
      await act(developer, `${q}/defects/${defect.id}`, 'fix', {
        buildId: b2.id,
        evidence: '修复提交已登记',
      });
      if (i === 9) {
        await record(r.cases[0], b2, null, 'RETEST', [defect.id]);
        continue;
      }
      const second = await record(r.cases[0], b2, 'FAILED', 'RETEST', [defect.id]);
      await act(developer, `${q}/defects/${defect.id}`, 'start');
      const b3 = await build(3);
      await act(developer, `${q}/defects/${defect.id}`, 'fix', {
        buildId: b3.id,
        evidence: '补齐边界校验',
      });
      const third = await record(r.cases[0], b3, 'PASSED', 'RETEST', [defect.id]);
      await record(r.cases[1], b3, 'PASSED');
      assert.equal((await get(tester, `${q}/defects/${defect.id}`)).status, 'CLOSED');
      assert.equal((await get(tester, `${root}/requirements/${r.id}`)).status, 'COMPLETED');
      manifest.journeys.push({
        projectId: p,
        requirementId: r.id,
        releaseId: release.id,
        defectId: defect.id,
        records: [first.id, second.id, third.id],
      });
      save();
    }

    const changed = requirements[16];
    await act(product, `${root}/requirements/${changed.id}`, 'revise', {
      ...changed.fields,
      acceptanceCriteria: changed.fields.acceptanceCriteria + '\n4. 新增跨部门权限边界。',
      reason: '业务确认增加跨部门权限规则。',
      impact: '关联任务需核对新依据，用例需复查后重新评审。',
    });
    if (projectIndex === 4) await act(owner, root, 'status', { status: 'PAUSED' });
    console.log(JSON.stringify({ progress: projectIndex + 1, project: name, requests, batch }));
    save();
  }
  // 将内容最完整的演示项目放到列表前方，保留多页项目列表。
  for (const project of [...manifest.projects.filter((p) => p.rich)].reverse()) {
    const detail = await get(administrator, `/projects/${project.id}`);
    if (detail.status !== 'ACTIVE') continue;
    await act(administrator, `/projects/${project.id}`, 'update', {
      name: detail.name,
      description: detail.description,
      color: detail.color,
      icon: detail.icon,
      startDate: detail.startDate,
      endDate: detail.endDate,
    });
  }
  const ids = manifest.projects.map((p) => p.id),
    counts = {},
    groups = {};
  for (const model of [
    'project',
    'projectMember',
    'iteration',
    'requirement',
    'task',
    'testCase',
    'release',
    'build',
    'testRecord',
    'defect',
    'defectDisposition',
    'comment',
    'attachment',
    'notification',
    'activityLog',
  ]) {
    const where = model === 'project' ? { id: { in: ids } } : { projectId: { in: ids } };
    counts[model] = await db[model].count({ where });
    if (['project', 'requirement', 'task', 'testCase', 'defect'].includes(model))
      groups[model] = await db[model].groupBy({ by: ['status'], where, _count: true });
  }
  manifest.counts = counts;
  manifest.statuses = groups;
  manifest.requests = requests;
  manifest.finishedAt = new Date().toISOString();
  save();
  console.log(
    JSON.stringify({ batch, counts, output, credentials: output + '/access.json' }, null, 2),
  );
} catch (error) {
  manifest.error = error.message;
  save();
  throw error;
} finally {
  await app.close();
  await db.$disconnect();
}
