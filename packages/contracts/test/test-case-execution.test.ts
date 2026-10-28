import { describe, expect, it } from 'vitest';
import {
  testCaseExecutionSnapshotSchema,
  testCaseSnapshotSchema,
  jsonSchema,
} from '../src/index.js';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const fixture = () => ({
  schemaVersion: 1,
  projectId: id(1),
  source: { testCaseId: id(2), revisionId: id(3), revision: 2 },
  content: {
    code: 'LOGIN-CASE-0001',
    title: '验证码登录',
    preconditions: '已注册用户\n验证码未使用',
    steps: [
      { action: '输入手机号', expected: '展示验证码输入框' },
      { action: '提交验证码', expected: '  进入工作台\n保留会话  ' },
    ],
    priority: 'HIGH',
    owner: { id: id(4), name: '测试人员' },
  },
  requirements: [
    {
      requirementId: id(5),
      revision: 3,
      scopeVersion: 2,
      code: 'LOGIN-REQ-0001',
      title: '手机号登录',
    },
  ],
  approval: {
    reviewId: id(6),
    round: 2,
    reviewer: { id: id(7), name: '指定评审人' },
    decidedBy: { id: id(8), name: '代评管理员' },
    approvedAt: '2026-10-28T01:00:00.000Z',
  },
  capturedAt: '2026-10-28T02:00:00.000Z',
  capturedBy: { id: id(4), name: '测试人员' },
});

describe('正式执行快照 v1', () => {
  it('完整内容、步骤顺序与原始文本可无损 JSON 往返，快照不引用原输入对象', () => {
    const input = fixture(),
      frozen = testCaseExecutionSnapshotSchema.parse(input);
    const encoded = JSON.stringify(frozen);
    expect(frozen.content.steps[1]!.expected).toBe('  进入工作台\n保留会话  ');
    expect(testCaseExecutionSnapshotSchema.parse(JSON.parse(encoded))).toEqual(frozen);
    input.content.steps[0]!.expected = '改变输入';
    input.requirements[0]!.title = '改变需求名称';
    input.approval.reviewer.name = '改变评审人名称';
    expect(JSON.stringify(frozen)).toBe(encoded);
  });
  it('解析和重新读取时逐层只读，不能修改步骤、责任人、需求令牌或评审来源', () => {
    const frozen = testCaseExecutionSnapshotSchema.parse(fixture());
    for (const node of [
      frozen,
      frozen.source,
      frozen.content,
      frozen.content.steps,
      frozen.content.steps[0],
      frozen.content.owner,
      frozen.requirements,
      frozen.requirements[0],
      frozen.approval,
      frozen.approval.reviewer,
      frozen.approval.decidedBy,
      frozen.capturedBy,
    ])
      expect(Object.isFrozen(node)).toBe(true);
    expect(Reflect.set(frozen.content.steps[0]!, 'expected', '覆盖')).toBe(false);
    expect(frozen.content.steps[0]!.expected).toBe('展示验证码输入框');
  });
  it('拒绝不完整执行内容及超限步骤，不采用草稿默认值填补步骤或预期', () => {
    const sample = fixture();
    for (const content of [
      { ...sample.content, title: '  ' },
      { ...sample.content, owner: null },
      { ...sample.content, steps: [] },
      { ...sample.content, steps: [{ action: '输入手机号' }] },
      { ...sample.content, steps: [{ action: '输入手机号', expected: '  ' }] },
      { ...sample.content, steps: Array.from({ length: 101 }, () => sample.content.steps[0]) },
    ])
      expect(testCaseExecutionSnapshotSchema.safeParse({ ...sample, content }).success).toBe(false);
  });
  it('拒绝空/重复/超限需求依据、非法修订、缺少评审及时间倒置', () => {
    const sample = fixture();
    for (const patch of [
      { requirements: [] },
      { requirements: [...sample.requirements, ...sample.requirements] },
      {
        requirements: Array.from({ length: 51 }, (_, n) => ({
          ...sample.requirements[0],
          requirementId: id(n + 20),
        })),
      },
      { requirements: [{ ...sample.requirements[0], revision: 0 }] },
      { requirements: [{ ...sample.requirements[0], scopeVersion: -1 }] },
      { source: { ...sample.source, revision: 0 } },
      { source: { ...sample.source, revisionId: 'missing' } },
      { approval: undefined },
      { capturedBy: undefined },
      { capturedAt: '2026-10-27T00:00:00.000Z' },
    ])
      expect(testCaseExecutionSnapshotSchema.safeParse({ ...sample, ...patch }).success).toBe(
        false,
      );
  });
  it('版本和所有层级严格校验，不能注入执行结果或默默丢弃未知字段', () => {
    const sample = fixture();
    for (const patch of [
      { schemaVersion: undefined },
      { schemaVersion: 2 },
      { result: 'PASSED' },
      { source: { ...sample.source, buildId: id(9) } },
      {
        content: {
          ...sample.content,
          steps: [{ ...sample.content.steps[0], actualResult: '通过' }],
        },
      },
    ])
      expect(testCaseExecutionSnapshotSchema.safeParse({ ...sample, ...patch }).success).toBe(
        false,
      );
    const schema = jsonSchema(testCaseExecutionSnapshotSchema);
    expect(schema.additionalProperties).toBe(false);
    expect(JSON.stringify(schema)).toContain('schemaVersion');
  });
  it('保留旧修订历史中的草稿兼容性，旧内容不会被当成完整执行快照读取', () => {
    const legacy = {
      code: 'LOGIN-CASE-0001',
      title: '草稿',
      preconditions: '',
      steps: [],
      priority: 'MEDIUM',
      owner: null,
      revision: 1,
      requirements: [{ id: id(5), code: 'LOGIN-REQ-0001', title: '手机号登录' }],
    };
    expect(testCaseSnapshotSchema.parse(legacy)).toEqual(legacy);
    expect(testCaseExecutionSnapshotSchema.safeParse(legacy).success).toBe(false);
  });
});
