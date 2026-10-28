import { describe, expect, it } from 'vitest';
import {
  createTestCaseSchema,
  reviseTestCaseSchema,
  blockTaskSchema,
  reasonTaskSchema,
  reviseRequirementSchema,
  acknowledgeTaskSchema,
  taskBoardQuerySchema,
  requirementEvidenceTokenSchema,
  hasPermission,
  jsonSchema,
  loginSchema,
  paginationSchema,
  sessionResponseSchema,
  createProjectSchema,
  rolesSchema,
  addProjectMemberSchema,
  createIterationSchema,
  closeIterationSchema,
  collaborationTargetSchema,
  createCommentSchema,
  projectRoles,
  workbenchQuerySchema,
  createTaskSchema,
  updateTaskSchema,
  assignTaskSchema,
  startTaskSchema,
  createRequirementSchema,
  updateRequirementSchema,
  submitRequirementSchema,
  reasonRequirementSchema,
  requirementQuerySchema,
} from '../src/index.js';

describe('共享契约和项目权限', () => {
  it('协作目标仅开放已有模块，评论不能为空，各业务角色可协作，只读不可写', () => {
    for (const role of projectRoles)
      expect(hasPermission([role], 'collaboration:write')).toBe(role !== 'VIEWER');
    expect(createCommentSchema.safeParse({ body: '  ' }).success).toBe(false);
    expect(
      collaborationTargetSchema.safeParse({
        targetType: 'DEPLOYMENT',
        targetId: '45c77d73-7786-45aa-9c37-cee5dcb60bc1',
      }).success,
    ).toBe(false);
  });
  it('用例允许不完整草稿；同一需求不能重复关联，步骤与修订原因有明确边界', () => {
    const id = '45c77d73-7786-45aa-9c37-cee5dcb60bc1';
    const input = { title: '验证码登录', requirementIds: [id] };
    expect(createTestCaseSchema.parse(input).steps).toEqual([]);
    expect(createTestCaseSchema.safeParse({ ...input, requirementIds: [] }).success).toBe(false);
    expect(createTestCaseSchema.safeParse({ ...input, requirementIds: [id, id] }).success).toBe(
      false,
    );
    expect(
      createTestCaseSchema.safeParse({
        ...input,
        steps: Array.from({ length: 101 }, () => ({ action: '', expected: '' })),
      }).success,
    ).toBe(false);
    expect(reviseTestCaseSchema.safeParse({ ...input, version: 1, reason: ' ' }).success).toBe(
      false,
    );
    expect(
      collaborationTargetSchema.parse({ targetType: 'TEST_CASE', targetId: id }).targetType,
    ).toBe('TEST_CASE');
    expect(hasPermission(['DEVELOPER'], 'case:review')).toBe(false);
    expect(hasPermission(['TESTER'], 'case:review')).toBe(true);
  });
  it('迭代拒绝无效/倒置日期，负责人必填，总结不能空白', () => {
    const input = {
      name: '第一轮',
      ownerId: '45c77d73-7786-45aa-9c37-cee5dcb60bc1',
      startDate: '2026-11-01',
      endDate: '2026-11-14',
    };
    expect(createIterationSchema.parse(input).goal).toBe('');
    expect(createIterationSchema.safeParse({ ...input, startDate: '2026-02-30' }).success).toBe(
      false,
    );
    expect(createIterationSchema.safeParse({ ...input, endDate: '2026-10-01' }).success).toBe(
      false,
    );
    expect(createIterationSchema.safeParse({ ...input, ownerId: '' }).success).toBe(false);
    expect(closeIterationSchema.safeParse({ version: 1, summary: '  ' }).success).toBe(false);
  });
  it('OpenAPI 保留经过规范化转换的角色输入类型', () => {
    expect(jsonSchema(addProjectMemberSchema)).toMatchObject({
      properties: {
        roles: {
          type: 'array',
          items: {
            type: 'string',
            enum: ['OWNER', 'PRODUCT', 'DEVELOPER', 'TESTER', 'RELEASE_MANAGER', 'VIEWER'],
          },
        },
      },
    });
  });
  it('项目标识规范化，拒绝倒置日期和空角色集', () => {
    expect(createProjectSchema.parse({ name: '项目', key: 'web' }).key).toBe('WEB');
    expect(
      createProjectSchema.safeParse({
        name: '项目',
        key: 'WEB',
        startDate: '2026-12-01',
        endDate: '2026-11-01',
      }).success,
    ).toBe(false);
    expect(rolesSchema.safeParse([]).success).toBe(false);
    expect(rolesSchema.parse(['DEVELOPER', 'DEVELOPER', 'TESTER'])).toEqual([
      'DEVELOPER',
      'TESTER',
    ]);
  });
  it('工作台限制筛选与安全分页范围，不能指定他人身份', () => {
    expect(workbenchQuerySchema.parse({}).status).toBe('all');
    expect(workbenchQuerySchema.safeParse({ status: 'CLOSED' }).success).toBe(false);
    expect(workbenchQuerySchema.parse({ ownerId: 'other' })).not.toHaveProperty('ownerId');
    for (const page of [0, -1, 1.5, 100001, Number.MAX_VALUE])
      expect(paginationSchema.safeParse({ page }).success).toBe(false);
  });
  it('限制分页和规范化邮箱，拒绝无效输入', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(loginSchema.parse({ email: 'DEV@EXAMPLE.TEST', password: 'x' }).email).toBe(
      'dev@example.test',
    );
  });
  it('只读和开发角色没有复测/发布等越权能力', () => {
    expect(hasPermission(['VIEWER'], 'task:write')).toBe(false);
    expect(hasPermission(['DEVELOPER'], 'defect:retest')).toBe(false);
    expect(hasPermission(['DEVELOPER', 'TESTER'], 'defect:retest')).toBe(true);
    expect(hasPermission(['OWNER'], 'risk:approve')).toBe(true);
  });
  it('从实际响应 schema 导出 OpenAPI，且不包含凭据字段', () => {
    const value = jsonSchema(sessionResponseSchema);
    expect(JSON.stringify(value)).toContain('csrfToken');
    expect(JSON.stringify(value)).not.toContain('passwordHash');
  });
});

describe('需求草稿与评审契约', () => {
  const id = '45c77d73-7786-45aa-9c37-cee5dcb60bc1';
  it('草稿可先只写标题，正文与关联有明确默认值，状态不可注入', () => {
    const data = createRequirementSchema.parse({ title: '  客户搜索  ', status: 'CONFIRMED' });
    expect(data).toEqual({
      title: '客户搜索',
      description: '',
      acceptanceCriteria: '',
      ownerId: null,
      iterationId: null,
      type: 'FUNCTIONAL',
      priority: 'MEDIUM',
    });
    expect(createRequirementSchema.safeParse({ title: ' ' }).success).toBe(false);
    expect(
      createRequirementSchema.safeParse({ title: 'a', acceptanceCriteria: 'x'.repeat(5001) })
        .success,
    ).toBe(false);
  });
  it('评审与更新需要版本，送审需要评审人，退回撤回取消必须说明原因', () => {
    expect(submitRequirementSchema.safeParse({ version: 1 }).success).toBe(false);
    expect(submitRequirementSchema.parse({ version: 1, reviewerId: id }).comment).toBe('');
    expect(updateRequirementSchema.safeParse({ title: 'a' }).success).toBe(false);
    expect(reasonRequirementSchema.safeParse({ version: 1, comment: '  ' }).success).toBe(false);
    expect(requirementQuerySchema.safeParse({ status: '任意状态' }).success).toBe(false);
    expect(
      collaborationTargetSchema.parse({ targetType: 'REQUIREMENT', targetId: id }).targetType,
    ).toBe('REQUIREMENT');
  });
});

describe('任务拆解与分配契约', () => {
  const id = '45c77d73-7786-45aa-9c37-cee5dcb60bc1';
  it('必须关联需求，估算按四分之一小时且日期合法，状态不可由表单跳转', () => {
    expect(createTaskSchema.safeParse({ title: '任务' }).success).toBe(false);
    const data = createTaskSchema.parse({
      title: '  实现搜索  ',
      requirementId: id,
      status: 'COMPLETED',
    });
    expect(data.title).toBe('实现搜索');
    expect(data).not.toHaveProperty('status');
    expect(data.assigneeId).toBe(null);
    expect(data).not.toHaveProperty('iterationId');
    for (const estimatedHours of [-1, 0.1, 10000.25])
      expect(
        createTaskSchema.safeParse({ title: '任务', requirementId: id, estimatedHours }).success,
      ).toBe(false);
    expect(
      createTaskSchema.safeParse({ title: '任务', requirementId: id, dueDate: '2026-02-30' })
        .success,
    ).toBe(false);
    expect(
      createTaskSchema.parse({ title: '任务', requirementId: id, estimatedHours: 1.25 })
        .estimatedHours,
    ).toBe(1.25);
  });
  it('改派必须携带版本和原因，后续状态只能通过领域命令变更', () => {
    expect(assignTaskSchema.safeParse({ assigneeId: id, reason: '安排' }).success).toBe(false);
    expect(assignTaskSchema.safeParse({ version: 1, assigneeId: id, reason: ' ' }).success).toBe(
      false,
    );
    expect(updateTaskSchema.safeParse({ title: '任务', iterationId: null }).success).toBe(false);
    expect(startTaskSchema.parse({ version: 1, status: 'COMPLETED' })).toEqual({
      version: 1,
      reason: '',
    });
    expect(collaborationTargetSchema.parse({ targetType: 'TASK', targetId: id }).targetType).toBe(
      'TASK',
    );
  });
});

describe('M2 看板、阻塞、修订与失效契约', () => {
  const id = '45c77d73-7786-45aa-9c37-cee5dcb60bc1';
  it('阻塞要原因与协助人，恢复取消和修订必须保留原因及影响', () => {
    expect(blockTaskSchema.safeParse({ version: 1, reason: '等待依赖' }).success).toBe(false);
    expect(blockTaskSchema.safeParse({ version: 1, reason: ' ', helperId: id }).success).toBe(
      false,
    );
    expect(reasonTaskSchema.safeParse({ version: 1, reason: '' }).success).toBe(false);
    expect(
      reviseRequirementSchema.safeParse({ title: '新范围', version: 1, reason: '调整', impact: '' })
        .success,
    ).toBe(false);
    expect(acknowledgeTaskSchema.safeParse({ version: 1, reason: '已核对' }).success).toBe(false);
  });
  it('工作台与看板使用有效类别和安全分页，失效令牌绑定明确修订及范围代次', () => {
    expect(workbenchQuerySchema.parse({ kind: 'TASK_ASSIST', status: 'blocked' }).kind).toBe(
      'TASK_ASSIST',
    );
    expect(workbenchQuerySchema.safeParse({ kind: '他人的工作' }).success).toBe(false);
    expect(taskBoardQuerySchema.safeParse({ todoPage: 0 }).success).toBe(false);
    expect(taskBoardQuerySchema.parse({}).progressPage).toBe(1);
    expect(
      requirementEvidenceTokenSchema.safeParse({ requirementId: id, revision: 0, scopeVersion: 1 })
        .success,
    ).toBe(false);
  });
});
