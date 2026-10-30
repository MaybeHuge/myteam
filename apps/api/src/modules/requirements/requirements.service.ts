import { refreshRequirementProgress } from '../../common/requirement-progress.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createRequirementSchema,
  applyDocumentSchema,
  reviseRequirementSchema,
  updateRequirementSchema,
  requirementQuerySchema,
  requirementSchema,
  requirementDetailSchema,
  requirementSnapshotSchema,
  requirementPeopleQuerySchema,
  submitRequirementSchema,
  decideRequirementSchema,
  reasonRequirementSchema,
  paginationSchema,
  hasPermission,
  projectRoles,
  type Permission,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { RequirementDocumentsService } from './requirement-documents.service.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { ApiException } from '../../common/http.js';
import { testPreparation } from '../../common/test-preparation.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { IterationsService } from '../iterations/iterations.service.js';
type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
const person = { id: true, name: true } as const;
const include = {
  documentVersion: { select: { id: true, number: true } },
  workItem: { include: { iteration: { select: { id: true, name: true, status: true } } } },
  owner: { select: person },
  reviewer: { select: person },
  createdBy: { select: person },
  project: { select: { key: true } },
} as const;
type Row = Prisma.RequirementGetPayload<{ include: typeof include }>;
@Injectable()
export class RequirementsService {
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly events: CollaborationEvents,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
    private readonly iterations: IterationsService,
    private readonly documents: RequirementDocumentsService,
  ) {}
  private writable(status: string) {
    return !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(status);
  }
  private async find(tx: Tx, projectId: string, id: string) {
    const row = await tx.requirement.findFirst({ where: { id, projectId }, include });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '需求不存在或不属于当前项目');
    return row;
  }
  private snapshot(row: Row) {
    return requirementSnapshotSchema.parse({
      code: `${row.project.key}-REQ-${String(row.number).padStart(4, '0')}`,
      title: row.workItem.title,
      document: row.documentVersion,
      description: row.description,
      acceptanceCriteria: row.acceptanceCriteria,
      type: row.type,
      priority: row.priority,
      owner: row.owner,
      iteration: row.workItem.iteration,
      revision: row.revision,
    });
  }
  private dto(row: Row, actor: Actor, roles: Parameters<typeof hasPermission>[0], status: string) {
    const actions: string[] = [];
    if (this.writable(status) && row.workItem.iteration?.status !== 'CLOSED') {
      if (actor.user.isSystemAdmin || hasPermission(roles, 'requirement:write')) {
        if (row.status === 'DRAFT') actions.push('edit', 'submit', 'cancel');
        if (['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(row.status))
          actions.push('revise');
        if (row.status === 'IN_REVIEW') actions.push('withdraw');
      }
      if (
        row.status === 'IN_REVIEW' &&
        (actor.user.isSystemAdmin ||
          (row.reviewerId === actor.userId && hasPermission(roles, 'requirement:review')))
      )
        actions.push('approve', 'return');
    }
    return requirementSchema.parse({
      ...this.snapshot(row),
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      ownerId: row.ownerId,
      iterationId: row.workItem.iterationId,
      reviewer: row.reviewer,
      createdBy: row.createdBy,
      status: row.status,
      version: row.version,
      reviewRound: row.reviewRound,
      acceptedRevision: row.acceptedRevision,
      scopeVersion: row.scopeVersion,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      allowedActions: actions,
    });
  }
  async list(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { q, status, priority, type, ownerId, iterationId, page, pageSize } =
      requirementQuerySchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        const number = q.toUpperCase().startsWith(`${project.key}-REQ-`)
          ? Number(q.slice(`${project.key}-REQ-`.length))
          : null;
        const where: Prisma.RequirementWhereInput = {
          projectId,
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(type ? { type } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(iterationId ? { workItem: { iterationId } } : {}),
          ...(q
            ? {
                OR: [
                  { workItem: { title: { contains: q, mode: 'insensitive' } } },
                  { description: { contains: q, mode: 'insensitive' } },
                  { documentVersion: { plainText: { contains: q, mode: 'insensitive' } } },
                  ...(number && Number.isSafeInteger(number) && number <= 2147483647
                    ? [{ number }]
                    : []),
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          tx.requirement.findMany({
            where,
            include,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.requirement.count({ where }),
        ]);
        return {
          items: rows.map((row) =>
            this.dto(row, actor, project.members[0]?.roles ?? [], project.status),
          ),
          total,
          page,
          pageSize,
          canCreate:
            this.writable(project.status) &&
            (actor.user.isSystemAdmin ||
              hasPermission(project.members[0]?.roles ?? [], 'requirement:write')),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(projectId: string, id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        const row = await this.find(tx, projectId, id);
        const [history, total] = await Promise.all([
          tx.requirementReview.findMany({
            where: { projectId, requirementId: id },
            include: { actor: { select: person }, reviewer: { select: person } },
            orderBy: [{ round: 'desc' }, { action: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.requirementReview.count({ where: { projectId, requirementId: id } }),
        ]);
        const changes = await tx.requirementChange.findMany({
          where: { projectId, requirementId: id },
          include: { actor: { select: person } },
          orderBy: [{ scopeVersion: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        });
        const baseline = await tx.requirementReview.findFirst({
          where: { projectId, requirementId: id, action: 'APPROVED' },
          orderBy: { round: 'desc' },
        });
        const taskPage = paginationSchema.parse({ page: req.query.taskPage ?? 1, pageSize }).page;
        const casePage = paginationSchema.parse({ page: req.query.casePage ?? 1, pageSize }).page;
        const taskWhere = { projectId, requirementId: id, status: { not: 'CANCELLED' as const } };
        const tasks = await tx.task.findMany({
          where: taskWhere,
          include: { workItem: true, assignee: { select: person } },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          skip: (taskPage - 1) * pageSize,
          take: pageSize,
        });
        const groups = await tx.task.groupBy({
          by: ['status'],
          where: taskWhere,
          _count: { _all: true },
        });
        const count = (status: string) =>
          groups.find((group) => group.status === status)?._count._all ?? 0;
        const taskTotal = groups.reduce((sum, group) => sum + group._count._all, 0);
        return requirementDetailSchema.parse({
          ...this.dto(row, actor, project.members[0]?.roles ?? [], project.status),
          ...(await testPreparation(tx, projectId, row, row.project.key, casePage, pageSize)),
          baseline: baseline?.snapshot ?? null,
          tasks: {
            items: tasks.map((task) => ({
              id: task.id,
              code: `${row.project.key}-TASK-${String(task.number).padStart(4, '0')}`,
              title: task.workItem.title,
              status: task.status,
              blocked: task.blocked,
              assignee: task.assignee,
              dueDate: task.dueDate?.toISOString().slice(0, 10) ?? null,
            })),
            total: taskTotal,
            page: taskPage,
            pageSize,
          },
          taskSummary: {
            total: taskTotal,
            todo: count('TODO'),
            inProgress: count('IN_PROGRESS'),
            readyForTest: count('READY_FOR_TEST'),
            testing: count('TESTING'),
            accepting: count('ACCEPTING'),
            completed: count('COMPLETED'),
            cancelled: count('CANCELLED'),
            blocked: await tx.task.count({
              where: { ...taskWhere, blocked: true, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
            }),
          },
          changes: {
            items: changes.map((change) => ({
              ...change,
              createdAt: change.createdAt.toISOString(),
            })),
            total: await tx.requirementChange.count({ where: { projectId, requirementId: id } }),
            page,
            pageSize,
          },
          history: {
            items: history.map((record) => ({
              ...record,
              createdAt: record.createdAt.toISOString(),
            })),
            total,
            page,
            pageSize,
          },
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async people(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { purpose, q, page, pageSize } = requirementPeopleQuerySchema.parse(req.query);
    const roles = projectRoles.filter((role) => hasPermission([role], 'requirement:review'));
    return this.db.$transaction(async (tx) => {
      await this.projects.authorize(tx, actor, projectId, req, 'requirement:write');
      const where: Prisma.ProjectMemberWhereInput = {
        projectId,
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
        ...(purpose === 'reviewer'
          ? { OR: [{ roles: { hasSome: roles } }, { user: { isSystemAdmin: true } }] }
          : {}),
      };
      const [members, total] = await Promise.all([
        tx.projectMember.findMany({
          where,
          select: { user: { select: { id: true, name: true, email: true } } },
          orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.projectMember.count({ where }),
      ]);
      return { items: members.map((member) => member.user), total, page, pageSize };
    });
  }
  private async eligible(tx: Tx, projectId: string, id: string, reviewer = false) {
    const users = await tx.$queryRaw<
      Array<{ active: boolean; isSystemAdmin: boolean }>
    >`SELECT active, "isSystemAdmin" FROM "User" WHERE id = ${id}::uuid FOR SHARE`;
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: id } },
    });
    if (
      !users[0]?.active ||
      !member ||
      (reviewer && !users[0].isSystemAdmin && !hasPermission(member.roles, 'requirement:review'))
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        reviewer ? '评审人须为本项目具有评审权限的可用成员' : '需求负责人须为本项目的可用成员',
      );
  }
  private async authorize(
    tx: Tx,
    actor: Actor,
    projectId: string,
    req: Request,
    permission: Permission,
    id?: string,
  ) {
    const project = await this.projects.authorize(tx, actor, projectId, req, permission, true);
    if (!this.writable(project.status))
      throw new ApiException(403, 'FORBIDDEN', '当前项目仅可查看需求');
    if (id) await this.find(tx, projectId, id);
    return project;
  }
  private async plan(tx: Tx, projectId: string, iterationId: string | null) {
    if (iterationId) await this.iterations.assertAssignable(tx, projectId, iterationId);
  }
  private version(row: Row, version: number) {
    if (row.version !== version)
      throw new ApiException(409, 'CONFLICT', '需求已被更新，请刷新后重试');
  }
  private async complete(tx: Tx, row: Row) {
    if (!row.description.trim() || !row.acceptanceCriteria.trim() || !row.ownerId)
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '请先补齐需求描述、负责人和可判断的验收标准',
      );
    await this.eligible(tx, row.projectId, row.ownerId);
  }
  private event(
    tx: Tx,
    actor: Actor,
    req: Request,
    projectId: string,
    id: string,
    action: string,
    details: Prisma.InputJsonObject,
    recipientId?: string,
    title?: string,
  ) {
    return this.events.record(tx, {
      actorId: actor.userId,
      requestId: req.requestId,
      projectId,
      target: { targetType: 'REQUIREMENT', targetId: id },
      action,
      details,
      ...(recipientId ? { recipientId } : {}),
      ...(title ? { title: title.slice(0, 200) } : {}),
    });
  }
  async create(projectId: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = createRequirementSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'requirement.create', projectId, ...data },
      async (tx) => {
        if (data.ownerId) await this.eligible(tx, projectId, data.ownerId);
        await this.plan(tx, projectId, data.iterationId);
        const project = await tx.project.update({
          where: { id: projectId },
          data: { requirementSequence: { increment: 1 } },
        });
        const item = await tx.workItem.create({
          data: {
            projectId,
            iterationId: data.iterationId,
            kind: 'REQUIREMENT',
            title: data.title,
          },
        });
        const row = await tx.requirement.create({
          data: {
            id: item.id,
            projectId,
            number: project.requirementSequence,
            ownerId: data.ownerId,
            description: data.description,
            acceptanceCriteria: data.acceptanceCriteria,
            type: data.type,
            priority: data.priority,
            createdById: actor.userId,
          },
          include,
        });
        await this.event(
          tx,
          actor,
          req,
          projectId,
          row.id,
          'requirement.created',
          { ...this.snapshot(row) },
          row.ownerId ?? undefined,
          `${actor.user.name} 向你分配了需求「${item.title}」`,
        );
        return { id: row.id };
      },
      async (tx) => {
        await this.authorize(tx, actor, projectId, req, 'requirement:write');
      },
    );
  }
  async update(
    projectId: string,
    id: string,
    input: unknown,
    req: Request,
    context?: { tx: Tx; actor: Actor },
  ) {
    const actor = context?.actor ?? (await this.identity.requireWrite(req)),
      data = updateRequirementSchema.parse(input);
    const apply = async (tx: Tx) => {
      const row = await this.find(tx, projectId, id);
      this.version(row, data.version);
      if (row.status !== 'DRAFT')
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          '仅草稿可以编辑，评审中和已确认内容须保留本次基线',
        );
      await this.plan(tx, projectId, row.workItem.iterationId);
      if (row.workItem.iterationId && !data.iterationId)
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          '已纳入迭代的需求不能直接移出，请调整至其他未关闭迭代或取消',
        );
      if (
        row.workItem.iterationId &&
        row.workItem.iterationId !== data.iterationId &&
        !data.changeReason
      )
        throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '调整迭代请填写原因');
      await this.plan(tx, projectId, data.iterationId);
      if (data.ownerId) await this.eligible(tx, projectId, data.ownerId);
      await tx.workItem.update({
        where: { id },
        data: { title: data.title, iterationId: data.iterationId },
      });
      const documentVersionId =
        data.documentDraftVersion === undefined
          ? undefined
          : await this.documents.apply(tx, row, actor, data.documentDraftVersion);
      const next = await tx.requirement.update({
        where: { id },
        data: {
          ...(documentVersionId ? { documentVersionId } : {}),
          ownerId: data.ownerId,
          description: data.description,
          acceptanceCriteria: data.acceptanceCriteria,
          type: data.type,
          priority: data.priority,
          version: { increment: 1 },
          revision: { increment: 1 },
        },
        include,
      });
      await this.event(
        tx,
        actor,
        req,
        projectId,
        id,
        'requirement.updated',
        { before: this.snapshot(row), after: this.snapshot(next), reason: data.changeReason },
        row.ownerId !== data.ownerId ? (data.ownerId ?? undefined) : undefined,
        `${actor.user.name} 向你分配了需求「${data.title}」`,
      );
      return { id };
    };
    if (context) return apply(context.tx);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'requirement.update', projectId, id, ...data },
      apply,
      async (tx) => {
        await this.authorize(tx, actor, projectId, req, 'requirement:write', id);
      },
    );
  }
  async revise(
    projectId: string,
    id: string,
    input: unknown,
    req: Request,
    context?: { tx: Tx; actor: Actor },
  ) {
    const actor = context?.actor ?? (await this.identity.requireWrite(req)),
      data = reviseRequirementSchema.parse(input);
    const apply = async (tx: Tx) => {
      const row = await this.find(tx, projectId, id);
      this.version(row, data.version);
      if (
        !['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(row.status) ||
        !row.acceptedRevision
      )
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          '仅已确认或实现中的需求可以发起新修订',
        );
      await this.plan(tx, projectId, row.workItem.iterationId);
      await this.plan(tx, projectId, data.iterationId);
      if (row.workItem.iterationId && !data.iterationId)
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          '已有迭代不能直接清空，请明确调整去向',
        );
      if (data.ownerId) await this.eligible(tx, projectId, data.ownerId);
      const documentVersionId =
        data.documentDraftVersion === undefined
          ? undefined
          : await this.documents.apply(tx, row, actor, data.documentDraftVersion);
      const values = (value: {
        title: string;
        description: string;
        acceptanceCriteria: string;
        type: string;
        priority: string;
        ownerId: string | null;
        iterationId: string | null;
      }) => [
        value.title,
        value.description,
        value.acceptanceCriteria,
        value.type,
        value.priority,
        value.ownerId,
        value.iterationId,
      ];
      if (
        !documentVersionId &&
        JSON.stringify(values(data)) ===
          JSON.stringify(
            values({ ...row, title: row.workItem.title, iterationId: row.workItem.iterationId }),
          )
      )
        throw new ApiException(
          422,
          'BUSINESS_RULE_VIOLATION',
          '请实际修改需求内容或责任计划后再发起修订',
        );
      const baseline = await tx.requirementReview.findFirst({
        where: { requirementId: id, revision: row.acceptedRevision, action: 'APPROVED' },
        orderBy: { round: 'desc' },
      });
      if (!baseline) throw new ApiException(409, 'CONFLICT', '缺少已确认基线，请先核对评审历史');
      const tasks = await tx.task.findMany({
        where: { projectId, requirementId: id, status: { not: 'CANCELLED' } },
        select: { id: true, assigneeId: true, helperId: true },
      });
      await tx.workItem.update({
        where: { id },
        data: { title: data.title, iterationId: data.iterationId },
      });
      const next = await tx.requirement.update({
        where: { id },
        data: {
          ...(documentVersionId ? { documentVersionId } : {}),
          description: data.description,
          acceptanceCriteria: data.acceptanceCriteria,
          type: data.type,
          priority: data.priority,
          ownerId: data.ownerId,
          status: 'DRAFT',
          revision: { increment: 1 },
          scopeVersion: { increment: 1 },
          testCycle: { increment: 1 },
          version: { increment: 1 },
        },
        include,
      });
      const effects = {
        testCaseReviewRequired: true,
        acceptanceInvalidated: true,
        releaseCheckInvalidated: true,
      };
      await tx.testCase.updateMany({
        where: {
          projectId,
          status: { not: 'DEPRECATED' },
          links: { some: { requirementId: id } },
        },
        data: { needsReview: true, version: { increment: 1 } },
      });
      await tx.task.updateMany({
        where: {
          projectId,
          requirementId: id,
          status: { in: ['READY_FOR_TEST', 'TESTING', 'ACCEPTING', 'COMPLETED'] },
        },
        data: { status: 'IN_PROGRESS', version: { increment: 1 } },
      });
      await tx.workItem.update({ where: { id }, data: { resolution: 'OPEN' } });
      await tx.workItem.updateMany({
        where: { id: { in: tasks.map((t) => t.id) } },
        data: { resolution: 'OPEN' },
      });
      const change = await tx.requirementChange.create({
        data: {
          projectId,
          requirementId: id,
          actorId: actor.userId,
          fromRevision: row.acceptedRevision,
          toRevision: next.revision,
          scopeVersion: next.scopeVersion,
          reason: data.reason,
          impact: data.impact,
          before: baseline.snapshot as Prisma.InputJsonObject,
          after: this.snapshot(next),
          affectedTaskIds: tasks.map((task) => task.id),
          effects,
        },
      });
      await tx.task.updateMany({
        where: { id: { in: tasks.map((task) => task.id) } },
        data: { version: { increment: 1 } },
      });
      await this.events.record(tx, {
        actorId: actor.userId,
        requestId: req.requestId,
        projectId,
        target: { targetType: 'REQUIREMENT', targetId: id },
        action: 'requirement.revised',
        details: {
          code: this.snapshot(next).code,
          title: data.title,
          changeId: change.id,
          fromRevision: row.acceptedRevision,
          toRevision: next.revision,
          scopeVersion: next.scopeVersion,
          reason: data.reason,
          impact: data.impact,
          affectedTaskIds: tasks.map((task) => task.id),
          ...effects,
        },
        ...(next.ownerId ? { recipientId: next.ownerId } : {}),
        additionalRecipientIds: [
          ...new Set(
            tasks
              .flatMap((task) => [task.assigneeId, task.helperId])
              .filter((value): value is string => !!value),
          ),
        ],
        title: `需求「${data.title}」已修订，请核对影响并等待重新评审`.slice(0, 200),
      });
      return { id };
    };
    if (context) return apply(context.tx);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'requirement.revise', projectId, id, ...data },
      apply,
      async (tx) => {
        await this.authorize(tx, actor, projectId, req, 'requirement:write', id);
      },
    );
  }
  async applyDocument(projectId: string, id: string, input: unknown, req: Request) {
    const data = applyDocumentSchema.parse(input);
    const actor = await this.identity.requireWrite(req);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'requirement.document.apply', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        const fields = {
          title: row.workItem.title,
          description: row.description,
          acceptanceCriteria: row.acceptanceCriteria,
          type: row.type,
          priority: row.priority,
          ownerId: row.ownerId,
          iterationId: row.workItem.iterationId,
          version: data.requirementVersion,
          documentDraftVersion: data.version,
        };
        if (row.status === 'DRAFT') await this.update(projectId, id, fields, req, { tx, actor });
        else
          await this.revise(
            projectId,
            id,
            { ...fields, reason: data.reason, impact: data.impact },
            req,
            { tx, actor },
          );
        return { id };
      },
      async (tx) => {
        await this.documents.context(tx, actor, projectId, id, req, true);
      },
    );
  }
  async transition(
    projectId: string,
    id: string,
    action: 'submit' | 'approve' | 'return' | 'withdraw' | 'cancel',
    input: unknown,
    req: Request,
  ) {
    const actor = await this.identity.requireWrite(req);
    const data =
      action === 'submit'
        ? submitRequirementSchema.parse(input)
        : ['return', 'withdraw', 'cancel'].includes(action)
          ? reasonRequirementSchema.parse(input)
          : decideRequirementSchema.parse(input);
    const decide = action === 'approve' || action === 'return';
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: `requirement.${action}`, projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.version(row, data.version);
        await this.plan(tx, projectId, row.workItem.iterationId);
        if (
          action === 'submit' || action === 'cancel'
            ? row.status !== 'DRAFT'
            : row.status !== 'IN_REVIEW'
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '当前需求状态不允许此操作，请刷新查看最新进展',
          );
        let round = row.reviewRound;
        if (
          action === 'cancel' &&
          (await tx.task.count({
            where: { requirementId: id, status: { notIn: ['COMPLETED', 'CANCELLED'] } },
          }))
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '需求仍有关联的未结束任务，请先处理任务',
          );
        let reviewerId = row.reviewerId;
        let snapshot = this.snapshot(row);
        if (action === 'submit' || action === 'approve') await this.complete(tx, row);
        if (action === 'submit') {
          await this.documents.assertApplied(tx, row);
          reviewerId = submitRequirementSchema.parse(input).reviewerId;
          await this.eligible(tx, projectId, reviewerId, true);
          round++;
        }
        if (decide || action === 'withdraw') {
          const submitted = await tx.requirementReview.findUnique({
            where: {
              requirementId_round_action: { requirementId: id, round, action: 'SUBMITTED' },
            },
          });
          if (!submitted || (action === 'approve' && submitted.revision !== row.revision))
            throw new ApiException(409, 'CONFLICT', '评审基线已变化，请重新提交评审');
          snapshot = requirementSnapshotSchema.parse(submitted.snapshot);
          const content = (value: typeof snapshot) => [
            value.code,
            value.title,
            value.description,
            value.acceptanceCriteria,
            value.type,
            value.priority,
            value.owner?.id,
            value.iteration?.id,
            value.revision,
            value.document?.id ?? null,
          ];
          if (
            action === 'approve' &&
            JSON.stringify(content(snapshot)) !== JSON.stringify(content(this.snapshot(row)))
          )
            throw new ApiException(409, 'CONFLICT', '需求内容与评审基线不一致，请撤回后重新提交');
        }
        const implementing =
          action === 'approve' &&
          (await tx.task.count({ where: { requirementId: id, status: 'IN_PROGRESS' } })) > 0;
        const nextStatus =
          action === 'submit'
            ? 'IN_REVIEW'
            : action === 'approve'
              ? implementing
                ? 'IMPLEMENTING'
                : 'CONFIRMED'
              : action === 'cancel'
                ? 'CANCELLED'
                : 'DRAFT';
        await tx.requirement.update({
          where: { id },
          data: {
            status: nextStatus,
            reviewerId,
            reviewRound: round,
            ...(action === 'approve' ? { acceptedRevision: row.revision } : {}),
            version: { increment: 1 },
          },
        });
        if (action === 'cancel')
          await tx.workItem.update({ where: { id }, data: { resolution: 'CANCELED' } });
        if (action !== 'cancel')
          await tx.requirementReview.create({
            data: {
              projectId,
              requirementId: id,
              round,
              revision: snapshot.revision,
              action:
                action === 'submit'
                  ? 'SUBMITTED'
                  : action === 'approve'
                    ? 'APPROVED'
                    : action === 'return'
                      ? 'RETURNED'
                      : 'WITHDRAWN',
              actorId: actor.userId,
              reviewerId: reviewerId!,
              comment: data.comment,
              snapshot,
            },
          });
        if (action === 'approve') await refreshRequirementProgress(tx, projectId, id);
        if (action === 'cancel')
          await tx.workItem.update({ where: { id }, data: { resolution: 'CANCELED' } });
        const recipient = action === 'submit' || action === 'withdraw' ? reviewerId : row.ownerId;
        const words = {
          submit: '提交了需求评审',
          approve: '确认了需求',
          return: '退回了需求',
          withdraw: '撤回了需求评审',
          cancel: '取消了需求',
        };
        await this.event(
          tx,
          actor,
          req,
          projectId,
          id,
          `requirement.${action}`,
          {
            code: snapshot.code,
            title: snapshot.title,
            from: row.status,
            to: nextStatus,
            revision: row.revision,
            round,
            comment: data.comment,
            reviewerId,
            adminOverride: decide && actor.userId !== row.reviewerId,
          },
          recipient ?? undefined,
          `${actor.user.name} ${words[action]}「${row.workItem.title}」`,
        );
        return { id };
      },
      async (tx) => {
        await this.authorize(
          tx,
          actor,
          projectId,
          req,
          decide ? 'requirement:review' : 'requirement:write',
          id,
        );
        if (decide) {
          const row = await this.find(tx, projectId, id);
          if (row.reviewerId !== actor.userId) {
            if (!actor.user.isSystemAdmin)
              throw new ApiException(403, 'FORBIDDEN', '仅指定评审人可以作出评审结论');
            if (!data.comment)
              throw new ApiException(
                422,
                'BUSINESS_RULE_VIOLATION',
                '代为评审请填写原因，操作会记录到评审历史',
              );
          }
        }
      },
    );
  }
}
