import type { Prisma } from '../generated/prisma/client.js';

export const usableTestCaseWhere = (tx: Prisma.TransactionClient): Prisma.TestCaseWhereInput => ({
  status: 'READY',
  needsReview: false,
  approvedRevision: { equals: tx.testCase.fields.revision },
});

// 与需求详情共用 RepeatableRead 事务，统计覆盖全部关联用例，不受当前页影响。
export async function testPreparation(
  tx: Prisma.TransactionClient,
  projectId: string,
  requirement: { id: string; status: string; revision: number; acceptedRevision: number | null },
  projectKey: string,
  page: number,
  pageSize: number,
) {
  const where = { projectId, links: { some: { requirementId: requirement.id } } };
  const [rows, groups, usable, needsReview] = await Promise.all([
    tx.testCase.findMany({
      where,
      select: {
        id: true,
        number: true,
        title: true,
        status: true,
        revision: true,
        approvedRevision: true,
        needsReview: true,
        owner: { select: { id: true, name: true } },
        reviewer: { select: { id: true, name: true } },
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    }),
    tx.testCase.groupBy({ by: ['status'], where, _count: { _all: true } }),
    tx.testCase.count({ where: { ...where, ...usableTestCaseWhere(tx) } }),
    tx.testCase.count({ where: { ...where, status: { not: 'DEPRECATED' }, needsReview: true } }),
  ]);
  const count = (status: string) => groups.find((g) => g.status === status)?._count._all ?? 0;
  const total = groups.reduce((sum, g) => sum + g._count._all, 0);
  return {
    testPreparation: {
      requirementConfirmed:
        ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
          requirement.status,
        ) && requirement.acceptedRevision === requirement.revision,
      total,
      draft: count('DRAFT'),
      inReview: count('IN_REVIEW'),
      usable,
      needsReview,
      deprecated: count('DEPRECATED'),
    },
    cases: {
      items: rows.map((row) => ({
        ...row,
        code: `${projectKey}-CASE-${String(row.number).padStart(4, '0')}`,
        usable: row.status === 'READY' && !row.needsReview && row.approvedRevision === row.revision,
      })),
      total,
      page,
      pageSize,
    },
  };
}
