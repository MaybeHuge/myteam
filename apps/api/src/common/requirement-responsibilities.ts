import type { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './http.js';
export async function assertRequirementHandover(
  tx: Prisma.TransactionClient,
  userId: string,
  options: { projectId?: string; owner?: boolean; reviewer?: boolean },
) {
  const scope = options.projectId ? { projectId: options.projectId } : {};
  if (
    options.owner &&
    (await tx.requirement.count({
      where: { ...scope, ownerId: userId, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
    }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍负责未结束需求，请先移交负责人或取消草稿',
    );
  if (
    options.reviewer &&
    (await tx.requirement.count({ where: { ...scope, reviewerId: userId, status: 'IN_REVIEW' } }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍有待评审需求，请先完成或撤回并重新安排评审',
    );
}
