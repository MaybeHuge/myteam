import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createDefectSchema,
  assignDefectSchema,
  fixDefectSchema,
  updateFixBuildSchema,
  retestDefectSchema,
  disposeDefectSchema,
  linkDefectResultSchema,
  qualityReasonSchema,
  qualityQuerySchema,
  defectStatusSchema,
  defectSchema,
  defectDetailSchema,
  defectListSchema,
  paginationSchema,
} from '@myteam/contracts';
import type { Defect, Prisma } from '../../generated/prisma/client.js';
import { ApiException } from '../../common/http.js';
import { refreshRequirementProgress } from '../../common/requirement-progress.js';
import {
  QualitySupport,
  checkVersion,
  rule,
  type Context,
  type Tx,
  terminalDefects,
} from './quality.support.js';

@Injectable()
export class DefectsService {
  constructor(readonly support: QualitySupport) {}
  async find(tx: Tx, projectId: string, id: string) {
    const row = await tx.defect.findFirst({ where: { id, projectId } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '缺陷不存在或不属于当前项目');
    return row;
  }
  async linkEvidence(c: Context, defect: Defect, caseIds: string[], recordIds: string[]) {
    const cases = new Set(caseIds);
    for (const id of new Set(recordIds)) {
      const record = await c.tx.testRecord.findFirst({
        where: { id, projectId: c.project.id, requirementId: defect.requirementId },
      });
      rule(record, '测试记录不存在或与缺陷需求不一致');
      cases.add(record.testCaseId);
      await c.tx.defectRecordLink.upsert({
        where: { defectId_testRecordId: { defectId: defect.id, testRecordId: id } },
        create: { projectId: c.project.id, defectId: defect.id, testRecordId: id },
        update: {},
      });
    }
    for (const id of cases) {
      rule(
        await c.tx.testCase.findFirst({
          where: {
            id,
            projectId: c.project.id,
            links: { some: { requirementId: defect.requirementId } },
          },
        }),
        '用例不存在或未关联该需求',
      );
      await c.tx.defectCaseLink.upsert({
        where: { defectId_testCaseId: { defectId: defect.id, testCaseId: id } },
        create: { projectId: c.project.id, defectId: defect.id, testCaseId: id },
        update: {},
      });
    }
  }
  private async dto(c: Context, row: Defect) {
    const actions: string[] = [];
    if (c.project.status === 'ACTIVE') {
      if (this.support.allowed(c, 'defect:retest')) {
        actions.push('assign', 'link');
        if (row.status === 'UNCONFIRMED') actions.push('confirm');
        if (!terminalDefects.includes(row.status as (typeof terminalDefects)[number]))
          actions.push('dispose');
        if (
          terminalDefects.includes(row.status as (typeof terminalDefects)[number]) ||
          row.status === 'DEFERRED'
        )
          actions.push('reopen');
        if (
          row.status === 'AWAITING_RETEST' &&
          (row.retesterId === c.actor.userId || this.support.manager(c))
        )
          actions.push('retest');
      }
      if (
        this.support.allowed(c, 'defect:fix') &&
        (row.assigneeId === c.actor.userId || this.support.manager(c))
      ) {
        if (row.status === 'OPEN') actions.push('start');
        if (row.status === 'FIXING') actions.push('fix');
        if (row.status === 'AWAITING_RETEST') actions.push('updateFixBuild');
      }
    }
    const found = row.foundBuildId
      ? await this.support.build(c.tx, c.project.id, row.foundBuildId)
      : null;
    const fixed = row.fixedBuildId
      ? await this.support.build(c.tx, c.project.id, row.fixedBuildId)
      : null;
    return defectSchema.parse({
      ...row,
      code: `${c.project.key}-BUG-${String(row.number).padStart(4, '0')}`,
      foundBuildIdentifier: found?.identifier ?? null,
      fixedBuildIdentifier: fixed?.identifier ?? null,
      assignee: await this.support.person(c.tx, row.assigneeId),
      retester: await this.support.person(c.tx, row.retesterId),
      createdBy: await this.support.person(c.tx, row.createdById),
      deferUntil: row.deferUntil?.toISOString().slice(0, 10) ?? null,
      createdAt: row.createdAt.toISOString(),
      allowedActions: actions,
    });
  }
  async list(projectId: string, req: Request) {
    const d = qualityQuerySchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const where: Prisma.DefectWhereInput = {
        projectId,
        ...(d.status ? { status: defectStatusSchema.parse(d.status) } : {}),
        ...(d.q ? { title: { contains: d.q, mode: 'insensitive' } } : {}),
        ...(d.assigneeId ? { assigneeId: d.assigneeId } : {}),
        ...(d.severity ? { severity: d.severity } : {}),
        ...(d.releaseId
          ? { OR: [{ releaseId: d.releaseId }, { targetReleaseId: d.releaseId }] }
          : {}),
      };
      return defectListSchema.parse({
        ...d,
        items: await Promise.all(
          (
            await c.tx.defect.findMany({
              where,
              orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              skip: (d.page - 1) * d.pageSize,
              take: d.pageSize,
            })
          ).map((r) => this.dto(c, r)),
        ),
        total: await c.tx.defect.count({ where }),
        canCreate: c.project.status === 'ACTIVE' && this.support.allowed(c, 'defect:report'),
      });
    });
  }
  async detail(projectId: string, id: string, req: Request) {
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const row = await this.find(c.tx, projectId, id);
      const dispositions = await c.tx.defectDisposition.findMany({
        where: { projectId, defectId: id },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const caseLinks = await c.tx.defectCaseLink.findMany({ where: { projectId, defectId: id } });
      const recordLinks = await c.tx.defectRecordLink.findMany({
        where: { projectId, defectId: id },
      });
      const cases = await c.tx.testCase.findMany({
        where: { projectId, id: { in: caseLinks.map((l) => l.testCaseId) } },
      });
      const records = await c.tx.testRecord.findMany({
        where: { projectId, id: { in: recordLinks.map((l) => l.testRecordId) } },
        orderBy: { number: 'desc' },
      });
      return defectDetailSchema.parse({
        ...(await this.dto(c, row)),
        testCases: cases.map((r) => ({
          id: r.id,
          title: r.title,
          code: `${c.project.key}-CASE-${String(r.number).padStart(4, '0')}`,
        })),
        testRecords: records.map((r) => ({
          id: r.id,
          code: `${c.project.key}-TR-${String(r.number).padStart(4, '0')}`,
          caseTitle:
            (r.snapshot as Prisma.JsonObject).content &&
            ((r.snapshot as Prisma.JsonObject).content as Prisma.JsonObject).title,
          outcome: r.outcome,
          type: r.type,
        })),
        dispositions: {
          items: await Promise.all(
            dispositions.map(async (d) => ({
              ...d,
              actor: await this.support.person(c.tx, d.actorId),
              createdAt: d.createdAt.toISOString(),
            })),
          ),
          total: await c.tx.defectDisposition.count({ where: { projectId, defectId: id } }),
          page,
          pageSize,
        },
        links: { items: [], total: 0, page, pageSize },
        history: await this.support.history(c, id),
      });
    });
  }
  async create(projectId: string, input: unknown, req: Request) {
    const d = createDefectSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: 'defect.create', ...d },
      'defect:report',
      async (c) => {
        await this.support.eligible(c.tx, projectId, d.assigneeId, 'defect:fix');
        await this.support.eligible(c.tx, projectId, d.retesterId, 'defect:retest');
        rule(
          await c.tx.requirement.findFirst({ where: { projectId, id: d.requirementId } }),
          '关联需求不存在',
        );
        if (d.taskId)
          rule(
            await c.tx.task.findFirst({
              where: { projectId, id: d.taskId, requirementId: d.requirementId },
            }),
            '任务与需求不一致',
          );
        const found = d.foundBuildId
          ? await this.support.build(c.tx, projectId, d.foundBuildId)
          : null;
        const targetId = d.targetReleaseId ?? found?.releaseId ?? null;
        if (targetId)
          rule(
            !['RELEASED', 'ARCHIVED'].includes(
              (await this.support.release(c.tx, projectId, targetId)).status,
            ),
            '修复目标版本须尚未交付',
          );
        if (d.source === 'PRODUCTION')
          rule(
            found &&
              (await this.support.release(c.tx, projectId, found.releaseId)).status === 'RELEASED',
            '生产来源须关联实际已发布版本',
          );
        const project = await c.tx.project.update({
          where: { id: projectId },
          data: { defectSequence: { increment: 1 } },
        });
        const row = await c.tx.defect.create({
          data: {
            projectId,
            number: project.defectSequence,
            title: d.title,
            reproduction: d.reproduction,
            expected: d.expected,
            actual: d.actual,
            environment: d.environment,
            source: d.source,
            severity: d.severity,
            requirementId: d.requirementId,
            taskId: d.taskId,
            foundBuildId: found?.id ?? null,
            releaseId: found?.releaseId ?? null,
            targetReleaseId: targetId,
            assigneeId: d.assigneeId,
            retesterId: d.retesterId,
            createdById: c.actor.userId,
          },
        });
        await this.linkEvidence(c, row, d.testCaseIds, d.testRecordIds);
        await refreshRequirementProgress(c.tx, projectId, d.requirementId);
        await this.support.event(c, 'DEFECT', row.id, 'defect.created', { title: row.title }, [
          row.retesterId,
          row.assigneeId,
        ]);
        return { id: row.id, version: row.version };
      },
    );
  }
  async refreshProgress(c: Context, defectIds: string[], requirementIds: string[] = []) {
    const seen = new Set<string>();
    const affected = new Set(requirementIds);
    let frontier = [...new Set(defectIds)];
    while (frontier.length) {
      const rows = await c.tx.defect.findMany({
        where: { projectId: c.project.id, id: { in: frontier } },
      });
      for (const row of rows) {
        seen.add(row.id);
        affected.add(row.requirementId);
      }
      const duplicates = await c.tx.defect.findMany({
        where: { projectId: c.project.id, status: 'DUPLICATE', duplicateOfId: { in: frontier } },
      });
      frontier = duplicates.map((d) => d.id).filter((id) => !seen.has(id));
    }
    for (const id of affected) await refreshRequirementProgress(c.tx, c.project.id, id);
  }
  async disposition(
    c: Context,
    row: Defect,
    status: Defect['status'],
    action: string,
    reason: string,
    evidence: string,
    recordId?: string,
  ) {
    const next = await c.tx.defect.update({
      where: { id: row.id },
      data: { status, version: { increment: 1 } },
    });
    await c.tx.defectDisposition.create({
      data: {
        projectId: c.project.id,
        defectId: row.id,
        action,
        fromStatus: row.status,
        toStatus: status,
        actorId: c.actor.userId,
        reason,
        evidence,
        buildId: ['fix', 'updateFixBuild', 'retest'].includes(action) ? row.fixedBuildId : null,
        details: recordId ? { testRecordId: recordId } : {},
      },
    });
    await this.support.event(
      c,
      'DEFECT',
      row.id,
      `defect.${action}`,
      {
        title: row.title,
        from: row.status,
        to: status,
        reason,
        ...(recordId ? { testRecordId: recordId } : {}),
      },
      [row.assigneeId, row.retesterId],
    );
    return next;
  }
  async action(
    projectId: string,
    id: string,
    action:
      | 'confirm'
      | 'assign'
      | 'start'
      | 'fix'
      | 'updateFixBuild'
      | 'retest'
      | 'reopen'
      | 'dispose'
      | 'link',
    input: unknown,
    req: Request,
  ) {
    const schema =
      action === 'assign'
        ? assignDefectSchema
        : action === 'fix'
          ? fixDefectSchema
          : action === 'updateFixBuild'
            ? updateFixBuildSchema
            : action === 'retest'
              ? retestDefectSchema
              : action === 'dispose'
                ? disposeDefectSchema
                : action === 'link'
                  ? linkDefectResultSchema
                  : qualityReasonSchema;
    const data = schema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: `defect.${action}`, id, ...data },
      ['start', 'fix', 'updateFixBuild'].includes(action) ? 'defect:fix' : 'defect:retest',
      async (c) => {
        let row = await this.find(c.tx, projectId, id);
        checkVersion(row, data.version);
        const reason = 'reason' in data ? String(data.reason) : '';
        if (action === 'assign') {
          const d = assignDefectSchema.parse(input);
          await this.support.eligible(c.tx, projectId, d.assigneeId, 'defect:fix');
          await this.support.eligible(c.tx, projectId, d.retesterId, 'defect:retest');
          if (d.targetReleaseId) await this.support.release(c.tx, projectId, d.targetReleaseId);
          row = await c.tx.defect.update({
            where: { id },
            data: {
              assigneeId: d.assigneeId,
              retesterId: d.retesterId,
              ...(d.targetReleaseId !== undefined ? { targetReleaseId: d.targetReleaseId } : {}),
              version: { increment: 1 },
            },
          });
          await this.support.event(
            c,
            'DEFECT',
            id,
            'defect.assigned',
            { title: row.title, reason },
            [row.assigneeId, row.retesterId],
          );
        } else if (action === 'link') {
          const d = linkDefectResultSchema.parse(input);
          rule(d.testCaseIds.length || d.testRecordIds.length, '请选择用例或测试记录');
          await this.linkEvidence(c, row, d.testCaseIds, d.testRecordIds);
          row = await c.tx.defect.update({ where: { id }, data: { version: { increment: 1 } } });
          await this.support.event(c, 'DEFECT', id, 'defect.linked', {
            title: row.title,
            testCaseIds: d.testCaseIds,
            testRecordIds: d.testRecordIds,
          });
        } else if (action === 'confirm') {
          rule(row.status === 'UNCONFIRMED', '仅待确认缺陷可以确认');
          row = await this.disposition(c, row, 'OPEN', action, reason, '');
        } else if (action === 'start') {
          this.support.assigned(c, row.assigneeId);
          rule(row.status === 'OPEN', '仅已确认缺陷可以开始修复');
          row = await this.disposition(c, row, 'FIXING', action, reason, '');
        } else if (action === 'fix') {
          this.support.assigned(c, row.assigneeId);
          rule(row.status === 'FIXING', '仅修复中的缺陷可以提交修复');
          const d = fixDefectSchema.parse(input);
          if (d.buildId) {
            const build = await this.support.build(c.tx, projectId, d.buildId);
            rule(
              !row.targetReleaseId || build.releaseId === row.targetReleaseId,
              '修复构建不属于目标版本',
            );
            rule(
              build.id !== row.foundBuildId && build.id !== row.fixedBuildId,
              '请登记新的修复构建',
            );
            rule(
              !(await c.tx.defectDisposition.count({
                where: { projectId, defectId: id, action: 'fix', buildId: d.buildId },
              })),
              '不能重复使用已经尝试的修复构建',
            );
          }
          // Once a defect has build context, fixing must keep that evidence.
          rule((!row.foundBuildId && !row.fixedBuildId) || d.buildId, '请提供实际修复构建');
          row = await c.tx.defect.update({
            where: { id },
            data: { fixedBuildId: d.buildId ?? null },
          });
          row = await this.disposition(c, row, 'AWAITING_RETEST', action, reason, d.evidence);
        } else if (action === 'updateFixBuild') {
          this.support.assigned(c, row.assigneeId);
          rule(row.status === 'AWAITING_RETEST', '仅待复测缺陷可以更新修复构建');
          const d = updateFixBuildSchema.parse(input);
          const build = await this.support.build(c.tx, projectId, d.buildId);
          const release = await this.support.release(c.tx, projectId, build.releaseId);
          rule(
            !row.targetReleaseId || build.releaseId === row.targetReleaseId,
            '修复构建不属于目标版本',
          );
          rule(
            build.scopeVersion === release.scopeVersion,
            '构建范围已经失效，请选择当前版本范围的构建',
          );
          rule(
            await c.tx.releaseItem.count({
              where: {
                projectId,
                releaseId: release.id,
                scopeVersion: release.scopeVersion,
                workItemId: row.requirementId,
              },
            }),
            '构建范围不包含该需求',
          );
          rule(
            build.id !== row.foundBuildId && build.id !== row.fixedBuildId,
            '请选择其他实际修复构建',
          );
          const links = await c.tx.defectRecordLink.findMany({
            where: { projectId, defectId: id },
          });
          const requirement = await c.tx.requirement.findUniqueOrThrow({
            where: { id: row.requirementId },
          });
          const pending = await c.tx.testRecord.findMany({
            where: {
              projectId,
              id: { in: links.map((link) => link.testRecordId) },
              type: 'RETEST',
              outcome: 'NOT_RUN',
              requirementRevision: requirement.revision,
              cycle: requirement.testCycle,
            },
          });
          for (const record of pending) {
            const testCase = await c.tx.testCase.findUnique({ where: { id: record.testCaseId } });
            rule(
              testCase?.revision !== record.caseRevision,
              '存在待填写的有效复测记录，请先完成该记录再更新修复构建',
            );
          }
          row = await c.tx.defect.update({ where: { id }, data: { fixedBuildId: build.id } });
          row = await this.disposition(c, row, 'AWAITING_RETEST', action, reason, d.evidence);
        } else if (action === 'retest') {
          this.support.assigned(c, row.retesterId);
          rule(row.status === 'AWAITING_RETEST', '当前缺陷不在待复测状态');
          const d = retestDefectSchema.parse(input);
          const caseLinks = await c.tx.defectCaseLink.count({ where: { defectId: id } });
          rule(!caseLinks || d.testRecordId, '已关联用例的缺陷须引用对应的复测记录');
          if (d.testRecordId) {
            const record = await c.tx.testRecord.findFirst({
              where: { projectId, id: d.testRecordId, requirementId: row.requirementId },
            });
            rule(
              record &&
                record.type === 'RETEST' &&
                record.outcome === (d.passed ? 'PASSED' : 'FAILED'),
              '复测记录与结论不一致',
            );
            const fix = await c.tx.defectDisposition.findFirst({
              where: { defectId: id, action: { in: ['fix', 'updateFixBuild'] } },
              orderBy: { createdAt: 'desc' },
            });
            rule(fix && record.createdAt >= fix.createdAt, '复测记录必须在提交修复之后创建');
            if (row.fixedBuildId)
              rule(record.buildId === row.fixedBuildId, '复测记录须使用实际修复构建');
            if (caseLinks)
              rule(
                await c.tx.defectCaseLink.count({
                  where: { defectId: id, testCaseId: record.testCaseId },
                }),
                '复测记录与关联场景不一致',
              );
            const requirement = await c.tx.requirement.findUniqueOrThrow({
              where: { id: row.requirementId },
            });
            rule(
              record.cycle === requirement.testCycle &&
                record.requirementRevision === requirement.revision,
              '复测记录已失效',
            );
            const latest = await c.tx.testRecord.findFirst({
              where: {
                projectId,
                requirementId: row.requirementId,
                testCaseId: record.testCaseId,
                cycle: requirement.testCycle,
              },
              orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
            });
            const testCase = await c.tx.testCase.findUniqueOrThrow({
              where: { id: record.testCaseId },
            });
            rule(
              latest?.id === record.id &&
                testCase.revision === record.caseRevision &&
                testCase.status === 'READY' &&
                !testCase.needsReview,
              '复测须使用当前用例的最新有效记录',
            );
            await this.linkEvidence(c, row, [], [record.id]);
          }
          row = await this.disposition(
            c,
            row,
            d.passed ? 'CLOSED' : 'OPEN',
            action,
            reason,
            d.evidence,
            d.testRecordId,
          );
        } else if (action === 'reopen') {
          rule(
            terminalDefects.includes(row.status as (typeof terminalDefects)[number]) ||
              row.status === 'DEFERRED',
            '仅已处理缺陷可以重新打开',
          );
          row = await this.disposition(c, row, 'OPEN', action, reason, '');
        } else {
          const d = disposeDefectSchema.parse(input);
          rule(
            !terminalDefects.includes(row.status as (typeof terminalDefects)[number]),
            '当前缺陷已经处理',
          );
          if (d.conclusion === 'DUPLICATE') {
            const seen = new Set([id]);
            let master = await this.find(c.tx, projectId, d.duplicateOfId!);
            while (true) {
              rule(!seen.has(master.id), '重复缺陷不能形成循环');
              seen.add(master.id);
              if (master.status !== 'DUPLICATE' || !master.duplicateOfId) break;
              master = await this.find(c.tx, projectId, master.duplicateOfId);
            }
          }
          if (d.conclusion === 'DEFERRED')
            rule(!['CRITICAL', 'MAJOR'].includes(row.severity), '严重和致命缺陷不能延期');
          if (d.targetReleaseId) await this.support.release(c.tx, projectId, d.targetReleaseId);
          await c.tx.defect.update({
            where: { id },
            data: {
              duplicateOfId: d.duplicateOfId ?? null,
              ...(d.deferUntil ? { deferUntil: new Date(d.deferUntil) } : {}),
              ...(d.targetReleaseId ? { targetReleaseId: d.targetReleaseId } : {}),
            },
          });
          row = await this.disposition(c, row, d.conclusion, action, reason, d.evidence);
        }
        await this.refreshProgress(c, [id]);
        return { id, version: row.version };
      },
    );
  }
}
