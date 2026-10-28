import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  hasPermission,
  paginationSchema,
  type Permission,
  type CollaborationTarget,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { RequirementValidity } from '../../common/requirement-validity.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';
import { ApiException } from '../../common/http.js';
export type Tx = Prisma.TransactionClient;
export type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
export type Context = {
  tx: Tx;
  actor: Actor;
  project: Awaited<ReturnType<ProjectsService['authorize']>>;
  req: Request;
};
export function rule(condition: unknown, message: string): asserts condition {
  if (!condition) throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', message);
}
export function checkVersion(row: { version: number }, version: number) {
  if (row.version !== version) throw new ApiException(409, 'CONFLICT', '记录已更新，请刷新后重试');
}
export const personSelect = { id: true, name: true } as const;
export const terminalDefects = ['CLOSED', 'DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE'] as const;
@Injectable()
export class QualitySupport {
  constructor(
    readonly db: Database,
    readonly commands: Commands,
    readonly events: CollaborationEvents,
    readonly validity: RequirementValidity,
    readonly identity: IdentityService,
    readonly projects: ProjectsService,
  ) {}
  allowed(c: Context, permission: Permission) {
    return (
      c.actor.user.isSystemAdmin || hasPermission(c.project.members[0]?.roles ?? [], permission)
    );
  }
  manager(c: Context) {
    return c.actor.user.isSystemAdmin || (c.project.members[0]?.roles ?? []).includes('OWNER');
  }
  assigned(c: Context, id: string) {
    if (c.actor.userId !== id && !this.manager(c))
      throw new ApiException(403, 'FORBIDDEN', '仅当前指定负责人可以处理此事项');
  }
  async eligible(tx: Tx, projectId: string, id: string, permission: Permission) {
    const users = await tx.$queryRaw<
      Array<{ active: boolean; isSystemAdmin: boolean }>
    >`SELECT active,"isSystemAdmin" FROM "User" WHERE id=${id}::uuid FOR SHARE`;
    const m = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: id } },
    });
    rule(
      users[0]?.active && m && (users[0].isSystemAdmin || hasPermission(m.roles, permission)),
      '责任人须为本项目具备对应权限的可用成员',
    );
  }
  async write(
    projectId: string,
    req: Request,
    input: Prisma.InputJsonObject,
    permission: Permission,
    apply: (c: Context) => Promise<Prisma.InputJsonValue>,
    guard?: (c: Context) => Promise<void>,
  ) {
    const actor = await this.identity.requireWrite(req);
    let context: Context;
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      input,
      async () => apply(context),
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req, permission, true);
        if (project.status !== 'ACTIVE')
          throw new ApiException(
            403,
            'FORBIDDEN',
            '当前项目仅可查看测试与交付记录，请先启动或恢复项目',
          );
        context = { tx, actor, project, req };
        await guard?.(context);
      },
    );
  }
  async read<T>(projectId: string, req: Request, apply: (c: Context) => Promise<T>) {
    const actor = await this.identity.requireSession(req);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        return apply({ tx, actor, project, req });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async person(tx: Tx, id: string) {
    return tx.user.findUniqueOrThrow({ where: { id }, select: personSelect });
  }
  async history(c: Context, id: string) {
    const { page, pageSize } = paginationSchema.parse(c.req.query);
    const where = { projectId: c.project.id, targetId: id };
    const rows = await c.tx.activityLog.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      skip: (page - 1) * pageSize,
      take: pageSize,
    });
    return {
      items: await Promise.all(
        rows.map(async (r) => ({
          ...r,
          actor: r.actorId
            ? await c.tx.user.findUnique({ where: { id: r.actorId }, select: personSelect })
            : null,
          createdAt: r.createdAt.toISOString(),
        })),
      ),
      total: await c.tx.activityLog.count({ where }),
      page,
      pageSize,
    };
  }
  async event(
    c: Context,
    targetType: CollaborationTarget['targetType'],
    id: string,
    action: string,
    details: Prisma.InputJsonObject,
    recipients: string[] = [],
  ) {
    await this.events.record(c.tx, {
      projectId: c.project.id,
      actorId: c.actor.userId,
      requestId: c.req.requestId,
      target: { targetType, targetId: id },
      action,
      details,
      additionalRecipientIds: recipients,
      title: `${details.title ?? '测试协作'} · ${action}`.slice(0, 200),
    });
  }
  async build(tx: Tx, projectId: string, id: string) {
    const row = await tx.build.findFirst({ where: { id, projectId } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '构建不存在或不属于当前项目');
    return row;
  }
  async release(tx: Tx, projectId: string, id: string) {
    const row = await tx.release.findFirst({ where: { id, projectId } });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '版本不存在或不属于当前项目');
    return row;
  }
}
