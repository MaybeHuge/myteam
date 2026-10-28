import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import type { CollaborationTarget } from '@myteam/contracts';

// 业务模块在自身事务中调用；审计/通知任一失败都会使业务回滚。
@Injectable()
export class CollaborationEvents {
  async record(
    tx: Prisma.TransactionClient,
    event: {
      actorId: string;
      projectId: string;
      requestId: string;
      action: string;
      target: CollaborationTarget;
      details?: Prisma.InputJsonObject;
      recipientId?: string;
      additionalRecipientIds?: string[];
      title?: string;
    },
  ) {
    await tx.activityLog.create({
      data: {
        actorId: event.actorId,
        projectId: event.projectId,
        requestId: event.requestId,
        action: event.action,
        targetId: event.target.targetId,
        details: { targetType: event.target.targetType, ...event.details },
      },
    });

    if (!event.title) return;
    const ids = [
      ...new Set([
        ...(event.recipientId ? [event.recipientId] : []),
        ...(event.additionalRecipientIds ?? []),
      ]),
    ].filter((id) => id !== event.actorId);
    if (!ids.length) return;
    const recipients = await tx.projectMember.findMany({
      where: { projectId: event.projectId, userId: { in: ids }, user: { active: true } },
      select: { userId: true },
    });
    for (const recipient of recipients)
      await tx.notification.create({
        data: {
          projectId: event.projectId,
          recipientId: recipient.userId,
          ...event.target,
          title: event.title,
        },
      });
  }
}
