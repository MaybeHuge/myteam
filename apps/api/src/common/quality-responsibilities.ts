import { Prisma } from '../generated/prisma/client.js';
import { ApiException } from './http.js';
export async function assertQualityHandover(
  tx: Prisma.TransactionClient,
  userId: string,
  projectId?: string,
  lost = { accept: true, execute: true, fix: true, retest: true },
) {
  const scope = projectId ? { projectId } : {};
  const counts = lost.execute
    ? await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`
    SELECT count(*) FROM "TestRecord" r JOIN "Requirement" q ON q.id=r."requirementId" JOIN "TestCase" c ON c.id=r."testCaseId"
    WHERE r."executorId"=${userId}::uuid AND r.outcome='NOT_RUN'
      ${projectId ? Prisma.sql`AND r."projectId"=${projectId}::uuid` : Prisma.empty}
      AND r.cycle=q."testCycle" AND r."requirementRevision"=q.revision AND r."caseRevision"=c.revision
      AND c.status='READY' AND NOT c."needsReview" AND q.status NOT IN ('DRAFT','IN_REVIEW','CANCELLED')
  `)
    : [{ count: 0n }];
  const pending =
    (counts[0]?.count ?? 0n) > 0n ||
    (lost.fix &&
      (await tx.defect.count({
        where: {
          ...scope,
          assigneeId: userId,
          status: { in: ['UNCONFIRMED', 'OPEN', 'FIXING', 'AWAITING_RETEST', 'DEFERRED'] },
        },
      }))) ||
    (lost.retest &&
      (await tx.defect.count({
        where: {
          ...scope,
          retesterId: userId,
          status: { in: ['UNCONFIRMED', 'OPEN', 'FIXING', 'AWAITING_RETEST', 'DEFERRED'] },
        },
      })));
  if (pending)
    throw new ApiException(
      422,
      'BUSINESS_RULE_VIOLATION',
      '该成员仍有测试记录或缺陷处理责任，请先完成或移交当前责任',
    );
}
