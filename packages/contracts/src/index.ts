import { z } from 'zod';

export const projectRoles = [
  'OWNER',
  'PRODUCT',
  'DEVELOPER',
  'TESTER',
  'RELEASE_MANAGER',
  'VIEWER',
] as const;
export type ProjectRole = (typeof projectRoles)[number];
export const projectRoleSchema = z.enum(projectRoles);

export const permissions = [
  'project:read',
  'project:manage',
  'member:manage',
  'iteration:manage',
  'collaboration:write',
  'requirement:write',
  'requirement:review',
  'task:write',
  'task:assign',
  'case:write',
  'case:review',
  'submission:write',
  'submission:accept',
  'test:execute',
  'defect:report',
  'defect:fix',
  'defect:retest',
  'acceptance:decide',
  'release:manage',
  'risk:approve',
] as const;
export type Permission = (typeof permissions)[number];
export const rolePermissions: Record<ProjectRole, readonly Permission[]> = {
  OWNER: permissions,
  PRODUCT: [
    'collaboration:write',
    'project:read',
    'requirement:write',
    'requirement:review',
    'defect:report',
    'acceptance:decide',
  ],
  DEVELOPER: [
    'collaboration:write',
    'project:read',
    'task:write',
    'submission:write',
    'defect:report',
    'defect:fix',
  ],
  TESTER: [
    'collaboration:write',
    'project:read',
    'case:write',
    'case:review',
    'submission:accept',
    'test:execute',
    'defect:report',
    'defect:retest',
  ],
  RELEASE_MANAGER: ['collaboration:write', 'project:read', 'release:manage', 'defect:report'],
  VIEWER: ['project:read'],
};
export function hasPermission(roles: readonly ProjectRole[], permission: Permission): boolean {
  return roles.some((role) => rolePermissions[role].includes(permission));
}

export const statuses = {
  project: ['PENDING', 'ACTIVE', 'PAUSED', 'ACCEPTING', 'COMPLETED', 'ARCHIVED'],
  iteration: ['PLANNING', 'ACTIVE', 'CLOSED'],
  requirement: [
    'DRAFT',
    'IN_REVIEW',
    'CONFIRMED',
    'IMPLEMENTING',
    'ACCEPTING',
    'TESTING',
    'COMPLETED',
    'CANCELLED',
  ],
  task: ['TODO', 'IN_PROGRESS', 'COMPLETED'],
  testCase: ['DRAFT', 'IN_REVIEW', 'READY', 'DEPRECATED'],
  submission: ['DRAFT', 'SUBMITTED', 'ACCEPTED', 'TESTING', 'COMPLETED', 'RETURNED', 'CANCELLED'],
  testRun: ['PENDING', 'RUNNING', 'COMPLETED', 'CANCELLED'],
  testResult: ['NOT_RUN', 'PASSED', 'FAILED', 'BLOCKED', 'NOT_APPLICABLE'],
  defect: [
    'UNCONFIRMED',
    'OPEN',
    'FIXING',
    'AWAITING_RETEST',
    'CLOSED',
    'DUPLICATE',
    'NOT_A_DEFECT',
    'CANNOT_REPRODUCE',
    'DEFERRED',
  ],
  release: ['PLANNING', 'DEVELOPING', 'TESTING', 'READY', 'RELEASED', 'ARCHIVED'],
} as const;

export const errorCodes = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'BUSINESS_RULE_VIOLATION',
  'RATE_LIMITED',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;
export const errorResponseSchema = z.object({
  code: z.enum(errorCodes),
  message: z.string(),
  details: z.unknown().optional(),
  requestId: z.string(),
});
export type ApiErrorResponse = z.infer<typeof errorResponseSchema>;

export const maxPage = 100000;
export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(maxPage).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});
export const versionSchema = z.object({ version: z.number().int().positive() });
export const loginSchema = z.object({
  email: z.string().trim().toLowerCase().max(254).pipe(z.email()),
  password: z.string().min(1).max(128),
});
export const passwordSchema = z.string().min(6, '密码至少 6 位').max(128);
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, '请输入原密码').max(128),
  newPassword: passwordSchema,
});
export const userSchema = z.object({
  id: z.uuid(),
  email: z.email(),
  name: z.string(),
  isSystemAdmin: z.boolean(),
});
export type CurrentUser = z.infer<typeof userSchema>;
export const csrfResponseSchema = z.object({ csrfToken: z.string().min(32) });
export const sessionResponseSchema = z.object({
  user: userSchema,
  csrfToken: z.string(),
  expiresAt: z.iso.datetime(),
});
export type SessionResponse = z.infer<typeof sessionResponseSchema>;
export const userStatusSchema = z.object({ active: z.boolean() }).extend(versionSchema.shape);
export const managedUserSchema = userSchema.extend({
  active: z.boolean(),
  version: z.number().int().positive(),
});
export const managedUsersSchema = z.object({
  items: z.array(managedUserSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  stats: z.object({
    total: z.number().int(),
    active: z.number().int(),
    inactive: z.number().int(),
    admins: z.number().int(),
  }),
});
export const userQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
});
export type ManagedUser = z.infer<typeof managedUserSchema>;
export const healthSchema = z.object({
  status: z.enum(['ok', 'degraded']),
  service: z.literal('myteam-api'),
  database: z.enum(['up', 'down']),
  storage: z.enum(['up', 'down']),
});

export const createUserSchema = loginSchema.extend({
  name: z.string().trim().min(1).max(80),
  password: passwordSchema,
});
export const projectColors = ['teal', 'blue', 'violet', 'amber', 'rose'] as const;
export const projectIcons = ['layers', 'rocket', 'code', 'compass', 'shield', 'cube'] as const;
export const projectStatusSchema = z.enum(statuses.project);
export const projectRoleLabels: Record<ProjectRole, string> = {
  OWNER: '负责人',
  PRODUCT: '产品',
  DEVELOPER: '开发',
  TESTER: '测试',
  RELEASE_MANAGER: '发布',
  VIEWER: '只读',
};
export const projectStatusLabels: Record<z.infer<typeof projectStatusSchema>, string> = {
  PENDING: '待启动',
  ACTIVE: '进行中',
  PAUSED: '已暂停',
  ACCEPTING: '待验收',
  COMPLETED: '已完成',
  ARCHIVED: '已归档',
};
const projectFields = z.object({
  name: z.string().trim().min(1, '请输入项目名称').max(80),
  description: z.string().trim().max(2000).default(''),
  color: z.enum(projectColors).default('teal'),
  icon: z.enum(projectIcons).default('layers'),
  startDate: z.iso.date().nullable().default(null),
  endDate: z.iso.date().nullable().default(null),
});
function validDates(input: { startDate: string | null; endDate: string | null }) {
  return !input.startDate || !input.endDate || input.endDate >= input.startDate;
}
export const createProjectSchema = projectFields
  .extend({
    key: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z][A-Z0-9]{1,11}$/, '项目标识须为 2–12 位大写字母或数字，以字母开头'),
    ownerId: z.uuid().optional(),
  })
  .refine(validDates, { path: ['endDate'], message: '结束日期不能早于开始日期' });
export const updateProjectSchema = projectFields
  .extend({ ownerId: z.uuid().optional(), version: z.number().int().positive() })
  .refine(validDates, { path: ['endDate'], message: '结束日期不能早于开始日期' });
export const projectQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: projectStatusSchema.optional(),
  scope: z.enum(['all', 'owned', 'joined']).default('all'),
});
export const projectMemberQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
});
export const rolesSchema = z
  .array(projectRoleSchema)
  .min(1, '至少选择一个项目角色')
  .max(6)
  .transform((roles) => [...new Set(roles)].sort());
export const addProjectMemberSchema = z.object({
  email: loginSchema.shape.email,
  roles: rolesSchema,
});
export const updateProjectMemberSchema = z.object({
  roles: rolesSchema,
  version: z.number().int().positive(),
});
export const projectStateCommandSchema = z
  .object({
    status: z.enum(['ACTIVE', 'PAUSED']),
    version: z.number().int().positive(),
    reason: z.string().trim().max(500).default(''),
  })
  .refine((value) => value.status !== 'PAUSED' || value.reason.length > 0, {
    path: ['reason'],
    message: '请填写暂停原因',
  });
export const projectActions = ['edit', 'manageMembers', 'start', 'pause', 'resume'] as const;
export const projectSchema = z.object({
  id: z.uuid(),
  key: z.string(),
  name: z.string(),
  description: z.string(),
  color: z.enum(projectColors),
  icon: z.enum(projectIcons),
  status: projectStatusSchema,
  owner: userSchema,
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  memberCount: z.number().int(),
  memberPreview: z.array(userSchema),
  myRoles: z.array(projectRoleSchema),
  allowedActions: z.array(z.enum(projectActions)),
  access: z.enum(['MEMBER', 'ADMIN']),
});
export type Project = z.infer<typeof projectSchema>;
export type CreateProject = z.infer<typeof createProjectSchema>;
export const projectListSchema = z.object({
  items: z.array(projectSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  stats: z.object({
    total: z.number().int(),
    active: z.number().int(),
    pending: z.number().int(),
    paused: z.number().int(),
  }),
  canCreate: z.boolean(),
});
export const projectMemberSchema = z.object({
  user: userSchema.extend({ active: z.boolean() }),
  roles: z.array(projectRoleSchema),
  version: z.number().int(),
  joinedAt: z.iso.datetime(),
});
export type ProjectMember = z.infer<typeof projectMemberSchema>;
export const projectMembersSchema = z.object({
  items: z.array(projectMemberSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
});
export const projectMemberOptionSchema = userSchema.pick({ id: true, name: true, email: true });
export type ProjectMemberOption = z.infer<typeof projectMemberOptionSchema>;
export const projectMemberOptionsSchema = z.object({
  items: z.array(projectMemberOptionSchema),
  total: z.number().int().nonnegative(),
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
});
export const projectActivitySchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      action: z.string(),
      actorName: z.string(),
      createdAt: z.iso.datetime(),
      details: z.record(z.string(), z.unknown()).nullable(),
    }),
  ),
});

export const iterationStatusSchema = z.enum(statuses.iteration);
export const iterationStatusLabels = {
  PLANNING: '规划中',
  ACTIVE: '进行中',
  CLOSED: '已关闭',
} as const;
const iterationFields = z.object({
  name: z.string().trim().min(1, '请输入迭代名称').max(80),
  goal: z.string().trim().max(2000).default(''),
  ownerId: z.uuid(),
  startDate: z.iso.date(),
  endDate: z.iso.date(),
});
export const createIterationSchema = iterationFields.refine(validDates, {
  path: ['endDate'],
  message: '结束日期不能早于开始日期',
});
export const updateIterationSchema = iterationFields
  .extend(versionSchema.shape)
  .refine(validDates, { path: ['endDate'], message: '结束日期不能早于开始日期' });
export type CreateIteration = z.infer<typeof createIterationSchema>;
export const iterationQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: iterationStatusSchema.optional(),
  ownerId: z.uuid().optional(),
});
export const closeIterationSchema = versionSchema.extend({
  summary: z.string().trim().min(1, '请填写迭代总结').max(2000),
});
export const iterationSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  name: z.string(),
  goal: z.string(),
  owner: userSchema,
  startDate: z.iso.date(),
  endDate: z.iso.date(),
  status: iterationStatusSchema,
  version: z.number().int().positive(),
  startedAt: z.iso.datetime().nullable(),
  closedAt: z.iso.datetime().nullable(),
  closeSummary: z.string().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  work: z.object({
    total: z.number().int().nonnegative(),
    open: z.number().int().nonnegative(),
    done: z.number().int().nonnegative(),
    canceled: z.number().int().nonnegative(),
  }),
  allowedActions: z.array(z.enum(['edit', 'start', 'close'])),
});
export type Iteration = z.infer<typeof iterationSchema>;
export const iterationListSchema = z.object({
  items: z.array(iterationSchema),
  total: z.number().int(),
  page: z.number().int(),
  pageSize: z.number().int(),
  canCreate: z.boolean(),
  stats: z.object({
    total: z.number().int(),
    planning: z.number().int(),
    active: z.number().int(),
    closed: z.number().int(),
  }),
});
export const iterationDetailSchema = iterationSchema.extend({
  items: z.object({
    items: z.array(
      z.object({
        id: z.uuid(),
        kind: z.enum(['REQUIREMENT', 'TASK']),
        title: z.string(),
        resolution: z.enum(['OPEN', 'DONE', 'CANCELED']),
      }),
    ),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  }),
});

export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', unrepresentable: 'any', io: 'input' });
}

export const collaborationTargetSchema = z.object({
  targetType: z.enum([
    'PROJECT',
    'ITERATION',
    'REQUIREMENT',
    'TASK',
    'TEST_CASE',
    'TEST_RECORD',
    'RELEASE',
    'SUBMISSION',
    'TEST_RUN',
    'DEFECT',
  ]),
  targetId: z.uuid(),
});
export type CollaborationTarget = z.infer<typeof collaborationTargetSchema>;
export const createCommentSchema = z.object({ body: z.string().trim().min(1).max(5000) });
export const commentSchema = z.object({
  id: z.uuid(),
  body: z.string(),
  authorName: z.string(),
  createdAt: z.iso.datetime(),
});
export const attachmentSchema = z.object({
  id: z.uuid(),
  filename: z.string(),
  contentType: z.string(),
  size: z.number().int(),
  uploaderName: z.string(),
  createdAt: z.iso.datetime(),
});
const paged = <T extends z.ZodType>(item: T) =>
  z.object({
    items: z.array(item),
    total: z.number().int(),
    page: z.number().int(),
    pageSize: z.number().int(),
  });
export const commentListSchema = paged(commentSchema).extend({ canWrite: z.boolean() });
export const attachmentListSchema = paged(attachmentSchema).extend({ canWrite: z.boolean() });
export const notificationSchema = collaborationTargetSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  title: z.string(),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export const notificationListSchema = paged(notificationSchema).extend({
  unread: z.number().int(),
});
export const notificationQuerySchema = paginationSchema.extend({
  unread: z.enum(['true', 'false']).optional(),
});

// 待办从领域当前状态聚合，不维护可手工勾选的第二份业务状态。
export const workbenchKindSchema = z.enum([
  'ITERATION_FOLLOW_UP',
  'TASK',
  'REQUIREMENT_REVIEW',
  'TASK_ASSIST',
  'TEST_CASE_REVIEW',
  'TEST_CASE_RECHECK',
  'TEST_RECORD',
  'DEFECT_TRIAGE',
  'DEFECT_FIX',
  'DEFECT_RETEST',
  'DEFECT_FOLLOW_UP',
]);
export const workbenchQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: z
    .enum([
      'all',
      'PLANNING',
      'ACTIVE',
      'TODO',
      'IN_PROGRESS',
      'IN_REVIEW',
      'NEEDS_REVIEW',
      'SUBMITTED',
      'PENDING',
      'NOT_RUN',
      'RUNNING',
      'UNCONFIRMED',
      'OPEN',
      'FIXING',
      'AWAITING_RETEST',
      'DEFERRED',
      'pending',
      'active',
      'overdue',
      'blocked',
    ])
    .default('all'),
  projectId: z.uuid().optional(),
  kind: workbenchKindSchema.optional(),
});
export const workbenchItemSchema = z.object({
  kind: workbenchKindSchema,
  id: z.uuid(),
  title: z.string(),
  status: z.enum([
    'PLANNING',
    'ACTIVE',
    'TODO',
    'IN_PROGRESS',
    'IN_REVIEW',
    'NEEDS_REVIEW',
    'SUBMITTED',
    'PENDING',
    'NOT_RUN',
    'RUNNING',
    'UNCONFIRMED',
    'OPEN',
    'FIXING',
    'AWAITING_RETEST',
    'DEFERRED',
  ]),
  startDate: z.iso.date().nullable(),
  endDate: z.iso.date().nullable(),
  dueDate: z.iso.date().nullable(),
  blocked: z.boolean(),
  overdue: z.boolean(),
  project: projectSchema.pick({
    id: true,
    key: true,
    name: true,
    color: true,
    icon: true,
    status: true,
  }),
});
export const workbenchListSchema = paged(workbenchItemSchema).extend({
  today: z.iso.date(),
  timeZone: z.literal('Asia/Shanghai'),
  summary: z.object({
    total: z.number().int(),
    planning: z.number().int(),
    active: z.number().int(),
    overdue: z.number().int(),
    tasks: z.number().int(),
    reviews: z.number().int(),
    caseReviews: z.number().int(),
    caseRechecks: z.number().int(),
    assistance: z.number().int(),
    blocked: z.number().int(),
  }),
});

export const requirementStatusSchema = z.enum(statuses.requirement);
export const requirementStatusLabels = {
  DRAFT: '草稿',
  IN_REVIEW: '待评审',
  CONFIRMED: '已确认',
  IMPLEMENTING: '实现中',
  ACCEPTING: '待测试',
  TESTING: '测试中',
  COMPLETED: '已完成',
  CANCELLED: '已取消',
} as const;
export const requirementPrioritySchema = z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']);
export const requirementPriorityLabels = {
  LOW: '低',
  MEDIUM: '普通',
  HIGH: '高',
  URGENT: '紧急',
} as const;
export const requirementTypeSchema = z.enum(['FUNCTIONAL', 'MAINTENANCE']);
export const requirementTypeLabels = { FUNCTIONAL: '功能需求', MAINTENANCE: '维护需求' } as const;
const requirementFields = z.object({
  title: z.string().trim().min(1, '请填写需求标题').max(200),
  description: z.string().trim().max(10000).default(''),
  acceptanceCriteria: z.string().trim().max(5000).default(''),
  type: requirementTypeSchema.default('FUNCTIONAL'),
  priority: requirementPrioritySchema.default('MEDIUM'),
  ownerId: z.uuid().nullable().default(null),
  iterationId: z.uuid().nullable().default(null),
});
export const createRequirementSchema = requirementFields;
export const updateRequirementSchema = requirementFields.extend({
  ...versionSchema.shape,
  changeReason: z.string().trim().max(500).default(''),
});
export type CreateRequirement = z.infer<typeof createRequirementSchema>;
export const submitRequirementSchema = versionSchema.extend({
  reviewerId: z.uuid(),
  comment: z.string().trim().max(2000).default(''),
});
export const decideRequirementSchema = versionSchema.extend({
  comment: z.string().trim().max(2000).default(''),
});
export const reasonRequirementSchema = versionSchema.extend({
  comment: z.string().trim().min(1, '请填写原因').max(2000),
});
export const requirementQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: requirementStatusSchema.optional(),
  priority: requirementPrioritySchema.optional(),
  type: requirementTypeSchema.optional(),
  ownerId: z.uuid().optional(),
  iterationId: z.uuid().optional(),
});
const requirementPerson = userSchema.pick({ id: true, name: true });
export const requirementSnapshotSchema = z.object({
  code: z.string(),
  title: z.string(),
  description: z.string(),
  acceptanceCriteria: z.string(),
  type: requirementTypeSchema,
  priority: requirementPrioritySchema,
  owner: requirementPerson.nullable(),
  iteration: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  revision: z.number().int().positive(),
});
export const requirementSchema = requirementSnapshotSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int().positive(),
  ownerId: z.uuid().nullable(),
  iterationId: z.uuid().nullable(),
  reviewer: requirementPerson.nullable(),
  createdBy: requirementPerson,
  status: requirementStatusSchema,
  version: z.number().int().positive(),
  reviewRound: z.number().int().nonnegative(),
  acceptedRevision: z.number().int().positive().nullable(),
  scopeVersion: z.number().int().nonnegative(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  allowedActions: z.array(
    z.enum(['edit', 'revise', 'submit', 'approve', 'return', 'withdraw', 'cancel']),
  ),
});
export type Requirement = z.infer<typeof requirementSchema>;
export const requirementListSchema = paged(requirementSchema).extend({ canCreate: z.boolean() });
export const requirementReviewSchema = z.object({
  id: z.uuid(),
  round: z.number().int().positive(),
  revision: z.number().int().positive(),
  action: z.enum(['SUBMITTED', 'APPROVED', 'RETURNED', 'WITHDRAWN']),
  actor: requirementPerson,
  reviewer: requirementPerson,
  comment: z.string(),
  snapshot: requirementSnapshotSchema,
  createdAt: z.iso.datetime(),
});
export const requirementChangeSchema = z.object({
  id: z.uuid(),
  actor: requirementPerson,
  fromRevision: z.number().int().positive(),
  toRevision: z.number().int().positive(),
  scopeVersion: z.number().int().positive(),
  reason: z.string(),
  impact: z.string(),
  before: requirementSnapshotSchema,
  after: requirementSnapshotSchema,
  affectedTaskIds: z.array(z.uuid()),
  effects: z.object({
    testCaseReviewRequired: z.boolean(),
    acceptanceInvalidated: z.boolean(),
    releaseCheckInvalidated: z.boolean(),
  }),
  createdAt: z.iso.datetime(),
});
export const testPreparationSchema = z.object({
  requirementConfirmed: z.boolean(),
  total: z.number().int().nonnegative(),
  draft: z.number().int().nonnegative(),
  inReview: z.number().int().nonnegative(),
  usable: z.number().int().nonnegative(),
  needsReview: z.number().int().nonnegative(),
  deprecated: z.number().int().nonnegative(),
});
export const requirementDetailSchema = requirementSchema.extend({
  testPreparation: testPreparationSchema,
  cases: paged(
    z.object({
      id: z.uuid(),
      code: z.string(),
      title: z.string(),
      status: z.enum(statuses.testCase),
      owner: requirementPerson.nullable(),
      reviewer: requirementPerson.nullable(),
      needsReview: z.boolean(),
      usable: z.boolean(),
    }),
  ),
  history: paged(requirementReviewSchema),
  changes: paged(requirementChangeSchema),
  baseline: requirementSnapshotSchema.nullable(),
  tasks: paged(
    z.object({
      id: z.uuid(),
      code: z.string(),
      title: z.string(),
      status: z.enum(statuses.task),
      blocked: z.boolean(),
      assignee: requirementPerson.nullable(),
      dueDate: z.iso.date().nullable(),
    }),
  ),
  taskSummary: z.object({
    total: z.number().int(),
    todo: z.number().int(),
    inProgress: z.number().int(),
    readyForTest: z.number().int(),
    testing: z.number().int(),
    accepting: z.number().int(),
    completed: z.number().int(),
    cancelled: z.number().int(),
    blocked: z.number().int(),
  }),
});
export const reviseRequirementSchema = createRequirementSchema.extend({
  ...versionSchema.shape,
  reason: z.string().trim().min(1, '请填写修订原因').max(500),
  impact: z.string().trim().min(1, '请说明影响范围和处理安排').max(2000),
});
export const requirementEvidenceTokenSchema = z.object({
  requirementId: z.uuid(),
  revision: z.number().int().positive(),
  scopeVersion: z.number().int().nonnegative(),
});
export type RequirementEvidenceToken = z.infer<typeof requirementEvidenceTokenSchema>;

export const requirementPeopleSchema = paged(
  userSchema.pick({ id: true, name: true, email: true }),
);
export const requirementPeopleQuerySchema = userQuerySchema.extend({
  purpose: z.enum(['owner', 'reviewer']).default('owner'),
});

export const taskStatusSchema = z.enum(statuses.task);
export const taskStatusLabels = {
  TODO: '待开始',
  IN_PROGRESS: '进行中',
  COMPLETED: '完成',
} as const;
export const taskPrioritySchema = requirementPrioritySchema;
export const taskPriorityLabels = requirementPriorityLabels;
const taskFields = z.object({
  title: z.string().trim().min(1, '请填写任务标题').max(200),
  description: z.string().trim().max(10000).default(''),
  priority: taskPrioritySchema.default('MEDIUM'),
  estimatedHours: z.number().min(0).max(10000).multipleOf(0.25).nullable().default(null),
  dueDate: z.iso.date().nullable().default(null),
});
export const createTaskSchema = taskFields.extend({
  requirementId: z.uuid(),
  assigneeId: z.uuid().nullable().default(null),
  iterationId: z.uuid().nullable().optional(),
});
export type CreateTask = z.infer<typeof createTaskSchema>;
export const updateTaskSchema = taskFields.extend({
  ...versionSchema.shape,
  iterationId: z.uuid().nullable(),
  changeReason: z.string().trim().max(500).default(''),
});
export const assignTaskSchema = versionSchema.extend({
  assigneeId: z.uuid().nullable(),
  reason: z.string().trim().min(1, '请说明任务分配或改派原因').max(500),
});
export const startTaskSchema = versionSchema.extend({
  reason: z.string().trim().max(500).default(''),
});
export const taskQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: taskStatusSchema.optional(),
  priority: taskPrioritySchema.optional(),
  requirementId: z.uuid().optional(),
  iterationId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  unassigned: z.enum(['true', 'false']).optional(),
  blocked: z.enum(['true', 'false']).optional(),
  overdue: z.enum(['true', 'false']).optional(),
});
export const taskRequirementSchema = z.object({
  revision: z.number().int().positive(),
  acceptedRevision: z.number().int().positive().nullable(),
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
  type: requirementTypeSchema,
  status: requirementStatusSchema,
});
export const taskSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int().positive(),
  code: z.string(),
  title: z.string(),
  description: z.string(),
  priority: taskPrioritySchema,
  requirement: taskRequirementSchema,
  assignee: requirementPerson.nullable(),
  createdBy: requirementPerson,
  estimatedHours: z.number().nullable(),
  dueDate: z.iso.date().nullable(),
  iteration: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  status: taskStatusSchema,
  version: z.number().int().positive(),
  startedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  allowedActions: z.array(
    z.enum([
      'edit',
      'assign',
      'claim',
      'start',
      'complete',
      'reopen',
      'reset',
      'block',
      'resume',
      'acknowledge',
    ]),
  ),
  canAssignOthers: z.boolean(),
  blocked: z.boolean(),
  blockedReason: z.string(),
  helper: requirementPerson.nullable(),
  blockedAt: z.iso.datetime().nullable(),
  basisRevision: z.number().int().positive().nullable(),
  needsRequirementReview: z.boolean(),
});
export type Task = z.infer<typeof taskSchema>;
export const taskListSchema = paged(taskSchema).extend({ canCreate: z.boolean() });
export const taskDetailSchema = taskSchema.extend({
  history: paged(projectActivitySchema.shape.items.element),
});
export const taskPeopleQuerySchema = userQuerySchema.extend({
  purpose: z.enum(['assignee', 'helper']).default('assignee'),
});
export const taskPeopleSchema = requirementPeopleSchema.extend({ canAssignOthers: z.boolean() });
export const taskRequirementOptionsSchema = paged(
  taskRequirementSchema.extend({
    iteration: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  }),
);

export const blockTaskSchema = versionSchema.extend({
  reason: z.string().trim().min(1, '请填写阻塞原因').max(2000),
  helperId: z.uuid(),
});
export const reasonTaskSchema = versionSchema.extend({
  reason: z.string().trim().min(1, '请说明操作原因').max(2000),
});
export const taskBoardQuerySchema = taskQuerySchema.omit({ page: true, status: true }).extend({
  todoPage: paginationSchema.shape.page,
  progressPage: paginationSchema.shape.page,
  cancelledPage: paginationSchema.shape.page,
  readyPage: paginationSchema.shape.page,
  testingPage: paginationSchema.shape.page,
  acceptingPage: paginationSchema.shape.page,
  completedPage: paginationSchema.shape.page,
});
export const taskBoardSchema = z.object({
  columns: z.array(
    z.object({
      status: taskStatusSchema,
      ...paginationSchema.shape,
      items: z.array(taskSchema),
      total: z.number().int().nonnegative(),
    }),
  ),
  summary: z.object({
    total: z.number().int(),
    blocked: z.number().int(),
    overdue: z.number().int(),
  }),
});

export const acknowledgeTaskSchema = reasonTaskSchema.extend({
  requirementRevision: z.number().int().positive(),
});

export const testCaseStatusSchema = z.enum(statuses.testCase);
export const testCaseStatusLabels: Record<z.infer<typeof testCaseStatusSchema>, string> = {
  DRAFT: '草稿',
  IN_REVIEW: '待评审',
  READY: '可使用',
  DEPRECATED: '已废弃',
};
export const testCaseStepSchema = z.object({
  action: z.string().trim().max(2000).default(''),
  expected: z.string().trim().max(2000).default(''),
});
export const createTestCaseSchema = z.object({
  title: z.string().trim().min(1, '请填写用例标题').max(200),
  preconditions: z.string().trim().max(5000).default(''),
  steps: z.array(testCaseStepSchema).max(100).default([]),
  priority: requirementPrioritySchema.default('MEDIUM'),
  ownerId: z.uuid().nullable().default(null),
  requirementIds: z
    .array(z.uuid())
    .min(1, '请至少关联一个已确认需求')
    .max(50)
    .refine((ids) => new Set(ids).size === ids.length, '不能重复关联需求'),
});
export type CreateTestCase = z.infer<typeof createTestCaseSchema>;
export const updateTestCaseSchema = createTestCaseSchema.extend({ ...versionSchema.shape });
export const reviseTestCaseSchema = updateTestCaseSchema.extend({
  reason: z.string().trim().min(1, '请填写修订原因').max(2000),
});
export const submitTestCaseSchema = submitRequirementSchema;
export const decideTestCaseSchema = decideRequirementSchema;
export const reasonTestCaseSchema = reasonRequirementSchema;
export const testCaseQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: testCaseStatusSchema.optional(),
  priority: requirementPrioritySchema.optional(),
  ownerId: z.uuid().optional(),
  requirementId: z.uuid().optional(),
  usable: z.enum(['true', 'false']).optional(),
});
export const testCaseSnapshotSchema = z.object({
  code: z.string(),
  title: z.string(),
  preconditions: z.string(),
  steps: z.array(testCaseStepSchema),
  priority: requirementPrioritySchema,
  owner: requirementPerson.nullable(),
  revision: z.number().int().positive(),
  requirements: z.array(z.object({ id: z.uuid(), code: z.string(), title: z.string() })),
});
export const testCaseSchema = testCaseSnapshotSchema.extend({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int().positive(),
  ownerId: z.uuid().nullable(),
  reviewer: requirementPerson.nullable(),
  createdBy: requirementPerson,
  status: testCaseStatusSchema,
  version: z.number().int().positive(),
  approvedRevision: z.number().int().positive().nullable(),
  reviewRound: z.number().int().nonnegative(),
  needsReview: z.boolean(),
  usable: z.boolean(),
  testResult: z.enum(['NOT_RUN', 'PASSED', 'FAILED', 'RETEST']).default('NOT_RUN'),
  latestRecordId: z.uuid().nullable().default(null),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  allowedActions: z.array(
    z.enum(['edit', 'revise', 'submit', 'approve', 'return', 'withdraw', 'deprecate']),
  ),
});
export type TestCase = z.infer<typeof testCaseSchema>;
export const testCaseListSchema = paged(testCaseSchema).extend({ canCreate: z.boolean() });
export const testCaseRevisionSchema = z.object({
  id: z.uuid(),
  revision: z.number().int().positive(),
  snapshot: testCaseSnapshotSchema.extend({ editedBy: requirementPerson.nullable().default(null) }),
  requirementBasis: z.array(requirementEvidenceTokenSchema),
  reason: z.string(),
  createdAt: z.iso.datetime(),
});
export const testCaseReviewSchema = z.object({
  id: z.uuid(),
  round: z.number().int().positive(),
  revision: z.number().int().positive(),
  action: z.enum(['SUBMITTED', 'APPROVED', 'RETURNED', 'WITHDRAWN']),
  actor: requirementPerson,
  reviewer: requirementPerson,
  comment: z.string(),
  createdAt: z.iso.datetime(),
});
export const testCaseDetailSchema = testCaseSchema.extend({
  revisions: paged(testCaseRevisionSchema),
  deprecation: z
    .object({
      reason: z.string(),
      actor: requirementPerson.nullable(),
      createdAt: z.iso.datetime(),
    })
    .nullable(),
  history: paged(testCaseReviewSchema),
});
export const testCasePeopleQuerySchema = requirementPeopleQuerySchema;
export const testCasePeopleSchema = requirementPeopleSchema;
export const testCaseRequirementOptionsSchema = paged(
  z.object({
    id: z.uuid(),
    code: z.string(),
    title: z.string(),
    revision: z.number().int().positive(),
  }),
);

// 修订历史允许不完整草稿；正式执行使用独立、有版本且完整的冻结结构。
// readonly 在解析时逐层冻结对象/数组，重新读取 JSON 时也须通过此 schema。
const executionText = (max: number) =>
  z
    .string()
    .max(max)
    .refine((s) => s.trim().length > 0, '内容不能为空');
const executionPerson = z.strictObject({ id: z.uuid(), name: executionText(80) }).readonly();
export const testCaseExecutionSnapshotSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    projectId: z.uuid(),
    source: z
      .strictObject({
        testCaseId: z.uuid(),
        revisionId: z.uuid(),
        revision: z.number().int().positive(),
      })
      .readonly(),
    content: z
      .strictObject({
        code: executionText(64),
        title: executionText(200),
        preconditions: z.string().max(5000),
        steps: z
          .array(
            z
              .strictObject({
                action: executionText(2000),
                expected: executionText(2000),
              })
              .readonly(),
          )
          .min(1)
          .max(100)
          .readonly(),
        priority: requirementPrioritySchema,
        owner: executionPerson,
      })
      .readonly(),
    requirements: z
      .array(
        requirementEvidenceTokenSchema
          .strict()
          .extend({
            code: executionText(64),
            title: executionText(200),
          })
          .readonly(),
      )
      .min(1)
      .max(50)
      .refine(
        (rows) => new Set(rows.map((r) => r.requirementId)).size === rows.length,
        '需求依据不能重复',
      )
      .readonly(),
    approval: z
      .strictObject({
        reviewId: z.uuid(),
        round: z.number().int().positive(),
        reviewer: executionPerson,
        decidedBy: executionPerson,
        approvedAt: z.iso.datetime(),
      })
      .readonly(),
    capturedAt: z.iso.datetime(),
    capturedBy: executionPerson,
  })
  .superRefine((value, ctx) => {
    if (Date.parse(value.approval.approvedAt) > Date.parse(value.capturedAt))
      ctx.addIssue({
        code: 'custom',
        path: ['capturedAt'],
        message: '冻结时间不能早于评审通过时间',
      });
  })
  .readonly();
export type TestCaseExecutionSnapshot = z.infer<typeof testCaseExecutionSnapshotSchema>;

// M4：版本、构建、提测、执行与缺陷契约。
export const releaseStatusSchema = z.enum(statuses.release);
export const submissionStatusSchema = z.enum(statuses.submission);
export const testRunStatusSchema = z.enum(statuses.testRun);
export const testOutcomeSchema = z.enum(['PASSED', 'FAILED', 'BLOCKED', 'NOT_APPLICABLE']);
export const defectStatusSchema = z.enum(statuses.defect);
export const defectSeveritySchema = z.enum(['CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL']);
export const qualityLabels: Record<string, string> = {
  PLANNING: '规划中',
  DEVELOPING: '开发中',
  TESTING: '测试中',
  READY: '待发布',
  RELEASED: '已发布',
  ARCHIVED: '已归档',
  DRAFT: '草稿',
  SUBMITTED: '待接收',
  ACCEPTED: '已接收',
  RETURNED: '已退回',
  CANCELLED: '已取消',
  COMPLETED: '已完成',
  PENDING: '待执行',
  RUNNING: '执行中',
  PASSED: '通过',
  FAILED: '失败',
  BLOCKED: '阻塞',
  NOT_APPLICABLE: '不适用',
  UNCONFIRMED: '待确认',
  OPEN: '待修复',
  FIXING: '修复中',
  AWAITING_RETEST: '待复测',
  CLOSED: '已关闭',
  DUPLICATE: '重复',
  NOT_A_DEFECT: '非缺陷',
  CANNOT_REPRODUCE: '无法复现',
  DEFERRED: '已延期',
  CRITICAL: '致命',
  MAJOR: '严重',
  MINOR: '一般',
  TRIVIAL: '轻微',
  PRODUCTION: '生产',
};
const qualityIds = z
  .array(z.uuid())
  .max(100)
  .refine((ids) => new Set(ids).size === ids.length, '关联对象不能重复');
const qualityText = (max = 5000) => z.string().trim().min(1, '请填写内容').max(max);
const qualityUrl = z
  .union([
    z.literal(''),
    z
      .url({ error: '请输入完整链接，例如 https://example.com' })
      .refine((url) => /^https?:\/\//i.test(url), '仅支持 HTTP/HTTPS 链接'),
  ])
  .default('');
export const createReleaseSchema = z.object({
  name: qualityText(100),
  description: z.string().trim().max(5000).default(''),
  requirementIds: qualityIds.default([]),
  taskIds: qualityIds.default([]),
});
export const updateReleaseSchema = createReleaseSchema.extend(versionSchema.shape);
export const createBuildSchema = z.object({
  releaseId: z.uuid(),
  identifier: qualityText(100),
  codeUrl: qualityUrl,
  artifactUrl: qualityUrl,
  notes: z.string().trim().max(5000).default(''),
});
export const createSubmissionSchema = z.object({
  title: qualityText(200),
  releaseId: z.uuid(),
  buildId: z.uuid(),
  receiverId: z.uuid(),
  taskIds: qualityIds.refine((ids) => ids.length > 0, '请至少关联一个任务'),
  environment: qualityText(2000),
  selfTest: qualityText(),
  changes: qualityText(),
});
export const updateSubmissionSchema = createSubmissionSchema.extend(versionSchema.shape);
export const qualityReasonSchema = versionSchema.extend({ reason: qualityText() });
export const assignRunSchema = qualityReasonSchema.extend({ executorId: z.uuid() });
export const selectRunCasesSchema = versionSchema.extend({
  items: z
    .array(
      z.object({
        testCaseId: z.uuid(),
        revision: z.number().int().positive(),
        required: z.boolean().default(true),
      }),
    )
    .min(1)
    .max(100)
    .refine((rows) => new Set(rows.map((r) => r.testCaseId)).size === rows.length, '用例不能重复'),
});
export const recordTestResultSchema = versionSchema
  .extend({
    itemId: z.uuid(),
    outcome: testOutcomeSchema,
    actual: qualityText(),
    evidence: qualityText(),
    reason: z.string().trim().max(5000).default(''),
    defectId: z.uuid().optional(),
    attachmentIds: qualityIds.default([]),
  })
  .superRefine((v, ctx) => {
    if (
      (['BLOCKED', 'NOT_APPLICABLE'].includes(v.outcome) ||
        (v.outcome === 'FAILED' && !v.defectId)) &&
      !v.reason
    )
      ctx.addIssue({
        code: 'custom',
        path: ['reason'],
        message: '失败、阻塞或不适用须填写原因；失败也可关联已有缺陷',
      });
  });
export const createDefectSchema = z.object({
  title: qualityText(200),
  reproduction: qualityText(10000),
  expected: qualityText(),
  actual: qualityText(),
  environment: qualityText(2000),
  source: z.enum(['TESTING', 'PRODUCTION']).default('TESTING'),
  severity: defectSeveritySchema,
  requirementId: z.uuid(),
  taskId: z.uuid().nullable().default(null),
  foundBuildId: z.uuid().nullable().optional(),
  targetReleaseId: z.uuid().nullable().optional(),
  testCaseIds: z.array(z.uuid()).max(100).default([]),
  testRecordIds: z.array(z.uuid()).max(100).default([]),
  assigneeId: z.uuid(),
  retesterId: z.uuid(),
  resultId: z.uuid().optional(),
});
export const assignDefectSchema = qualityReasonSchema.extend({
  assigneeId: z.uuid(),
  retesterId: z.uuid(),
  targetReleaseId: z.uuid().nullable().optional(),
});
export const fixDefectSchema = qualityReasonSchema.extend({
  buildId: z.uuid().nullable().optional(),
  reason: z.string().trim().max(5000).default(''),
  evidence: z.string().trim().max(5000).default(''),
});
export const retestDefectSchema = qualityReasonSchema.extend({
  testRecordId: z.uuid().optional(),
  passed: z.boolean(),
  evidence: qualityText(),
});
export const disposeDefectSchema = qualityReasonSchema
  .extend({
    conclusion: z.enum(['DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE', 'DEFERRED']),
    evidence: qualityText(),
    duplicateOfId: z.uuid().optional(),
    targetReleaseId: z.uuid().optional(),
    deferUntil: z.iso.date().optional(),
  })
  .superRefine((v, ctx) => {
    if (v.conclusion === 'DUPLICATE' && !v.duplicateOfId)
      ctx.addIssue({ code: 'custom', path: ['duplicateOfId'], message: '请选择主缺陷' });
    if (v.conclusion === 'DEFERRED' && !v.targetReleaseId && !v.deferUntil)
      ctx.addIssue({
        code: 'custom',
        path: ['targetReleaseId'],
        message: '延期须指定目标版本或日期',
      });
  });
export const linkDefectResultSchema = versionSchema.extend({
  testCaseIds: z.array(z.uuid()).max(100).default([]),
  testRecordIds: z.array(z.uuid()).max(100).default([]),
});
export const qualityQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  status: z.string().max(40).optional(),
  releaseId: z.uuid().optional(),
  assigneeId: z.uuid().optional(),
  severity: defectSeveritySchema.optional(),
  source: z.enum(['TESTING', 'PRODUCTION']).optional(),
});
export const qualityOptionsQuerySchema = qualityQuerySchema.extend({
  kind: z.enum([
    'releases',
    'builds',
    'tasks',
    'requirements',
    'cases',
    'defects',
    'results',
    'records',
    'attachments',
  ]),
  id: z.uuid().optional(),
  runId: z.uuid().optional(),
  requirementId: z.uuid().optional(),
  testCaseId: z.uuid().optional(),
  buildId: z.uuid().optional(),
});
export const qualityPeopleQuerySchema = qualityQuerySchema.extend({
  purpose: z.enum(['receiver', 'executor', 'assignee', 'retester']),
  id: z.uuid().optional(),
});
export const qualityOptionSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  revision: z.number().optional(),
  version: z.number().optional(),
  releaseId: z.uuid().optional(),
  requirementId: z.uuid().optional(),
  buildId: z.uuid().optional(),
});
export const qualityOptionsSchema = paged(qualityOptionSchema);
const qualityBase = {
  id: z.uuid(),
  projectId: z.uuid(),
  version: z.number().int().positive(),
  createdAt: z.iso.datetime(),
  allowedActions: z.array(z.string()),
};
export const qualityActivitySchema = z.object({
  id: z.uuid(),
  action: z.string(),
  actor: requirementPerson.nullable(),
  details: z.unknown(),
  createdAt: z.iso.datetime(),
});
export const releaseSchema = z.object({
  ...qualityBase,
  name: z.string(),
  description: z.string(),
  status: releaseStatusSchema,
  scopeVersion: z.number().int().positive(),
});
export type Release = z.infer<typeof releaseSchema>;
export const releaseListSchema = paged(releaseSchema).extend({ canCreate: z.boolean() });
export const buildSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  releaseId: z.uuid(),
  scopeVersion: z.number().int(),
  identifier: z.string(),
  codeUrl: z.string(),
  artifactUrl: z.string(),
  notes: z.string(),
  createdAt: z.iso.datetime(),
});
export const buildListSchema = paged(buildSchema).extend({ canCreate: z.boolean() });
export const releaseDetailSchema = releaseSchema.extend({
  scope: z.array(
    z.object({
      id: z.uuid(),
      kind: z.enum(['REQUIREMENT', 'TASK']),
      code: z.string(),
      title: z.string(),
      status: z.string(),
    }),
  ),
  builds: paged(buildSchema),
  history: paged(qualityActivitySchema),
});
export const submissionSchema = z.object({
  ...qualityBase,
  number: z.number().int(),
  code: z.string(),
  title: z.string(),
  releaseId: z.uuid(),
  releaseName: z.string(),
  buildId: z.uuid(),
  buildIdentifier: z.string(),
  receiver: requirementPerson,
  createdBy: requirementPerson,
  environment: z.string(),
  selfTest: z.string(),
  changes: z.string(),
  status: submissionStatusSchema,
  round: z.number().int(),
  scopeVersion: z.number().int(),
  requirementBasis: z.array(requirementEvidenceTokenSchema),
  taskIds: z.array(z.uuid()),
  scopeSnapshot: z.unknown(),
});
export type Submission = z.infer<typeof submissionSchema>;
export const submissionListSchema = paged(submissionSchema).extend({ canCreate: z.boolean() });
export const submissionDetailSchema = submissionSchema.extend({
  runId: z.uuid().nullable(),
  reviews: paged(
    z.object({
      id: z.uuid(),
      round: z.number().int(),
      action: z.string(),
      actor: requirementPerson,
      reason: z.string(),
      snapshot: z.unknown(),
      createdAt: z.iso.datetime(),
    }),
  ),
  history: paged(qualityActivitySchema),
});
export const testRunSchema = z.object({
  ...qualityBase,
  submissionId: z.uuid(),
  title: z.string(),
  buildId: z.uuid(),
  buildIdentifier: z.string(),
  releaseId: z.uuid(),
  environment: z.string(),
  executor: requirementPerson,
  status: testRunStatusSchema,
  passed: z.boolean().nullable(),
  summary: z.unknown(),
  completedAt: z.iso.datetime().nullable(),
});
export type TestRun = z.infer<typeof testRunSchema>;
export const testRunListSchema = paged(testRunSchema);
export const testResultSchema = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  attempt: z.number().int(),
  outcome: testOutcomeSchema,
  actual: z.string(),
  reason: z.string(),
  evidence: z.string(),
  attachmentIds: z.array(z.uuid()),
  actor: requirementPerson,
  createdAt: z.iso.datetime(),
  defectIds: z.array(z.uuid()),
});
export const testRunItemSchema = z.object({
  id: z.uuid(),
  testCaseId: z.uuid(),
  revision: z.number().int(),
  required: z.boolean(),
  snapshot: testCaseExecutionSnapshotSchema,
  latest: testResultSchema.nullable(),
});
export type TestRunItem = z.infer<typeof testRunItemSchema>;
export const testRunDetailSchema = testRunSchema.extend({
  items: paged(testRunItemSchema),
  history: paged(qualityActivitySchema),
});
export const testRunItemDetailSchema = testRunItemSchema.extend({
  results: paged(testResultSchema),
});
export const defectSchema = z.object({
  ...qualityBase,
  number: z.number().int(),
  code: z.string(),
  title: z.string(),
  reproduction: z.string(),
  expected: z.string(),
  actual: z.string(),
  environment: z.string(),
  source: z.enum(['TESTING', 'PRODUCTION']),
  severity: defectSeveritySchema,
  status: defectStatusSchema,
  requirementId: z.uuid(),
  taskId: z.uuid().nullable(),
  foundBuildId: z.uuid().nullable(),
  foundBuildIdentifier: z.string().nullable(),
  releaseId: z.uuid().nullable(),
  targetReleaseId: z.uuid().nullable(),
  fixedBuildId: z.uuid().nullable(),
  fixedBuildIdentifier: z.string().nullable(),
  duplicateOfId: z.uuid().nullable(),
  assignee: requirementPerson,
  retester: requirementPerson,
  createdBy: requirementPerson,
  deferUntil: z.iso.date().nullable(),
});
export type Defect = z.infer<typeof defectSchema>;
export const defectListSchema = paged(defectSchema).extend({ canCreate: z.boolean() });
export const defectDetailSchema = defectSchema.extend({
  testCases: z.array(z.object({ id: z.uuid(), code: z.string(), title: z.string() })),
  testRecords: z.array(
    z.object({
      id: z.uuid(),
      code: z.string(),
      caseTitle: z.string(),
      outcome: z.string(),
      type: z.string(),
    }),
  ),
  dispositions: paged(
    z.object({
      id: z.uuid(),
      action: z.string(),
      fromStatus: defectStatusSchema,
      toStatus: defectStatusSchema,
      actor: requirementPerson,
      reason: z.string(),
      evidence: z.string(),
      buildId: z.uuid().nullable(),
      resultId: z.uuid().nullable(),
      details: z.unknown(),
      createdAt: z.iso.datetime(),
    }),
  ),
  links: paged(
    z.object({
      id: z.uuid(),
      resultId: z.uuid(),
      runId: z.uuid(),
      buildId: z.uuid(),
      buildIdentifier: z.string(),
      outcome: testOutcomeSchema,
      caseTitle: z.string(),
      createdAt: z.iso.datetime(),
    }),
  ),
  history: paged(qualityActivitySchema),
});

// 轻量测试：一条记录代表一个需求、一个用例修订的一次测试。
export const testRecordOutcomeSchema = z.enum(['NOT_RUN', 'PASSED', 'FAILED']);
export const testRecordTypeSchema = z.enum(['INITIAL', 'RETEST']);
export const testRecordLabels: Record<string, string> = {
  NOT_RUN: '待测试',
  PASSED: '通过',
  FAILED: '未通过',
  RETEST: '待复测',
  INITIAL: '首次测试',
};
export const createTestRecordSchema = z.object({
  testCaseId: z.uuid(),
  requirementId: z.uuid(),
  buildId: z.uuid().nullable().default(null),
  environment: qualityText(2000),
  type: testRecordTypeSchema.default('INITIAL'),
  defectIds: z.array(z.uuid()).max(100).default([]),
});
export const finishTestRecordSchema = versionSchema.extend({
  outcome: z.enum(['PASSED', 'FAILED']),
  actual: qualityText(),
  evidence: z.string().trim().max(5000).default(''),
  attachmentIds: z.array(z.uuid()).max(100).default([]),
  defectIds: z.array(z.uuid()).max(100).default([]),
  severity: defectSeveritySchema.default('MAJOR'),
  assigneeId: z.uuid().optional(),
  retesterId: z.uuid().optional(),
});
export const testRecordQuerySchema = paginationSchema.extend({
  q: z.string().trim().max(100).default(''),
  requirementId: z.uuid().optional(),
  testCaseId: z.uuid().optional(),
  outcome: testRecordOutcomeSchema.optional(),
  type: testRecordTypeSchema.optional(),
});
export const testRecordSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  number: z.number().int(),
  code: z.string(),
  testCaseId: z.uuid(),
  caseCode: z.string(),
  caseTitle: z.string(),
  caseRevision: z.number().int(),
  requirementId: z.uuid(),
  requirementTitle: z.string(),
  requirementRevision: z.number().int(),
  cycle: z.number().int(),
  current: z.boolean(),
  type: testRecordTypeSchema,
  outcome: testRecordOutcomeSchema,
  environment: z.string(),
  buildId: z.uuid().nullable(),
  buildIdentifier: z.string().nullable(),
  actual: z.string(),
  evidence: z.string(),
  attachmentIds: z.array(z.uuid()),
  executor: requirementPerson,
  version: z.number().int(),
  createdAt: z.iso.datetime(),
  completedAt: z.iso.datetime().nullable(),
  snapshot: testCaseExecutionSnapshotSchema,
  defects: z.array(
    z.object({ id: z.uuid(), code: z.string(), title: z.string(), status: defectStatusSchema }),
  ),
  allowedActions: z.array(z.enum(['finish'])),
});
export type TestRecord = z.infer<typeof testRecordSchema>;
export const testRecordListSchema = paged(testRecordSchema).extend({ canCreate: z.boolean() });
export const testRecordDetailSchema = testRecordSchema.extend({
  history: paged(qualityActivitySchema),
});
export const defectCaseEvidenceSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  title: z.string(),
});
