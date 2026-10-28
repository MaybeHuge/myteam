import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  collaborationTargetSchema,
  createCommentSchema,
  paginationSchema,
  notificationQuerySchema,
  hasPermission,
  type CollaborationTarget,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { S3Storage } from '../../infrastructure/s3-storage.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { ApiException } from '../../common/http.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';

type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
@Injectable()
export class CollaborationService {
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly events: CollaborationEvents,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
    private readonly storage: S3Storage,
  ) {}

  private async authorize(
    tx: Tx,
    actor: Actor,
    projectId: string,
    target: CollaborationTarget,
    req: Request,
    write = false,
  ) {
    const project = await this.projects.authorize(
      tx,
      actor,
      projectId,
      req,
      write ? 'collaboration:write' : 'project:read',
      write,
    );
    let ownerId = project.ownerId;
    let title = project.name;
    let closed = false;
    if (target.targetType === 'PROJECT') {
      if (target.targetId !== projectId) throw new ApiException(404, 'NOT_FOUND', '协作对象不存在');
    } else if (target.targetType === 'ITERATION') {
      const iteration = await tx.iteration.findFirst({ where: { id: target.targetId, projectId } });
      if (!iteration) throw new ApiException(404, 'NOT_FOUND', '迭代不存在或不属于当前项目');
      ownerId = iteration.ownerId;
      title = iteration.name;
      closed = iteration.status === 'CLOSED';
    } else if (target.targetType === 'TEST_CASE') {
      const item = await tx.testCase.findFirst({ where: { id: target.targetId, projectId } });
      if (!item) throw new ApiException(404, 'NOT_FOUND', '用例不存在或不属于当前项目');
      ownerId = item.ownerId ?? project.ownerId;
      title = item.title;
      closed = item.status === 'DEPRECATED';
    } else if (target.targetType === 'RELEASE') {
      const item = await tx.release.findFirst({ where: { id: target.targetId, projectId } });
      if (!item) throw new ApiException(404, 'NOT_FOUND', '版本不存在');
      ownerId = project.ownerId;
      title = item.name;
      closed = ['RELEASED', 'ARCHIVED'].includes(item.status);
    } else if (target.targetType === 'TEST_RECORD') {
      const item = await tx.testRecord.findFirst({ where: { id: target.targetId, projectId } });
      if (!item) throw new ApiException(404, 'NOT_FOUND', '测试记录不存在');
      ownerId = item.executorId;
      title = '测试记录';
      closed = item.outcome !== 'NOT_RUN';
    } else if (target.targetType === 'DEFECT') {
      const item = await tx.defect.findFirst({ where: { id: target.targetId, projectId } });
      if (!item) throw new ApiException(404, 'NOT_FOUND', '缺陷不存在');
      ownerId = item.status === 'AWAITING_RETEST' ? item.retesterId : item.assigneeId;
      title = item.title;
      closed = ['CLOSED', 'DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE'].includes(item.status);
    } else if (target.targetType === 'REQUIREMENT') {
      const requirement = await tx.requirement.findFirst({
        where: { id: target.targetId, projectId },
        include: { workItem: { include: { iteration: true } } },
      });
      if (!requirement) throw new ApiException(404, 'NOT_FOUND', '需求不存在或不属于当前项目');
      ownerId = requirement.ownerId ?? project.ownerId;
      title = requirement.workItem.title;
      closed =
        ['CANCELLED', 'COMPLETED'].includes(requirement.status) ||
        requirement.workItem.iteration?.status === 'CLOSED';
    } else {
      const task = await tx.task.findFirst({
        where: { id: target.targetId, projectId },
        include: {
          workItem: { include: { iteration: true } },
          requirement: { include: { workItem: { include: { iteration: true } } } },
        },
      });
      if (!task) throw new ApiException(404, 'NOT_FOUND', '任务不存在或不属于当前项目');
      ownerId = task.assigneeId ?? project.ownerId;
      title = task.workItem.title;
      closed =
        ['CANCELLED', 'COMPLETED'].includes(task.status) ||
        ['CANCELLED', 'COMPLETED'].includes(task.requirement.status) ||
        task.workItem.iteration?.status === 'CLOSED' ||
        task.requirement.workItem.iteration?.status === 'CLOSED';
    }
    const canWrite =
      !closed &&
      !['ARCHIVED', 'COMPLETED'].includes(project.status) &&
      (actor.user.isSystemAdmin ||
        hasPermission(project.members[0]?.roles ?? [], 'collaboration:write'));
    if (write && !canWrite) throw new ApiException(403, 'FORBIDDEN', '当前对象仅可查看协作记录');
    return { canWrite, ownerId, title };
  }
  async list(projectId: string, targetInput: unknown, req: Request, attachments = false) {
    const actor = await this.identity.requireSession(req);
    const target = collaborationTargetSchema.parse(targetInput);
    const { page, pageSize } = paginationSchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const { canWrite } = await this.authorize(tx, actor, projectId, target, req);
      const where = { projectId, ...target };
      const query = {
        where,
        orderBy: [{ createdAt: 'desc' as const }, { id: 'desc' as const }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      };
      const rows = attachments
        ? await tx.attachment.findMany(query)
        : await tx.comment.findMany(query);
      const total = attachments
        ? await tx.attachment.count({ where })
        : await tx.comment.count({ where });
      const names = await tx.user.findMany({
        where: {
          id: { in: rows.map((row) => ('authorId' in row ? row.authorId : row.uploaderId)) },
        },
        select: { id: true, name: true },
      });
      const name = (id: string) => names.find((u) => u.id === id)?.name ?? '已移除成员';
      return {
        page,
        pageSize,
        total,
        canWrite,
        items: rows.map((row) =>
          'body' in row
            ? {
                id: row.id,
                body: row.body,
                authorName: name(row.authorId),
                createdAt: row.createdAt.toISOString(),
              }
            : {
                id: row.id,
                filename: row.filename,
                size: row.size,
                contentType: row.contentType,
                uploaderName: name(row.uploaderId),
                createdAt: row.createdAt.toISOString(),
              },
        ),
      };
    });
  }
  async comment(projectId: string, targetInput: unknown, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const target = collaborationTargetSchema.parse(targetInput);
    const data = createCommentSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'comment.create', projectId, ...target, ...data },
      async (tx) => {
        const context = await this.authorize(tx, actor, projectId, target, req, true);
        const row = await tx.comment.create({
          data: { projectId, ...target, authorId: actor.userId, ...data },
        });
        await this.events.record(tx, {
          actorId: actor.userId,
          projectId,
          requestId: req.requestId,
          action: 'comment.created',
          target,
          details: { commentId: row.id },
          recipientId: context.ownerId,
          title: `${actor.user.name} 评论了「${context.title}」`.slice(0, 200),
        });
        return { id: row.id };
      },
      async (tx) => {
        await this.authorize(tx, actor, projectId, target, req, true);
      },
    );
  }
  async upload(projectId: string, targetInput: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const target = collaborationTargetSchema.parse(targetInput);
    const filename = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (v) =>
          !/[\\/]/.test(v) &&
          !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
        '文件名不能包含路径或控制字符',
      )
      .parse(req.query.filename);
    z.uuid().parse(req.get('idempotency-key'));
    // 在读取文件内容前确认权限；落库前在项目锁内再次确认。
    await this.db.$transaction(async (tx) => {
      await this.authorize(tx, actor, projectId, target, req, true);
    });
    if (!req.is('application/octet-stream'))
      throw new ApiException(400, 'VALIDATION_ERROR', '请使用二进制文件上传');
    const limit = 20 * 1024 * 1024;
    if (Number(req.get('content-length')) > limit)
      throw new ApiException(400, 'VALIDATION_ERROR', '附件不能超过 20 MiB');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > limit) {
        req.resume();
        throw new ApiException(400, 'VALIDATION_ERROR', '附件不能超过 20 MiB');
      }
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks);
    const hash = createHash('sha256').update(content).digest('hex');
    const stored = await this.storage.put(filename, content);
    let used = false;
    let applyFailed = false;
    try {
      const result = await this.commands.run(
        actor.userId,
        req.get('idempotency-key'),
        { action: 'attachment.upload', projectId, ...target, filename, hash },
        async (tx) => {
          const context = await this.authorize(tx, actor, projectId, target, req, true);
          try {
            const row = await tx.attachment.create({
              data: { projectId, ...target, uploaderId: actor.userId, ...stored },
            });
            await this.events.record(tx, {
              actorId: actor.userId,
              projectId,
              requestId: req.requestId,
              action: 'attachment.uploaded',
              target,
              details: { attachmentId: row.id, filename, size: row.size },
              recipientId: context.ownerId,
              title: `${actor.user.name} 向「${context.title}」添加了附件`.slice(0, 200),
            });
            used = true;
            return { id: row.id };
          } catch (error) {
            applyFailed = true;
            throw error;
          }
        },
        async (tx) => {
          await this.authorize(tx, actor, projectId, target, req, true);
        },
      );
      if (!used) await this.discard(stored.storageKey);
      return result;
    } catch (error) {
      // 明确发生于事务回调内的错误已回滚；提交结果不明时保留对象，由保护窗口清理。
      if (applyFailed || error instanceof ApiException) await this.discard(stored.storageKey);
      throw error;
    }
  }
  private async discard(storageKey: string) {
    try {
      await this.storage.remove(storageKey);
    } catch {
      process.stderr.write(
        `${JSON.stringify({ level: 'error', event: 'storage.cleanup.deferred', storageKey })}\n`,
      );
    }
  }
  async download(projectId: string, id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const row = await this.db.$transaction(async (tx) => {
      await this.projects.authorize(tx, actor, projectId, req);
      const attachment = await tx.attachment.findFirst({ where: { id, projectId } });
      if (!attachment) throw new ApiException(404, 'NOT_FOUND', '附件不存在');
      await this.authorize(tx, actor, projectId, attachment, req);
      return attachment;
    });
    if (!row.storageBucket)
      throw new ApiException(503, 'SERVICE_UNAVAILABLE', '附件尚未完成存储迁移，请联系管理员');
    return { row, stream: await this.storage.stream(row.storageKey, row.storageBucket) };
  }
  private visible(actor: Actor): Prisma.NotificationWhereInput {
    return {
      recipientId: actor.userId,
      project: actor.user.isSystemAdmin ? {} : { members: { some: { userId: actor.userId } } },
    };
  }
  async notifications(req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize, unread } = notificationQuerySchema.parse(req.query);
    const visible = this.visible(actor);
    const where = { ...visible, ...(unread === 'true' ? { readAt: null } : {}) };
    return this.db.$transaction(async (tx) => {
      const [items, total, unreadCount] = await Promise.all([
        tx.notification.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
          select: {
            id: true,
            projectId: true,
            targetType: true,
            targetId: true,
            title: true,
            readAt: true,
            createdAt: true,
          },
        }),
        tx.notification.count({ where }),
        tx.notification.count({ where: { ...visible, readAt: null } }),
      ]);
      return {
        items: items.map((item) => ({
          ...item,
          readAt: item.readAt?.toISOString() ?? null,
          createdAt: item.createdAt.toISOString(),
        })),
        total,
        page,
        pageSize,
        unread: unreadCount,
      };
    });
  }
  async readNotification(id: string, req: Request) {
    const actor = await this.identity.requireWrite(req);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'notification.read', id },
      async (tx) => {
        await tx.notification.updateMany({
          where: { id, ...this.visible(actor), readAt: null },
          data: { readAt: new Date() },
        });
        return { id };
      },
      async (tx) => {
        const user = await tx.user.findUnique({ where: { id: actor.userId } });
        if (!user?.active) throw new ApiException(401, 'UNAUTHENTICATED', '登录已失效');
        if (!(await tx.notification.findFirst({ where: { id, ...this.visible(actor) } })))
          throw new ApiException(404, 'NOT_FOUND', '通知不存在');
      },
    );
  }
}
