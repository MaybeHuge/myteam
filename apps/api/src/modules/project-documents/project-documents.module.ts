import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import {
  documentContentSchema,
  createProjectDocumentSchema,
  saveProjectDocumentSchema,
  documentImageIds,
  documentPlainText,
  emptyDocument,
  hasPermission,
  paginationSchema,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { S3Storage } from '../../infrastructure/s3-storage.js';
import { attachmentMetadata } from '../../infrastructure/attachment-file.js';
import { ApiException } from '../../common/http.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { IdentityModule } from '../identity/identity.module.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { ProjectsService } from '../projects/projects.service.js';

const uuid = (id: string) => z.uuid().parse(id);
const canWrite = (
  project: { status: string; members: { roles: Parameters<typeof hasPermission>[0] }[] },
  admin: boolean,
) =>
  !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(project.status) &&
  (admin || hasPermission(project.members[0]?.roles ?? [], 'requirement:write'));
@Controller('projects/:projectId/documents')
class ProjectDocumentsController {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
    private readonly commands: Commands,
    private readonly events: CollaborationEvents,
    private readonly storage: S3Storage,
  ) {}
  @Get()
  async list(@Param('projectId') project: string, @Req() req: Request) {
    const projectId = uuid(project),
      actor = await this.identity.requireSession(req);
    const query = paginationSchema
      .extend({
        q: z.string().trim().max(200).default(''),
        kind: z.enum(['all', 'project', 'requirement']).default('all'),
      })
      .parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const p = await this.projects.authorize(tx, actor, projectId, req);
        const editable = canWrite(p, actor.user.isSystemAdmin);
        const pattern = `%${query.q.replace(/[\\%_]/g, '\\$&')}%`;
        const visible = editable;
        type Row = {
          id: string;
          title: string;
          kind: string;
          requirementId: string | null;
          requirementCode: string | null;
          status: string;
          updatedAt: Date;
          updatedBy: string;
          total: bigint;
        };
        const rows = await tx.$queryRaw<Row[]>`
        WITH docs AS (
          SELECT d.id, d.title, 'project'::text AS kind, NULL::uuid AS "requirementId", NULL::text AS "requirementCode", 'document'::text AS status, d."updatedAt", d."updatedByName" AS "updatedBy"
          FROM "RequirementDocumentDraft" d WHERE d."requirementId" IS NULL AND d."projectId" = ${projectId}::uuid AND (${query.kind} = 'all' OR ${query.kind} = 'project') AND d.title ILIKE ${pattern}
          UNION ALL
          SELECT r.id, w.title, 'requirement'::text, r.id, CONCAT(${p.key}::text, '-REQ-', lpad(r.number::text, 4, '0')),
            CASE WHEN r."documentVersionId" IS NULL THEN 'draft' ELSE 'applied' END,
            CASE WHEN ${visible} AND r.status NOT IN ('IN_REVIEW','CANCELLED') AND COALESCE(i.status::text,'') <> 'CLOSED' AND dr.id IS NOT NULL THEN dr."updatedAt" ELSE v."createdAt" END,
            CASE WHEN ${visible} AND r.status NOT IN ('IN_REVIEW','CANCELLED') AND COALESCE(i.status::text,'') <> 'CLOSED' AND dr.id IS NOT NULL THEN dr."updatedByName" ELSE v."createdByName" END
          FROM "Requirement" r JOIN "WorkItem" w ON w.id = r.id AND w."projectId" = r."projectId"
          LEFT JOIN "Iteration" i ON i.id = w."iterationId" AND i."projectId" = r."projectId"
          LEFT JOIN "RequirementDocumentDraft" dr ON dr."requirementId" = r.id
          LEFT JOIN "RequirementDocumentVersion" v ON v.id = r."documentVersionId"
          WHERE r."projectId" = ${projectId}::uuid AND (${query.kind} = 'all' OR ${query.kind} = 'requirement') AND w.title ILIKE ${pattern}
          AND (r."documentVersionId" IS NOT NULL OR (${visible} AND r.status NOT IN ('IN_REVIEW','CANCELLED') AND COALESCE(i.status::text,'') <> 'CLOSED' AND dr.id IS NOT NULL))
        ) SELECT d.*, totals.total FROM (SELECT count(*) AS total FROM docs) totals LEFT JOIN LATERAL (SELECT * FROM docs ORDER BY "updatedAt" DESC, id DESC OFFSET ${(query.page - 1) * query.pageSize} LIMIT ${query.pageSize}) d ON true`;
        return {
          items: rows
            .filter((row) => row.id !== null)
            .map((row) => ({
              id: row.id,
              title: row.title,
              kind: row.kind,
              requirementId: row.requirementId,
              requirementCode: row.requirementCode,
              status: row.status,
              updatedAt: row.updatedAt.toISOString(),
              updatedBy: row.updatedBy,
            })),
          total: Number(rows[0]?.total ?? 0),
          page: query.page,
          pageSize: query.pageSize,
          canCreate: editable,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  @Get('requirements')
  async requirements(@Param('projectId') project: string, @Req() req: Request) {
    const projectId = uuid(project),
      actor = await this.identity.requireSession(req);
    const query = paginationSchema
      .extend({ q: z.string().trim().max(200).default('') })
      .parse(req.query);
    return this.db.$transaction(async (tx) => {
      const p = await this.projects.authorize(tx, actor, projectId, req, 'requirement:write');
      if (!canWrite(p, actor.user.isSystemAdmin))
        throw new ApiException(403, 'FORBIDDEN', '项目当前仅可查看');
      const where = {
        projectId,
        ...(query.q
          ? { workItem: { title: { contains: query.q, mode: 'insensitive' as const } } }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.requirement.findMany({
          where,
          include: {
            workItem: { include: { iteration: true } },
            documentDraft: { select: { id: true } },
          },
          orderBy: [{ number: 'desc' }],
          skip: (query.page - 1) * query.pageSize,
          take: query.pageSize,
        }),
        tx.requirement.count({ where }),
      ]);
      return {
        items: rows.map((r) => ({
          id: r.id,
          title: r.workItem.title,
          code: `${p.key}-REQ-${String(r.number).padStart(4, '0')}`,
          hasDocument: !!(
            r.documentVersionId ||
            (r.documentDraft &&
              !['IN_REVIEW', 'CANCELLED'].includes(r.status) &&
              r.workItem.iteration?.status !== 'CLOSED')
          ),
          canCreate:
            !r.documentDraft &&
            !r.documentVersionId &&
            !['IN_REVIEW', 'CANCELLED'].includes(r.status) &&
            r.workItem.iteration?.status !== 'CLOSED',
        })),
        total,
        page: query.page,
        pageSize: query.pageSize,
      };
    });
  }
  @Post()
  async create(@Param('projectId') project: string, @Body() body: unknown, @Req() req: Request) {
    const projectId = uuid(project),
      actor = await this.identity.requireWrite(req),
      data = createProjectDocumentSchema.parse(body);
    const auth = async (tx: Prisma.TransactionClient) => {
      const p = await this.projects.authorize(tx, actor, projectId, req, 'requirement:write', true);
      if (!canWrite(p, actor.user.isSystemAdmin))
        throw new ApiException(403, 'FORBIDDEN', '项目当前仅可查看');
    };
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.document.create', projectId, ...data },
      async (tx) => {
        const doc = await tx.requirementDocumentDraft.create({
          data: {
            projectId,
            title: data.title,
            requirementId: null,
            baseRevision: 0,
            plainText: '',
            content: emptyDocument() as Prisma.InputJsonObject,
            createdById: actor.userId,
            createdByName: actor.user.name,
            updatedById: actor.userId,
            updatedByName: actor.user.name,
          },
        });
        await this.events.record(tx, {
          projectId,
          actorId: actor.userId,
          requestId: req.requestId,
          action: 'project.document.create',
          target: { targetType: 'PROJECT', targetId: projectId },
          details: { documentId: doc.id, title: doc.title },
        });
        return { id: doc.id };
      },
      auth,
    );
  }
  @Get(':id')
  async detail(
    @Param('projectId') project: string,
    @Param('id') document: string,
    @Req() req: Request,
  ) {
    const projectId = uuid(project),
      id = uuid(document),
      actor = await this.identity.requireSession(req);
    return this.db.$transaction(async (tx) => {
      const p = await this.projects.authorize(tx, actor, projectId, req);
      const row = await tx.requirementDocumentDraft.findFirst({
        where: { id, projectId, requirementId: null },
      });
      if (!row || !row.title || !row.createdById || !row.createdByName)
        throw new ApiException(404, 'NOT_FOUND', '项目文档不存在');
      return {
        ...row,
        content: documentContentSchema.parse(row.content),
        canEdit: canWrite(p, actor.user.isSystemAdmin),
      };
    });
  }
  @Post(':id/save')
  async save(
    @Param('projectId') project: string,
    @Param('id') document: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const projectId = uuid(project),
      id = uuid(document),
      actor = await this.identity.requireWrite(req),
      data = saveProjectDocumentSchema.parse(body),
      ids = documentImageIds(data.content);
    const auth = async (tx: Prisma.TransactionClient) => {
      const p = await this.projects.authorize(tx, actor, projectId, req, 'requirement:write', true);
      if (!canWrite(p, actor.user.isSystemAdmin))
        throw new ApiException(403, 'FORBIDDEN', '项目当前仅可查看');
    };
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'project.document.save', projectId, id, ...data },
      async (tx) => {
        if (
          (await tx.requirementDocumentImage.count({
            where: { projectId, documentDraftId: id, id: { in: ids } },
          })) !== ids.length
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '图片不存在或不属于当前文档，请重新上传',
          );
        const updated = await tx.requirementDocumentDraft.updateMany({
          where: { id, projectId, requirementId: null, version: data.version },
          data: {
            title: data.title,
            content: data.content as Prisma.InputJsonObject,
            plainText: documentPlainText(data.content),
            version: { increment: 1 },
            updatedById: actor.userId,
            updatedByName: actor.user.name,
          },
        });
        if (!updated.count) {
          if (
            !(await tx.requirementDocumentDraft.count({
              where: { id, projectId, requirementId: null },
            }))
          )
            throw new ApiException(404, 'NOT_FOUND', '项目文档不存在');
          throw new ApiException(409, 'CONFLICT', '文档已更新，请刷新后重试');
        }
        await tx.requirementDocumentImage.updateMany({
          where: { projectId, documentDraftId: id },
          data: { draftReferenced: false },
        });
        await tx.requirementDocumentImage.updateMany({
          where: { projectId, documentDraftId: id, id: { in: ids } },
          data: { draftReferenced: true },
        });
        await this.events.record(tx, {
          projectId,
          actorId: actor.userId,
          requestId: req.requestId,
          action: 'project.document.save',
          target: { targetType: 'PROJECT', targetId: projectId },
          details: { documentId: id, title: data.title },
        });
        return { id, version: data.version + 1 };
      },
      auth,
    );
  }
  @Get(':id/images')
  async images(
    @Param('projectId') project: string,
    @Param('id') document: string,
    @Req() req: Request,
  ) {
    const projectId = uuid(project),
      id = uuid(document),
      actor = await this.identity.requireSession(req),
      q = paginationSchema.parse(req.query);
    return this.db.$transaction(async (tx) => {
      const p = await this.projects.authorize(tx, actor, projectId, req);
      if (!canWrite(p, actor.user.isSystemAdmin))
        throw new ApiException(403, 'FORBIDDEN', '项目当前仅可查看');
      if (
        !(await tx.requirementDocumentDraft.count({
          where: { projectId, id, requirementId: null },
        }))
      )
        throw new ApiException(404, 'NOT_FOUND', '项目文档不存在');
      const where = { projectId, documentDraftId: id };
      const [items, total] = await Promise.all([
        tx.requirementDocumentImage.findMany({
          where,
          select: { id: true, filename: true, size: true, createdAt: true },
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          skip: (q.page - 1) * q.pageSize,
          take: q.pageSize,
        }),
        tx.requirementDocumentImage.count({ where }),
      ]);
      return { ...q, items, total };
    });
  }
  @Post(':id/images')
  async upload(
    @Param('projectId') project: string,
    @Param('id') document: string,
    @Req() req: Request,
  ) {
    const projectId = uuid(project),
      id = uuid(document),
      actor = await this.identity.requireWrite(req);
    const filename = z
      .string()
      .trim()
      .min(1)
      .max(200)
      .refine(
        (v) =>
          !/[\\/]/.test(v) &&
          !Array.from(v).some((c) => c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127),
      )
      .parse(req.query.filename);
    z.uuid().parse(req.get('idempotency-key'));
    const auth = async (tx: Prisma.TransactionClient) => {
      const p = await this.projects.authorize(tx, actor, projectId, req, 'requirement:write', true);
      if (!canWrite(p, actor.user.isSystemAdmin))
        throw new ApiException(403, 'FORBIDDEN', '项目当前仅可查看');
      if (
        !(await tx.requirementDocumentDraft.count({
          where: { projectId, id, requirementId: null },
        }))
      )
        throw new ApiException(404, 'NOT_FOUND', '项目文档不存在');
    };
    await this.db.$transaction(auth);
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
    if (!['image/png', 'image/jpeg', 'image/webp'].includes(metadata.contentType))
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '请选择 PNG、JPG 或 WebP 图片');
    const stored = await this.storage.put(filename, content);
    let retained = false,
      rolledBack = false;
    const discard = async () => {
      try {
        await this.storage.remove(stored.storageKey);
      } catch {
        /* Orphan cleanup handles failure. */
      }
    };
    try {
      const result = await this.commands.run(
        actor.userId,
        req.get('idempotency-key'),
        { action: 'project.document.image', projectId, id, filename, hash: stored.sha256 },
        async (tx) => {
          try {
            const image = await tx.requirementDocumentImage.create({
              data: { projectId, documentDraftId: id, uploaderId: actor.userId, ...stored },
            });
            retained = true;
            return { id: image.id, filename: image.filename };
          } catch (error) {
            rolledBack = true;
            throw error;
          }
        },
        auth,
      );
      if (!retained) await discard();
      return result;
    } catch (error) {
      if (rolledBack || error instanceof ApiException) await discard();
      throw error;
    }
  }
  @Get(':id/images/:imageId/preview')
  async preview(
    @Param('projectId') project: string,
    @Param('id') document: string,
    @Param('imageId') image: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const projectId = uuid(project),
      documentId = uuid(document),
      id = uuid(image),
      actor = await this.identity.requireSession(req);
    const row = await this.db.$transaction(async (tx) => {
      const p = await this.projects.authorize(tx, actor, projectId, req);
      const found = await tx.requirementDocumentImage.findFirst({
        where: { id, documentDraftId: documentId, projectId },
      });
      if (!found || (!found.draftReferenced && !canWrite(p, actor.user.isSystemAdmin)))
        throw new ApiException(404, 'NOT_FOUND', '文档图片不存在或无权查看');
      return found;
    });
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(await this.storage.stream(row.storageKey, row.storageBucket), {
      type: row.contentType,
      length: row.size,
      disposition: 'inline',
    });
  }
}
@Module({ imports: [IdentityModule, ProjectsModule], controllers: [ProjectDocumentsController] })
export class ProjectDocumentsModule {}
