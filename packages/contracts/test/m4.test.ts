import { expect, it } from 'vitest';
import {
  createBuildSchema,
  createTestRecordSchema,
  finishTestRecordSchema,
  createDefectSchema,
  retestDefectSchema,
  taskStatusSchema,
  hasPermission,
  workbenchQuerySchema,
} from '../src/index.js';
const id = '00000000-0000-4000-8000-000000000001';
it('任务仅开放待开始、进行中、完成，测试待办使用测试记录', () => {
  expect(taskStatusSchema.options).toEqual(['TODO', 'IN_PROGRESS', 'COMPLETED']);
  expect(workbenchQuerySchema.safeParse({ kind: 'TEST_RECORD' }).success).toBe(true);
  expect(workbenchQuerySchema.safeParse({ kind: 'SUBMISSION_REVIEW' }).success).toBe(false);
});
it('测试类型与结果分开；记录必须有需求、用例和环境，最终结果不得是复测或待测试', () => {
  const input = { requirementId: id, testCaseId: id, environment: 'qa' };
  expect(createTestRecordSchema.parse(input).type).toBe('INITIAL');
  expect(createTestRecordSchema.safeParse({ ...input, environment: ' ' }).success).toBe(false);
  for (const outcome of ['RETEST', 'NOT_RUN'])
    expect(finishTestRecordSchema.safeParse({ version: 1, outcome, actual: '通过' }).success).toBe(
      false,
    );
  expect(
    finishTestRecordSchema.safeParse({ version: 1, outcome: 'FAILED', actual: '实际错误' }).success,
  ).toBe(true);
});
it('手工缺陷可以不关联用例/测试记录/构建，复测仍需要证据，开发没有复测权限', () => {
  const defect = {
    title: '问题',
    reproduction: '操作',
    expected: '通过',
    actual: '失败',
    environment: 'qa',
    severity: 'MAJOR',
    requirementId: id,
    assigneeId: id,
    retesterId: id,
  };
  expect(createDefectSchema.parse(defect).testRecordIds).toEqual([]);
  expect(createDefectSchema.parse(defect).testCaseIds).toEqual([]);
  expect(retestDefectSchema.safeParse({ version: 1, reason: '已验证', passed: true }).success).toBe(
    false,
  );
  expect(
    retestDefectSchema.safeParse({ version: 1, reason: '已验证', passed: true, evidence: '截图' })
      .success,
  ).toBe(true);
  expect(hasPermission(['DEVELOPER'], 'defect:retest')).toBe(false);
});
it('构建链接仍只接受完整 HTTP(S) 地址或留空', () => {
  for (const field of ['codeUrl', 'artifactUrl']) {
    for (const value of ['www.example.com', 'http://', 'javascript:alert(1)', 'ftp://host/file'])
      expect(
        createBuildSchema.safeParse({ releaseId: id, identifier: 'build-1', [field]: value })
          .success,
      ).toBe(false);
    for (const value of ['', 'https://example.com/build', 'http://localhost:8080/artifact'])
      expect(
        createBuildSchema.safeParse({ releaseId: id, identifier: 'build-1', [field]: value })
          .success,
      ).toBe(true);
  }
});
