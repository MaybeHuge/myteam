import { refreshRequirementProgress } from '../../common/requirement-progress.js';
import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import {
  createTestCaseSchema,
  updateTestCaseSchema,
  reviseTestCaseSchema,
  submitTestCaseSchema,
  decideTestCaseSchema,
  reasonTestCaseSchema,
  testCaseQuerySchema,
  testCaseSchema,
  testCaseDetailSchema,
  testCaseSnapshotSchema,
  testCaseExecutionSnapshotSchema,
  testCasePeopleQuerySchema,
  paginationSchema,
  requirementEvidenceTokenSchema,
  hasPermission,
  projectRoles,
  type Permission,
  type CreateTestCase,
  type TestCaseExecutionSnapshot,
} from '@myteam/contracts';
import type { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { Commands } from '../../common/commands.js';
import { CollaborationEvents } from '../../common/collaboration-events.js';
import { RequirementValidity } from '../../common/requirement-validity.js';
import { ApiException } from '../../common/http.js';
import { usableTestCaseWhere } from '../../common/test-preparation.js';
import { IdentityService } from '../identity/identity.service.js';
import { ProjectsService } from '../projects/projects.service.js';
type Tx = Prisma.TransactionClient;
type Actor = Awaited<ReturnType<IdentityService['requireSession']>>;
const person = { id: true, name: true } as const;
const include = {
  owner: { select: person },
  reviewer: { select: person },
  createdBy: { select: person },
  project: { select: { key: true } },
  links: {
    include: { requirement: { include: { workItem: true } } },
    orderBy: { requirementId: 'asc' as const },
  },
} as const;
type Row = Prisma.TestCaseGetPayload<{ include: typeof include }>;
@Injectable()
export class TestCasesService {
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    private readonly events: CollaborationEvents,
    private readonly validity: RequirementValidity,
    private readonly identity: IdentityService,
    private readonly projects: ProjectsService,
  ) {}
  private writable(status: string) {
    return !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(status);
  }
  private async find(tx: Tx, projectId: string, id: string) {
    const row = await tx.testCase.findFirst({ where: { id, projectId }, include });
    if (!row) throw new ApiException(404, 'NOT_FOUND', '用例不存在或不属于当前项目');
    return row;
  }
  private snapshot(row: Row) {
    return testCaseSnapshotSchema.parse({
      code: `${row.project.key}-CASE-${String(row.number).padStart(4, '0')}`,
      title: row.title,
      preconditions: row.preconditions,
      steps: row.steps,
      priority: row.priority,
      owner: row.owner,
      revision: row.revision,
      requirements: row.links.map(({ requirement: r }) => ({
        id: r.id,
        title: r.workItem.title,
        code: `${row.project.key}-REQ-${String(r.number).padStart(4, '0')}`,
      })),
    });
  }
  private async dto(
    tx: Tx,
    row: Row,
    actor: Actor,
    roles: Parameters<typeof hasPermission>[0],
    projectStatus: string,
  ) {
    const actions: string[] = [];
    if (this.writable(projectStatus) && row.status !== 'DEPRECATED') {
      if (actor.user.isSystemAdmin || hasPermission(roles, 'case:write')) {
        if (row.status === 'DRAFT') actions.push('edit', 'submit');
        if (row.status === 'READY') actions.push('revise');
        if (row.status === 'IN_REVIEW') actions.push('withdraw');
        actions.push('deprecate');
      }
      if (
        row.status === 'IN_REVIEW' &&
        (actor.user.isSystemAdmin ||
          (row.reviewerId === actor.userId && hasPermission(roles, 'case:review')))
      ) {
        if (!row.needsReview) actions.push('approve');
        actions.push('return');
      }
    }
    const latest = await tx.testRecord.findFirst({
      where: { projectId: row.projectId, testCaseId: row.id, caseRevision: row.revision },
      orderBy: [{ createdAt: 'desc' }, { number: 'desc' }],
    });
    let latestCurrent = false;
    if (latest) {
      const r = await tx.requirement.findUnique({ where: { id: latest.requirementId } });
      latestCurrent =
        !!r &&
        r.revision === latest.requirementRevision &&
        r.testCycle === latest.cycle &&
        !['DRAFT', 'IN_REVIEW', 'CANCELLED'].includes(r.status) &&
        !row.needsReview;
    }
    return testCaseSchema.parse({
      ...this.snapshot(row),
      id: row.id,
      projectId: row.projectId,
      number: row.number,
      ownerId: row.ownerId,
      reviewer: row.reviewer,
      createdBy: row.createdBy,
      status: row.status,
      version: row.version,
      approvedRevision: row.approvedRevision,
      reviewRound: row.reviewRound,
      needsReview: row.needsReview,
      usable: row.status === 'READY' && row.approvedRevision === row.revision && !row.needsReview,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      testResult:
        latestCurrent && latest
          ? latest.outcome === 'NOT_RUN' && latest.type === 'RETEST'
            ? 'RETEST'
            : latest.outcome
          : 'NOT_RUN',
      latestRecordId: latestCurrent ? (latest?.id ?? null) : null,
      allowedActions: actions,
    });
  }
  async list(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { q, status, priority, ownerId, requirementId, usable, page, pageSize } =
      testCaseQuerySchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        const codePrefix = `${project.key}-CASE-`;
        const number = q.toUpperCase().startsWith(codePrefix)
          ? Number(q.slice(codePrefix.length))
          : null;
        const usableWhere = usableTestCaseWhere(tx);
        const where: Prisma.TestCaseWhereInput = {
          projectId,
          ...(status ? { status } : {}),
          ...(priority ? { priority } : {}),
          ...(ownerId ? { ownerId } : {}),
          ...(requirementId ? { links: { some: { requirementId } } } : {}),
          ...(usable === 'true'
            ? { AND: [usableWhere] }
            : usable === 'false'
              ? { NOT: usableWhere }
              : {}),
          ...(q
            ? {
                OR: [
                  { title: { contains: q, mode: 'insensitive' } },
                  ...(number && Number.isSafeInteger(number) && number <= 2147483647
                    ? [{ number }]
                    : []),
                ],
              }
            : {}),
        };
        const [rows, total] = await Promise.all([
          tx.testCase.findMany({
            where,
            include,
            orderBy: [{ updatedAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.testCase.count({ where }),
        ]);
        return {
          items: await Promise.all(
            rows.map((row) =>
              this.dto(tx, row, actor, project.members[0]?.roles ?? [], project.status),
            ),
          ),
          total,
          page,
          pageSize,
          canCreate:
            this.writable(project.status) &&
            (actor.user.isSystemAdmin ||
              hasPermission(project.members[0]?.roles ?? [], 'case:write')),
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async detail(projectId: string, id: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { page, pageSize } = paginationSchema.parse(req.query);
    const revisionPage = paginationSchema.parse({
      page: req.query.revisionPage ?? 1,
      pageSize,
    }).page;
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req);
        const row = await this.find(tx, projectId, id);
        const where = { projectId, testCaseId: id };
        const [history, historyTotal, revisions, revisionTotal] = await Promise.all([
          tx.testCaseReview.findMany({
            where,
            include: { actor: { select: person }, reviewer: { select: person } },
            orderBy: [{ round: 'desc' }, { createdAt: 'desc' }, { id: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.testCaseReview.count({ where }),
          tx.testCaseRevision.findMany({
            where,
            orderBy: { revision: 'desc' },
            skip: (revisionPage - 1) * pageSize,
            take: pageSize,
          }),
          tx.testCaseRevision.count({ where }),
        ]);
        const deprecated =
          row.status === 'DEPRECATED'
            ? await tx.activityLog.findFirst({
                where: { projectId, targetId: id, action: 'testCase.deprecate' },
                orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
              })
            : null;
        const details = deprecated?.details as Prisma.JsonObject | undefined;
        const deprecation = deprecated
          ? {
              reason: typeof details?.comment === 'string' ? details.comment : '',
              actor: deprecated.actorId
                ? await tx.user.findUnique({ where: { id: deprecated.actorId }, select: person })
                : null,
              createdAt: deprecated.createdAt.toISOString(),
            }
          : null;
        return testCaseDetailSchema.parse({
          ...(await this.dto(tx, row, actor, project.members[0]?.roles ?? [], project.status)),
          deprecation,
          history: {
            items: history.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            total: historyTotal,
            page,
            pageSize,
          },
          revisions: {
            items: revisions.map((r) => ({ ...r, createdAt: r.createdAt.toISOString() })),
            total: revisionTotal,
            page: revisionPage,
            pageSize,
          },
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  async people(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { purpose, q, page, pageSize } = testCasePeopleQuerySchema.parse(req.query);
    const permission = purpose === 'reviewer' ? 'case:review' : 'case:write';
    const eligibleRoles = projectRoles.filter((role) => hasPermission([role], permission));
    return this.db.$transaction(async (tx) => {
      await this.projects.authorize(tx, actor, projectId, req, 'case:write');
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
        OR: [{ roles: { hasSome: eligibleRoles } }, { user: { isSystemAdmin: true } }],
      };
      const [rows, total] = await Promise.all([
        tx.projectMember.findMany({
          where,
          select: { user: { select: { ...person, email: true } } },
          orderBy: [{ joinedAt: 'asc' }, { userId: 'asc' }],
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
        tx.projectMember.count({ where }),
      ]);
      return { items: rows.map((r) => r.user), total, page, pageSize };
    });
  }
  async requirements(projectId: string, req: Request) {
    const actor = await this.identity.requireSession(req);
    const { q, page, pageSize } = testCaseQuerySchema.parse(req.query);
    return this.db.$transaction(
      async (tx) => {
        const project = await this.projects.authorize(tx, actor, projectId, req, 'case:write');
        const where: Prisma.RequirementWhereInput = {
          projectId,
          status: { in: ['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'] },
          acceptedRevision: { equals: tx.requirement.fields.revision },
          ...(q ? { workItem: { title: { contains: q, mode: 'insensitive' } } } : {}),
        };
        const [rows, total] = await Promise.all([
          tx.requirement.findMany({
            where,
            include: { workItem: true },
            orderBy: [{ number: 'asc' }],
            skip: (page - 1) * pageSize,
            take: pageSize,
          }),
          tx.requirement.count({ where }),
        ]);
        return {
          items: rows.map((r) => ({
            id: r.id,
            title: r.workItem.title,
            revision: r.revision,
            code: `${project.key}-REQ-${String(r.number).padStart(4, '0')}`,
          })),
          total,
          page,
          pageSize,
        };
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
  private async eligible(
    tx: Tx,
    projectId: string,
    id: string,
    permission: 'case:write' | 'case:review',
  ) {
    const users = await tx.$queryRaw<
      Array<{ active: boolean; isSystemAdmin: boolean }>
    >`SELECT active, "isSystemAdmin" FROM "User" WHERE id = ${id}::uuid FOR SHARE`;
    const member = await tx.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: id } },
    });
    if (
      !users[0]?.active ||
      !member ||
      (!users[0].isSystemAdmin && !hasPermission(member.roles, permission))
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        permission === 'case:review'
          ? '评审人须为本项目具有用例评审权限的可用成员'
          : '用例负责人须为本项目具有用例编写权限的可用成员',
      );
  }
  private async authorize(
    tx: Tx,
    actor: Actor,
    projectId: string,
    req: Request,
    permission: Permission,
    id?: string,
    decision = false,
  ) {
    const project = await this.projects.authorize(tx, actor, projectId, req, permission, true);
    if (!this.writable(project.status))
      throw new ApiException(403, 'FORBIDDEN', '当前项目仅可查看用例');
    if (id) {
      const row = await this.find(tx, projectId, id);
      if (decision && !actor.user.isSystemAdmin && row.reviewerId !== actor.userId)
        throw new ApiException(403, 'FORBIDDEN', '仅指定用例评审人可以给出结论');
    }
  }
  private checkVersion(row: Row, version: number) {
    if (row.version !== version)
      throw new ApiException(409, 'CONFLICT', '用例已被更新，请刷新后重试');
  }
  private revisionBasis(input: unknown) {
    const parsed = requirementEvidenceTokenSchema
      .strict()
      .array()
      .min(1)
      .max(50)
      .refine(
        (tokens) => new Set(tokens.map((token) => token.requirementId)).size === tokens.length,
      )
      .safeParse(input);
    if (!parsed.success)
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '用例修订的需求依据不完整，请核对后重新修订评审',
      );
    return parsed.data;
  }
  private async saveRevision(
    tx: Tx,
    row: Row,
    basis: Awaited<ReturnType<RequirementValidity['capture']>>,
    reason: string,
    actor: Actor,
  ) {
    await tx.testCaseRevision.create({
      data: {
        projectId: row.projectId,
        testCaseId: row.id,
        revision: row.revision,
        snapshot: { ...this.snapshot(row), editedBy: { id: actor.userId, name: actor.user.name } },
        requirementBasis: basis,
        reason,
      },
    });
  }
  private event(
    tx: Tx,
    actor: Actor,
    req: Request,
    row: Row,
    action: string,
    details: Prisma.InputJsonObject,
    recipientId?: string,
  ) {
    return this.events.record(tx, {
      actorId: actor.userId,
      projectId: row.projectId,
      requestId: req.requestId,
      target: { targetType: 'TEST_CASE', targetId: row.id },
      action: `testCase.${action}`,
      details: { title: row.title, ...details },
      ...(recipientId
        ? {
            recipientId,
            title:
              `用例「${row.title}」${action === 'submitted' ? '待你评审' : '状态已更新'}`.slice(
                0,
                200,
              ),
          }
        : {}),
    });
  }
  async create(projectId: string, input: unknown, req: Request) {
    const actor = await this.identity.requireWrite(req),
      data = createTestCaseSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: 'testCase.create', projectId, ...data },
      async (tx) => {
        if (data.ownerId) await this.eligible(tx, projectId, data.ownerId, 'case:write');
        const basis = await this.validity.capture(tx, projectId, data.requirementIds);
        const project = await tx.project.update({
          where: { id: projectId },
          data: { testCaseSequence: { increment: 1 } },
        });
        const { requirementIds, ...fields } = data;
        const row = await tx.testCase.create({
          data: {
            ...fields,
            projectId,
            number: project.testCaseSequence,
            createdById: actor.userId,
            links: {
              create: requirementIds.map((requirementId) => ({ requirementId })),
            },
          },
          include,
        });
        await this.saveRevision(tx, row, basis, '创建草稿', actor);
        await this.event(
          tx,
          actor,
          req,
          row,
          'created',
          { revision: row.revision },
          row.ownerId ?? undefined,
        );
        for (const link of row.links)
          await refreshRequirementProgress(tx, projectId, link.requirementId);
        return { id: row.id, version: row.version };
      },
      async (tx) => {
        await this.authorize(tx, actor, projectId, req, 'case:write');
      },
    );
  }
  async update(projectId: string, id: string, input: unknown, req: Request, revise = false) {
    const actor = await this.identity.requireWrite(req);
    const data = revise ? reviseTestCaseSchema.parse(input) : updateTestCaseSchema.parse(input);
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: revise ? 'testCase.revise' : 'testCase.update', projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.checkVersion(row, data.version);
        if (row.status !== (revise ? 'READY' : 'DRAFT'))
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            revise ? '仅可使用用例可以发起修订' : '仅草稿可编辑；已通过内容须发起新修订',
          );
        if (data.ownerId) await this.eligible(tx, projectId, data.ownerId, 'case:write');
        const basis = await this.validity.capture(tx, projectId, data.requirementIds);
        const fields: CreateTestCase = data;
        await tx.requirementCaseLink.deleteMany({ where: { projectId, testCaseId: id } });
        const next = await tx.testCase.update({
          where: { id },
          data: {
            title: fields.title,
            preconditions: fields.preconditions,
            steps: fields.steps,
            priority: fields.priority,
            ownerId: fields.ownerId,
            status: 'DRAFT',
            reviewerId: null,
            revision: { increment: 1 },
            version: { increment: 1 },
            needsReview: false,
            links: {
              create: fields.requirementIds.map((requirementId) => ({ requirementId })),
            },
          },
          include,
        });
        const reason = 'reason' in data ? String(data.reason) : '保存草稿';
        await this.saveRevision(tx, next, basis, reason, actor);
        await this.event(
          tx,
          actor,
          req,
          next,
          revise ? 'revised' : 'updated',
          {
            fromRevision: row.revision,
            toRevision: next.revision,
            reason,
            fromOwnerId: row.ownerId,
            toOwnerId: next.ownerId,
          },
          next.ownerId ?? undefined,
        );
        for (const requirementId of new Set([
          ...row.links.map((l) => l.requirementId),
          ...next.links.map((l) => l.requirementId),
        ]))
          await refreshRequirementProgress(tx, projectId, requirementId);
        return { id, version: next.version };
      },
      async (tx) => {
        await this.authorize(tx, actor, projectId, req, 'case:write', id);
      },
    );
  }
  async transition(
    projectId: string,
    id: string,
    action: 'submit' | 'approve' | 'return' | 'withdraw' | 'deprecate',
    input: unknown,
    req: Request,
  ) {
    const actor = await this.identity.requireWrite(req);
    const data =
      action === 'submit'
        ? submitTestCaseSchema.parse(input)
        : action === 'approve'
          ? decideTestCaseSchema.parse(input)
          : reasonTestCaseSchema.parse(input);
    const decision = action === 'approve' || action === 'return';
    return this.commands.run(
      actor.userId,
      req.get('idempotency-key'),
      { action: `testCase.${action}`, projectId, id, ...data },
      async (tx) => {
        const row = await this.find(tx, projectId, id);
        this.checkVersion(row, data.version);
        if (
          row.status === 'DEPRECATED' ||
          (action === 'submit' && row.status !== 'DRAFT') ||
          ((decision || action === 'withdraw') && row.status !== 'IN_REVIEW')
        )
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '当前用例状态不支持此操作');
        if (
          decision &&
          actor.user.isSystemAdmin &&
          row.reviewerId !== actor.userId &&
          !data.comment
        )
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '管理员代评须填写说明');
        let reviewerId = row.reviewerId;
        const patch: Prisma.TestCaseUpdateInput = { version: { increment: 1 } };
        let reviewAction: 'SUBMITTED' | 'APPROVED' | 'RETURNED' | 'WITHDRAWN' | undefined;
        if (action === 'submit' || action === 'approve') {
          const snapshot = this.snapshot(row);
          if (
            !row.ownerId ||
            !snapshot.steps.length ||
            snapshot.steps.some((step) => !step.action || !step.expected)
          )
            throw new ApiException(
              422,
              'BUSINESS_RULE_VIOLATION',
              '送审和通过前须补齐负责人、至少一个步骤及每步预期',
            );
          await this.eligible(tx, projectId, row.ownerId, 'case:write');
          const revision = await tx.testCaseRevision.findUniqueOrThrow({
            where: { testCaseId_revision: { testCaseId: id, revision: row.revision } },
          });
          const basis = this.revisionBasis(revision.requirementBasis);
          await this.validity.assertCurrent(tx, projectId, basis);
          if (row.needsReview)
            throw new ApiException(
              422,
              'BUSINESS_RULE_VIOLATION',
              '关联需求已变化，请更新用例并重新评审',
            );
        }
        if (action === 'submit') {
          reviewerId = 'reviewerId' in data ? String(data.reviewerId) : null;
          await this.eligible(tx, projectId, reviewerId!, 'case:review');
          patch.status = 'IN_REVIEW';
          patch.reviewer = { connect: { id: reviewerId! } };
          patch.reviewRound = { increment: 1 };
          reviewAction = 'SUBMITTED';
        } else if (action === 'approve') {
          await this.eligible(tx, projectId, reviewerId!, 'case:review');
          patch.status = 'READY';
          patch.approvedRevision = row.revision;
          reviewAction = 'APPROVED';
        } else if (action === 'return' || action === 'withdraw') {
          patch.status = 'DRAFT';
          reviewAction = action === 'return' ? 'RETURNED' : 'WITHDRAWN';
        } else patch.status = 'DEPRECATED';
        const next = await tx.testCase.update({ where: { id }, data: patch, include });
        if (reviewAction)
          await tx.testCaseReview.create({
            data: {
              projectId,
              testCaseId: id,
              revision: row.revision,
              round: next.reviewRound,
              action: reviewAction,
              actorId: actor.userId,
              reviewerId: reviewerId!,
              comment: data.comment,
            },
          });
        await this.event(
          tx,
          actor,
          req,
          next,
          action === 'submit' ? 'submitted' : action,
          {
            from: row.status,
            to: next.status,
            revision: next.revision,
            comment: data.comment,
            ...(decision && actor.user.isSystemAdmin && row.reviewerId !== actor.userId
              ? { adminOverride: true }
              : {}),
          },
          action === 'submit' ? reviewerId! : (row.ownerId ?? undefined),
        );
        for (const requirementId of new Set([
          ...row.links.map((l) => l.requirementId),
          ...next.links.map((l) => l.requirementId),
        ]))
          await refreshRequirementProgress(tx, projectId, requirementId);
        return { id, version: next.version };
      },
      async (tx) => {
        await this.authorize(
          tx,
          actor,
          projectId,
          req,
          decision ? 'case:review' : 'case:write',
          id,
          decision,
        );
      },
    );
  }
  // M4 在自身已授权事务内调用，项目锁与基线校验覆盖选择和后续写入，拒绝旧修订。
  async selectUsableRevision(tx: Tx, projectId: string, id: string, revision: number) {
    await tx.$queryRaw`SELECT id FROM "Project" WHERE id = ${projectId}::uuid FOR UPDATE`;
    const row = await this.find(tx, projectId, id);
    if (
      row.status !== 'READY' ||
      row.needsReview ||
      row.revision !== revision ||
      row.approvedRevision !== revision
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '只能选择当前已通过且需求基线有效的用例修订',
      );
    const content = await tx.testCaseRevision.findUnique({
      where: { testCaseId_revision: { testCaseId: id, revision } },
    });
    if (!content)
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '用例当前修订历史缺失，不能形成执行依据',
      );
    await this.validity.assertCurrent(tx, projectId, this.revisionBasis(content.requirementBasis));
    return content;
  }

  // M4 须先完成当前操作者的 test:execute/项目/批次范围授权，并在同一事务内
  // 将返回值完整复制进执行项 JSON。这里只生成快照，不提交事务、不创建虚构批次。
  async freezeExecutionSnapshot(
    tx: Tx,
    projectId: string,
    id: string,
    revision: number,
    capturedBy: { id: string; name: string },
  ): Promise<TestCaseExecutionSnapshot> {
    const content = await this.selectUsableRevision(tx, projectId, id, revision);
    const row = await this.find(tx, projectId, id);
    const stored = testCaseSnapshotSchema.safeParse(content.snapshot);
    const basis = this.revisionBasis(content.requirementBasis);
    const approval = await tx.testCaseReview.findFirst({
      where: { projectId, testCaseId: id, revision, round: row.reviewRound, action: 'APPROVED' },
      include: { actor: { select: person }, reviewer: { select: person } },
    });
    const ids = stored.success ? stored.data.requirements.map((r) => r.id) : [];
    if (
      !stored.success ||
      stored.data.revision !== revision ||
      !approval ||
      ids.length !== basis.length ||
      new Set(ids).size !== ids.length ||
      basis.some((token) => !ids.includes(token.requirementId)) ||
      row.links.length !== ids.length ||
      row.links.some((link) => !ids.includes(link.requirementId))
    )
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '用例修订内容、评审或关联需求不一致，不能冻结执行快照',
      );
    const snapshot = stored.data;
    const [clock] = await tx.$queryRaw<
      Array<{ capturedAt: Date }>
    >`SELECT clock_timestamp() AS "capturedAt"`;
    const frozen = testCaseExecutionSnapshotSchema.safeParse({
      schemaVersion: 1,
      projectId,
      source: { testCaseId: id, revisionId: content.id, revision },
      content: {
        code: snapshot.code,
        title: snapshot.title,
        preconditions: snapshot.preconditions,
        // 草稿读取 schema 会 trim 文本；冻结必须复制历史修订的步骤原文。
        steps: (content.snapshot as Prisma.JsonObject).steps,
        priority: snapshot.priority,
        owner: snapshot.owner,
      },
      requirements: basis.map((token) => {
        const requirement = snapshot.requirements.find((r) => r.id === token.requirementId)!;
        return { ...token, code: requirement.code, title: requirement.title };
      }),
      approval: {
        reviewId: approval.id,
        round: approval.round,
        reviewer: approval.reviewer,
        decidedBy: approval.actor,
        approvedAt: approval.createdAt.toISOString(),
      },
      capturedAt: clock!.capturedAt.toISOString(),
      capturedBy,
    });
    if (!frozen.success)
      throw new ApiException(
        422,
        'BUSINESS_RULE_VIOLATION',
        '用例执行快照缺少完整内容或有效元数据，请重新修订评审',
      );
    return frozen.data;
  }
}
