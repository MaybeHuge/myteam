import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { workbenchQuerySchema, workbenchListSchema } from '@myteam/contracts';
import { Prisma } from '../../generated/prisma/client.js';
import { Database } from '../../infrastructure/database.js';
import { IdentityService } from '../identity/identity.service.js';
export function workbenchDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  return ['year', 'month', 'day']
    .map((type) => parts.find((part) => part.type === type)!.value)
    .join('-');
}
@Injectable()
export class WorkbenchService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
  ) {}
  async list(req: Request) {
    const actor = await this.identity.requireSession(req),
      { q, status, projectId, kind, page, pageSize } = workbenchQuerySchema.parse(req.query),
      today = workbenchDate();
    const pattern = `%${q.replace(/[\\%_]/g, '\\$&')}%`;
    const scoped = Prisma.sql`
      WITH candidates AS (
        SELECT 'ITERATION_FOLLOW_UP'::text AS kind, i.id, i.name AS title, i.status::text AS status, i."projectId", i."startDate", i."endDate" AS "dueDate", false AS blocked, ''::text AS code
        FROM "Iteration" i WHERE i."ownerId" = ${actor.userId}::uuid AND i.status IN ('PLANNING','ACTIVE')
        UNION ALL
        SELECT a.kind, t.id, w.title, t.status::text, t."projectId", NULL::date, t."dueDate", t.blocked, concat('TASK-', lpad(t.number::text,4,'0'))
        FROM "Task" t JOIN "WorkItem" w ON w.id=t.id AND w."projectId"=t."projectId"
        JOIN "Requirement" r ON r.id=t."requirementId" AND r."projectId"=t."projectId"
        JOIN "WorkItem" rw ON rw.id=r.id
        LEFT JOIN "Iteration" i ON i.id=w."iterationId" LEFT JOIN "Iteration" ri ON ri.id=rw."iterationId"
        CROSS JOIN LATERAL (VALUES ('TASK'::text, t."assigneeId", false), ('TASK_ASSIST'::text, t."helperId", true)) AS a(kind,person,assist)
        WHERE a.person=${actor.userId}::uuid AND (NOT a.assist OR (t.blocked AND t."assigneeId" IS DISTINCT FROM ${actor.userId}::uuid))
          AND t.status IN ('TODO','IN_PROGRESS') AND r.status IN ('DRAFT','IN_REVIEW','CONFIRMED','IMPLEMENTING') AND (i.status IS NULL OR i.status<>'CLOSED') AND (ri.status IS NULL OR ri.status<>'CLOSED')
        UNION ALL
        SELECT 'REQUIREMENT_REVIEW'::text, r.id, w.title, r.status::text, r."projectId", NULL::date, NULL::date, false, concat('REQ-', lpad(r.number::text,4,'0'))
        FROM "Requirement" r JOIN "WorkItem" w ON w.id=r.id LEFT JOIN "Iteration" i ON i.id=w."iterationId"
        WHERE r."reviewerId"=${actor.userId}::uuid AND r.status='IN_REVIEW' AND (i.status IS NULL OR i.status<>'CLOSED')
          AND (${actor.user.isSystemAdmin} OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=r."projectId" AND m."userId"=${actor.userId}::uuid AND m.roles && ARRAY['OWNER','PRODUCT']::"ProjectRole"[]))
        UNION ALL
        SELECT 'TEST_CASE_REVIEW'::text, c.id, c.title, 'IN_REVIEW'::text, c."projectId", NULL::date, NULL::date, false, concat('CASE-', lpad(c.number::text,4,'0'))
        FROM "TestCase" c
        WHERE c."reviewerId"=${actor.userId}::uuid AND c.status='IN_REVIEW'
          AND (${actor.user.isSystemAdmin} OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=c."projectId" AND m."userId"=${actor.userId}::uuid AND m.roles && ARRAY['OWNER','TESTER']::"ProjectRole"[]))
        UNION ALL
        SELECT 'TEST_CASE_RECHECK'::text, c.id, c.title, 'NEEDS_REVIEW'::text, c."projectId", NULL::date, NULL::date, false, concat('CASE-', lpad(c.number::text,4,'0'))
        FROM "TestCase" c JOIN "Project" cp ON cp.id=c."projectId"
        WHERE coalesce(c."ownerId", cp."ownerId")=${actor.userId}::uuid AND c.status<>'DEPRECATED' AND c."needsReview"
          AND (${actor.user.isSystemAdmin} OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=c."projectId" AND m."userId"=${actor.userId}::uuid AND m.roles && ARRAY['OWNER','TESTER']::"ProjectRole"[]))
        UNION ALL
        SELECT 'TEST_RECORD'::text,r.id,c.title,r.outcome::text,r."projectId",NULL::date,NULL::date,false,concat('TR-',lpad(r.number::text,4,'0'))
        FROM "TestRecord" r JOIN "TestCase" c ON c.id=r."testCaseId" JOIN "Requirement" q ON q.id=r."requirementId"
        WHERE r.outcome='NOT_RUN' AND r."executorId"=${actor.userId}::uuid AND r.cycle=q."testCycle" AND r."requirementRevision"=q.revision AND r."caseRevision"=c.revision AND c.status='READY' AND NOT c."needsReview" AND q.status NOT IN ('DRAFT','IN_REVIEW','CANCELLED')
          AND (${actor.user.isSystemAdmin} OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=r."projectId" AND m."userId"=${actor.userId}::uuid AND m.roles && ARRAY['OWNER','TESTER']::"ProjectRole"[]))
        UNION ALL
        SELECT a.kind,d.id,d.title,d.status::text,d."projectId",NULL::date,d."deferUntil",false,concat('BUG-',lpad(d.number::text,4,'0'))
        FROM "Defect" d CROSS JOIN LATERAL (VALUES
          ('DEFECT_TRIAGE'::text,d."retesterId",d.status='UNCONFIRMED',ARRAY['OWNER','TESTER']::"ProjectRole"[]),
          ('DEFECT_FIX'::text,d."assigneeId",d.status IN ('OPEN','FIXING'),ARRAY['OWNER','DEVELOPER']::"ProjectRole"[]),
          ('DEFECT_RETEST'::text,d."retesterId",d.status='AWAITING_RETEST',ARRAY['OWNER','TESTER']::"ProjectRole"[]),
          ('DEFECT_FOLLOW_UP'::text,d."assigneeId",d.status='DEFERRED',ARRAY['OWNER','DEVELOPER']::"ProjectRole"[])
        ) a(kind,person,pending,roles)
        WHERE a.pending AND a.person=${actor.userId}::uuid
          AND (${actor.user.isSystemAdmin} OR EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=d."projectId" AND m."userId"=${actor.userId}::uuid AND m.roles && a.roles))
      ), scoped AS (
        SELECT c.*, jsonb_build_object('id',p.id,'key',p.key,'name',p.name,'color',p.color,'icon',p.icon,'status',p.status) AS project
        FROM candidates c JOIN "Project" p ON p.id=c."projectId"
        WHERE p.status IN ('PENDING','ACTIVE','PAUSED') AND EXISTS(SELECT 1 FROM "ProjectMember" m WHERE m."projectId"=p.id AND m."userId"=${actor.userId}::uuid)
        ${projectId ? Prisma.sql`AND p.id=${projectId}::uuid` : Prisma.empty}
        ${kind ? Prisma.sql`AND c.kind=${kind}` : Prisma.empty}
        ${q ? Prisma.sql`AND (c.title ILIKE ${pattern} OR p.name ILIKE ${pattern} OR p.key ILIKE ${pattern} OR concat(p.key,'-',c.code) ILIKE ${pattern})` : Prisma.empty}
      )`;
    const filter =
      status === 'all'
        ? Prisma.sql`true`
        : status === 'overdue'
          ? Prisma.sql`"dueDate" < ${today}::date`
          : status === 'blocked'
            ? Prisma.sql`blocked`
            : status === 'pending'
              ? Prisma.sql`status IN ('PLANNING','TODO','PENDING','NOT_RUN','SUBMITTED','UNCONFIRMED','OPEN','AWAITING_RETEST','DEFERRED')`
              : status === 'active'
                ? Prisma.sql`status IN ('ACTIVE','IN_PROGRESS','RUNNING','FIXING')`
                : Prisma.sql`status=${status}`;
    return this.db.$transaction(
      async (tx) => {
        const rows = await tx.$queryRaw<
          Array<{
            kind: string;
            id: string;
            title: string;
            status: string;
            startDate: string | null;
            dueDate: string | null;
            blocked: boolean;
            overdue: boolean;
            project: unknown;
          }>
        >(
          Prisma.sql`${scoped} SELECT kind,id,title,status,to_char("startDate",'YYYY-MM-DD') AS "startDate",to_char("dueDate",'YYYY-MM-DD') AS "dueDate",blocked,coalesce("dueDate"<${today}::date,false) AS overdue,project FROM scoped WHERE ${filter} ORDER BY "dueDate" ASC NULLS LAST,id ASC,kind ASC LIMIT ${pageSize} OFFSET ${(page - 1) * pageSize}`,
        );
        const totals = await tx.$queryRaw<Array<{ total: bigint }>>(
          Prisma.sql`${scoped} SELECT count(*) AS total FROM scoped WHERE ${filter}`,
        );
        const stats = await tx.$queryRaw<Array<Record<string, bigint>>>(
          Prisma.sql`${scoped} SELECT count(*) AS total, count(*) FILTER(WHERE status IN ('PLANNING','TODO','PENDING','NOT_RUN','SUBMITTED','UNCONFIRMED','OPEN','AWAITING_RETEST','DEFERRED')) AS planning, count(*) FILTER(WHERE status IN ('ACTIVE','IN_PROGRESS','RUNNING','FIXING')) AS active, count(*) FILTER(WHERE "dueDate"<${today}::date) AS overdue, count(*) FILTER(WHERE kind='TASK') AS tasks,count(*) FILTER(WHERE kind IN ('REQUIREMENT_REVIEW','TEST_CASE_REVIEW','SUBMISSION_REVIEW')) AS reviews,count(*) FILTER(WHERE kind='TEST_CASE_REVIEW') AS "caseReviews",count(*) FILTER(WHERE kind='TEST_CASE_RECHECK') AS "caseRechecks",count(*) FILTER(WHERE kind='TASK_ASSIST') AS assistance,count(*) FILTER(WHERE blocked) AS blocked FROM scoped`,
        );
        return workbenchListSchema.parse({
          items: rows.map((row) => ({ ...row, endDate: row.dueDate })),
          total: Number(totals[0]!.total),
          page,
          pageSize,
          today,
          timeZone: 'Asia/Shanghai',
          summary: Object.fromEntries(
            Object.entries(stats[0]!).map(([key, value]) => [key, Number(value)]),
          ),
        });
      },
      { isolationLevel: 'RepeatableRead' },
    );
  }
}
