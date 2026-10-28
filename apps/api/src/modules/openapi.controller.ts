import * as quality from '@myteam/contracts';
import { Controller, Get } from '@nestjs/common';
import {
  createTestCaseSchema,
  updateTestCaseSchema,
  reviseTestCaseSchema,
  submitTestCaseSchema,
  decideTestCaseSchema,
  reasonTestCaseSchema,
  testCaseListSchema,
  testCaseDetailSchema,
  testCaseExecutionSnapshotSchema,
  testCaseQuerySchema,
  testCasePeopleQuerySchema,
  testCasePeopleSchema,
  testCaseRequirementOptionsSchema,
  csrfResponseSchema,
  errorResponseSchema,
  jsonSchema,
  loginSchema,
  managedUsersSchema,
  sessionResponseSchema,
  userStatusSchema,
  createUserSchema,
  createProjectSchema,
  updateProjectSchema,
  projectSchema,
  projectListSchema,
  projectStateCommandSchema,
  projectMembersSchema,
  projectMemberOptionsSchema,
  addProjectMemberSchema,
  updateProjectMemberSchema,
  projectActivitySchema,
  versionSchema,
  createIterationSchema,
  updateIterationSchema,
  iterationListSchema,
  iterationDetailSchema,
  closeIterationSchema,
  commentListSchema,
  attachmentListSchema,
  createCommentSchema,
  notificationListSchema,
  workbenchListSchema,
  createTaskSchema,
  updateTaskSchema,
  assignTaskSchema,
  startTaskSchema,
  taskListSchema,
  taskBoardSchema,
  taskBoardQuerySchema,
  blockTaskSchema,
  reasonTaskSchema,
  acknowledgeTaskSchema,
  reviseRequirementSchema,
  taskPeopleQuerySchema,
  workbenchQuerySchema,
  taskDetailSchema,
  taskQuerySchema,
  taskPeopleSchema,
  taskRequirementOptionsSchema,
  createRequirementSchema,
  updateRequirementSchema,
  requirementListSchema,
  requirementDetailSchema,
  requirementPeopleSchema,
  requirementPeopleQuerySchema,
  requirementQuerySchema,
  submitRequirementSchema,
  decideRequirementSchema,
  reasonRequirementSchema,
} from '@myteam/contracts';

const body = (schema: Record<string, unknown>) => ({
  required: true,
  content: { 'application/json': { schema } },
});
const response = (schema: Record<string, unknown>) => ({
  description: '成功',
  content: { 'application/json': { schema } },
});
const pathId = {
  name: 'id',
  in: 'path',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const commandKey = {
  name: 'Idempotency-Key',
  in: 'header',
  required: true,
  schema: { type: 'string', format: 'uuid' },
};
const projectPathId = { ...pathId, name: 'projectId' };
const collaborationParameters = [
  projectPathId,
  {
    ...pathId,
    name: 'targetType',
    schema: {
      type: 'string',
      enum: [
        'PROJECT',
        'ITERATION',
        'REQUIREMENT',
        'TASK',
        'TEST_CASE',
        'RELEASE',
        'SUBMISSION',
        'TEST_RUN',
        'DEFECT',
      ],
    },
  },
  { ...pathId, name: 'targetId' },
];
const securedGet = (summary: string, schema: Record<string, unknown>) => ({
  summary,
  security: [{ session: [] }],
  parameters: [pathId],
  responses: { '200': response(schema) },
});
const securedCommand = (
  summary: string,
  schema: Record<string, unknown>,
  parameters: Record<string, unknown>[] = [pathId, commandKey],
) => ({
  summary,
  security: [{ session: [], csrf: [] }],
  parameters,
  requestBody: body(schema),
  responses: {
    '201': { description: '操作已完成' },
    '403': response(jsonSchema(errorResponseSchema)),
    '409': response(jsonSchema(errorResponseSchema)),
  },
});

const queryParameters = (schema: Parameters<typeof jsonSchema>[0]) => {
  const definition = jsonSchema(schema) as { properties?: Record<string, Record<string, unknown>> };
  return Object.entries(definition.properties ?? {}).map(([name, value]) => ({
    name,
    in: 'query',
    schema: value,
  }));
};

const qualityPaths: Record<string, unknown> = {};
const qualityPrefix = '/projects/{projectId}/quality';
for (const [kind, list, detail, input] of [
  ['releases', quality.releaseListSchema, quality.releaseDetailSchema, quality.createReleaseSchema],
  ['builds', quality.buildListSchema, null, quality.createBuildSchema],
  [
    'records',
    quality.testRecordListSchema,
    quality.testRecordDetailSchema,
    quality.createTestRecordSchema,
  ],
  ['defects', quality.defectListSchema, quality.defectDetailSchema, quality.createDefectSchema],
] as const) {
  qualityPaths[`${qualityPrefix}/${kind}`] = {
    get: {
      ...securedGet(`分页查询${kind}`, jsonSchema(list)),
      parameters: [
        projectPathId,
        ...queryParameters(
          kind === 'records' ? quality.testRecordQuerySchema : quality.qualityQuerySchema,
        ),
      ],
    },
    ...(input
      ? { post: securedCommand(`创建${kind}`, jsonSchema(input), [projectPathId, commandKey]) }
      : {}),
  };
  if (detail)
    qualityPaths[`${qualityPrefix}/${kind}/{id}`] = {
      get: {
        ...securedGet(`查看${kind}详情与分页历史`, jsonSchema(detail)),
        parameters: [projectPathId, pathId, ...queryParameters(quality.paginationSchema)],
      },
    };
}
for (const [kind, actions] of [
  ['releases', { update: quality.updateReleaseSchema }],
  ['records', { finish: quality.finishTestRecordSchema }],
  [
    'defects',
    {
      confirm: quality.qualityReasonSchema,
      assign: quality.assignDefectSchema,
      start: quality.qualityReasonSchema,
      fix: quality.fixDefectSchema,
      retest: quality.retestDefectSchema,
      reopen: quality.qualityReasonSchema,
      dispose: quality.disposeDefectSchema,
      link: quality.linkDefectResultSchema,
    },
  ],
] as const) {
  for (const [action, schema] of Object.entries(actions))
    qualityPaths[`${qualityPrefix}/${kind}/{id}/${action}`] = {
      post: securedCommand(`${kind}.${action}`, jsonSchema(schema), [
        projectPathId,
        pathId,
        commandKey,
      ]),
    };
}
for (const [name, schema] of [
  ['options', quality.qualityOptionsQuerySchema],
  ['people', quality.qualityPeopleQuerySchema],
] as const)
  qualityPaths[`${qualityPrefix}/${name}`] = {
    get: {
      ...securedGet('分页查询授权候选对象', jsonSchema(quality.qualityOptionsSchema)),
      parameters: [projectPathId, ...queryParameters(schema)],
    },
  };
@Controller('openapi.json')
export class OpenApiController {
  @Get() document() {
    return {
      openapi: '3.0.3',
      info: { title: 'MyTeam API', version: '0.1.0' },
      servers: [{ url: '/api/v1' }],
      components: {
        securitySchemes: {
          session: {
            type: 'apiKey',
            in: 'cookie',
            name: process.env.SESSION_COOKIE ?? 'myteam_session',
          },
          csrf: { type: 'apiKey', in: 'header', name: 'X-CSRF-Token' },
        },
        schemas: {
          Login: jsonSchema(loginSchema),
          Session: jsonSchema(sessionResponseSchema),
          Error: jsonSchema(errorResponseSchema),
          UserStatus: jsonSchema(userStatusSchema),
          TestCaseExecutionSnapshot: jsonSchema(testCaseExecutionSnapshotSchema),
        },
      },
      paths: {
        ...qualityPaths,
        '/projects/{projectId}/requirements': {
          get: {
            ...securedGet('分页查询项目需求', jsonSchema(requirementListSchema)),
            parameters: [projectPathId, ...queryParameters(requirementQuerySchema)],
          },
          post: securedCommand('创建需求草稿', jsonSchema(createRequirementSchema), [
            projectPathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases': {
          get: {
            ...securedGet('分页查询用例库及当前可用修订', jsonSchema(testCaseListSchema)),
            parameters: [projectPathId, ...queryParameters(testCaseQuerySchema)],
          },
          post: securedCommand('创建已确认需求的用例草稿', jsonSchema(createTestCaseSchema), [
            projectPathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/people': {
          get: {
            ...securedGet('分页查询用例负责人及评审人', jsonSchema(testCasePeopleSchema)),
            parameters: [projectPathId, ...queryParameters(testCasePeopleQuerySchema)],
          },
        },
        '/projects/{projectId}/test-cases/requirements': {
          get: {
            ...securedGet(
              '分页查询可关联的已确认需求',
              jsonSchema(testCaseRequirementOptionsSchema),
            ),
            parameters: [
              projectPathId,
              ...queryParameters(testCaseQuerySchema.pick({ q: true, page: true, pageSize: true })),
            ],
          },
        },
        '/projects/{projectId}/test-cases/{id}': {
          get: {
            ...securedGet('用例详情与独立分页修订、评审历史', jsonSchema(testCaseDetailSchema)),
            parameters: [
              projectPathId,
              pathId,
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
              { name: 'revisionPage', in: 'query', schema: { type: 'integer', minimum: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100 },
              },
            ],
          },
        },
        '/projects/{projectId}/test-cases/{id}/update': {
          post: securedCommand('保存草稿并保留内容修订', jsonSchema(updateTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/revise': {
          post: securedCommand('已通过用例发起修订', jsonSchema(reviseTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/submit': {
          post: securedCommand('指定评审人并提交用例', jsonSchema(submitTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/approve': {
          post: securedCommand('校验需求基线并通过评审', jsonSchema(decideTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/return': {
          post: securedCommand('附原因退回用例', jsonSchema(reasonTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/withdraw': {
          post: securedCommand('附原因撤回评审', jsonSchema(reasonTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/test-cases/{id}/deprecate': {
          post: securedCommand('附原因废弃用例', jsonSchema(reasonTestCaseSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/people': {
          get: {
            ...securedGet('分页查询可选负责人或评审人', jsonSchema(requirementPeopleSchema)),
            parameters: [projectPathId, ...queryParameters(requirementPeopleQuerySchema)],
          },
        },
        '/projects/{projectId}/requirements/{id}': {
          get: {
            ...securedGet(
              '需求详情、测试准备统计及独立分页用例/任务/评审历史',
              jsonSchema(requirementDetailSchema),
            ),
            parameters: [
              projectPathId,
              pathId,
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
              { name: 'casePage', in: 'query', schema: { type: 'integer', minimum: 1 } },
              { name: 'taskPage', in: 'query', schema: { type: 'integer', minimum: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100 },
              },
            ],
          },
        },
        '/projects/{projectId}/requirements/{id}/revise': {
          post: securedCommand('发起新修订并使旧依据失效', jsonSchema(reviseRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks/board': {
          get: {
            ...securedGet('分列分页查询任务看板', jsonSchema(taskBoardSchema)),
            parameters: [projectPathId, ...queryParameters(taskBoardQuerySchema)],
          },
        },
        '/projects/{projectId}/tasks/{id}/block': {
          post: securedCommand('记录阻塞原因与协助人', jsonSchema(blockTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks/{id}/resume': {
          post: securedCommand('按当前依据恢复阻塞任务', jsonSchema(reasonTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        ...Object.fromEntries(
          ['complete', 'reopen', 'reset'].map((action) => [
            `/projects/{projectId}/tasks/{id}/${action}`,
            {
              post: securedCommand(`任务状态：${action}`, jsonSchema(reasonTaskSchema), [
                projectPathId,
                pathId,
                commandKey,
              ]),
            },
          ]),
        ),
        '/projects/{projectId}/tasks/{id}/acknowledge': {
          post: securedCommand('核对指定需求修订对任务的影响', jsonSchema(acknowledgeTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/update': {
          post: securedCommand('保存需求草稿', jsonSchema(updateRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/submit': {
          post: securedCommand('指定评审人并提交快照', jsonSchema(submitRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/approve': {
          post: securedCommand('指定评审人确认当前基线', jsonSchema(decideRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/return': {
          post: securedCommand('附原因退回修改', jsonSchema(reasonRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/withdraw': {
          post: securedCommand('附原因撤回本轮评审', jsonSchema(reasonRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/requirements/{id}/cancel': {
          post: securedCommand('附原因取消草稿', jsonSchema(reasonRequirementSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks': {
          get: {
            ...securedGet('分页查询授权任务', jsonSchema(taskListSchema)),
            parameters: [projectPathId, ...queryParameters(taskQuerySchema)],
          },
          post: securedCommand('在需求下拆分任务', jsonSchema(createTaskSchema), [
            projectPathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks/people': {
          get: {
            ...securedGet('分页查询可分配成员', jsonSchema(taskPeopleSchema)),
            parameters: [projectPathId, ...queryParameters(taskPeopleQuerySchema)],
          },
        },
        '/projects/{projectId}/tasks/requirements': {
          get: {
            ...securedGet('分页查询可拆分需求', jsonSchema(taskRequirementOptionsSchema)),
            parameters: [
              projectPathId,
              ...queryParameters(requirementPeopleQuerySchema.omit({ purpose: true })),
            ],
          },
        },
        '/projects/{projectId}/tasks/{id}': {
          get: {
            ...securedGet('任务详情及分页历史', jsonSchema(taskDetailSchema)),
            parameters: [
              projectPathId,
              pathId,
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100 },
              },
            ],
          },
        },
        '/projects/{projectId}/tasks/{id}/update': {
          post: securedCommand('维护授权任务', jsonSchema(updateTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks/{id}/assign': {
          post: securedCommand('分配、改派或认领任务', jsonSchema(assignTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/tasks/{id}/start': {
          post: securedCommand('校验开始条件并开始任务', jsonSchema(startTaskSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/auth/csrf': {
          get: {
            summary: '获取页面 CSRF 凭据',
            responses: { '200': response(jsonSchema(csrfResponseSchema)) },
          },
        },
        '/auth/login': {
          post: {
            summary: '登录并轮换会话',
            security: [{ csrf: [] }],
            requestBody: body(jsonSchema(loginSchema)),
            responses: {
              '201': response(jsonSchema(sessionResponseSchema)),
              '401': response(jsonSchema(errorResponseSchema)),
            },
          },
        },
        '/auth/me': {
          get: {
            summary: '读取当前会话',
            security: [{ session: [] }],
            responses: {
              '200': response(jsonSchema(sessionResponseSchema)),
              '401': response(jsonSchema(errorResponseSchema)),
            },
          },
        },
        '/auth/logout': {
          post: {
            summary: '退出并撤销会话',
            security: [{ session: [], csrf: [] }],
            responses: { '201': { description: '会话已撤销' } },
          },
        },
        '/users': {
          post: securedCommand('创建普通账号', jsonSchema(createUserSchema), [commandKey]),
          get: {
            summary: '管理员分页查看账号',
            security: [{ session: [] }],
            parameters: [
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            ],
            responses: { '200': response(jsonSchema(managedUsersSchema)) },
          },
        },
        '/users/{id}/status': {
          post: {
            summary: '管理员启停账号，校验版本并保证幂等',
            security: [{ session: [], csrf: [] }],
            parameters: [
              {
                name: 'id',
                in: 'path',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
              {
                name: 'Idempotency-Key',
                in: 'header',
                required: true,
                schema: { type: 'string', format: 'uuid' },
              },
            ],
            requestBody: body(jsonSchema(userStatusSchema)),
            responses: {
              '201': { description: '账号状态已更新' },
              '409': response(jsonSchema(errorResponseSchema)),
            },
          },
        },
        '/projects': {
          get: {
            ...securedGet('列出授权项目、筛选和真实统计', jsonSchema(projectListSchema)),
            parameters: [
              { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
              {
                name: 'scope',
                in: 'query',
                schema: { type: 'string', enum: ['all', 'owned', 'joined'] },
              },
              { name: 'status', in: 'query', schema: { type: 'string' } },
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100 },
              },
            ],
          },
          post: securedCommand('管理员创建项目', jsonSchema(createProjectSchema), [commandKey]),
        },
        '/projects/{id}': {
          get: securedGet('项目详情和当前可执行操作', jsonSchema(projectSchema)),
        },
        '/projects/{id}/update': {
          post: securedCommand('更新项目与移交主负责人', jsonSchema(updateProjectSchema)),
        },
        '/projects/{id}/status': {
          post: securedCommand('启动、暂停或继续项目', jsonSchema(projectStateCommandSchema)),
        },
        '/projects/{id}/members': {
          get: securedGet('分页读取项目成员', jsonSchema(projectMembersSchema)),
          post: securedCommand('添加已有账号到项目', jsonSchema(addProjectMemberSchema)),
        },
        '/projects/{id}/member-options': {
          get: {
            ...securedGet(
              '搜索可加入项目的有效账号，需成员管理权限',
              jsonSchema(projectMemberOptionsSchema),
            ),
            parameters: [
              pathId,
              { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            ],
          },
        },
        '/projects/{id}/members/{userId}/roles': {
          post: securedCommand('调整项目成员角色', jsonSchema(updateProjectMemberSchema), [
            pathId,
            { ...pathId, name: 'userId' },
            commandKey,
          ]),
        },
        '/projects/{id}/members/{userId}/remove': {
          post: securedCommand('移除项目成员', jsonSchema(versionSchema), [
            pathId,
            { ...pathId, name: 'userId' },
            commandKey,
          ]),
        },
        '/projects/{id}/activity': {
          get: securedGet('读取项目近期操作动态', jsonSchema(projectActivitySchema)),
        },
        '/workbench/todos': {
          get: {
            ...securedGet(
              '当前用户的任务、待评审、协助及迭代跟进',
              jsonSchema(workbenchListSchema),
            ),
            parameters: queryParameters(workbenchQuerySchema),
          },
        },
        '/notifications': {
          get: {
            ...securedGet(
              '当前用户可见通知；unread=true 仅未读',
              jsonSchema(notificationListSchema),
            ),
            parameters: [],
          },
        },
        '/notifications/{id}/read': {
          post: {
            ...securedCommand('将自己的可见通知标为已读', { type: 'object' }),
            requestBody: undefined,
          },
        },
        '/projects/{projectId}/collaboration/{targetType}/{targetId}/comments': {
          get: {
            ...securedGet('分页读取对象评论', jsonSchema(commentListSchema)),
            parameters: collaborationParameters,
          },
          post: securedCommand('发布评论并通知负责人', jsonSchema(createCommentSchema), [
            ...collaborationParameters,
            commandKey,
          ]),
        },
        '/projects/{projectId}/collaboration/{targetType}/{targetId}/attachments': {
          get: {
            ...securedGet('分页读取附件元信息', jsonSchema(attachmentListSchema)),
            parameters: collaborationParameters,
          },
          post: {
            ...securedCommand('上传经内容校验的私有附件，最多 20 MiB', {}, [
              ...collaborationParameters,
              commandKey,
              {
                name: 'filename',
                in: 'query',
                required: true,
                schema: { type: 'string', maxLength: 200 },
              },
            ]),
            requestBody: {
              required: true,
              content: {
                'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
              },
            },
          },
        },
        '/projects/{projectId}/attachments/{id}/download': {
          get: {
            ...securedGet('校验项目和对象权限后流式下载', {}),
            parameters: [projectPathId, pathId],
            responses: {
              '200': {
                description: '作为附件下载',
                content: {
                  'application/octet-stream': { schema: { type: 'string', format: 'binary' } },
                },
              },
            },
          },
        },
        '/projects/{projectId}/iterations': {
          get: {
            ...securedGet('分页筛选项目迭代与真实统计', jsonSchema(iterationListSchema)),
            parameters: [
              projectPathId,
              { name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 } },
              {
                name: 'status',
                in: 'query',
                schema: { type: 'string', enum: ['PLANNING', 'ACTIVE', 'CLOSED'] },
              },
              { name: 'ownerId', in: 'query', schema: { type: 'string', format: 'uuid' } },
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            ],
          },
          post: securedCommand('新建规划迭代', jsonSchema(createIterationSchema), [
            projectPathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/iterations/{id}': {
          get: {
            ...securedGet('迭代详情与分页计划范围', jsonSchema(iterationDetailSchema)),
            parameters: [
              projectPathId,
              pathId,
              { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
              {
                name: 'pageSize',
                in: 'query',
                schema: { type: 'integer', minimum: 1, maximum: 100, default: 20 },
              },
            ],
          },
        },
        '/projects/{projectId}/iterations/{id}/update': {
          post: securedCommand('编辑迭代计划，关闭后只读', jsonSchema(updateIterationSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/iterations/{id}/start': {
          post: securedCommand('启动有明确目标的迭代，项目须进行中', jsonSchema(versionSchema), [
            projectPathId,
            pathId,
            commandKey,
          ]),
        },
        '/projects/{projectId}/iterations/{id}/close': {
          post: securedCommand(
            '检查未完成事项并关闭迭代，保留总结',
            jsonSchema(closeIterationSchema),
            [projectPathId, pathId, commandKey],
          ),
        },
      },
    };
  }
}
