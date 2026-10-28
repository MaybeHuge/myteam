import { CollaborationEvents } from '../../common/collaboration-events.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  closeIterationSchema,
  createIterationSchema,
  hasPermission,
  iterationQuerySchema,
  iterationSchema,
  paginationSchema,
  updateIterationSchema,
  versionSchema,
  type ProjectRole,
} from '@myteam/contracts';
import type { Prisma, Iteration, Project } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { ApiException } from '../../common/http.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';

type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
const include = {
  owner: { select: { id: true, name: true, email: true, isSystemAdmin: true } },
} as const;
type Row = Prisma.IterationGetPayload<{ include: typeof include }>;

@Injectable()
export class IterationsService {
  constructor(
    private readonly events: CollaborationEvents,
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
  ) {}

  private writable(project: Project) {
    return !['COMPLETED', 'ARCHIVED', 'ACCEPTING'].includes(project.status);
  }
  private manage(project: Project & { members: { roles: ProjectRole[] }[] }, actor: Actor) {
    return (
      this.writable(project) &&
      (actor.user.isSystemAdmin ||
        hasPermission(project.members[0]?.roles ?? [], 'iteration:manage'))
    );
  }
  private async find(tx: Tx, projectId: string, id: string) {
    const item = await tx.iteration.findFirst({ where: { id, projectId }, include });
    if (!item) throw new ApiException(404, 'NOT_FOUND', '迭代不存在或不属于当前项目');
    return item;
  }
  private checkVersion(item: Iteration, version: number) {
    if (item.version !== version)
      throw new ApiException(409, 'CONFLICT', '迭代已被其他成员更新，请刷新后重试');
  }
  private async dto(tx: Tx, row: Row, canManage: boolean, project: Project) {
    const grouped = await tx.workItem.groupBy({
      by: ['resolution'],
      where: { projectId: row.projectId, iterationId: row.id },
      _count: { _all: true },
    });
    const count = (state: string) => grouped.find((g) => g.resolution === state)?._count._all ?? 0;
    return iterationSchema.parse({
      ...row,
      startDate: row.startDate.toISOString().slice(0, 10),
      endDate: row.endDate.toISOString().slice(0, 10),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      startedAt: row.startedAt?.toISOString() ?? null,
      closedAt: row.closedAt?.toISOString() ?? null,
      work: {
        total: grouped.reduce((sum, g) => sum + g._count._all, 0),
        open: count('OPEN'),
        done: count('DONE'),
        canceled: count('CANCELED'),
      },
      allowedActions:
        !canManage || row.status === 'CLOSED'
          ? []
          : [
              'edit',
              ...(row.status === 'PLANNING' && project.status === 'ACTIVE' ? ['start'] : []),
              ...(row.status === 'ACTIVE' ? ['close'] : []),
            ],
    });
  }
  async list(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { q, status, ownerId, page, pageSize } = iterationQuerySchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const project = await this.projects.authorize(tx, actor, projectId, req);
      const where: Prisma.IterationWhereInput = {
        projectId,
        ...(status ? { status } : {}),
        ...(ownerId ? { ownerId } : {}),
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { goal: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total, groups] = await Promise.all([
        tx.iteration.findMany({
          where,
          include,
          orderBy: [{ startDate: 'desc' }, { id: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.iteration.count({ where }),
        tx.iteration.groupBy({ by: ['status'], where: { projectId }, _count: { _all: true } }),
      ]);
      const count = (state: string) => groups.find((g) => g.status === state)?._count._all ?? 0;
      const canCreate = this.manage(project, actor);
      return {
        items: await Promise.all(rows.map((row) => this.dto(tx, row, canCreate, project))),
        total,
        page,
        pageSize,
        canCreate,
        stats: {
          total: groups.reduce((sum, g) => sum + g._count._all, 0),
          planning: count('PLANNING'),
          active: count('ACTIVE'),
          closed: count('CLOSED'),
        },
      };
    });
  }
  async detail(projectId: string, id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const project = await this.projects.authorize(tx, actor, projectId, req);
      const row = await this.find(tx, projectId, id);
      const dto = await this.dto(tx, row, this.manage(project, actor), project);
      const items = await tx.workItem.findMany({
        where: { projectId, iterationId: id },
        select: { id: true, kind: true, title: true, resolution: true },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return { ...dto, items: { items, total: dto.work.total, page, pageSize } };
    });
  }
  private async validatePlan(
    tx: Tx,
    project: Project,
    data: { ownerId: string; startDate: string; endDate: string },
  ) {
    if (
      (project.startDate && data.startDate < project.startDate.toISOString().slice(0, 10)) ||
      (project.endDate && data.endDate > project.endDate.toISOString().slice(0, 10))
    )
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '迭代日期须在项目计划日期范围内');
    const users = await tx.$queryRaw<
      Array<{ active: boolean }>
    >`SELECT active FROM "User" WHERE id = ${data.ownerId}::uuid FOR SHARE`;
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId: project.id, userId: data.ownerId } },
    });
    if (!users[0]?.active || !member)
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '迭代负责人须为本项目的可用成员');
  }
  private async audit(
    tx: Tx,
    actor: Actor,
    req: Request,
    projectId: string,
    id: string,
    action: string,
    details: Prisma.InputJsonObject,
  ) {
    const iteration = await tx.iteration.findUniqueOrThrow({ where: { id } });
    await this.events.record(tx, {
      actorId: actor.userId,
      projectId,
      requestId: req.requestId,
      action,
      details,
      target: { targetType: 'ITERATION', targetId: id },
      recipientId: iteration.ownerId,
      title:
        `${actor.user.name} ${action === 'iteration.created' ? '向你分配了迭代' : action === 'iteration.updated' ? '更新了迭代计划' : action === 'iteration.started' ? '启动了迭代' : '关闭了迭代'}「${iteration.name}」`.slice(
          0,
          200,
        ),
    });
  }
  async create(projectId: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const data = createIterationSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'iteration.create', projectId, ...data },
      async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        await this.validatePlan(tx, project, data);
        const item = await tx.iteration.create({
          data: {
            projectId,
            ...data,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
          },
        });
        await this.audit(tx, actor, req, projectId, item.id, 'iteration.created', {
          ...data,
        });
        return { id: item.id };
      },
      async (tx) => {
        await this.authorizeWrite(tx, actor, projectId, req);
      },
    );
  }
  private async authorizeWrite(tx: Tx, actor: Actor, projectId: string, req: Request, id?: string) {
    const project = await this.projects.authorize(
      tx,
      actor,
      projectId,
      req,
      'iteration:manage',
      true,
    );
    if (!this.writable(project))
      throw new ApiException(403, 'FORBIDDEN', '当前项目状态只允许查看迭代');
    if (id) await this.find(tx, projectId, id);
    return project;
  }
  async update(projectId: string, id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const data = updateIterationSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'iteration.update', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.checkVersion(row, data.version);
        if (row.status === 'CLOSED')
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '已关闭迭代不可修改');
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        await this.validatePlan(tx, project, data);
        await tx.iteration.update({
          where: { id },
          data: {
            name: data.name,
            goal: data.goal,
            ownerId: data.ownerId,
            startDate: new Date(data.startDate),
            endDate: new Date(data.endDate),
            version: { increment: 1 },
          },
        });
        await this.audit(tx, actor, req, projectId, id, 'iteration.updated', {
          name: data.name,
          fromOwnerId: row.ownerId,
          ownerId: data.ownerId,
          before: {
            name: row.name,
            goal: row.goal,
            ownerId: row.ownerId,
            startDate: row.startDate.toISOString().slice(0, 10),
            endDate: row.endDate.toISOString().slice(0, 10),
          },
          after: {
            name: data.name,
            goal: data.goal,
            ownerId: data.ownerId,
            startDate: data.startDate,
            endDate: data.endDate,
          },
        });
        return { id };
      },
      async (tx) => {
        await this.authorizeWrite(tx, actor, projectId, req, id);
      },
    );
  }
  async changeState(projectId: string, id: string, input: unknown, req: Request, close = false) {
    const actor = await this.identity.requireWrite(req);
    const data = close ? closeIterationSchema.parse(input) : versionSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: close ? 'iteration.close' : 'iteration.start', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.checkVersion(row, data.version);
        const project = await tx.project.findUniqueOrThrow({ where: { id: projectId } });
        if (!close && !row.goal.trim())
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请先填写迭代目标，再启动迭代');
        if (
          (!close && (row.status !== 'PLANNING' || project.status !== 'ACTIVE')) ||
          (close && row.status !== 'ACTIVE')
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            close ? '仅进行中的迭代可以关闭' : '请先启动项目，仅规划中的迭代可以启动',
          );
        const open = await tx.workItem.count({
          where: { projectId, iterationId: id, resolution: 'OPEN' },
        });
        if (close && open)
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            `仍有 ${open} 项未完成事项，请先完成或处理后再关闭`,
            { open },
          );
        const summary = close ? closeIterationSchema.parse(input).summary : null;
        await tx.iteration.update({
          where: { id },
          data: {
            status: close ? 'CLOSED' : 'ACTIVE',
            ...(close
              ? { closedAt: new Date(), closeSummary: summary }
              : { startedAt: new Date() }),
            version: { increment: 1 },
          },
        });
        await this.audit(
          tx,
          actor,
          req,
          projectId,
          id,
          close ? 'iteration.closed' : 'iteration.started',
          {
            name: row.name,
            from: row.status,
            to: close ? 'CLOSED' : 'ACTIVE',
            ...(summary ? { summary } : {}),
          },
        );
        return { id };
      },
      async (tx) => {
        await this.authorizeWrite(tx, actor, projectId, req, id);
      },
    );
  }

  // M2 在自身业务事务授权后调用；统一项目锁与关闭命令互斥，禁止向关闭迭代加入事项。
  async assertAssignable(tx: Tx, projectId: string, iterationId: string) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const project = await tx.project.findUnique({ where: { id: projectId } });
    if (!project || !this.writable(project))
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '项目当前不可调整计划');
    const row = await this.find(tx, projectId, iterationId);
    if (row.status === 'CLOSED')
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '已关闭迭代不可加入事项');
    return row;
  }
}
