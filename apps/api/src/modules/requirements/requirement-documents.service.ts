import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createDocumentSchema,
  saveDocumentSchema,
  resetDocumentSchema,
  documentContentSchema,
  requirementDocumentSchema,
  documentVersionListSchema,
  documentImageListSchema,
  documentImageIds,
  documentPlainText,
  emptyDocument,
  hasPermission,
  paginationSchema,
  resolveLocale,
  translate,
  type DocumentContent,
} from '@myteam/contracts';
import { z } from 'zod';
import type { Prisma, Requirement } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { ApiException } from '../../common/http.js';
import { S3Storage } from '../../infrastructure/s3-storage.js';
import { attachmentMetadata } from '../../infrastructure/attachment-file.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';

type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
function requireRule(value: unknown, message: string): asserts value {
  if (!value) throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', message);
}
@Injectable()
export class RequirementDocumentsService {
  constructor(
    readonly db: Database,
    readonly commands: Commands,
    readonly events: CollaborationEvents,
    readonly identity: IdentityService,
    readonly projects: ProjectsService,
    readonly storage: S3Storage,
  ) {}

  async context(
    tx: Tx,
    actor: Actor,
    projectId: string,
    requirementId: string,
    req: Request,
    write = false,
  ) {
    const project = await this.projects.authorize(
      tx,
      actor,
      projectId,
      req,
      write ? 'requirement:write' : 'project:read',
      write,
    );
    const requirement = await tx.requirement.findFirst({
      where: { projectId, id: requirementId },
      include: { workItem: { include: { iteration: true } } },
    });
    if (!requirement) throw new ApiException(404, 'NOT_FOUND', '需求不存在或不属于当前项目');
    const canEdit =
      !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(project.status) &&
      !['IN_REVIEW', 'CANCELLED'].includes(requirement.status) &&
      requirement.workItem.iteration?.status !== 'CLOSED' &&
      (actor.user.isSystemAdmin ||
        hasPermission(project.members[0]?.roles ?? [], 'requirement:write'));
    if (write && !canEdit) throw new ApiException(403, 'FORBIDDEN', '当前需求文档仅可查看');
    return { project, requirement, canEdit };
  }
  private versionDto(row: Prisma.RequirementDocumentVersionGetPayload<object>) {
    return {
      id: row.id,
      number: row.number,
      content: documentContentSchema.parse(row.content),
      createdAt: row.createdAt.toISOString(),
      createdBy: { id: row.createdById, name: row.createdByName },
    };
  }
  async detail(projectId: string, requirementId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const selected =
      req.query.versionId === undefined ? undefined : z.uuid().parse(req.query.versionId);
    return this.db.$transaction(
      async (tx) => {
        const {
          project,
          requirement: row,
          canEdit,
        } = await this.context(tx, actor, projectId, requirementId, req);
        const current =
          selected || row.documentVersionId
            ? await tx.requirementDocumentVersion.findFirst({
                where: { projectId, requirementId, id: selected ?? row.documentVersionId! },
              })
            : null;
        if (selected && !current)
          throw new ApiException(404, 'NOT_FOUND', '文档版本不存在或不属于当前需求');
        const draft =
          canEdit && !selected
            ? await tx.requirementDocumentDraft.findUnique({ where: { requirementId } })
            : null;
        return requirementDocumentSchema.parse({
          requirement: {
            id: row.id,
            projectId,
            title: row.workItem.title,
            code: `${project.key}-REQ-${String(row.number).padStart(4, '0')}`,
            version: row.version,
            revision: row.revision,
            status: row.status,
          },
          current: current ? this.versionDto(current) : null,
          draft: draft
            ? {
                content: draft.content,
                version: draft.version,
                baseRevision: draft.baseRevision,
                updatedAt: draft.updatedAt.toISOString(),
                updatedBy: { id: draft.updatedById, name: draft.updatedByName },
              }
            : null,
          canEdit: canEdit && !selected,
          hasPendingChanges:
            !!draft &&
            (current
              ? JSON.stringify(draft.content) !== JSON.stringify(current.content)
              : !!(
                  documentPlainText(documentContentSchema.parse(draft.content)) ||
                  documentImageIds(documentContentSchema.parse(draft.content)).length
                )),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async versions(projectId: string, requirementId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      q = paginationSchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        await this.context(tx, actor, projectId, requirementId, req);
        const where = { projectId, requirementId };
        const rows = await tx.requirementDocumentVersion.findMany({
          where,
          select: {
            id: true,
            number: true,
            createdAt: true,
            createdById: true,
            createdByName: true,
          },
          orderBy: { number: 'desc' },
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        });
        return documentVersionListSchema.parse({
          ...q,
          total: await tx.requirementDocumentVersion.count({ where }),
          items: rows.map((row) => ({
            id: row.id,
            number: row.number,
            createdAt: row.createdAt.toISOString(),
            createdBy: { id: row.createdById, name: row.createdByName },
          })),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async write(
    projectId: string,
    requirementId: string,
    kind: 'create' | 'save' | 'reset',
    input: unknown,
    req: Request,
  ) {
    const actor = await this.identity.requireWrite(req);
    const data =
      kind === 'create'
        ? createDocumentSchema.parse(input)
        : kind === 'save'
          ? saveDocumentSchema.parse(input)
          : resetDocumentSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: `requirement.document.${kind}`, projectId, requirementId, ...data },
      async (tx) => {
        const { requirement: row } = await this.context(
          tx,
          actor,
          projectId,
          requirementId,
          req,
          true,
        );
        const old = await tx.requirementDocumentDraft.findUnique({ where: { requirementId } });
        if (kind === 'create' && old)
          throw new ApiException(409, 'CONFLICT', '需求文档草稿已存在，请刷新后继续编辑');
        if (kind !== 'create' && (!old || !('version' in data) || old.version !== data.version))
          throw new ApiException(409, 'CONFLICT', '文档已被其他成员更新，当前编辑内容已保留');
        if (kind === 'save' && old!.baseRevision !== row.revision)
          throw new ApiException(409, 'CONFLICT', '需求基线已变化，请保留当前编辑并加载最新草稿');
        const current = row.documentVersionId
          ? await tx.requirementDocumentVersion.findUniqueOrThrow({
              where: { id: row.documentVersionId },
            })
          : null;
        let content: DocumentContent;
        if ('content' in data) content = documentContentSchema.parse(data.content);
        else if (current) content = documentContentSchema.parse(current.content);
        else if ('template' in data && data.template === 'requirement') {
          const section = (title: string, text: string) => [
            {
              type: 'heading',
              attrs: { level: 2 },
              content: [
                { type: 'text', text: translate(title, resolveLocale(req.get('Accept-Language'))) },
              ],
            },
            { type: 'paragraph', ...(text ? { content: [{ type: 'text', text }] } : {}) },
          ];
          content = documentContentSchema.parse({
            type: 'doc',
            content: [
              ...section('背景与目标', row.description),
              ...section('业务流程与规则', ''),
              ...section('验收标准', row.acceptanceCriteria),
              ...section('边界与异常情况', ''),
            ],
          });
        } else content = emptyDocument();
        await this.validateImages(tx, projectId, requirementId, content);
        const draft = old
          ? await tx.requirementDocumentDraft.update({
              where: { id: old.id },
              data: {
                content: content as Prisma.InputJsonObject,
                plainText: documentPlainText(content),
                baseRevision: row.revision,
                version: { increment: 1 },
                updatedById: actor.userId,
                updatedByName: actor.user.name,
              },
            })
          : await tx.requirementDocumentDraft.create({
              data: {
                projectId,
                requirementId,
                content: content as Prisma.InputJsonObject,
                plainText: documentPlainText(content),
                baseRevision: row.revision,
                updatedById: actor.userId,
                updatedByName: actor.user.name,
              },
            });
        await tx.requirementDocumentImage.updateMany({
          where: { projectId, requirementId },
          data: { draftReferenced: false },
        });
        await tx.requirementDocumentImage.updateMany({
          where: { projectId, requirementId, id: { in: documentImageIds(content) } },
          data: { draftReferenced: true },
        });
        await this.events.record(tx, {
          projectId,
          actorId: actor.userId,
          requestId: req.requestId,
          target: { targetType: 'REQUIREMENT', targetId: requirementId },
          action: `requirement.document.${kind}`,
          details: { draftVersion: draft.version, title: row.workItem.title },
        });
        return { id: draft.id, version: draft.version, updatedAt: draft.updatedAt.toISOString() };
      },
      async (tx) => {
        await this.context(tx, actor, projectId, requirementId, req, true);
      },
    );
  }
  async validateImages(tx: Tx, projectId: string, requirementId: string, content: DocumentContent) {
    const ids = documentImageIds(content);
    requireRule(
      (await tx.requirementDocumentImage.count({
        where: { projectId, requirementId, id: { in: ids } },
      })) === ids.length,
      '图片不存在或不属于当前需求文档，请重新上传',
    );
  }
  async apply(tx: Tx, row: Requirement, actor: Actor, draftVersion: number): Promise<string> {
    const draft = await tx.requirementDocumentDraft.findUnique({
      where: { requirementId: row.id },
    });
    if (!draft || draft.version !== draftVersion || draft.baseRevision !== row.revision)
      throw new ApiException(409, 'CONFLICT', '文档或需求已更新，请保留当前编辑并刷新');
    const content = documentContentSchema.parse(draft.content);
    const previous = row.documentVersionId
      ? await tx.requirementDocumentVersion.findUniqueOrThrow({
          where: { id: row.documentVersionId },
        })
      : null;
    requireRule(
      !previous || JSON.stringify(content) !== JSON.stringify(previous.content),
      '文档内容没有变化',
    );
    requireRule(
      documentPlainText(content).length || documentImageIds(content).length,
      '请先填写文档内容',
    );
    await this.validateImages(tx, row.projectId, row.id, content);
    const latest = await tx.requirementDocumentVersion.findFirst({
      where: { requirementId: row.id },
      orderBy: { number: 'desc' },
    });
    const version = await tx.requirementDocumentVersion.create({
      data: {
        projectId: row.projectId,
        requirementId: row.id,
        number: (latest?.number ?? 0) + 1,
        content: content as Prisma.InputJsonObject,
        plainText: draft.plainText,
        createdById: actor.userId,
        createdByName: actor.user.name,
      },
    });
    const ids = documentImageIds(content);
    if (ids.length)
      await tx.requirementDocumentVersionImage.createMany({
        data: ids.map((imageId) => ({
          projectId: row.projectId,
          requirementId: row.id,
          versionId: version.id,
          imageId,
        })),
      });
    await tx.requirementDocumentDraft.update({
      where: { id: draft.id },
      data: {
        baseRevision: row.revision + 1,
        version: { increment: 1 },
        updatedById: actor.userId,
        updatedByName: actor.user.name,
      },
    });
    return version.id;
  }
  async assertApplied(tx: Tx, row: Requirement) {
    const draft = await tx.requirementDocumentDraft.findUnique({
      where: { requirementId: row.id },
    });
    if (!draft) return;
    if (!row.documentVersionId) {
      const content = documentContentSchema.parse(draft.content);
      if (!documentPlainText(content) && !documentImageIds(content).length) return;
    }
    const current = row.documentVersionId
      ? await tx.requirementDocumentVersion.findUniqueOrThrow({
          where: { id: row.documentVersionId },
        })
      : null;
    requireRule(
      current && JSON.stringify(draft.content) === JSON.stringify(current.content),
      '文档有未应用的修改，请先应用文档后再提交评审',
    );
  }
  async upload(projectId: string, requirementId: string, req: Request) {
    const actor = await this.identity.requireWrite(req);
    const filename = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (v) =>
          !/[\\/]/.test(v) &&
          !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
        '文件名无效',
      )
      .parse(req.query.filename);
    z.uuid().parse(req.get('idempotency-key'));
    const check = async (tx: Tx) => {
      const { requirement } = await this.context(tx, actor, projectId, requirementId, req, true);
      if (!(await tx.requirementDocumentDraft.count({ where: { requirementId } })))
        throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请先创建文档草稿');
      return requirement;
    };
    await this.db.$transaction(check);
    if (!req.is('application/octet-stream'))
      throw new ApiException(400, 'VALIDATION_ERROR', '请使用二进制文件上传');
    let size = 0;
    const chunks: Buffer[] = [];
    for await (const chunk of req.iterator({ destroyOnReturn: false })) {
      size += chunk.length;
      if (size > 20 * 1024 * 1024) {
        req.resume();
        throw new ApiException(400, 'VALIDATION_ERROR', '附件不能超过 20 MiB');
      }
      chunks.push(Buffer.from(chunk));
    }
    const content = Buffer.concat(chunks),
      metadata = attachmentMetadata(filename, content);
    requireRule(
      ['image/png', 'image/jpeg', 'image/webp'].includes(metadata.contentType),
      '请选择 PNG、JPG 或 WebP 图片',
    );
    const stored = await this.storage.put(filename, content);
    let retained = false,
      rolledBack = false;
    try {
      const result = await this.commands.run(
        actor.userId,
        req.get('idempotency-key'),
        {
          action: 'requirement.document.image',
          projectId,
          requirementId,
          filename,
          hash: stored.sha256,
        },
        async (tx) => {
          try {
            const row = await check(tx);
            const image = await tx.requirementDocumentImage.create({
              data: { projectId, requirementId, uploaderId: actor.userId, ...stored },
            });
            await this.events.record(tx, {
              projectId,
              actorId: actor.userId,
              requestId: req.requestId,
              target: { targetType: 'REQUIREMENT', targetId: requirementId },
              action: 'requirement.document.image',
              details: { imageId: image.id, filename, title: row.workItem.title },
            });
            retained = true;
            return { id: image.id, filename: image.filename };
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        },
        async (tx) => {
          await check(tx);
        },
      );
      if (!retained) await this.discard(stored.storageKey);
      return result;
    } catch (error) {
      if (rolledBack || error instanceof ApiException) await this.discard(stored.storageKey);
      throw error;
    }
  }
  async images(projectId: string, requirementId: string, req: Request) {
    const actor = await this.identity.requireSession(req),
      query = paginationSchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const { canEdit } = await this.context(tx, actor, projectId, requirementId, req);
        if (!canEdit) throw new ApiException(403, 'FORBIDDEN', '当前需求文档仅可查看');
        const where = { projectId, requirementId };
        const rows = await tx.requirementDocumentImage.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
          select: { id: true, filename: true, size: true, createdAt: true },
        });
        return documentImageListSchema.parse({
          ...query,
          total: await tx.requirementDocumentImage.count({ where }),
          items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async discard(key: string) {
    try {
      await this.storage.remove(key);
    } catch {
      /* Orphan storage objects are collected after the retention window. */
    }
  }
  async preview(projectId: string, requirementId: string, imageId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const image = await this.db.$transaction(async (tx) => {
      const context = await this.context(tx, actor, projectId, requirementId, req);
      const row = await tx.requirementDocumentImage.findFirst({
        where: { projectId, requirementId, id: imageId },
        include: { versions: { take: 1 } },
      });
      if (!row || (!row.versions.length && !context.canEdit))
        throw new ApiException(404, 'NOT_FOUND', '文档图片不存在或无权查看');
      return row;
    });
    return { image, stream: await this.storage.stream(image.storageKey, image.storageBucket) };
  }
}
