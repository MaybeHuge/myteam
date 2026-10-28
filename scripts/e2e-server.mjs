import {
  configureTestEnvironment,
  migrateTestDatabase,
  testPassword,
  prepareTestStorage,
} from '../apps/api/test/helpers.mjs';
import { createRequire } from 'node:module';

configureTestEnvironment('http://localhost:5174');
migrateTestDatabase();
const testStorage = await prepareTestStorage();
const { createDatabase } = await import('../apps/api/dist/infrastructure/database.js');
const { createApp } = await import('../apps/api/dist/app.js');
const require = createRequire(new URL('../apps/api/package.json', import.meta.url));
const argon2 = require('argon2');
const db = createDatabase(process.env.DATABASE_URL);
const passwordHash = await argon2.hash(testPassword, { type: argon2.argon2id });
for (const [email, name, isSystemAdmin] of [
  ['browser-admin@example.test', '浏览器测试管理员', true],
  ['browser-member@example.test', '浏览器测试成员', false],
  ['browser-collaborator@example.test', '陈青', false],
  ['browser-product@example.test', '林悦', false],
  ['browser-tester@example.test', '周宁', false],
]) {
  await db.user.upsert({
    where: { email },
    create: { email, name, passwordHash, isSystemAdmin },
    update: { passwordHash, active: true },
  });
  await db.loginAttempt.deleteMany({ where: { email } });
}
const administrator = await db.user.findUniqueOrThrow({
  where: { email: 'browser-admin@example.test' },
});
const collaborator = await db.user.findUniqueOrThrow({
  where: { email: 'browser-collaborator@example.test' },
});
const viewer = await db.user.findUniqueOrThrow({ where: { email: 'browser-member@example.test' } });
if (process.env.KEEP_TEST_DATA !== 'true') {
  const oldProjects = await db.project.findMany({
    where: { key: { startsWith: 'E2E' }, ownerId: administrator.id },
    select: { id: true },
  });
  await db.activityLog.deleteMany({
    where: { projectId: { in: oldProjects.map((project) => project.id) } },
  });
  await db.project.deleteMany({ where: { id: { in: oldProjects.map((project) => project.id) } } });
  const previousMember = await db.user.findUnique({
    where: { email: 'new-member@browser-e2e.test' },
  });
  if (
    previousMember &&
    !(await db.projectMember.count({ where: { userId: previousMember.id } })) &&
    !(await db.project.count({ where: { ownerId: previousMember.id } }))
  ) {
    await db.loginAttempt.deleteMany({ where: { email: previousMember.email } });
    await db.user.delete({ where: { id: previousMember.id } });
  }
}
// 仅写入经 helpers 校验的 _test 数据库；业务库不创建示例项目。
for (const [key, name, description, color, icon, status] of [
  [
    'VTEAM',
    'MyTeam 协作平台',
    '连接需求、研发与测试，让每一次团队协作都有清晰的交付路径。',
    'teal',
    'layers',
    'ACTIVE',
  ],
  [
    'VWEB',
    '品牌官网体验升级',
    '重新梳理品牌表达与访问体验，为每一位访客带来清晰而友好的第一印象。',
    'blue',
    'compass',
    'ACTIVE',
  ],
  [
    'VQA',
    '质量保障体系建设',
    '从可复用的用例和清晰的验收标准开始，把质量融入团队的日常。',
    'violet',
    'shield',
    'PENDING',
  ],
  [
    'VMOBILE',
    '移动端体验探索',
    '聚焦核心使用场景，探索轻盈、自然的移动协作体验。',
    'rose',
    'rocket',
    'PAUSED',
  ],
]) {
  const existing = await db.project.findUnique({ where: { key } });
  const project = await db.project.upsert({
    where: { key },
    create: {
      key,
      name,
      description,
      color,
      icon,
      status,
      ownerId: administrator.id,
      startDate: new Date('2026-10-01'),
      endDate: new Date('2026-11-30'),
    },
    update: { name, description, color, icon, status },
  });
  await db.projectMember.upsert({
    where: { projectId_userId: { projectId: project.id, userId: administrator.id } },
    create: { projectId: project.id, userId: administrator.id, roles: ['OWNER'] },
    update: { roles: ['OWNER'] },
  });
  if (key === 'VTEAM') {
    const tester = await db.user.findUniqueOrThrow({
      where: { email: 'browser-tester@example.test' },
    });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: tester.id } },
      create: { projectId: project.id, userId: tester.id, roles: ['TESTER'] },
      update: { roles: ['TESTER'] },
    });
    const product = await db.user.findUniqueOrThrow({
      where: { email: 'browser-product@example.test' },
    });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: product.id } },
      create: { projectId: project.id, userId: product.id, roles: ['PRODUCT'] },
      update: { roles: ['PRODUCT'] },
    });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: collaborator.id } },
      create: { projectId: project.id, userId: collaborator.id, roles: ['DEVELOPER'] },
      update: { roles: ['DEVELOPER'] },
    });
    await db.projectMember.upsert({
      where: { projectId_userId: { projectId: project.id, userId: viewer.id } },
      create: { projectId: project.id, userId: viewer.id, roles: ['VIEWER'] },
      update: { roles: ['VIEWER'] },
    });
  }
  if (!existing)
    await db.activityLog.create({
      data: {
        actorId: administrator.id,
        projectId: project.id,
        targetId: project.id,
        action: 'project.created',
        requestId: 'browser-fixture',
        details: { name, key },
      },
    });
}
const iterationProject = await db.project.findUniqueOrThrow({ where: { key: 'VTEAM' } });
if (process.env.KEEP_TEST_DATA !== 'true') {
  const previousCases = await db.testCase.findMany({
    where: { projectId: iterationProject.id, title: { startsWith: 'E2E用例 · ' } },
    select: { id: true },
  });
  const previousCaseIds = previousCases.map((item) => item.id);
  await db.activityLog.deleteMany({
    where: { projectId: iterationProject.id, targetId: { in: previousCaseIds } },
  });
  await db.notification.deleteMany({
    where: {
      projectId: iterationProject.id,
      targetType: 'TEST_CASE',
      targetId: { in: previousCaseIds },
    },
  });
  await db.comment.deleteMany({
    where: {
      projectId: iterationProject.id,
      targetType: 'TEST_CASE',
      targetId: { in: previousCaseIds },
    },
  });
  await db.testCase.deleteMany({ where: { id: { in: previousCaseIds } } });
  const previousTasks = await db.workItem.findMany({
    where: { projectId: iterationProject.id, kind: 'TASK', title: { startsWith: 'E2E任务 · ' } },
    select: { id: true },
  });
  const previousTaskIds = previousTasks.map((item) => item.id);
  await db.activityLog.deleteMany({
    where: { projectId: iterationProject.id, targetId: { in: previousTaskIds } },
  });
  await db.notification.deleteMany({
    where: {
      projectId: iterationProject.id,
      targetType: 'TASK',
      targetId: { in: previousTaskIds },
    },
  });
  await db.comment.deleteMany({
    where: {
      projectId: iterationProject.id,
      targetType: 'TASK',
      targetId: { in: previousTaskIds },
    },
  });
  await db.workItem.deleteMany({ where: { id: { in: previousTaskIds } } });
  const previousRequirements = await db.workItem.findMany({
    where: {
      projectId: iterationProject.id,
      kind: 'REQUIREMENT',
      title: { startsWith: 'E2E需求 · ' },
    },
    select: { id: true },
  });
  // 阶段退出用例可能创建未带任务前缀的子任务；先清理标记需求的全部测试子对象。
  const previousRequirementIds = previousRequirements.map((item) => item.id);
  const dependentTasks = await db.task.findMany({
    where: { projectId: iterationProject.id, requirementId: { in: previousRequirementIds } },
    select: { id: true },
  });
  await db.workItem.deleteMany({
    where: { projectId: iterationProject.id, id: { in: dependentTasks.map((item) => item.id) } },
  });
  await db.testCase.deleteMany({
    where: {
      projectId: iterationProject.id,
      links: { some: { requirementId: { in: previousRequirementIds } } },
    },
  });
  await db.activityLog.deleteMany({
    where: { targetId: { in: previousRequirements.map((item) => item.id) } },
  });
  await db.notification.deleteMany({
    where: {
      projectId: iterationProject.id,
      targetType: 'REQUIREMENT',
      targetId: { in: previousRequirements.map((item) => item.id) },
    },
  });
  await db.workItem.deleteMany({
    where: { id: { in: previousRequirements.map((item) => item.id) } },
  });
  const oldIterations = await db.iteration.findMany({
    where: { projectId: iterationProject.id, name: { startsWith: 'E2E · ' } },
    select: { id: true },
  });
  await db.activityLog.deleteMany({
    where: { targetId: { in: oldIterations.map((item) => item.id) } },
  });
  await db.iteration.deleteMany({ where: { id: { in: oldIterations.map((item) => item.id) } } });
}
const iterationFixture = await db.iteration.upsert({
  where: { projectId_name: { projectId: iterationProject.id, name: '交付准备与验收' } },
  create: {
    projectId: iterationProject.id,
    name: '交付准备与验收',
    goal: '梳理本轮交付范围，确认遗留事项全部有处理结论。',
    ownerId: administrator.id,
    startDate: new Date('2026-11-01'),
    endDate: new Date('2026-11-14'),
    status: 'ACTIVE',
    startedAt: new Date('2026-10-27T01:00:00Z'),
  },
  update: { status: 'ACTIVE', closedAt: null, closeSummary: null, version: { increment: 1 } },
});
// 此 WorkItem 为关闭门禁的隔离夹具，不宣称需求/任务业务已经实现。
await db.workItem.upsert({
  where: { id: '7b854ab4-252f-48aa-8e90-0a4260280721' },
  create: {
    id: '7b854ab4-252f-48aa-8e90-0a4260280721',
    projectId: iterationProject.id,
    iterationId: iterationFixture.id,
    kind: 'TASK',
    title: '尚未完成的范围（测试夹具）',
  },
  update: { resolution: 'OPEN' },
});
// 工作台只使用隔离测试库中的真实迭代对象，日期与业务时区一致。
const { workbenchDate } = await import('../apps/api/dist/modules/workbench/workbench.service.js');
const workbenchToday = workbenchDate();
const day = (offset) => new Date(new Date(workbenchToday).getTime() + offset * 86400000);
for (const [name, status, offset] of [
  ['工作台 · 准备本轮计划', 'PLANNING', 5],
  ['工作台 · 核对逾期目标', 'ACTIVE', -1],
  ['工作台 · 完成本轮收尾', 'ACTIVE', 0],
]) {
  const fields = {
    goal: '明确本轮目标与交付安排。',
    status,
    ownerId: administrator.id,
    startDate: day(-10),
    endDate: day(offset),
    closedAt: null,
    closeSummary: null,
  };
  await db.iteration.upsert({
    where: { projectId_name: { projectId: iterationProject.id, name } },
    create: { projectId: iterationProject.id, name, ...fields },
    update: { ...fields, version: { increment: 1 } },
  });
}
if (process.env.KEEP_TEST_DATA !== 'true')
  await db.attachment.deleteMany({
    where: { projectId: iterationProject.id, storageBucket: null },
  });
await db.$disconnect();
testStorage.onModuleDestroy();
const app = await createApp();
await app.listen(3001, '127.0.0.1');
console.log('MYTEAM_E2E_READY');
