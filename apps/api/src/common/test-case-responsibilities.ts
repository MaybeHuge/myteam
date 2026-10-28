import type { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './http.js';
export async function assertTestCaseHandover(
  tx: Prisma.TransactionClient,
  userId: string,
  options: { projectId?: string; owner: boolean; reviewer: boolean },
) {
  const scope = options.projectId ? { projectId: options.projectId } : {};
  if (
    options.owner &&
    (await tx.testCase.count({
      where: { ...scope, ownerId: userId, status: { not: 'DEPRECATED' } },
    }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍负责未废弃用例，请先移交负责人或废弃用例',
    );
  if (
    options.reviewer &&
    (await tx.testCase.count({ where: { ...scope, reviewerId: userId, status: 'IN_REVIEW' } }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍有待评审用例，请先完成或撤回并重新安排评审',
    );
}
