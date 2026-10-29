import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTestRecordSchema,
  finishTestRecordSchema,
  testRecordQuerySchema,
  testRecordSchema,
  testRecordListSchema,
  testRecordDetailSchema,
  testCaseExecutionSnapshotSchema,
} from '@myteam/contracts';
import type { Prisma, TestRecord } from '../../generated/prisma/client.js';
import { refreshRequirementProgress } from '../../common/requirement-progress.js';
import { ApiException } from '../../common/http.js';
import { TestCasesService } from '../test-cases/test-cases.service.js';
import { QualitySupport, rule, checkVersion, type Context } from './quality.support.js';
import { DefectsService } from './defects.service.js';

@Injectable()
export class TestRecordsService {
  constructor(
    readonly support: QualitySupport,
    readonly cases: TestCasesService,
    readonly defects: DefectsService,
  ) {}
  private async find(c: Context, id: string) {
    const row = await c.tx.testRecord.findFirst({ where: { id, projectId: c.project.id } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '测试记录不存在或不属于当前项目');
    return row;
  }
  private async current(c: Context, row: TestRecord) {
    const requirement = await c.tx.requirement.findUniqueOrThrow({
      where: { id: row.requirementId },
    });
    const testCase = await c.tx.testCase.findUniqueOrThrow({ where: { id: row.testCaseId } });
    let buildCurrent = true;
    if (row.buildId) {
      const build = await this.support.build(c.tx, c.project.id, row.buildId);
      const release = await this.support.release(c.tx, c.project.id, build.releaseId);
      buildCurrent =
        build.scopeVersion === release.scopeVersion &&
        !!(await c.tx.releaseItem.count({
          where: {
            projectId: c.project.id,
            releaseId: release.id,
            scopeVersion: release.scopeVersion,
            workItemId: row.requirementId,
          },
        }));
    }
    return (
      buildCurrent &&
      requirement.revision === row.requirementRevision &&
      requirement.testCycle === row.cycle &&
      requirement.acceptedRevision === requirement.revision &&
      ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
        requirement.status,
      ) &&
      testCase.revision === row.caseRevision &&
      testCase.status === 'READY' &&
      !testCase.needsReview &&
      !!(await c.tx.requirementCaseLink.count({
        where: { testCaseId: row.testCaseId, requirementId: row.requirementId },
      }))
    );
  }
  async dto(c: Context, row: TestRecord) {
    const snapshot = testCaseExecutionSnapshotSchema.parse(row.snapshot);
    const requirement = await c.tx.requirement.findUniqueOrThrow({
      where: { id: row.requirementId },
      include: { workItem: true },
    });
    const build = row.buildId ? await this.support.build(c.tx, c.project.id, row.buildId) : null;
    const links = await c.tx.defectRecordLink.findMany({
      where: { projectId: c.project.id, testRecordId: row.id },
    });
    const defects = await c.tx.defect.findMany({
      where: { projectId: c.project.id, id: { in: links.map((l) => l.defectId) } },
    });
    const current = await this.current(c, row);
    return testRecordSchema.parse({
      ...row,
      code: `${c.project.key}-TR-${String(row.number).padStart(4, '0')}`,
      caseCode: snapshot.content.code,
      caseTitle: snapshot.content.title,
      requirementTitle: requirement.workItem.title,
      buildIdentifier: build?.identifier ?? null,
      executor: await this.support.person(c.tx, row.executorId),
      current,
      createdAt: row.createdAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
      defects: defects.map((d) => ({
        id: d.id,
        code: `${c.project.key}-BUG-${String(d.number).padStart(4, '0')}`,
        title: d.title,
        status: d.status,
      })),
      allowedActions:
        c.project.status === 'ACTIVE' &&
        this.support.allowed(c, 'test:execute') &&
        (row.executorId === c.actor.userId || this.support.manager(c)) &&
        row.outcome === 'NOT_RUN' &&
        current
          ? ['finish']
          : [],
    });
  }
  async list(projectId: string, req: Request) {
    const d = testRecordQuerySchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const where: Prisma.TestRecordWhereInput = {
        projectId,
        ...(d.requirementId ? { requirementId: d.requirementId } : {}),
        ...(d.testCaseId ? { testCaseId: d.testCaseId } : {}),
        ...(d.outcome ? { outcome: d.outcome } : {}),
        ...(d.type ? { type: d.type } : {}),
        ...(d.q
          ? {
              OR: [
                { actual: { contains: d.q, mode: 'insensitive' } },
                { environment: { contains: d.q, mode: 'insensitive' } },
                { snapshot: { path: ['content', 'title'], string_contains: d.q } },
              ],
            }
          : {}),
      };
      return testRecordListSchema.parse({
        ...d,
        items: await Promise.all(
          (
            await c.tx.testRecord.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
              skip: (d.page - 1) * d.pageSize,
              take: d.pageSize,
            })
          ).map((r) => this.dto(c, r)),
        ),
        total: await c.tx.testRecord.count({ where }),
        canCreate: c.project.status === 'ACTIVE' && this.support.allowed(c, 'test:execute'),
      });
    });
  }
  async detail(projectId: string, id: string, req: Request) {
    return this.support.read(projectId, req, async (c) =>
      testRecordDetailSchema.parse({
        ...(await this.dto(c, await this.find(c, id))),
        history: await this.support.history(c, id),
      }),
    );
  }
  async create(projectId: string, input: unknown, req: Request) {
    const d = createTestRecordSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: 'test-record.create', ...d },
      'test:execute',
      async (c) => {
        const testCase = await c.tx.testCase.findFirst({
          where: {
            projectId,
            id: d.testCaseId,
            links: { some: { requirementId: d.requirementId } },
          },
        });
        rule(testCase, '用例不存在或未关联该需求');
        const [basis] = await this.support.validity.capture(c.tx, projectId, [d.requirementId]);
        const requirement = await c.tx.requirement.findUniqueOrThrow({
          where: { id: d.requirementId },
        });
        rule(
          !(await c.tx.testRecord.count({
            where: {
              projectId,
              requirementId: d.requirementId,
              testCaseId: d.testCaseId,
              cycle: requirement.testCycle,
              outcome: 'NOT_RUN',
              caseRevision: testCase.revision,
            },
          })),
          '该用例已有待填写的测试记录',
        );
        if (d.buildId) {
          const build = await this.support.build(c.tx, projectId, d.buildId);
          const release = await this.support.release(c.tx, projectId, build.releaseId);
          rule(
            release.scopeVersion === build.scopeVersion,
            '构建范围已经失效，请选择当前版本范围的构建；缺陷复测请联系开发更新修复构建',
          );
          rule(
            await c.tx.releaseItem.count({
              where: {
                projectId,
                releaseId: release.id,
                scopeVersion: release.scopeVersion,
                workItemId: d.requirementId,
              },
            }),
            '构建范围不包含该需求',
          );
        }
        const snapshot = await this.cases.freezeExecutionSnapshot(
          c.tx,
          projectId,
          testCase.id,
          testCase.revision,
          { id: c.actor.userId, name: c.actor.user.name },
        );
        const project = await c.tx.project.update({
          where: { id: projectId },
          data: { testRecordSequence: { increment: 1 } },
        });
        const row = await c.tx.testRecord.create({
          data: {
            projectId,
            number: project.testRecordSequence,
            testCaseId: testCase.id,
            caseRevision: testCase.revision,
            requirementId: d.requirementId,
            requirementRevision: basis!.revision,
            cycle: requirement.testCycle,
            snapshot: snapshot as Prisma.InputJsonObject,
            environment: d.environment,
            buildId: d.buildId,
            type: d.type,
            executorId: c.actor.userId,
          },
        });
        const defectIds = new Set(d.defectIds);
        if (d.type === 'RETEST' && !defectIds.size) {
          const caseLinks = await c.tx.defectCaseLink.findMany({
            where: { projectId, testCaseId: testCase.id },
          });
          const awaiting = await c.tx.defect.findMany({
            where: {
              projectId,
              requirementId: d.requirementId,
              id: { in: caseLinks.map((l) => l.defectId) },
              status: 'AWAITING_RETEST',
            },
          });
          for (const defect of awaiting) defectIds.add(defect.id);
        }
        for (const id of defectIds) {
          const defect = await this.defects.find(c.tx, projectId, id);
          rule(defect.requirementId === d.requirementId, '缺陷与测试记录需求不一致');
          const scope = await c.tx.defectCaseLink.findMany({ where: { projectId, defectId: id } });
          rule(
            !scope.length || scope.some((l) => l.testCaseId === testCase.id),
            '复测用例与缺陷场景不一致',
          );
          if (d.type === 'RETEST' && defect.status === 'AWAITING_RETEST' && defect.fixedBuildId)
            rule(d.buildId === defect.fixedBuildId, '复测须使用实际修复构建');
          await this.defects.linkEvidence(c, defect, [testCase.id], [row.id]);
        }
        await refreshRequirementProgress(c.tx, projectId, d.requirementId);
        await this.support.event(c, 'TEST_RECORD', row.id, 'test-record.created', {
          title: testCase.title,
          requirementId: d.requirementId,
        });
        return { id: row.id, version: row.version };
      },
    );
  }
  async finish(projectId: string, id: string, input: unknown, req: Request) {
    const d = finishTestRecordSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: 'test-record.finish', id, ...d },
      'test:execute',
      async (c) => {
        const row = await this.find(c, id);
        checkVersion(row, d.version);
        this.support.assigned(c, row.executorId);
        rule(row.outcome === 'NOT_RUN', '已完成记录不能覆盖，请新建测试记录');
        rule(await this.current(c, row), '需求、用例或开发范围已变化，请新建测试记录');
        const snapshot = testCaseExecutionSnapshotSchema.parse(row.snapshot);
        await this.support.validity.assertCurrent(
          c.tx,
          projectId,
          snapshot.requirements.map((r) => ({
            requirementId: r.requirementId,
            revision: r.revision,
            scopeVersion: r.scopeVersion,
          })),
        );
        const attached = await c.tx.attachment.count({
          where: {
            projectId,
            targetType: 'TEST_RECORD',
            targetId: id,
            id: { in: [...new Set(d.attachmentIds)] },
          },
        });
        rule(attached === new Set(d.attachmentIds).size, '附件须来自当前测试记录');
        const existing = await c.tx.defectRecordLink.findMany({
          where: { projectId, testRecordId: id },
        });
        const linked = new Set([...d.defectIds, ...existing.map((l) => l.defectId)]);
        if (d.outcome === 'FAILED' && !linked.size) {
          const cases = await c.tx.defectCaseLink.findMany({
            where: { projectId, testCaseId: row.testCaseId },
          });
          const reusable = await c.tx.defect.findFirst({
            where: {
              projectId,
              requirementId: row.requirementId,
              id: { in: cases.map((l) => l.defectId) },
              status: { notIn: ['CLOSED', 'DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE'] },
            },
            orderBy: { createdAt: 'desc' },
          });
          if (reusable) linked.add(reusable.id);
        }
        if (d.outcome === 'FAILED' && !linked.size) {
          rule(this.support.allowed(c, 'defect:report'), '没有报告缺陷权限');
          let assigneeId = d.assigneeId;
          if (!assigneeId)
            assigneeId =
              (
                await c.tx.task.findFirst({
                  where: { projectId, requirementId: row.requirementId, assigneeId: { not: null } },
                  orderBy: { updatedAt: 'desc' },
                })
              )?.assigneeId ?? undefined;
          rule(assigneeId, '首次失败请指定缺陷处理人');
          const retesterId = d.retesterId ?? row.executorId;
          await this.support.eligible(c.tx, projectId, assigneeId, 'defect:fix');
          await this.support.eligible(c.tx, projectId, retesterId, 'defect:retest');
          const project = await c.tx.project.update({
            where: { id: projectId },
            data: { defectSequence: { increment: 1 } },
          });
          const build = row.buildId ? await this.support.build(c.tx, projectId, row.buildId) : null;
          const defect = await c.tx.defect.create({
            data: {
              projectId,
              number: project.defectSequence,
              title: snapshot.content.title.slice(0, 200),
              reproduction: [
                snapshot.content.preconditions,
                ...snapshot.content.steps.map((s, i) => `${i + 1}. ${s.action}`),
              ]
                .filter(Boolean)
                .join('\n')
                .slice(0, 10000),
              expected: snapshot.content.steps
                .map((s) => s.expected)
                .join('\n')
                .slice(0, 5000),
              actual: d.actual,
              environment: row.environment,
              source: 'TESTING',
              severity: d.severity,
              requirementId: row.requirementId,
              foundBuildId: row.buildId,
              releaseId: build?.releaseId ?? null,
              targetReleaseId: build?.releaseId ?? null,
              assigneeId,
              retesterId,
              createdById: c.actor.userId,
            },
          });
          linked.add(defect.id);
          await this.support.event(
            c,
            'DEFECT',
            defect.id,
            'defect.created',
            { title: defect.title, testRecordId: id },
            [assigneeId, retesterId],
          );
        }
        for (const defectId of linked) {
          const defect = await this.defects.find(c.tx, projectId, defectId);
          rule(defect.requirementId === row.requirementId, '缺陷与测试记录需求不一致');
          await this.defects.linkEvidence(c, defect, [row.testCaseId], [id]);
          if (row.type === 'RETEST' && defect.status === 'AWAITING_RETEST') {
            this.support.assigned(c, defect.retesterId);
            rule(this.support.allowed(c, 'defect:retest'), '没有缺陷复测权限');
            const fix = await c.tx.defectDisposition.findFirst({
              where: { defectId, action: { in: ['fix', 'updateFixBuild'] } },
              orderBy: { createdAt: 'desc' },
            });
            rule(fix && row.createdAt >= fix.createdAt, '请在提交修复后创建复测记录');
            if (defect.fixedBuildId)
              rule(row.buildId === defect.fixedBuildId, '复测须使用实际修复构建');
            await this.defects.disposition(
              c,
              defect,
              d.outcome === 'PASSED' ? 'CLOSED' : 'OPEN',
              'retest',
              d.actual,
              d.evidence,
              id,
            );
          } else if (
            d.outcome === 'FAILED' &&
            ['CLOSED', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE', 'DEFERRED'].includes(defect.status)
          ) {
            rule(this.support.allowed(c, 'defect:retest'), '没有重新打开缺陷的权限');
            await this.defects.disposition(c, defect, 'OPEN', 'reopen', d.actual, d.evidence, id);
          }
        }
        const next = await c.tx.testRecord.update({
          where: { id },
          data: {
            outcome: d.outcome,
            actual: d.actual,
            evidence: d.evidence,
            attachmentIds: [...new Set(d.attachmentIds)],
            completedAt: new Date(),
            version: { increment: 1 },
          },
        });
        await this.defects.refreshProgress(c, [...linked], [row.requirementId]);
        await this.support.event(c, 'TEST_RECORD', id, 'test-record.finished', {
          title: snapshot.content.title,
          outcome: d.outcome,
          defectIds: [...linked],
        });
        return { id, version: next.version, defectIds: [...linked] };
      },
    );
  }
}
