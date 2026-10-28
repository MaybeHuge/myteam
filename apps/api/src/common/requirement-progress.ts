import type { Prisma } from '../generated/prisma/client.js';

// Call inside the authorized project write transaction. ProjectsService holds the project lock.
export async function refreshRequirementProgress(
  tx: Prisma.TransactionClient,
  projectId: string,
  requirementId: string,
) {
  const requirement = await tx.requirement.findFirst({ where: { projectId, id: requirementId } });
  if (!requirement || ['DRAFT', 'IN_REVIEW', 'CANCELLED'].includes(requirement.status)) return;
  const tasks = await tx.task.findMany({
    where: { projectId, requirementId, status: { not: 'CANCELLED' } },
  });
  let status: typeof requirement.status = 'CONFIRMED';
  if (tasks.some((t) => t.status !== 'TODO')) status = 'IMPLEMENTING';
  if (tasks.length && tasks.every((t) => t.status === 'COMPLETED')) {
    status = 'ACCEPTING';
    const records = await tx.testRecord.findMany({
      where: {
        projectId,
        requirementId,
        requirementRevision: requirement.revision,
        cycle: requirement.testCycle,
      },
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    });
    if (records.length) {
      status = 'TESTING';
      // Every non-deprecated linked case belongs to the current required scope, including unapproved cases.
      const cases = await tx.testCase.findMany({
        where: { projectId, status: { not: 'DEPRECATED' }, links: { some: { requirementId } } },
      });
      const passed =
        cases.length > 0 &&
        cases.every((c) => {
          const latest = records.find((r) => r.testCaseId === c.id);
          return (
            c.status === 'READY' &&
            !c.needsReview &&
            c.approvedRevision === c.revision &&
            latest?.caseRevision === c.revision &&
            latest.outcome === 'PASSED'
          );
        });
      const defects = await tx.defect.findMany({ where: { projectId, requirementId } });
      let blocked = false;
      for (const defect of defects) {
        let current = defect;
        const seen = new Set<string>();
        while (current.status === 'DUPLICATE' && current.duplicateOfId) {
          if (seen.has(current.id)) {
            blocked = true;
            break;
          }
          seen.add(current.id);
          const master = await tx.defect.findFirst({
            where: { projectId, id: current.duplicateOfId },
          });
          if (!master) {
            blocked = true;
            break;
          }
          current = master;
        }
        if (
          (['CRITICAL', 'MAJOR'].includes(defect.severity) ||
            ['CRITICAL', 'MAJOR'].includes(current.severity)) &&
          !['CLOSED', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE'].includes(current.status)
        )
          blocked = true;
      }
      if (passed && !blocked) status = 'COMPLETED';
    }
  }
  if (status !== requirement.status) {
    await tx.requirement.update({
      where: { id: requirementId },
      data: { status, version: { increment: 1 } },
    });
    await tx.workItem.update({
      where: { id: requirementId },
      data: { resolution: status === 'COMPLETED' ? 'DONE' : 'OPEN' },
    });
  }
}

export async function invalidateRequirementTests(
  tx: Prisma.TransactionClient,
  projectId: string,
  requirementId: string,
) {
  if (await tx.testRecord.count({ where: { projectId, requirementId } })) {
    await tx.requirement.update({
      where: { id: requirementId },
      data: { testCycle: { increment: 1 }, version: { increment: 1 } },
    });
  }
}
