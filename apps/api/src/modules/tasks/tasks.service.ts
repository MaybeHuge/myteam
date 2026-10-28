import {
  refreshRequirementProgress,
  invalidateRequirementTests,
} from '../../common/requirement-progress.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTaskSchema,
  blockTaskSchema,
  acknowledgeTaskSchema,
  reasonTaskSchema,
  taskBoardQuerySchema,
  taskBoardSchema,
  updateTaskSchema,
  assignTaskSchema,
  startTaskSchema,
  taskQuerySchema,
  taskSchema,
  taskDetailSchema,
  taskPeopleQuerySchema,
  userQuerySchema,
  paginationSchema,
  hasPermission,
  projectRoles,
  type ProjectRole,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { ApiException } from '../../common/http.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { workbenchDate } from '../workbench/workbench.service.js';
import { IterationsService } from '../iterations/iterations.service.js';
type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
const person = { id: true, name: true } as const;
const plan = {
  include: { iteration: { select: { id: true, name: true, status: true } } },
} as const;
const include = {
  submissionTasks: { where: { active: true }, select: { id: true } },
  workItem: plan,
  requirement: { include: { workItem: plan } },
  assignee: { select: person },
  helper: { select: person },
  createdBy: { select: person },
  project: { select: { key: true, status: true } },
} as const;
type Row = Prisma.TaskGetPayload<{ include: typeof include }>;
const requirementStatuses = [
  'DRAFT',
  'IN_REVIEW',
  'CONFIRMED',
  'IMPLEMENTING',
  'ACCEPTING',
  'TESTING',
  'COMPLETED',
] as const;
@Injectable()
export class TasksService {
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly events: CollaborationEvents,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
    private readonly iterations: IterationsService,
  ) {}
  private writable(status: string) {
    return !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(status);
  }
  private manager(actor: Actor, roles: readonly ProjectRole[]) {
    return actor.user.isSystemAdmin || hasPermission(roles, 'task:assign');
  }
  private editor(row: Row, actor: Actor, roles: readonly ProjectRole[]) {
    return (
      this.manager(actor, roles) ||
      row.assigneeId === actor.userId ||
      (!row.assigneeId &&
        ['TODO', 'CANCELLED'].includes(row.status) &&
        row.createdById === actor.userId)
    );
  }
  private editable(row: Row) {
    return (
      ['TODO', 'IN_PROGRESS', 'COMPLETED'].includes(row.status) &&
      requirementStatuses.includes(
        row.requirement.status as (typeof requirementStatuses)[number],
      ) &&
      this.writable(row.project.status) &&
      row.workItem.iteration?.status !== 'CLOSED' &&
      row.requirement.workItem.iteration?.status !== 'CLOSED'
    );
  }
  private canStart(row: Row) {
    return (
      row.status === 'TODO' &&
      !row.blocked &&
      !!row.assigneeId &&
      row.project.status === 'ACTIVE' &&
      ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
        row.requirement.status,
      ) &&
      row.requirement.acceptedRevision === row.requirement.revision &&
      (!row.workItem.iteration || row.workItem.iteration.status === 'ACTIVE')
    );
  }
  private currentBasis(row: Row) {
    return (
      ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
        row.requirement.status,
      ) &&
      row.basisRevision === row.requirement.acceptedRevision &&
      row.requirement.acceptedRevision === row.requirement.revision
    );
  }
  private progressPlan(row: Row) {
    return (
      row.project.status === 'ACTIVE' &&
      (!row.workItem.iteration || row.workItem.iteration.status === 'ACTIVE')
    );
  }
  private async find(tx: Tx, projectId: string, id: string) {
    const row = await tx.task.findFirst({
      where: { projectId, id, status: { not: 'CANCELLED' } },
      include,
    });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '任务不存在或不属于当前项目');
    return row;
  }
  private requirementDto(row: Row['requirement'], key: string) {
    return {
      id: row.id,
      revision: row.revision,
      acceptedRevision: row.acceptedRevision,
      code: `${key}-REQ-${String(row.number).padStart(4, '0')}`,
      title: row.workItem.title,
      status: row.status,
      type: row.type,
    };
  }
  private snapshot(row: Row) {
    return {
      code: `${row.project.key}-TASK-${String(row.number).padStart(4, '0')}`,
      title: row.workItem.title,
      description: row.description,
      priority: row.priority,
      assigneeId: row.assigneeId,
      assigneeName: row.assignee?.name ?? null,
      requirementId: row.requirementId,
      estimatedHours: row.estimatedHours?.toNumber() ?? null,
      dueDate: row.dueDate?.toISOString().slice(0, 10) ?? null,
      iterationId: row.workItem.iterationId,
      iterationName: row.workItem.iteration?.name ?? null,
      status: row.status,
      blocked: row.blocked,
      blockedReason: row.blockedReason,
      helperId: row.helperId,
      helperName: row.helper?.name ?? null,
      basisRevision: row.basisRevision,
    };
  }
  private dto(row: Row, actor: Actor, roles: readonly ProjectRole[]) {
    const actions: string[] = [],
      manager = this.manager(actor, roles),
      writer = actor.user.isSystemAdmin || hasPermission(roles, 'task:write');
    if (this.editable(row) && writer) {
      if (this.editor(row, actor, roles)) {
        if (row.status !== 'COMPLETED') actions.push('edit', 'block');
        if (
          row.status === 'IN_PROGRESS' &&
          !row.blocked &&
          this.currentBasis(row) &&
          this.progressPlan(row)
        )
          actions.push('complete');
        if (row.status === 'COMPLETED' && this.progressPlan(row)) actions.push('reopen', 'reset');
        if (row.status === 'IN_PROGRESS' && this.progressPlan(row)) actions.push('reset');
        if (
          row.blocked &&
          (row.status === 'TODO' || (this.currentBasis(row) && this.progressPlan(row)))
        )
          actions.push('resume');
        if (
          row.status === 'IN_PROGRESS' &&
          !this.currentBasis(row) &&
          ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
            row.requirement.status,
          )
        )
          actions.push('acknowledge');
      }
      if (manager) actions.push('assign');
      else if (!row.assigneeId && row.status === 'TODO') actions.push('claim');
      if (this.canStart(row) && (manager || row.assigneeId === actor.userId)) actions.push('start');
    }
    return taskSchema.parse({
      ...this.snapshot(row),
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      requirement: this.requirementDto(row.requirement, row.project.key),
      assignee: row.assignee,
      createdBy: row.createdBy,
      iteration: row.workItem.iteration,
      version: row.version,
      startedAt: row.startedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions: actions,
      canAssignOthers: manager && this.editable(row),
      blocked: row.blocked,
      blockedReason: row.blockedReason,
      helper: row.helper,
      blockedAt: row.blockedAt?.toISOString() ?? null,
      basisRevision: row.basisRevision,
      needsRequirementReview: row.status === 'IN_PROGRESS' && !this.currentBasis(row),
    });
  }
  private filter(
    projectId: string,
    data: ReturnType<typeof taskQuerySchema.parse>,
    key: string,
  ): Prisma.TaskWhereInput {
    const number = data.q.toUpperCase().startsWith(`${key}-TASK-`)
      ? Number(data.q.slice(`${key}-TASK-`.length))
      : null;
    const where: Prisma.TaskWhereInput = {
      projectId,
      status: data.status ?? { not: 'CANCELLED' },
      ...(data.priority ? { priority: data.priority } : {}),
      ...(data.requirementId ? { requirementId: data.requirementId } : {}),
      ...(data.assigneeId ? { assigneeId: data.assigneeId } : {}),
      ...(data.assigneeId && data.unassigned === 'true'
        ? { AND: { assigneeId: data.assigneeId } }
        : {}),
      ...(data.unassigned === 'true'
        ? { assigneeId: null }
        : data.unassigned === 'false' && !data.assigneeId
          ? { assigneeId: { not: null } }
          : {}),
      ...(data.iterationId ? { workItem: { iterationId: data.iterationId } } : {}),
      ...(data.q
        ? {
            OR: [
              { workItem: { title: { contains: data.q, mode: 'insensitive' } } },
              { description: { contains: data.q, mode: 'insensitive' } },
              ...(number && Number.isSafeInteger(number) && number <= 2147483647
                ? [{ number }]
                : []),
            ],
          }
        : {}),
    };

    if (data.blocked) where.blocked = data.blocked === 'true';
    if (data.overdue) {
      const overdue = {
        dueDate: { lt: new Date(workbenchDate()) },
        status: { notIn: ['COMPLETED', 'CANCELLED'] as Array<'COMPLETED' | 'CANCELLED'> },
      };
      const previous = where.AND;
      where.AND = [
        ...(previous ? (Array.isArray(previous) ? previous : [previous]) : []),
        data.overdue === 'true' ? overdue : { NOT: overdue },
      ];
    }
    return where;
  }
  async board(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      data = taskBoardQuerySchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req),
          base = this.filter(projectId, taskQuerySchema.parse(data), project.key);
        const columns = [];
        for (const [status, page] of [
          ['TODO', data.todoPage],
          ['IN_PROGRESS', data.progressPage],
          ['COMPLETED', data.completedPage],
        ] as const) {
          const where = { ...base, status };
          const rows = await tx.task.findMany({
            where,
            include,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * data.pageSize,
            take: data.pageSize,
          });
          columns.push({
            status,
            page,
            pageSize: data.pageSize,
            total: await tx.task.count({ where }),
            items: rows.map((row) => this.dto(row, actor, project.members[0]?.roles ?? [])),
          });
        }
        const visible = {
          ...base,
          status: {
            in: ['TODO', 'IN_PROGRESS', 'COMPLETED'] as Array<
              import('../../generated/prisma/enums.js').TaskStatus
            >,
          },
        };
        return taskBoardSchema.parse({
          columns,
          summary: {
            total: await tx.task.count({ where: visible }),
            blocked: await tx.task.count({ where: { AND: [visible, { blocked: true }] } }),
            overdue: await tx.task.count({
              where: {
                AND: [
                  visible,
                  {
                    dueDate: { lt: new Date(workbenchDate()) },
                    status: { notIn: ['COMPLETED', 'CANCELLED'] },
                  },
                ],
              },
            }),
          },
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async list(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      data = taskQuerySchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        const where = this.filter(projectId, data, project.key);
        const rows = await tx.task.findMany({
          where,
          include,
          orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
          skip: (data.page - 1) * data.pageSize,
          take: data.pageSize,
        });
        return {
          items: rows.map((row) => this.dto(row, actor, project.members[0]?.roles ?? [])),
          total: await tx.task.count({ where }),
          page: data.page,
          pageSize: data.pageSize,
          canCreate:
            this.writable(project.status) &&
            (actor.user.isSystemAdmin ||
              hasPermission(project.members[0]?.roles ?? [], 'task:write')),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(projectId: string, id: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      { page, pageSize } = paginationSchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req),
          row = await this.find(tx, projectId, id);
        const where = { projectId, targetId: id, action: { startsWith: 'task.' } };
        const logs = await tx.activityLog.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        });
        const actors = await tx.user.findMany({
          where: { id: { in: logs.flatMap((log) => (log.actorId ? [log.actorId] : [])) } },
          select: person,
        });
        return taskDetailSchema.parse({
          ...this.dto(row, actor, project.members[0]?.roles ?? []),
          history: {
            items: logs.map((log) => ({
              ...log,
              actorName: actors.find((actor) => actor.id === log.actorId)?.name ?? '系统',
              createdAt: log.createdAt.toISOString(),
            })),
            total: await tx.activityLog.count({ where }),
            page,
            pageSize,
          },
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async people(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      { q, page, pageSize, purpose } = taskPeopleQuerySchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const project = await this.projects.authorize(tx, actor, projectId, req, 'task:write'),
        canAssignOthers = this.manager(actor, project.members[0]?.roles ?? []);
      const where: Prisma.ProjectMemberWhereInput = {
        projectId,
        ...(!canAssignOthers && purpose !== 'helper' ? { userId: actor.userId } : {}),
        user: {
          active: true,
          ...(q
            ? {
                OR: [
                  { name: { contains: q, mode: 'insensitive' } },
                  { email: { contains: q, mode: 'insensitive' } },
                ],
              }
            : {}),
        },
        OR: [
          {
            roles: {
              hasSome: projectRoles.filter((role) =>
                hasPermission([role], purpose === 'helper' ? 'collaboration:write' : 'task:write'),
              ),
            },
          },
          { user: { isSystemAdmin: true } },
        ],
      };
      const rows = await tx.projectMember.findMany({
        where,
        select: { user: { select: { ...person, email: true } } },
        orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return {
        items: rows.map((row) => row.user),
        total: await tx.projectMember.count({ where }),
        page,
        pageSize,
        canAssignOthers,
      };
    });
  }
  async requirements(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      { q, page, pageSize } = userQuerySchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const project = await this.projects.authorize(tx, actor, projectId, req, 'task:write');
      const number = q.toUpperCase().startsWith(`${project.key}-REQ-`)
        ? Number(q.slice(`${project.key}-REQ-`.length))
        : null;
      const where: Prisma.RequirementWhereInput = {
        projectId,
        status: { in: [...requirementStatuses] },
        workItem: { OR: [{ iterationId: null }, { iteration: { status: { not: 'CLOSED' } } }] },
        ...(q
          ? {
              OR: [
                { workItem: { title: { contains: q, mode: 'insensitive' } } },
                ...(number && Number.isSafeInteger(number) && number <= 2147483647
                  ? [{ number }]
                  : []),
              ],
            }
          : {}),
      };
      const rows = await tx.requirement.findMany({
        where,
        include: { workItem: plan },
        orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      });
      return {
        items: rows.map((row) => ({
          ...this.requirementDto(row, project.key),
          iteration: row.workItem.iteration,
        })),
        total: await tx.requirement.count({ where }),
        page,
        pageSize,
      };
    });
  }
  private async eligible(tx: Tx, projectId: string, id: string) {
    const users = await tx.$queryRaw<
      Array<{ active: boolean; isSystemAdmin: boolean }>
    >`SELECT active, "isSystemAdmin" FROM "User" WHERE id = ${id}::uuid FOR SHARE`;
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: id } },
    });
    if (
      !users[0]?.active ||
      !member ||
      (!users[0].isSystemAdmin && !hasPermission(member.roles, 'task:write'))
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '任务负责人须为本项目具有任务权限的可用成员',
      );
  }
  private async authorize(tx: Tx, actor: Actor, projectId: string, req: Request, id?: string) {
    const project = await this.projects.authorize(tx, actor, projectId, req, 'task:write', true);
    if (!this.writable(project.status))
      throw new ApiException(403, 'FORBIDDEN', '当前项目仅可查看任务');
    if (id) await this.find(tx, projectId, id);
    return project;
  }
  private check(row: Row, version: number) {
    if (row.version !== version)
      throw new ApiException(409, 'CONFLICT', '任务已被更新，请刷新后重试');
    if (!this.editable(row))
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '当前任务、关联需求或迭代仅可查看');
  }
  private async requirement(tx: Tx, projectId: string, id: string) {
    const row = await tx.requirement.findFirst({
      where: { projectId, id },
      include: { workItem: plan },
    });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '关联需求不存在或不属于当前项目');
    if (
      !requirementStatuses.includes(row.status as (typeof requirementStatuses)[number]) ||
      row.workItem.iteration?.status === 'CLOSED'
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '当前需求已结束或所属迭代已关闭，不能拆分任务',
      );
    return row;
  }
  private async event(
    tx: Tx,
    actor: Actor,
    req: Request,
    row: Row,
    action: string,
    details: Prisma.InputJsonObject,
    recipientId = row.assigneeId,
    additionalRecipientIds: string[] = [],
  ) {
    await this.events.record(tx, {
      actorId: actor.userId,
      requestId: req.requestId,
      projectId: row.projectId,
      target: { targetType: 'TASK', targetId: row.id },
      action,
      additionalRecipientIds,
      details: { code: this.snapshot(row).code, title: row.workItem.title, ...details },
      ...(recipientId || additionalRecipientIds.length
        ? {
            ...(recipientId ? { recipientId } : {}),
            title:
              `${actor.user.name} ${action === 'task.created' ? '向你分配了任务' : action === 'task.assigned' ? '调整了任务负责人' : action === 'task.started' ? '开始了任务' : '更新了任务'}「${row.workItem.title}」`.slice(
                0,
                200,
              ),
          }
        : {}),
    });
  }
  async create(projectId: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = createTaskSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'task.create', projectId, ...data },
      async (tx) => {
        const requirement = await this.requirement(tx, projectId, data.requirementId);
        if (data.assigneeId) await this.eligible(tx, projectId, data.assigneeId);
        const iterationId =
          data.iterationId === undefined ? requirement.workItem.iterationId : data.iterationId;
        if (iterationId) await this.iterations.assertAssignable(tx, projectId, iterationId);
        const project = await tx.project.update({
          where: { id: projectId },
          data: { taskSequence: { increment: 1 } },
        });
        const item = await tx.workItem.create({
          data: { projectId, kind: 'TASK', title: data.title, iterationId },
        });
        const row = await tx.task.create({
          data: {
            id: item.id,
            projectId,
            requirementId: requirement.id,
            number: project.taskSequence,
            createdById: actor.userId,
            description: data.description,
            priority: data.priority,
            assigneeId: data.assigneeId,
            estimatedHours: data.estimatedHours,
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
          },
          include,
        });
        await invalidateRequirementTests(tx, projectId, requirement.id);
        await refreshRequirementProgress(tx, projectId, requirement.id);
        await this.event(tx, actor, req, row, 'task.created', this.snapshot(row));
        return { id: row.id };
      },
      async (tx) => {
        const project = await this.authorize(tx, actor, projectId, req);
        if (
          data.assigneeId &&
          data.assigneeId !== actor.userId &&
          !this.manager(actor, project.members[0]?.roles ?? [])
        )
          throw new ApiException(403, 'FORBIDDEN', '只有具有分配权限的成员可以向他人分配任务');
      },
    );
  }
  async update(projectId: string, id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = updateTaskSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'task.update', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.check(row, data.version);
        if (row.workItem.iterationId && !data.iterationId)
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '已纳入迭代的任务不能直接移出，请调整至其他未关闭迭代',
          );
        if (row.workItem.iterationId !== data.iterationId && !data.changeReason)
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '调整任务迭代请填写原因');
        if (data.iterationId) {
          await this.iterations.assertAssignable(tx, projectId, data.iterationId);
          const iteration = await tx.iteration.findUniqueOrThrow({
            where: { id: data.iterationId },
          });
          if (row.status === 'IN_PROGRESS' && iteration.status !== 'ACTIVE')
            throw new ApiException(
              422,
              'BUSINESS_RULE_VIOLATION',
              '进行中的任务只能调整至进行中的迭代',
            );
        }
        await tx.workItem.update({
          where: { id },
          data: { title: data.title, iterationId: data.iterationId },
        });
        const next = await tx.task.update({
          where: { id },
          data: {
            description: data.description,
            priority: data.priority,
            estimatedHours: data.estimatedHours,
            dueDate: data.dueDate ? new Date(data.dueDate) : null,
            version: { increment: 1 },
          },
          include,
        });
        await this.event(tx, actor, req, next, 'task.updated', {
          before: this.snapshot(row),
          after: this.snapshot(next),
          reason: data.changeReason,
        });
        return { id };
      },
      async (tx) => {
        const project = await this.authorize(tx, actor, projectId, req, id),
          row = await this.find(tx, projectId, id);
        if (!this.editor(row, actor, project.members[0]?.roles ?? []))
          throw new ApiException(403, 'FORBIDDEN', '只能维护本人负责或本人创建且尚未分配的任务');
      },
    );
  }
  async assign(projectId: string, id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = assignTaskSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'task.assign', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.check(row, data.version);
        if (row.assigneeId === data.assigneeId)
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请选择不同的任务负责人');
        if (!data.assigneeId && row.status !== 'TODO')
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '进行中的任务必须保留负责人');
        if (data.assigneeId) await this.eligible(tx, projectId, data.assigneeId);
        const next = await tx.task.update({
          where: { id },
          data: { assigneeId: data.assigneeId, version: { increment: 1 } },
          include,
        });
        await this.event(
          tx,
          actor,
          req,
          next,
          'task.assigned',
          { before: this.snapshot(row), after: this.snapshot(next), reason: data.reason },
          next.assigneeId,
          row.assigneeId ? [row.assigneeId] : [],
        );
        return { id };
      },
      async (tx) => {
        const project = await this.authorize(tx, actor, projectId, req, id);
        if (!this.manager(actor, project.members[0]?.roles ?? [])) {
          const row = await this.find(tx, projectId, id);
          if (
            data.assigneeId !== actor.userId ||
            (row.assigneeId && row.assigneeId !== actor.userId)
          )
            throw new ApiException(403, 'FORBIDDEN', '仅可认领尚未分配的待开始任务');
        }
      },
    );
  }
  async start(projectId: string, id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = startTaskSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'task.start', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.check(row, data.version);
        if (!this.canStart(row))
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '开始前须确认需求、指定负责人、启动项目及已安排的迭代',
          );
        await this.eligible(tx, projectId, row.assigneeId!);
        const next = await tx.task.update({
          where: { id },
          data: {
            status: 'IN_PROGRESS',
            startedAt: new Date(),
            basisRevision: row.requirement.revision,
            version: { increment: 1 },
          },
          include,
        });
        await invalidateRequirementTests(tx, projectId, row.requirementId);
        await refreshRequirementProgress(tx, projectId, row.requirementId);

        await this.event(tx, actor, req, next, 'task.started', {
          before: this.snapshot(row),
          after: this.snapshot(next),
          reason: data.reason,
          onBehalf: row.assigneeId !== actor.userId,
          adminOverride: actor.user.isSystemAdmin && row.assigneeId !== actor.userId,
        });
        return { id };
      },
      async (tx) => {
        const project = await this.authorize(tx, actor, projectId, req, id),
          row = await this.find(tx, projectId, id);
        if (row.assigneeId !== actor.userId) {
          if (!this.manager(actor, project.members[0]?.roles ?? []))
            throw new ApiException(
              403,
              'FORBIDDEN',
              '仅任务负责人或具有分配权限的成员可以开始任务',
            );
          if (!data.reason)
            throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '代为开始任务请填写原因');
        }
      },
    );
  }
  async transition(
    projectId: string,
    id: string,
    action: 'block' | 'resume' | 'cancel' | 'acknowledge' | 'complete' | 'reopen' | 'reset',
    input: unknown,
    req: Request,
  ) {
    const actor = await this.identity.requireWrite(req),
      data =
        action === 'block'
          ? blockTaskSchema.parse(input)
          : action === 'acknowledge'
            ? acknowledgeTaskSchema.parse(input)
            : reasonTaskSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: `task.${action}`, projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.check(row, data.version);
        if (
          action === 'complete' &&
          (row.status !== 'IN_PROGRESS' ||
            row.blocked ||
            !this.currentBasis(row) ||
            !this.progressPlan(row))
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '完成前须有有效需求依据、进行中的任务和计划，并解除阻塞',
          );
        if (action === 'reopen' && (row.status !== 'COMPLETED' || !this.progressPlan(row)))
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '仅已完成任务可以重新开始');
        if (action === 'reset' && !['IN_PROGRESS', 'COMPLETED'].includes(row.status))
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '仅进行中或已完成任务可退回待开始',
          );
        if (['block', 'resume', 'acknowledge'].includes(action) && row.status === 'COMPLETED')
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请先重新开始任务');
        if (action === 'block') {
          const helperId = blockTaskSchema.parse(input).helperId;
          const users = await tx.$queryRaw<
            Array<{ active: boolean; isSystemAdmin: boolean }>
          >`SELECT active, "isSystemAdmin" FROM "User" WHERE id = ${helperId}::uuid FOR SHARE`;
          const helper = await tx.projectMember.findUnique({
            where: { projectId_userId: { projectId, userId: helperId } },
          });
          if (
            !users[0]?.active ||
            !helper ||
            (!users[0].isSystemAdmin && !hasPermission(helper.roles, 'collaboration:write'))
          )
            throw new ApiException(
              422,
              'BUSINESS_RULE_VIOLATION',
              '协助人须为本项目可用且具有协作权限的成员',
            );
        }
        if (
          action === 'resume' &&
          (!row.blocked ||
            (row.status === 'IN_PROGRESS' && (!this.currentBasis(row) || !this.progressPlan(row))))
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '恢复前须有阻塞记录、有效需求基线，并启动项目和任务迭代',
          );
        if (
          action === 'acknowledge' &&
          (row.status !== 'IN_PROGRESS' ||
            this.currentBasis(row) ||
            !['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
              row.requirement.status,
            ) ||
            row.requirement.acceptedRevision !== row.requirement.revision)
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '需在新需求重新确认后核对任务影响',
          );
        if (
          action === 'acknowledge' &&
          acknowledgeTaskSchema.parse(input).requirementRevision !==
            row.requirement.acceptedRevision
        )
          throw new ApiException(409, 'CONFLICT', '需求基线已更新，请重新核对当前修订');
        const next = await tx.task.update({
          where: { id },
          data: {
            ...(action === 'block'
              ? {
                  blocked: true,
                  blockedReason: data.reason,
                  helperId: blockTaskSchema.parse(input).helperId,
                  blockedAt: new Date(),
                }
              : {}),
            ...(action === 'resume' ||
            action === 'cancel' ||
            action === 'complete' ||
            action === 'reopen' ||
            action === 'reset'
              ? { blocked: false, blockedReason: '', helperId: null, blockedAt: null }
              : {}),
            ...(action === 'cancel' ? { status: 'CANCELLED' } : {}),
            ...(action === 'complete' ? { status: 'COMPLETED' } : {}),
            ...(action === 'reopen'
              ? { status: 'IN_PROGRESS', basisRevision: row.requirement.acceptedRevision }
              : {}),
            ...(action === 'reset' ? { status: 'TODO', basisRevision: null } : {}),
            ...(action === 'acknowledge'
              ? { basisRevision: row.requirement.acceptedRevision }
              : {}),
            version: { increment: 1 },
          },
          include,
        });
        if (['reopen', 'reset'].includes(action))
          await invalidateRequirementTests(tx, projectId, row.requirementId);
        if (['complete', 'reopen', 'reset'].includes(action))
          await tx.workItem.update({
            where: { id },
            data: { resolution: action === 'complete' ? 'DONE' : 'OPEN' },
          });
        await refreshRequirementProgress(tx, projectId, row.requirementId);
        if (action === 'cancel')
          await tx.workItem.update({ where: { id }, data: { resolution: 'CANCELED' } });
        await this.event(
          tx,
          actor,
          req,
          next,
          `task.${action}`,
          { before: this.snapshot(row), after: this.snapshot(next), reason: data.reason },
          next.assigneeId,
          [...new Set([row.helperId, next.helperId].filter((value): value is string => !!value))],
        );
        return { id };
      },
      async (tx) => {
        const project = await this.authorize(tx, actor, projectId, req, id),
          row = await this.find(tx, projectId, id);
        if (!this.editor(row, actor, project.members[0]?.roles ?? []))
          throw new ApiException(
            403,
            'FORBIDDEN',
            '仅任务负责人、未分配任务创建者或项目负责人可以处理任务',
          );
      },
    );
  }
}
