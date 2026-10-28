import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Drawer,
  Empty,
  Input,
  Pagination,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  taskStatusLabels,
  taskPriorityLabels,
  taskPrioritySchema,
  taskStatusSchema,
  hasPermission,
  type Task,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { readPage } from '../../shared/list-state';
import { EmptyPage } from '../../shared/EmptyPage';
import { projectKey } from '../projects/api';
import { RequirementPicker } from '../requirements/RequirementPicker';
import { loadRequirement } from '../requirements/api';
import { CollaborationPanel, formatTime } from '../collaboration/CollaborationPanel';
import { loadTask, loadTasks } from './api';
import { TaskEditor } from './TaskEditor';
import { TaskActionDialog, taskActionLabels, type TaskAction } from './TaskActionDialog';
import { TaskBoard } from './TaskBoard';
import styles from '../requirements/requirements.module.css';
const labels: Record<string, string> = {
  'task.created': '创建任务',
  'task.updated': '更新任务',
  'task.assigned': '调整负责人',
  'task.started': '开始任务',
  'task.block': '标记阻塞',
  'task.resume': '恢复任务',
  'task.cancel': '取消任务',
  'task.acknowledge': '核对需求变更',
};
const fields: Record<string, string> = {
  title: '标题',
  description: '说明',
  priority: '优先级',
  assigneeName: '负责人',
  estimatedHours: '估算工时',
  dueDate: '截止日',
  iterationName: '迭代',
  status: '状态',
  blocked: '阻塞标记',
  blockedReason: '阻塞原因',
  helperName: '协助人',
  basisRevision: '需求依据版本',
};
function HistoryChanges({ details }: { details: Record<string, unknown> | null }) {
  const before = details?.before as Record<string, unknown> | undefined,
    after = details?.after as Record<string, unknown> | undefined;
  const display = (field: string, value: unknown) =>
    value === null || value === undefined || value === ''
      ? '未设置'
      : field === 'priority'
        ? taskPriorityLabels[value as Task['priority']]
        : field === 'status'
          ? taskStatusLabels[value as Task['status']]
          : String(value);
  return (
    <>
      {!!details?.reason && <p className={styles.content}>{String(details.reason)}</p>}
      {before &&
        after &&
        Object.entries(fields)
          .filter(([field]) => before[field] !== after[field])
          .map(([field, label]) => (
            <p key={field} className={styles.content}>
              {label}：{display(field, before[field])} → {display(field, after[field])}
            </p>
          ))}
    </>
  );
}
function Detail({
  id,
  project,
  session,
  onClose,
  onEdit,
  requirementHref,
}: {
  id: string;
  project: Project;
  session: SessionResponse;
  onClose: () => void;
  onEdit: (task: Task) => void;
  requirementHref: (id: string) => string;
}) {
  const [page, setPage] = useState(1),
    [operation, setOperation] = useState<{
      action: TaskAction;
      task: Task;
    } | null>(null);
  const query = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'task', id, page],
    queryFn: ({ signal }) => loadTask(project.id, id, page, signal),
  });
  const task = query.data;
  return (
    <>
      <Drawer open size="min(760px, 100vw)" title="任务详情" onClose={onClose}>
        {query.isPending ? (
          <Skeleton active />
        ) : query.isError || !task ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(query.error)}
            action={<Button onClick={() => void query.refetch()}>重新加载任务</Button>}
          />
        ) : (
          <>
            <span className={styles.code}>{task.code}</span>
            <h2 className={styles.detailTitle}>{task.title}</h2>
            <Space>
              <Tag color={task.status === 'IN_PROGRESS' ? 'blue' : 'default'}>
                {taskStatusLabels[task.status]}
              </Tag>
              <Tag>{taskPriorityLabels[task.priority]}优先级</Tag>
            </Space>
            {task.blocked && (
              <Alert
                type="warning"
                showIcon
                title={`阻塞 · 协助人：${task.helper?.name ?? ''}`}
                description={task.blockedReason}
              />
            )}
            {task.needsRequirementReview && (
              <Alert type="warning" showIcon title="需求已发生修订，请等待重新确认并核对任务影响" />
            )}
            <dl className={styles.facts}>
              <div>
                <dt>负责人</dt>
                <dd>{task.assignee?.name ?? '尚未分配'}</dd>
              </div>
              <div>
                <dt>任务迭代</dt>
                <dd>{task.iteration?.name ?? '暂未安排'}</dd>
              </div>
              <div>
                <dt>估算工时</dt>
                <dd>{task.estimatedHours === null ? '未估算' : `${task.estimatedHours} 小时`}</dd>
              </div>
              <div>
                <dt>截止日期</dt>
                <dd>{task.dueDate ?? '未设置'}</dd>
              </div>
              <div>
                <dt>关联需求</dt>
                <dd>
                  <Link to={requirementHref(task.requirement.id)}>
                    {task.requirement.code} · {task.requirement.title}
                  </Link>
                </dd>
              </div>
              <div>
                <dt>需求状态</dt>
                <dd>
                  {
                    (
                      {
                        DRAFT: '草稿',
                        IN_REVIEW: '待评审',
                        CONFIRMED: '已确认',
                        IMPLEMENTING: '实现中',
                        ACCEPTING: '待测试',
                        TESTING: '测试中',
                        COMPLETED: '已完成',
                        CANCELLED: '已取消',
                      } as const
                    )[task.requirement.status]
                  }
                </dd>
              </div>
            </dl>
            <Space wrap style={{ marginBottom: 20 }}>
              {task.allowedActions.includes('edit') && (
                <Button onClick={() => onEdit(task)}>编辑任务</Button>
              )}
              {(
                [
                  'assign',
                  'claim',
                  'start',
                  'block',
                  'resume',
                  'complete',
                  'reopen',
                  'reset',
                  'acknowledge',
                ] as const
              )
                .filter((value) => task.allowedActions.includes(value))
                .map((value) => (
                  <Button
                    key={value}
                    type={value === 'start' ? 'primary' : 'default'}
                    onClick={() => {
                      setOperation({ action: value, task });
                    }}
                  >
                    {taskActionLabels[value]}
                  </Button>
                ))}
            </Space>
            {task.status === 'TODO' && !task.allowedActions.includes('start') && (
              <Alert
                type="info"
                showIcon
                title="待开始：由任务负责人在需求确认、项目和已安排的任务迭代启动后开始"
              />
            )}
            <Tabs
              items={[
                {
                  key: 'content',
                  label: '任务说明',
                  children: (
                    <>
                      <p className={styles.content}>{task.description || '尚未填写任务说明'}</p>
                      {task.startedAt && (
                        <p className={styles.muted}>开始时间：{formatTime(task.startedAt)}</p>
                      )}
                    </>
                  ),
                },
                {
                  key: 'history',
                  label: `任务历史 (${task.history.total})`,
                  children: (
                    <>
                      {task.history.items.map((record) => (
                        <article className={styles.review} key={record.id}>
                          <strong>{labels[record.action] ?? '更新任务'}</strong> ·{' '}
                          {record.actorName}
                          <p className={styles.muted}>{formatTime(record.createdAt)}</p>
                          <HistoryChanges details={record.details} />
                        </article>
                      ))}
                      <Pagination
                        size="small"
                        current={page}
                        total={task.history.total}
                        pageSize={20}
                        hideOnSinglePage
                        showSizeChanger={false}
                        onChange={setPage}
                      />
                    </>
                  ),
                },
                {
                  key: 'collaboration',
                  label: '讨论与附件',
                  children: (
                    <CollaborationPanel
                      projectId={project.id}
                      target={{ targetType: 'TASK', targetId: id }}
                      session={session}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      <TaskActionDialog
        operation={operation}
        projectId={project.id}
        session={session}
        onClose={() => setOperation(null)}
      />
    </>
  );
}
export function ProjectTasks({ project, session }: { project: Project; session: SessionResponse }) {
  const [params, setParams] = useSearchParams(),
    [editor, setEditor] = useState<Task | 'new' | null>(null);
  const page = readPage(params.get('tp')),
    q = params.get('tq') ?? '',
    id = params.get('task'),
    newRequirementId = params.get('newTask');
  const status = taskStatusSchema.safeParse(params.get('ts')),
    priority = taskPrioritySchema.safeParse(params.get('tpriority'));
  const requirementId = params.get('trequirement'),
    assigneeId = params.get('tassignee'),
    iterationId = params.get('titeration'),
    unassigned = params.get('tunassigned') === 'true';
  const change = (key: string, value?: string | null) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (!['tp', 'task', 'newTask'].includes(key)) next.delete('tp');
      if (key === 'tassignee') next.delete('tunassigned');
      if (key === 'tunassigned') next.delete('tassignee');
      return next;
    });
  const view = params.get('tv') === 'board' ? 'board' : 'list';
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: '20',
    ...(status.success ? { status: status.data } : {}),
    ...(priority.success ? { priority: priority.data } : {}),
    ...(requirementId ? { requirementId } : {}),
    ...(assigneeId ? { assigneeId } : {}),
    ...(iterationId ? { iterationId } : {}),
    ...(unassigned ? { unassigned: 'true' } : {}),
    ...(params.get('tblocked') ? { blocked: params.get('tblocked')! } : {}),
    ...(params.get('toverdue') ? { overdue: params.get('toverdue')! } : {}),
  }).toString();
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'tasks', query],
    queryFn: ({ signal }) => loadTasks(project.id, query, signal),
  });
  const requirement = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'task-initial-requirement',
      newRequirementId,
    ],
    queryFn: ({ signal }) => loadRequirement(project.id, newRequirementId!, 1, signal),
    enabled: !!newRequirementId && !!list.data?.canCreate,
  });
  const closeEditor = () => {
    setEditor(null);
    if (newRequirementId) change('newTask', null);
  };
  const href = (requirement: string) => {
    const next = new URLSearchParams({ tab: 'requirements', requirement });
    if (params.get('list')) next.set('list', params.get('list')!);
    return `/projects/${project.id}?${next}`;
  };
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h2>任务管理</h2>
          <p className={styles.muted}>把需求拆成清晰的行动，安排负责人和交付时间。</p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            aria-label="新建任务"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditor('new')}
          >
            新建任务
          </Button>
        )}
      </div>
      <Space wrap style={{ marginBottom: 16 }}>
        <Button aria-pressed={view === 'list'} onClick={() => change('tv', null)}>
          任务列表
        </Button>
        <Button aria-pressed={view === 'board'} onClick={() => change('tv', 'board')}>
          任务看板
        </Button>
        <Button
          type={params.get('tblocked') === 'true' ? 'primary' : 'default'}
          onClick={() => change('tblocked', params.get('tblocked') ? null : 'true')}
        >
          仅看阻塞
        </Button>
        <Button
          type={params.get('toverdue') === 'true' ? 'primary' : 'default'}
          onClick={() => change('toverdue', params.get('toverdue') ? null : 'true')}
        >
          仅看逾期
        </Button>
      </Space>
      <div className={styles.toolbar}>
        <Input.Search
          aria-label="搜索任务"
          enterButton="搜索"
          onSearch={(value) => change('tq', value.trim())}
          placeholder="搜索任务标题、编号或说明"
          value={q}
          allowClear
          maxLength={100}
          style={{ width: 270 }}
          onChange={(event) => change('tq', event.target.value)}
        />
        <Select
          aria-label="任务状态筛选"
          disabled={view === 'board'}
          placeholder="全部状态"
          allowClear
          style={{ width: 140 }}
          value={status.success ? status.data : undefined}
          options={['TODO', 'IN_PROGRESS', 'COMPLETED'].map((value) => ({
            value,
            label: taskStatusLabels[value as Task['status']],
          }))}
          onChange={(value) => change('ts', value)}
        />
        <Select
          aria-label="任务优先级筛选"
          placeholder="全部优先级"
          allowClear
          style={{ width: 145 }}
          value={priority.success ? priority.data : undefined}
          options={Object.entries(taskPriorityLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => change('tpriority', value)}
        />
        <div style={{ width: 175 }}>
          <RequirementPicker
            aria-label="任务负责人筛选"
            projectId={project.id}
            session={session}
            purpose="filterOwner"
            value={assigneeId}
            onChange={(value) => change('tassignee', value)}
          />
        </div>
        <div style={{ width: 175 }}>
          <RequirementPicker
            aria-label="任务迭代筛选"
            projectId={project.id}
            session={session}
            purpose="filterIteration"
            value={iterationId}
            onChange={(value) => change('titeration', value)}
          />
        </div>
        <Button
          type={unassigned ? 'primary' : 'default'}
          onClick={() => change('tunassigned', unassigned ? null : 'true')}
        >
          待分配任务
        </Button>
        {(q ||
          status.success ||
          priority.success ||
          requirementId ||
          assigneeId ||
          iterationId ||
          unassigned ||
          params.get('tblocked') ||
          params.get('toverdue')) && (
          <Button
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                [
                  'tp',
                  'tq',
                  'ts',
                  'tpriority',
                  'trequirement',
                  'tassignee',
                  'titeration',
                  'tunassigned',
                  'tblocked',
                  'toverdue',
                ].forEach((key) => next.delete(key));
                return next;
              })
            }
          >
            清除任务筛选
          </Button>
        )}
      </div>
      {newRequirementId && requirement.isError && (
        <Alert
          showIcon
          type="error"
          title={errorMessage(requirement.error)}
          action={
            <Space>
              <Button onClick={() => void requirement.refetch()}>重新加载关联需求</Button>
              <Button onClick={closeEditor}>取消拆分任务</Button>
            </Space>
          }
        />
      )}
      {view === 'board' ? (
        <TaskBoard
          project={project}
          session={session}
          query={query}
          onOpen={(id) => change('task', id)}
        />
      ) : list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>重新加载任务列表</Button>}
        />
      ) : list.data && list.data.total > 0 && !list.data.items.length ? (
        <EmptyPage onReset={() => change('tp', null)} />
      ) : (
        <Table<Task>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 900 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的任务" />
            ),
          }}
          columns={[
            {
              title: '任务',
              key: 'title',
              render: (_, task) => (
                <>
                  <span className={styles.code}>{task.code}</span>
                  <Button
                    type="link"
                    className={styles.title}
                    onClick={() => change('task', task.id)}
                  >
                    {task.title}
                  </Button>
                </>
              ),
            },
            {
              title: '状态',
              key: 'status',
              width: 110,
              render: (_, task) => (
                <Tag color={task.status === 'IN_PROGRESS' ? 'blue' : 'default'}>
                  {taskStatusLabels[task.status]}
                </Tag>
              ),
            },
            {
              title: '负责人',
              key: 'assignee',
              width: 120,
              render: (_, task) => task.assignee?.name ?? '待分配',
            },
            {
              title: '估算 / 截止日',
              key: 'plan',
              width: 155,
              render: (_, task) => (
                <>
                  {task.estimatedHours === null ? '未估算' : `${task.estimatedHours} 小时`}
                  <br />
                  <span className={styles.muted}>{task.dueDate ?? '无截止日'}</span>
                </>
              ),
            },
            {
              title: '关联需求',
              key: 'requirement',
              width: 180,
              render: (_, task) => (
                <Link to={href(task.requirement.id)}>{task.requirement.code}</Link>
              ),
            },
            {
              title: '优先级',
              key: 'priority',
              width: 90,
              render: (_, task) => taskPriorityLabels[task.priority],
            },
          ]}
        />
      )}
      {view === 'list' && !!list.data?.total && (
        <Pagination
          style={{ marginTop: 20 }}
          current={page}
          pageSize={20}
          total={list.data.total}
          showSizeChanger={false}
          showTotal={(total) => `共 ${total} 条任务`}
          onChange={(value) => change('tp', String(value))}
        />
      )}
      {id && (
        <Detail
          key={`detail:${id}`}
          id={id}
          project={project}
          session={session}
          onClose={() => change('task', null)}
          onEdit={setEditor}
          requirementHref={href}
        />
      )}
      {(editor || (newRequirementId && requirement.data && list.data?.canCreate)) && (
        <TaskEditor
          key={editor && editor !== 'new' ? `edit:${editor.id}` : `new:${newRequirementId ?? ''}`}
          project={project}
          session={session}
          item={editor && editor !== 'new' ? editor : undefined}
          requirement={newRequirementId ? requirement.data : undefined}
          onClose={closeEditor}
          onCreated={(created) => {
            setEditor(null);
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.delete('newTask');
              next.set('task', created);
              return next;
            });
          }}
        />
      )}
      {!!newRequirementId && !list.isPending && !list.data?.canCreate && !list.isError && (
        <Alert type="info" title="当前角色或项目状态不允许新建任务" />
      )}
      {!list.isPending &&
        list.data?.canCreate &&
        !session.user.isSystemAdmin &&
        !hasPermission(project.myRoles, 'task:assign') && (
          <p className={styles.muted}>
            可认领待分配任务，或维护本人负责的任务；需要改派时请联系项目负责人。
          </p>
        )}
    </>
  );
}
