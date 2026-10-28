import { assertQualityHandover } from '../../common/quality-responsibilities.js';
import { assertTestCaseHandover } from '../../common/test-case-responsibilities.js';
import { assertTaskHandover } from '../../common/task-responsibilities.js';
import { assertRequirementHandover } from '../../common/requirement-responsibilities.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  addProjectMemberSchema,
  createProjectSchema,
  hasPermission,
  projectMemberQuerySchema,
  projectQuerySchema,
  projectSchema,
  projectStateCommandSchema,
  updateProjectMemberSchema,
  updateProjectSchema,
  versionSchema,
  type Permission,
  type ProjectRole,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { ApiException } from '../../common/http.js';
import { IdentityService } from '../identity/identity.service.js';

type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
type Tx = Prisma.TransactionClient;
const publicUser = { id: true, name: true, email: true, isSystemAdmin: true } as const;
const projectInclude = {
  owner: { select: publicUser },
  members: {
    select: { userId: true, roles: true, user: { select: publicUser } },
    orderBy: { joinedAt: 'asc' as const },
  },
  _count: { select: { members: true } },
} satisfies Prisma.ProjectInclude;
type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

@Injectable()
export class ProjectsService {
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly identity: IdentityService,
  ) {}

  private dto(project: ProjectRow, actor: Actor) {
    const membership = project.members.find((member) => member.userId === actor.userId);
    const roles = membership?.roles ?? [];
    const manage =
      project.status !== 'ARCHIVED' &&
      (actor.user.isSystemAdmin || hasPermission(roles, 'project:manage'));
    const members =
      project.status !== 'ARCHIVED' &&
      (actor.user.isSystemAdmin || hasPermission(roles, 'member:manage'));
    const allowedActions: string[] = [];
    if (manage) {
      allowedActions.push('edit');
      if (project.status === 'PENDING') allowedActions.push('start');
      if (project.status === 'ACTIVE') allowedActions.push('pause');
      if (project.status === 'PAUSED') allowedActions.push('resume');
    }
    if (members) allowedActions.push('manageMembers');
    return projectSchema.parse({
      ...project,
      owner: project.owner,
      memberCount: project._count.members,
      memberPreview: project.members.slice(0, 4).map((member) => member.user),
      startDate: project.startDate?.toISOString().slice(0, 10) ?? null,
      endDate: project.endDate?.toISOString().slice(0, 10) ?? null,
      createdAt: project.createdAt.toISOString(),
      updatedAt: project.updatedAt.toISOString(),
      myRoles: roles,
      allowedActions,
      access: membership ? 'MEMBER' : 'ADMIN',
    });
  }

  private async actorStillActive(tx: Tx, actor: Actor) {
    const users = await tx.$queryRaw<
      Array<{ active: boolean }>
    >`SELECT active FROM "User" WHERE id = ${actor.userId}::uuid FOR SHARE`;
    if (!users[0]?.active) throw new ApiException(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
  }

  async authorize(
    tx: Tx,
    actor: Actor,
    id: string,
    req: Request,
    permission: Permission = 'project:read',
    write = false,
  ) {
    if (write) {
      await this.actorStillActive(tx, actor);
      await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${id}::uuid FOR UPDATE`;
    }
    const project = await tx.project.findUnique({
      where: { id },
      include: { members: { where: { userId: actor.userId } } },
    });
    const membership = project?.members[0];
    if (!project || (!membership && !actor.user.isSystemAdmin))
      throw new ApiException(404, 'NOT_FOUND', '项目不存在或你没有访问权限');
    if (!actor.user.isSystemAdmin && !hasPermission(membership?.roles ?? [], permission))
      throw new ApiException(403, 'FORBIDDEN', '当前项目角色没有此操作权限');
    if (write && project.status === 'ARCHIVED')
      throw new ApiException(403, 'FORBIDDEN', '项目已归档，仅可查看');
    if (actor.user.isSystemAdmin && (!membership || !hasPermission(membership.roles, permission))) {
      await tx.activityLog.create({
        data: {
          actorId: actor.userId,
          projectId: id,
          targetId: id,
          action: 'project.admin.access',
          requestId: req.requestId,
          details: { permission },
        },
      });
    }
    return project;
  }

  private audit(
    tx: Tx,
    actor: Actor,
    req: Request,
    id: string,
    action: string,
    details: Prisma.InputJsonValue,
  ) {
    return tx.activityLog.create({
      data: {
        actorId: actor.userId,
        projectId: id,
        targetId: id,
        action,
        details,
        requestId: req.requestId,
      },
    });
  }
  private checkVersion(actual: number, expected: number) {
    if (actual !== expected)
      throw new ApiException(409, 'CONFLICT', '内容已被其他成员更新，请刷新后重试');
  }

  async list(req: Request) {
    const actor = await this.identity.requireSession(req);
    const { q, scope, status, page, pageSize } = projectQuerySchema.parse(req.query);
    const visible: Prisma.ProjectWhereInput = actor.user.isSystemAdmin
      ? {}
      : { members: { some: { userId: actor.userId } } };
    const filter: Prisma.ProjectWhereInput = {
      AND: [
        visible,
        ...(scope === 'owned' ? [{ ownerId: actor.userId }] : []),
        ...(scope === 'joined' ? [{ members: { some: { userId: actor.userId } } }] : []),
        ...(status ? [{ status }] : []),
        ...(q
          ? [
              {
                OR: [
                  { name: { contains: q, mode: 'insensitive' as const } },
                  { key: { contains: q, mode: 'insensitive' as const } },
                  { description: { contains: q, mode: 'insensitive' as const } },
                ],
              },
            ]
          : []),
      ],
    };
    const [items, total, groups] = await this.db.$transaction([
      this.db.project.findMany({
        where: filter,
        include: projectInclude,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.db.project.count({ where: filter }),
      this.db.project.groupBy({ by: ['status'], where: visible, _count: { _all: true } }),
    ]);
    if (actor.user.isSystemAdmin)
      await this.db.activityLog.create({
        data: { actorId: actor.userId, action: 'project.admin.list', requestId: req.requestId },
      });
    const count = (status: string) =>
      groups.find((group) => group.status === status)?._count._all ?? 0;
    return {
      items: items.map((item) => this.dto(item, actor)),
      total,
      page,
      pageSize,
      stats: {
        total: groups.reduce((sum, group) => sum + group._count._all, 0),
        active: count('ACTIVE'),
        pending: count('PENDING'),
        paused: count('PAUSED'),
      },
      canCreate: actor.user.isSystemAdmin,
    };
  }

  async detail(id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    return this.db.$transaction(async (tx) => {
      await this.authorize(tx, actor, id, req);
      const project = await tx.project.findUniqueOrThrow({
        where: { id },
        include: projectInclude,
      });
      return this.dto(project, actor);
    });
  }

  async create(input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    if (!actor.user.isSystemAdmin)
      throw new ApiException(403, 'FORBIDDEN', '只有系统管理员可以创建项目');
    const data = createProjectSchema.parse(input);
    const ownerId = data.ownerId ?? actor.userId;
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.create', ...data, ownerId },
      async (tx) => {
        const owners = await tx.$queryRaw<
          Array<{ active: boolean }>
        >`SELECT active FROM "User" WHERE id = ${ownerId}::uuid FOR SHARE`;
        if (!owners[0]?.active)
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请选择有效的项目负责人');
        const project = await tx.project.create({
          data: {
            key: data.key,
            name: data.name,
            description: data.description,
            color: data.color,
            icon: data.icon,
            ownerId,
            startDate: data.startDate ? new Date(data.startDate) : null,
            endDate: data.endDate ? new Date(data.endDate) : null,
            members: { create: { userId: ownerId, roles: ['OWNER'] } },
          },
        });
        await this.audit(tx, actor, req, project.id, 'project.created', {
          name: data.name,
          key: data.key,
        });
        return { id: project.id };
      },
    );
  }

  async update(id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const data = updateProjectSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.update', id, ...data },
      async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id } });
        this.checkVersion(project.version, data.version);
        if (
          await tx.iteration.count({
            where: {
              projectId: id,
              OR: [
                ...(data.startDate ? [{ startDate: { lt: new Date(data.startDate) } }] : []),
                ...(data.endDate ? [{ endDate: { gt: new Date(data.endDate) } }] : []),
              ],
            },
          })
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '项目日期不能排除已有迭代，请先调整迭代计划',
          );
        const ownerId = data.ownerId ?? project.ownerId;
        if (ownerId !== project.ownerId) {
          const owners = await tx.$queryRaw<
            Array<{ active: boolean }>
          >`SELECT active FROM "User" WHERE id = ${ownerId}::uuid FOR SHARE`;
          const member = await tx.projectMember.findUnique({
            where: { projectId_userId: { projectId: id, userId: ownerId } },
          });
          if (!owners[0]?.active || !member)
            throw new ApiException(
              422,
              'BUSINESS_RULE_VIOLATION',
              '新负责人必须是本项目的可用成员',
            );
          const roles: ProjectRole[] = [...new Set<ProjectRole>([...member.roles, 'OWNER'])];
          await tx.projectMember.update({
            where: { projectId_userId: { projectId: id, userId: ownerId } },
            data: { roles, version: { increment: 1 } },
          });
        }
        await tx.project.update({
          where: { id },
          data: {
            name: data.name,
            description: data.description,
            color: data.color,
            icon: data.icon,
            ownerId,
            startDate: data.startDate ? new Date(data.startDate) : null,
            endDate: data.endDate ? new Date(data.endDate) : null,
            version: { increment: 1 },
          },
        });
        await this.audit(tx, actor, req, id, 'project.updated', {
          name: data.name,
          fromOwnerId: project.ownerId,
          ownerId,
        });
        return { id };
      },
      async (tx) => {
        await this.authorize(tx, actor, id, req, 'project:manage', true);
      },
    );
  }

  async changeState(id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const data = projectStateCommandSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.status', id, ...data },
      async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id } });
        this.checkVersion(project.version, data.version);
        const allowed =
          (data.status === 'ACTIVE' && ['PENDING', 'PAUSED'].includes(project.status)) ||
          (data.status === 'PAUSED' && project.status === 'ACTIVE');
        if (!allowed)
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '当前项目状态不能执行此操作');
        await tx.project.update({
          where: { id },
          data: { status: data.status, version: { increment: 1 } },
        });
        await this.audit(tx, actor, req, id, 'project.status.changed', {
          from: project.status,
          to: data.status,
          reason: data.reason,
        });
        return { id };
      },
      async (tx) => {
        await this.authorize(tx, actor, id, req, 'project:manage', true);
      },
    );
  }

  async members(id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize, q } = projectMemberQuerySchema.parse(req.query);
    const where: Prisma.ProjectMemberWhereInput = {
      projectId: id,
      ...(q
        ? {
            user: {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : {}),
    };
    return this.db.$transaction(async (tx) => {
      await this.authorize(tx, actor, id, req);
      const [members, total] = await Promise.all([
        tx.projectMember.findMany({
          where,
          include: { user: { select: { ...publicUser, active: true } } },
          orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
          take: pageSize,
          skip: (page - 1) * pageSize,
        }),
        tx.projectMember.count({ where }),
      ]);
      return {
        items: members.map((member) => ({ ...member, joinedAt: member.joinedAt.toISOString() })),
        total,
        page,
        pageSize,
      };
    });
  }

  async memberOptions(id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize, q } = projectMemberQuerySchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const project = await this.authorize(tx, actor, id, req, 'member:manage');
      if (project.status === 'ARCHIVED')
        throw new ApiException(403, 'FORBIDDEN', '项目已归档，仅可查看');
      const where: Prisma.UserWhereInput = {
        active: true,
        memberships: { none: { projectId: id } },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [items, total] = await Promise.all([
        tx.user.findMany({
          where,
          select: { id: true, name: true, email: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
          take: pageSize,
          skip: (page - 1) * pageSize,
        }),
        tx.user.count({ where }),
      ]);
      return { items, total, page, pageSize };
    });
  }

  async addMember(id: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const data = addProjectMemberSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.member.add', id, ...data },
      async (tx) => {
        const users = await tx.$queryRaw<
          Array<{ id: string; active: boolean; name: string }>
        >`SELECT id, active, name FROM "User" WHERE email = ${data.email} FOR SHARE`;
        const user = users[0];
        if (!user?.active)
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '找不到可用账号，请联系管理员创建或启用该账号',
          );
        const project = await tx.project.findUniqueOrThrow({ where: { id } });
        await tx.projectMember.create({
          // 重新加入也使用递增代次，避免移除前的旧表单命中新建成员记录。
          data: { projectId: id, userId: user.id, roles: data.roles, version: project.version + 1 },
        });
        await tx.project.update({ where: { id }, data: { version: { increment: 1 } } });
        await this.audit(tx, actor, req, id, 'project.member.added', {
          userId: user.id,
          name: user.name,
          roles: data.roles,
        });
        return { userId: user.id };
      },
      async (tx) => {
        await this.authorize(tx, actor, id, req, 'member:manage', true);
      },
    );
  }

  async updateMember(id: string, userId: string, input: unknown, req: Request, remove = false) {
    const actor = await this.identity.requireWrite(req);
    const data = remove ? versionSchema.parse(input) : updateProjectMemberSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: remove ? 'project.member.remove' : 'project.member.roles', id, userId, ...data },
      async (tx) => {
        const project = await tx.project.findUniqueOrThrow({ where: { id } });
        const member = await tx.projectMember.findUnique({
          where: { projectId_userId: { projectId: id, userId } },
          include: { user: { select: { name: true, isSystemAdmin: true } } },
        });
        if (!member) throw new ApiException(404, 'NOT_FOUND', '该成员不属于当前项目');
        this.checkVersion(member.version, data.version);
        const roles = remove ? [] : updateProjectMemberSchema.parse(input).roles;
        if (userId === project.ownerId && (remove || !roles.includes('OWNER')))
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '请先移交项目负责人，再移除或调整该成员',
          );
        if (
          remove &&
          (await tx.iteration.count({
            where: { projectId: id, ownerId: userId, status: { not: 'CLOSED' } },
          }))
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '该成员仍负责未关闭迭代，请先移交迭代负责人',
          );
        await assertQualityHandover(tx, userId, id, {
          accept:
            remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'submission:accept')),
          execute: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'test:execute')),
          fix: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'defect:fix')),
          retest: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'defect:retest')),
        });
        await assertTestCaseHandover(tx, userId, {
          projectId: id,
          owner: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'case:write')),
          reviewer: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'case:review')),
        });
        await assertRequirementHandover(tx, userId, {
          projectId: id,
          owner: remove,
          reviewer:
            remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'requirement:review')),
        });
        await assertTaskHandover(tx, userId, id, {
          assignee: remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'task:write')),
          helper:
            remove || (!member.user.isSystemAdmin && !hasPermission(roles, 'collaboration:write')),
        });
        if (remove)
          await tx.projectMember.delete({ where: { projectId_userId: { projectId: id, userId } } });
        else
          await tx.projectMember.update({
            where: { projectId_userId: { projectId: id, userId } },
            data: { roles, version: { increment: 1 } },
          });
        await tx.project.update({ where: { id }, data: { version: { increment: 1 } } });
        await this.audit(
          tx,
          actor,
          req,
          id,
          remove ? 'project.member.removed' : 'project.member.roles.changed',
          { userId, name: member.user.name, fromRoles: member.roles, roles },
        );
        return { success: true };
      },
      async (tx) => {
        await this.authorize(tx, actor, id, req, 'member:manage', true);
      },
    );
  }

  async activity(id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    return this.db.$transaction(async (tx) => {
      await this.authorize(tx, actor, id, req);
      const logs = await tx.activityLog.findMany({
        where: { projectId: id, action: { not: 'project.admin.access' } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: 12,
      });
      const actors = await tx.user.findMany({
        where: { id: { in: logs.flatMap((log) => (log.actorId ? [log.actorId] : [])) } },
        select: { id: true, name: true },
      });
      return {
        items: logs.map((log) => ({
          id: log.id,
          action: log.action,
          details: log.details,
          actorName: actors.find((actor) => actor.id === log.actorId)?.name ?? '系统',
          createdAt: log.createdAt.toISOString(),
        })),
      };
    });
  }
}
