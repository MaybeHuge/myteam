import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import {
  paginationSchema,
  publishReleaseSchema,
  releaseCheckSchema,
  releaseEventListSchema,
  releaseFollowupSchema,
} from '@myteam/contracts';
import type { Prisma, Release } from '../../generated/prisma/client.js';
import { QualitySupport, checkVersion, rule, type Context } from './quality.support.js';

@Injectable()
export class ReleasePublicationService {
  constructor(private readonly support: QualitySupport) {}

  private async check(c: Context, release: Release, buildId: string | null) {
    const issues: Array<{
      kind: 'BUILD' | 'REQUIREMENT' | 'DEFECT' | 'RELEASE';
      id: string | null;
      message: string;
    }> = [];
    if (['RELEASED', 'ARCHIVED'].includes(release.status))
      issues.push({ kind: 'RELEASE', id: release.id, message: '当前版本已发布或归档' });
    if (!buildId) issues.push({ kind: 'BUILD', id: null, message: '请选择本次发布的构建' });
    else {
      const build = await c.tx.build.findFirst({
        where: { id: buildId, projectId: c.project.id, releaseId: release.id },
      });
      if (!build) issues.push({ kind: 'BUILD', id: buildId, message: '构建不存在或不属于此版本' });
      else if (build.scopeVersion !== release.scopeVersion)
        issues.push({
          kind: 'BUILD',
          id: buildId,
          message: '构建范围已失效，请选择当前范围的构建',
        });
    }
    const scope = await c.tx.releaseItem.findMany({
      where: { projectId: c.project.id, releaseId: release.id, scopeVersion: release.scopeVersion },
    });
    const requirements = await c.tx.requirement.findMany({
      where: { projectId: c.project.id, id: { in: scope.map((item) => item.workItemId) } },
      include: { workItem: { select: { title: true } } },
    });
    if (!requirements.length)
      issues.push({ kind: 'RELEASE', id: release.id, message: '版本没有关联需求' });
    for (const item of requirements)
      if (item.status !== 'COMPLETED')
        issues.push({
          kind: 'REQUIREMENT',
          id: item.id,
          message: `需求「${item.workItem.title}」尚未完成`,
        });
    const defects = await c.tx.defect.findMany({
      where: {
        projectId: c.project.id,
        requirementId: { in: requirements.map((item) => item.id) },
      },
    });
    const byId = new Map(defects.map((item) => [item.id, item]));
    for (const defect of defects) {
      let master = defect;
      const seen = new Set<string>();
      while (master.status === 'DUPLICATE' && master.duplicateOfId && !seen.has(master.id)) {
        seen.add(master.id);
        const next =
          byId.get(master.duplicateOfId) ??
          (await c.tx.defect.findFirst({
            where: { projectId: c.project.id, id: master.duplicateOfId },
          }));
        if (!next) break;
        byId.set(next.id, next);
        master = next;
      }
      if (
        (['CRITICAL', 'MAJOR'].includes(defect.severity) ||
          ['CRITICAL', 'MAJOR'].includes(master.severity)) &&
        !['CLOSED', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE'].includes(master.status)
      )
        issues.push({
          kind: 'DEFECT',
          id: defect.id,
          message: `严重缺陷「${defect.title}」尚未解决`,
        });
    }
    return releaseCheckSchema.parse({
      releaseId: release.id,
      scopeVersion: release.scopeVersion,
      buildId,
      canPublish: !issues.length,
      issues,
      requirements: requirements.map((item) => ({
        id: item.id,
        title: item.workItem.title,
        status: item.status,
        revision: item.revision,
        testCycle: item.testCycle,
      })),
    });
  }

  async preview(projectId: string, releaseId: string, req: Request) {
    const raw = req.query.buildId;
    const buildId = raw === undefined || raw === '' ? null : z.uuid().parse(raw);
    return this.support.read(projectId, req, async (c) =>
      this.check(c, await this.support.release(c.tx, projectId, releaseId), buildId),
    );
  }
  async events(projectId: string, releaseId: string, req: Request) {
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      await this.support.release(c.tx, projectId, releaseId);
      const where = { projectId, releaseId };
      const rows = await c.tx.releaseEvent.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      const items = await Promise.all(
        rows.map(async (row) => ({
          ...row,
          buildIdentifier: (await this.support.build(c.tx, projectId, row.buildId)).identifier,
          actor: await this.support.person(c.tx, row.actorId),
          occurredAt: row.occurredAt.toISOString(),
          createdAt: row.createdAt.toISOString(),
        })),
      );
      return releaseEventListSchema.parse({
        items,
        total: await c.tx.releaseEvent.count({ where }),
        page,
        pageSize,
      });
    });
  }
  async publish(projectId: string, releaseId: string, input: unknown, req: Request) {
    const d = publishReleaseSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: 'release.publish', releaseId, ...d },
      'release:manage',
      async (c) => {
        const release = await this.support.release(c.tx, projectId, releaseId);
        checkVersion(release, d.version);
        const check = await this.check(c, release, d.buildId);
        rule(check.canPublish, `发布检查未通过：${check.issues.map((i) => i.message).join('；')}`);
        const row = await c.tx.releaseEvent.create({
          data: {
            projectId,
            releaseId,
            buildId: d.buildId,
            kind: d.outcome === 'SUCCESS' ? 'PUBLISH_SUCCESS' : 'PUBLISH_FAILED',
            notes: d.notes,
            occurredAt: new Date(d.occurredAt),
            actorId: c.actor.userId,
            checkSnapshot: check as Prisma.InputJsonObject,
          },
        });
        await c.tx.release.update({
          where: { id: releaseId },
          data: {
            version: { increment: 1 },
            ...(d.outcome === 'SUCCESS' ? { status: 'RELEASED' as const } : {}),
          },
        });
        if (d.outcome === 'SUCCESS')
          await c.tx.releaseItem.updateMany({
            where: { projectId, releaseId, active: true },
            data: { active: false },
          });
        await this.support.event(c, 'RELEASE', releaseId, 'release.published', {
          title: release.name,
          result: d.outcome,
          eventId: row.id,
          buildId: d.buildId,
        });
        return { id: row.id };
      },
    );
  }
  async followup(projectId: string, releaseId: string, input: unknown, req: Request) {
    const d = releaseFollowupSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: 'release.followup', releaseId, ...d },
      'release:manage',
      async (c) => {
        const release = await this.support.release(c.tx, projectId, releaseId);
        checkVersion(release, d.version);
        rule(release.status === 'RELEASED', '仅已发布版本可以登记上线验证或回滚');
        const publish = await c.tx.releaseEvent.findFirst({
          where: { id: d.publishId, projectId, releaseId, kind: 'PUBLISH_SUCCESS' },
        });
        rule(publish, '发布记录不存在或未成功');
        const latest = await c.tx.releaseEvent.findFirst({
          where: { projectId, releaseId, kind: 'PUBLISH_SUCCESS' },
          orderBy: { sequence: 'desc' },
        });
        rule(latest?.id === publish.id, '只能操作当前发布记录');
        rule(
          !(await c.tx.releaseEvent.count({
            where: { projectId, releaseId, publishId: publish.id, kind: 'ROLLBACK' },
          })),
          '本次发布已经回滚',
        );
        const kind =
          d.outcome === 'ROLLBACK'
            ? 'ROLLBACK'
            : d.outcome === 'PASSED'
              ? 'VERIFY_PASSED'
              : 'VERIFY_FAILED';
        const row = await c.tx.releaseEvent.create({
          data: {
            projectId,
            releaseId,
            buildId: publish.buildId,
            publishId: publish.id,
            kind,
            notes: d.notes,
            occurredAt: new Date(d.occurredAt),
            actorId: c.actor.userId,
          },
        });
        await c.tx.release.update({
          where: { id: releaseId },
          data: {
            version: { increment: 1 },
            ...(d.outcome === 'ROLLBACK' ? { status: 'DEVELOPING' as const } : {}),
          },
        });
        await this.support.event(c, 'RELEASE', releaseId, 'release.followup', {
          title: release.name,
          result: d.outcome,
          eventId: row.id,
          publishId: publish.id,
        });
        return { id: row.id };
      },
    );
  }
}
