import {
  invalidateRequirementTests,
  refreshRequirementProgress,
} from '../../common/requirement-progress.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createReleaseSchema,
  updateReleaseSchema,
  createBuildSchema,
  qualityQuerySchema,
  qualityOptionsQuerySchema,
  qualityPeopleQuerySchema,
  releaseStatusSchema,
  releaseSchema,
  releaseListSchema,
  releaseDetailSchema,
  buildSchema,
  buildListSchema,
  paginationSchema,
  hasPermission,
  projectRoles,
  testRecordLabels,
  type Permission,
} from '@myteam/contracts';
import type { Prisma, Release } from '../../generated/prisma/client.js';
import {
  QualitySupport,
  rule,
  checkVersion,
  personSelect,
  type Context,
} from './quality.support.js';
@Injectable()
export class TestingService {
  constructor(readonly support: QualitySupport) {}
  private releaseDto(c: Context, r: Release) {
    return releaseSchema.parse({
      ...r,
      createdAt: r.createdAt.toISOString(),
      allowedActions:
        c.project.status === 'ACTIVE' &&
        this.support.allowed(c, 'release:manage') &&
        !['READY', 'RELEASED', 'ARCHIVED'].includes(r.status)
          ? ['update']
          : [],
    });
  }
  private buildDto(r: Prisma.BuildGetPayload<object>) {
    return buildSchema.parse({ ...r, createdAt: r.createdAt.toISOString() });
  }
  async list(projectId: string, kind: 'releases' | 'builds', req: Request) {
    const q = qualityQuerySchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const paging = {
        skip: (q.page - 1) * q.pageSize,
        take: q.pageSize,
        orderBy: [{ createdAt: 'desc' as const }, { id: 'asc' as const }],
      };
      if (kind === 'releases') {
        const where: Prisma.ReleaseWhereInput = {
          projectId,
          ...(q.q ? { name: { contains: q.q, mode: 'insensitive' } } : {}),
          ...(q.status ? { status: releaseStatusSchema.parse(q.status) } : {}),
        };
        return releaseListSchema.parse({
          ...q,
          items: (await c.tx.release.findMany({ where, ...paging })).map((r) =>
            this.releaseDto(c, r),
          ),
          total: await c.tx.release.count({ where }),
          canCreate: c.project.status === 'ACTIVE' && this.support.allowed(c, 'release:manage'),
        });
      }
      const where: Prisma.BuildWhereInput = {
        projectId,
        ...(q.releaseId ? { releaseId: q.releaseId } : {}),
        ...(q.q ? { identifier: { contains: q.q, mode: 'insensitive' } } : {}),
      };
      return buildListSchema.parse({
        ...q,
        items: (await c.tx.build.findMany({ where, ...paging })).map((r) => this.buildDto(r)),
        total: await c.tx.build.count({ where }),
        canCreate:
          c.project.status === 'ACTIVE' &&
          (this.support.allowed(c, 'submission:write') ||
            this.support.allowed(c, 'release:manage')),
      });
    });
  }
  async detail(projectId: string, kind: 'releases', id: string, req: Request) {
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const release = await this.support.release(c.tx, projectId, id);
      const links = await c.tx.releaseItem.findMany({
        where: { releaseId: id, scopeVersion: release.scopeVersion },
      });
      const work = await c.tx.workItem.findMany({
        where: { projectId, id: { in: links.map((l) => l.workItemId) } },
        include: { requirement: true, task: true },
      });
      const where = { projectId, releaseId: id };
      return releaseDetailSchema.parse({
        ...this.releaseDto(c, release),
        scope: work.map((w) => ({
          id: w.id,
          kind: w.kind,
          title: w.title,
          status: w.task?.status ?? w.requirement!.status,
          code: `${c.project.key}-${w.kind === 'TASK' ? 'TASK' : 'REQ'}-${String(w.task?.number ?? w.requirement!.number).padStart(4, '0')}`,
        })),
        builds: {
          items: (
            await c.tx.build.findMany({
              where,
              orderBy: { createdAt: 'desc' },
              skip: (page - 1) * pageSize,
              take: pageSize,
            })
          ).map((r) => this.buildDto(r)),
          total: await c.tx.build.count({ where }),
          page,
          pageSize,
        },
        history: await this.support.history(c, id),
      });
    });
  }
  async releaseCommand(projectId: string, id: string | null, input: unknown, req: Request) {
    const d = id ? updateReleaseSchema.parse(input) : createReleaseSchema.parse(input);
    return this.support.write(
      projectId,
      req,
      { action: id ? 'release.update' : 'release.create', id, ...d },
      'release:manage',
      async (c) => {
        if (id) {
          const old = await this.support.release(c.tx, projectId, id);
          checkVersion(old, 'version' in d ? Number(d.version) : 0);
          rule(!['READY', 'RELEASED', 'ARCHIVED'].includes(old.status), '当前版本范围已冻结');
        }
        const tasks = await c.tx.task.findMany({
          where: { projectId, id: { in: d.taskIds } },
          include: { workItem: true },
        });
        rule(tasks.length === d.taskIds.length, '任务范围包含其他项目或不存在的任务');
        const reqIds = [...new Set([...d.requirementIds, ...tasks.map((t) => t.requirementId)])];
        rule(reqIds.length > 0, '版本至少关联一个需求或任务');
        await this.support.validity.capture(c.tx, projectId, reqIds);
        const workIds = [...reqIds, ...d.taskIds];
        const existing = await c.tx.releaseItem.findFirst({
          where: {
            projectId,
            workItemId: { in: workIds },
            active: true,
            ...(id ? { releaseId: { not: id } } : {}),
          },
        });
        rule(!existing, '需求或任务已属于其他未交付目标版本');
        const oldScope = id
          ? await c.tx.releaseItem.findMany({ where: { releaseId: id, active: true } })
          : [];
        const release = id
          ? await c.tx.release.update({
              where: { id },
              data: {
                name: d.name,
                description: d.description,
                scopeVersion: { increment: 1 },
                version: { increment: 1 },
              },
            })
          : await c.tx.release.create({
              data: {
                projectId,
                name: d.name,
                description: d.description,
                createdById: c.actor.userId,
              },
            });
        if (id)
          await c.tx.releaseItem.updateMany({
            where: { releaseId: id, active: true },
            data: { active: false },
          });
        await c.tx.releaseItem.createMany({
          data: workIds.map((workItemId) => ({
            projectId,
            releaseId: release.id,
            workItemId,
            scopeVersion: release.scopeVersion,
          })),
        });
        if (id) {
          const affected = await c.tx.requirement.findMany({
            where: { projectId, id: { in: [...reqIds, ...oldScope.map((l) => l.workItemId)] } },
          });
          for (const r of affected) {
            await invalidateRequirementTests(c.tx, projectId, r.id);
            await refreshRequirementProgress(c.tx, projectId, r.id);
          }
        }
        await this.support.event(
          c,
          'RELEASE',
          release.id,
          id ? 'release.updated' : 'release.created',
          { title: release.name, scopeVersion: release.scopeVersion, workItemIds: workIds },
        );
        return { id: release.id, version: release.version };
      },
    );
  }
  async createBuild(projectId: string, input: unknown, req: Request) {
    const d = createBuildSchema.parse(input);
    const actor = await this.support.identity.requireWrite(req);
    const permission: Permission = actor.user.isSystemAdmin
      ? 'submission:write'
      : await this.support.db.projectMember
          .findUnique({ where: { projectId_userId: { projectId, userId: actor.userId } } })
          .then((m) =>
            hasPermission(m?.roles ?? [], 'submission:write')
              ? 'submission:write'
              : 'release:manage',
          );
    return this.support.write(
      projectId,
      req,
      { action: 'build.create', ...d },
      permission,
      async (c) => {
        const release = await this.support.release(c.tx, projectId, d.releaseId);
        rule(!['READY', 'RELEASED', 'ARCHIVED'].includes(release.status), '当前版本不再接受新构建');
        const row = await c.tx.build.create({
          data: {
            ...d,
            projectId,
            scopeVersion: release.scopeVersion,
            createdById: c.actor.userId,
          },
        });
        if (release.status === 'PLANNING')
          await c.tx.release.update({
            where: { id: release.id },
            data: { status: 'DEVELOPING', version: { increment: 1 } },
          });
        await this.support.event(c, 'RELEASE', release.id, 'build.created', {
          title: release.name,
          buildId: row.id,
          identifier: row.identifier,
        });
        return { id: row.id };
      },
    );
  }
  async people(projectId: string, req: Request) {
    const d = qualityPeopleQuerySchema.parse(req.query),
      permission: Permission =
        d.purpose === 'assignee'
          ? 'defect:fix'
          : d.purpose === 'retester'
            ? 'defect:retest'
            : d.purpose === 'receiver'
              ? 'submission:accept'
              : 'test:execute';
    return this.support.read(projectId, req, async (c) => {
      const roles = projectRoles.filter((role) => hasPermission([role], permission));
      const where: Prisma.ProjectMemberWhereInput = {
        projectId,
        ...(d.id ? { userId: d.id } : {}),
        user: {
          active: true,
          ...(d.q
            ? {
                OR: [
                  { name: { contains: d.q, mode: 'insensitive' } },
                  { email: { contains: d.q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        OR: [{ roles: { hasSome: roles } }, { user: { isSystemAdmin: true } }],
      };
      const rows = await c.tx.projectMember.findMany({
        where,
        include: { user: { select: personSelect } },
        orderBy: { userId: 'asc' },
        skip: (d.page - 1) * d.pageSize,
        take: d.pageSize,
      });
      return {
        items: rows.map((r) => ({ id: r.user.id, label: r.user.name })),
        total: await c.tx.projectMember.count({ where }),
        page: d.page,
        pageSize: d.pageSize,
      };
    });
  }
  async options(projectId: string, req: Request) {
    const d = qualityOptionsQuerySchema.parse(req.query);
    return this.support.read(projectId, req, async (c) => {
      const common = { projectId, ...(d.id ? { id: d.id } : {}) },
        paging = {
          skip: (d.page - 1) * d.pageSize,
          take: d.pageSize,
          orderBy: { id: 'asc' as const },
        };
      let items: Array<{
        id: string;
        label: string;
        revision?: number;
        version?: number;
        releaseId?: string;
        requirementId?: string;
        buildId?: string;
      }>;
      let total: number;
      if (d.kind === 'releases') {
        const where = {
          ...common,
          ...(d.q ? { name: { contains: d.q, mode: 'insensitive' as const } } : {}),
        };
        const rows = await c.tx.release.findMany({ where, ...paging });
        items = rows.map((r) => ({ id: r.id, label: r.name, version: r.version }));
        total = await c.tx.release.count({ where });
      } else if (d.kind === 'builds') {
        const where = {
          ...common,
          ...(d.releaseId ? { releaseId: d.releaseId } : {}),
          ...(d.q ? { identifier: { contains: d.q, mode: 'insensitive' as const } } : {}),
        };
        const rows = await c.tx.build.findMany({ where, ...paging });
        items = rows.map((r) => ({ id: r.id, label: r.identifier, releaseId: r.releaseId }));
        total = await c.tx.build.count({ where });
      } else if (d.kind === 'tasks' || d.kind === 'requirements') {
        const kind = d.kind === 'tasks' ? 'TASK' : 'REQUIREMENT';
        const where: Prisma.WorkItemWhereInput = {
          ...common,
          kind,
          ...(kind === 'REQUIREMENT' && d.testCaseId
            ? { requirement: { testCaseLinks: { some: { testCaseId: d.testCaseId } } } }
            : {}),
          ...(d.q ? { title: { contains: d.q, mode: 'insensitive' } } : {}),
          ...(kind === 'TASK' && d.requirementId
            ? { task: { requirementId: d.requirementId } }
            : {}),
        };
        const rows = await c.tx.workItem.findMany({
          where,
          ...paging,
          include: { task: true, requirement: true },
        });
        items = rows.map((r) => ({
          id: r.id,
          label: `${c.project.key}-${kind === 'TASK' ? 'TASK' : 'REQ'}-${String(r.task?.number ?? r.requirement!.number).padStart(4, '0')} · ${r.title}`,
          ...(r.task ? { requirementId: r.task.requirementId } : {}),
          version: r.task?.version ?? r.requirement!.version,
        }));
        total = await c.tx.workItem.count({ where });
      } else if (d.kind === 'cases') {
        const where: Prisma.TestCaseWhereInput = {
          ...common,
          status: 'READY',
          needsReview: false,
          approvedRevision: { equals: c.tx.testCase.fields.revision },
          ...(d.requirementId ? { links: { some: { requirementId: d.requirementId } } } : {}),
          ...(d.q ? { title: { contains: d.q, mode: 'insensitive' } } : {}),
        };
        const rows = await c.tx.testCase.findMany({ where, ...paging });
        items = rows.map((r) => ({
          id: r.id,
          label: `${c.project.key}-CASE-${String(r.number).padStart(4, '0')} · ${r.title}`,
          revision: r.revision,
        }));
        total = await c.tx.testCase.count({ where });
      } else if (d.kind === 'defects') {
        const where = {
          ...common,
          ...(d.requirementId ? { requirementId: d.requirementId } : {}),
          ...(d.q ? { title: { contains: d.q, mode: 'insensitive' as const } } : {}),
        };
        const rows = await c.tx.defect.findMany({ where, ...paging });
        items = rows.map((r) => ({
          id: r.id,
          label: `${c.project.key}-BUG-${String(r.number).padStart(4, '0')} · ${r.title}`,
          version: r.version,
        }));
        total = await c.tx.defect.count({ where });
      } else {
        const where: Prisma.TestRecordWhereInput = {
          ...common,
          ...(d.requirementId ? { requirementId: d.requirementId } : {}),
          ...(d.testCaseId ? { testCaseId: d.testCaseId } : {}),
          ...(d.buildId ? { buildId: d.buildId } : {}),
          ...(d.q ? { snapshot: { path: ['content', 'title'], string_contains: d.q } } : {}),
        };
        const rows = await c.tx.testRecord.findMany({ where, ...paging });
        items = rows.map((r) => ({
          id: r.id,
          label: `${c.project.key}-TR-${String(r.number).padStart(4, '0')} · ${((r.snapshot as Prisma.JsonObject).content as Prisma.JsonObject).title} · ${testRecordLabels[r.outcome]}`,
          ...(r.buildId ? { buildId: r.buildId } : {}),
        }));
        total = await c.tx.testRecord.count({ where });
      }
      return { items, total, page: d.page, pageSize: d.pageSize };
    });
  }
}
