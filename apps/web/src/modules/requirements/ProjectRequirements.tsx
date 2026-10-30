import { RequirementDocumentPanel } from './RequirementDocumentPanel';
import { DocumentVersionLink } from './DocumentView';
import {
  taskStatusLabels,
  requirementStatusLabels,
  requirementPriorityLabels,
  requirementTypeLabels,
} from '../../i18n/labels';
import { t, localizeLabels, useLocale } from '../../i18n';
import { TestRecordsList } from '../quality/ProjectTestRecords';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Select,
  Skeleton,
  Space,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import {
  hasPermission,
  requirementStatusSchema,
  requirementPrioritySchema,
  requirementTypeSchema,
  type Project,
  type Requirement,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { EmptyPage } from '../../shared/EmptyPage';
import { readPage } from '../../shared/list-state';
import { projectKey, useProjectCommand } from '../projects/api';
import { CollaborationPanel, formatTime } from '../collaboration/CollaborationPanel';
import { loadRequirement, loadRequirements } from './api';
import { RequirementEditor } from './RequirementEditor';
import { RequirementPicker } from './RequirementPicker';
import { PreparationNotice, RequirementCases } from './RequirementTestPreparation';
import styles from './requirements.module.css';
const actionLabels = localizeLabels({
  submit: '提交评审',
  approve: '确认需求',
  return: '退回修改',
  withdraw: '撤回评审',
  cancel: '取消需求',
} as const);
type Action = keyof typeof actionLabels;
const historyLabels = localizeLabels({
  SUBMITTED: '提交评审',
  APPROVED: '确认需求',
  RETURNED: '退回修改',
  WITHDRAWN: '撤回评审',
} as const);
const statusColor = {
  DRAFT: 'default',
  IN_REVIEW: 'orange',
  CONFIRMED: 'green',
  IMPLEMENTING: 'blue',
  ACCEPTING: 'purple',
  TESTING: 'cyan',
  COMPLETED: 'green',
  CANCELLED: 'default',
} as const;
function Status({ item }: { item: Requirement }) {
  useLocale();
  return <Tag color={statusColor[item.status]}>{requirementStatusLabels[item.status]}</Tag>;
}
function Detail({
  id,
  project,
  session,
  onClose,
  onEdit,
}: {
  id: string;
  project: Project;
  session: SessionResponse;
  onClose: () => void;
  onEdit: (item: Requirement) => void;
}) {
  useLocale();
  const [navigationParams] = useSearchParams();
  const taskHref = (newTask: boolean) => {
    const next = new URLSearchParams({
      tab: 'tasks',
      trequirement: id,
      ...(newTask ? { newTask: id } : {}),
    });
    if (navigationParams.get('list')) next.set('list', navigationParams.get('list')!);
    return `/projects/${project.id}?${next}`;
  };
  const [page, setPage] = useState(1);
  const [taskPage, setTaskPage] = useState(1);
  const [casePage, setCasePage] = useState(1);
  const [detailTab, setDetailTab] = useState('content');
  const [operation, setOperation] = useState<{ action: Action; item: Requirement } | null>(null);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const detail = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'requirement',
      id,
      page,
      taskPage,
      casePage,
    ],
    queryFn: ({ signal }) => loadRequirement(project.id, id, page, signal, taskPage, casePage),
  });
  const command = useProjectCommand(session, () => {
    void message.success(t('需求状态已更新'));
    setOperation(null);
  });
  const item = detail.data;
  const action = operation?.action;
  const requiresReason =
    action === 'return' ||
    action === 'withdraw' ||
    action === 'cancel' ||
    (action === 'approve' && operation?.item.reviewer?.id !== session.user.id);
  return (
    <>
      <Drawer open size="min(760px, 100vw)" title={t('需求详情')} onClose={onClose}>
        {detail.isPending ? (
          <Skeleton active />
        ) : detail.isError || !item ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(detail.error)}
            action={<Button onClick={() => void detail.refetch()}>{t('重新加载需求')}</Button>}
          />
        ) : (
          <>
            <span className={styles.code}>
              {item.code} {t(' · 内容版本 ')}
              {item.revision}
            </span>
            <h2 className={styles.detailTitle}>{item.title}</h2>
            <Space wrap>
              <Status item={item} />
              <Tag>{requirementTypeLabels[item.type]}</Tag>
              <Tag>{t('{{0}}优先级', { 0: requirementPriorityLabels[item.priority] })}</Tag>
            </Space>
            <dl className={styles.facts}>
              <div>
                <dt>{t('需求负责人')}</dt>
                <dd>{item.owner?.name ?? t('尚未指定')}</dd>
              </div>
              <div>
                <dt>{t('所属迭代')}</dt>
                <dd>{item.iteration?.name ?? t('暂未安排')}</dd>
              </div>
              <div>
                <dt>{t('评审人')}</dt>
                <dd>{item.reviewer?.name ?? t('提交时指定')}</dd>
              </div>
              <div>
                <dt>{t('最近更新')}</dt>
                <dd>{formatTime(item.updatedAt)}</dd>
              </div>
            </dl>
            <Space wrap style={{ marginBottom: 20 }}>
              {item.allowedActions.includes('revise') && (
                <Button onClick={() => onEdit(item)}>{t('修订需求')}</Button>
              )}
              {item.allowedActions.includes('edit') && (
                <Button onClick={() => onEdit(item)}>{t('编辑需求')}</Button>
              )}
              {(['submit', 'approve', 'return', 'withdraw', 'cancel'] as const)
                .filter((value) => item.allowedActions.includes(value))
                .map((value) => (
                  <Button
                    key={value}
                    type={value === 'submit' || value === 'approve' ? 'primary' : 'default'}
                    danger={value === 'cancel'}
                    onClick={() => {
                      command.reset();
                      form.resetFields();
                      setOperation({ action: value, item });
                    }}
                  >
                    {actionLabels[value]}
                  </Button>
                ))}
            </Space>
            {['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
              item.status,
            ) && (
              <Alert
                type="success"
                showIcon
                title={t('需求已确认，评审基线已保留')}
                description={t('当前基线受保护，需要调整时请发起新修订并重新评审。')}
              />
            )}
            <Space wrap style={{ marginBottom: 16 }}>
              <Link to={taskHref(false)}>
                <Button>{t('查看关联任务')}</Button>
              </Link>
              {[
                'DRAFT',
                'IN_REVIEW',
                'CONFIRMED',
                'IMPLEMENTING',
                'ACCEPTING',
                'TESTING',
                'COMPLETED',
              ].includes(item.status) &&
                !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(project.status) &&
                (session.user.isSystemAdmin || hasPermission(project.myRoles, 'task:write')) && (
                  <Link to={taskHref(true)}>
                    <Button>{t('拆分任务')}</Button>
                  </Link>
                )}
            </Space>
            {['CONFIRMED', 'IMPLEMENTING', 'ACCEPTING', 'TESTING', 'COMPLETED'].includes(
              item.status,
            ) &&
              !['ACCEPTING', 'COMPLETED', 'ARCHIVED'].includes(project.status) &&
              (session.user.isSystemAdmin || hasPermission(project.myRoles, 'case:write')) && (
                <Link
                  to={`/projects/${project.id}?${new URLSearchParams({ tab: 'test-cases', newCase: item.id, crequirement: item.id, ...(navigationParams.get('list') ? { list: navigationParams.get('list')! } : {}) })}`}
                >
                  <Button style={{ marginTop: 12 }}>{t('为此需求创建用例')}</Button>
                </Link>
              )}
            <PreparationNotice item={item} />
            <Tabs
              className={styles.detailTabs}
              activeKey={detailTab}
              onChange={setDetailTab}
              items={[
                {
                  key: 'content',
                  label: t('需求内容'),
                  children: (
                    <>
                      <h3>{t('需求描述')}</h3>
                      <p className={styles.content}>{item.description || t('尚未填写需求描述')}</p>
                      <h3>{t('验收标准')}</h3>
                      <p className={styles.content}>
                        {item.acceptanceCriteria || t('尚未填写验收标准')}
                      </p>
                    </>
                  ),
                },
                {
                  key: 'document',
                  label: t('需求文档'),
                  children: (
                    <RequirementDocumentPanel
                      projectId={project.id}
                      requirementId={id}
                      session={session}
                    />
                  ),
                },
                {
                  key: 'cases',
                  label: t('关联用例 ({{0}})', { '0': item.cases.total }),
                  children: (
                    <RequirementCases
                      item={item}
                      projectId={project.id}
                      listContext={navigationParams.get('list')}
                      onPage={setCasePage}
                    />
                  ),
                },
                {
                  key: 'records',
                  label: t('测试记录'),
                  children: (
                    <TestRecordsList project={project} session={session} requirementId={item.id} />
                  ),
                },
                {
                  key: 'tasks',
                  label: t('关联任务 ({{0}})', { '0': item.taskSummary.total }),
                  children: (
                    <>
                      <p>
                        {t('待开始 ')}
                        {item.taskSummary.todo} {t(' · 进行中 ')}
                        {item.taskSummary.inProgress} {t(' · 完成')} {item.taskSummary.completed}{' '}
                        {t(' · 阻塞 ')}
                        {item.taskSummary.blocked}
                      </p>
                      {!item.tasks.total ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t('尚未拆分任务')}
                        />
                      ) : (
                        item.tasks.items.map((task) => (
                          <article className={styles.review} key={task.id}>
                            <Link
                              to={`/projects/${project.id}?tab=tasks&task=${task.id}${navigationParams.get('list') ? `&list=${encodeURIComponent(navigationParams.get('list')!)}` : ''}`}
                            >
                              {task.code} · {task.title}
                            </Link>
                            <p>
                              {taskStatusLabels[task.status]}
                              {task.blocked ? t(' · 阻塞') : ''} ·{' '}
                              {task.assignee?.name ?? t('待分配')} · {task.dueDate ?? t('无截止日')}
                            </p>
                          </article>
                        ))
                      )}
                      <Pagination
                        size="small"
                        current={taskPage}
                        pageSize={20}
                        total={item.tasks.total}
                        hideOnSinglePage
                        showSizeChanger={false}
                        onChange={setTaskPage}
                      />
                    </>
                  ),
                },
                {
                  key: 'changes',
                  label: t('修订与影响 ({{0}})', { '0': item.changes.total }),
                  children: (
                    <>
                      {item.baseline && (
                        <details>
                          <summary>
                            {t('查看最近确认基线 · 版本 ')}
                            {item.baseline.revision}
                          </summary>
                          <h4>{item.baseline.title}</h4>
                          <p className={styles.content}>{item.baseline.description}</p>
                          <h4>{t('验收标准')}</h4>
                          <p className={styles.content}>{item.baseline.acceptanceCriteria}</p>
                        </details>
                      )}
                      {!item.changes.total ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t('尚未发起基线修订')}
                        />
                      ) : (
                        item.changes.items.map((change) => (
                          <article key={change.id} className={styles.review}>
                            <strong>
                              {t('版本 ')}
                              {change.fromRevision} → {change.toRevision}
                            </strong>{' '}
                            · {change.actor.name}
                            <p className={styles.muted}>{formatTime(change.createdAt)}</p>
                            <h4>{t('修订原因')}</h4>
                            <p className={styles.content}>{change.reason}</p>
                            <h4>{t('影响范围与处理安排')}</h4>
                            <p className={styles.content}>{change.impact}</p>
                            <p>
                              {t('影响 ')}
                              {change.affectedTaskIds.length}{' '}
                              {t('项任务；用例需复审，旧验收及发布检查依据已失效。')}
                            </p>
                            <details>
                              <summary>{t('查看修订前后快照')}</summary>
                              <DocumentVersionLink
                                projectId={project.id}
                                requirementId={id}
                                document={change.before.document}
                              />
                              <h4>{t('原验收标准')}</h4>
                              <p className={styles.content}>{change.before.acceptanceCriteria}</p>
                              <DocumentVersionLink
                                projectId={project.id}
                                requirementId={id}
                                document={change.after.document}
                              />
                              <h4>{t('新验收标准')}</h4>
                              <p className={styles.content}>{change.after.acceptanceCriteria}</p>
                              <h4>{t('原需求描述')}</h4>
                              <p className={styles.content}>{change.before.description}</p>
                              <h4>{t('新需求描述')}</h4>
                              <p className={styles.content}>{change.after.description}</p>
                            </details>
                          </article>
                        ))
                      )}
                      <Pagination
                        size="small"
                        current={page}
                        pageSize={20}
                        total={item.changes.total}
                        hideOnSinglePage
                        showSizeChanger={false}
                        onChange={setPage}
                      />
                    </>
                  ),
                },
                {
                  key: 'history',
                  label: t('评审历史 ({{0}})', { '0': item.history.total }),
                  children: (
                    <>
                      {!item.history.total ? (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t('提交评审后，将在这里保留每轮意见和需求快照')}
                        />
                      ) : (
                        item.history.items.map((record) => (
                          <article className={styles.review} key={record.id}>
                            <Space wrap>
                              <Tag>
                                {t('第 ')}
                                {record.round} {t(' 轮')}
                              </Tag>
                              <strong>{historyLabels[record.action]}</strong>
                              <span>{record.actor.name}</span>
                            </Space>
                            <p className={styles.muted}>
                              {t('评审人：')}
                              {record.reviewer.name} · {formatTime(record.createdAt)}
                            </p>
                            <p className={styles.content}>{record.comment || t('未补充意见')}</p>
                            <details>
                              <summary>
                                {t('查看本轮需求快照 · 版本 ')}
                                {record.revision}
                              </summary>
                              <h4>
                                {record.snapshot.code} · {record.snapshot.title}
                              </h4>
                              <p className={styles.muted}>
                                {requirementTypeLabels[record.snapshot.type]} ·{' '}
                                {requirementPriorityLabels[record.snapshot.priority]}
                                {t('优先级 · 负责人：')}
                                {record.snapshot.owner?.name ?? t('未指定')} {t(' · 迭代：')}
                                {record.snapshot.iteration?.name ?? t('未安排')}
                              </p>
                              <DocumentVersionLink
                                projectId={project.id}
                                requirementId={id}
                                document={record.snapshot.document}
                              />
                              <h4>{t('需求描述')}</h4>
                              <p className={styles.content}>{record.snapshot.description}</p>
                              <h4>{t('验收标准')}</h4>
                              <p className={styles.content}>{record.snapshot.acceptanceCriteria}</p>
                            </details>
                          </article>
                        ))
                      )}
                      <Pagination
                        size="small"
                        current={page}
                        total={item.history.total}
                        pageSize={20}
                        hideOnSinglePage
                        showSizeChanger={false}
                        onChange={setPage}
                      />
                    </>
                  ),
                },
                {
                  key: 'discussion',
                  label: t('讨论与附件'),
                  children: (
                    <CollaborationPanel
                      projectId={project.id}
                      target={{ targetType: 'REQUIREMENT', targetId: id }}
                      session={session}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      <Modal
        zIndex={1200}
        open={!!operation}
        title={action && actionLabels[action]}
        onCancel={() => setOperation(null)}
        onOk={() => form.submit()}
        confirmLoading={command.isPending}
        okText={action && actionLabels[action]}
        okButtonProps={{ 'aria-label': action ? actionLabels[action] : undefined }}
        cancelText={t('取消')}
        forceRender
      >
        {action === 'submit' ? (
          <p className={styles.muted}>
            {t('本轮评审将保存当前需求内容。请指定评审人，由对方确认或退回修改。')}
          </p>
        ) : (
          <p className={styles.muted}>
            {action === 'approve'
              ? t('确认当前需求内容及验收标准，本轮内容将作为需求基线保留。')
              : action === 'cancel'
                ? t('取消后将保留记录，并从迭代未完成工作中移除。')
                : t('请记录原因，方便团队接续修改和安排。')}
          </p>
        )}
        {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
        <Form
          form={form}
          layout="vertical"
          onFinish={(values: { reviewerId?: string; comment?: string }) =>
            operation &&
            command.mutate({
              path: `/projects/${project.id}/requirements/${id}/${operation.action}`,
              input: { ...values, version: operation.item.version },
            })
          }
        >
          {action === 'submit' && (
            <Form.Item
              name="reviewerId"
              label={t('指定评审人')}
              rules={[{ required: true, message: t('请选择评审人') }]}
            >
              <RequirementPicker projectId={project.id} session={session} purpose="reviewer" />
            </Form.Item>
          )}
          <Form.Item
            name="comment"
            label={requiresReason ? t('原因 / 评审意见') : t('补充说明')}
            rules={
              requiresReason
                ? [{ required: true, whitespace: true, message: t('请填写原因或评审意见') }]
                : []
            }
          >
            <Input.TextArea rows={4} maxLength={2000} showCount />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
export function ProjectRequirements({
  project,
  session,
}: {
  project: Project;
  session: SessionResponse;
}) {
  useLocale();
  const [params, setParams] = useSearchParams();
  const [search, setSearch] = useState(params.get('rq') ?? '');
  const [editor, setEditor] = useState<Requirement | 'new' | null>(null);
  const q = params.get('rq') ?? '';
  const page = readPage(params.get('rp'));
  const status = requirementStatusSchema.safeParse(params.get('rs'));
  const priority = requirementPrioritySchema.safeParse(params.get('rpriority'));
  const type = requirementTypeSchema.safeParse(params.get('rtype'));
  const ownerId = params.get('rowner') ?? '';
  const iterationId = params.get('riteration') ?? '';
  const id = params.get('requirement');
  const set = (key: string, value?: string | null) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'requirement' && key !== 'rp') next.delete('rp');
      return next;
    });
  useEffect(() => setSearch(q), [q]);
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: '20',
    ...(status.success ? { status: status.data } : {}),
    ...(priority.success ? { priority: priority.data } : {}),
    ...(type.success ? { type: type.data } : {}),
    ...(ownerId ? { ownerId } : {}),
    ...(iterationId ? { iterationId } : {}),
  }).toString();
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'requirements', query],
    queryFn: ({ signal }) => loadRequirements(project.id, query, signal),
  });
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h2>{t('需求管理')}</h2>
          <p className={styles.muted}>{t('把想法写清楚，让评审结论有据可查。')}</p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            aria-label={t('新建需求')}
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditor('new')}
          >
            {t('新建需求')}
          </Button>
        )}
      </div>
      <div className={styles.toolbar}>
        <Input
          style={{ width: 250 }}
          prefix={<SearchOutlined />}
          aria-label={t('搜索需求')}
          placeholder={t('搜索标题、编号或描述')}
          value={search}
          maxLength={100}
          allowClear
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) set('rq', null);
          }}
          onPressEnter={() => set('rq', search.trim())}
        />
        <Button aria-label={t('搜索')} onClick={() => set('rq', search.trim())}>
          {t('搜索')}
        </Button>
        <Select
          aria-label={t('需求状态筛选')}
          placeholder={t('全部状态')}
          allowClear
          style={{ width: 130 }}
          value={status.success ? status.data : undefined}
          options={Object.entries(requirementStatusLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => set('rs', value)}
        />
        <Select
          aria-label={t('需求优先级筛选')}
          placeholder={t('全部优先级')}
          allowClear
          style={{ width: 140 }}
          value={priority.success ? priority.data : undefined}
          options={Object.entries(requirementPriorityLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => set('rpriority', value)}
        />
        <Select
          aria-label={t('需求类型筛选')}
          placeholder={t('全部类型')}
          allowClear
          style={{ width: 140 }}
          value={type.success ? type.data : undefined}
          options={Object.entries(requirementTypeLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => set('rtype', value)}
        />
        <div style={{ width: 175 }}>
          <RequirementPicker
            aria-label={t('需求负责人筛选')}
            projectId={project.id}
            session={session}
            purpose="filterOwner"
            value={ownerId || null}
            onChange={(value) => set('rowner', value)}
          />
        </div>
        <div style={{ width: 175 }}>
          <RequirementPicker
            aria-label={t('需求迭代筛选')}
            projectId={project.id}
            session={session}
            purpose="filterIteration"
            value={iterationId || null}
            onChange={(value) => set('riteration', value)}
          />
        </div>
        {(q || status.success || priority.success || type.success || ownerId || iterationId) && (
          <Button
            type="link"
            onClick={() =>
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                ['rq', 'rs', 'rpriority', 'rtype', 'rowner', 'riteration', 'rp'].forEach((key) =>
                  next.delete(key),
                );
                return next;
              })
            }
          >
            {t('清除筛选')}
          </Button>
        )}
      </div>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{t('重新加载需求列表')}</Button>}
        />
      ) : list.data && list.data.total > 0 && !list.data.items.length ? (
        <EmptyPage onReset={() => set('rp', null)} />
      ) : (
        <Table<Requirement>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 800 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无符合条件的需求')} />
            ),
          }}
          columns={[
            {
              title: t('需求'),
              key: 'title',
              render: (_, item) => (
                <>
                  <span className={styles.code}>{item.code}</span>
                  <Button
                    type="link"
                    className={styles.title}
                    onClick={() => set('requirement', item.id)}
                  >
                    {item.title}
                  </Button>
                </>
              ),
            },
            {
              title: t('状态'),
              key: 'status',
              width: 110,
              render: (_, item) => <Status item={item} />,
            },
            {
              title: t('优先级'),
              dataIndex: 'priority',
              width: 90,
              render: (value: Requirement['priority']) => requirementPriorityLabels[value],
            },
            {
              title: t('负责人'),
              key: 'owner',
              width: 120,
              render: (_, item) => item.owner?.name ?? t('未指定'),
            },
            {
              title: t('迭代'),
              key: 'iteration',
              width: 180,
              render: (_, item) => item.iteration?.name ?? t('未安排'),
            },
          ]}
        />
      )}
      {!!list.data?.total && (
        <Pagination
          style={{ marginTop: 20, textAlign: 'right' }}
          current={page}
          pageSize={20}
          total={list.data.total}
          showSizeChanger={false}
          showTotal={(total) => t('共 {{0}} 条需求', { '0': total })}
          onChange={(value) => set('rp', String(value))}
        />
      )}
      {id && (
        <Detail
          key={`detail:${id}`}
          id={id}
          project={project}
          session={session}
          onClose={() => set('requirement', null)}
          onEdit={setEditor}
        />
      )}
      {editor && (
        <RequirementEditor
          key={editor === 'new' ? 'new' : `edit:${editor.id}`}
          project={project}
          session={session}
          item={editor === 'new' ? undefined : editor}
          revision={editor !== 'new' && editor.allowedActions.includes('revise')}
          onClose={() => setEditor(null)}
          onCreated={(createdId) => set('requirement', createdId)}
        />
      )}
    </>
  );
}
