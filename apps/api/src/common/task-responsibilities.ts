import type { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './http.js';
export async function assertTaskHandover(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId?: string,
  responsibilities = { assignee: true, helper: true },
) {
  if (
    responsibilities.assignee &&
    (await tx.task.count({
      where: {
        ...(projectId ? { projectId } : {}),
        assigneeId: userId,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍负责未结束任务，请先改派任务负责人',
    );
  if (
    responsibilities.helper &&
    (await tx.task.count({
      where: {
        ...(projectId ? { projectId } : {}),
        helperId: userId,
        blocked: true,
        status: { notIn: ['COMPLETED', 'CANCELLED'] },
      },
    }))
  )
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍有待协助的阻塞任务，请先恢复、取消或调整协助人',
    );
}
