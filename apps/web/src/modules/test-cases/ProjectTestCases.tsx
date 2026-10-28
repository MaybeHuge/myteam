import {
  CreateTestRecord,
  TestRecordsList,
  canTest,
  RecordStatus,
} from '../quality/ProjectTestRecords';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams, useNavigate } from 'react-router';
import { z } from 'zod';
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
  testCaseStatusSchema,
  testCaseStatusLabels,
  requirementPrioritySchema,
  requirementPriorityLabels,
  type Project,
  type TestCase,
  type SessionResponse,
  type testCaseSnapshotSchema,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { EmptyPage } from '../../shared/EmptyPage';
import { readPage } from '../../shared/list-state';
import { projectKey, useProjectCommand } from '../projects/api';
import { RequirementPicker } from '../requirements/RequirementPicker';
import { CollaborationPanel, formatTime } from '../collaboration/CollaborationPanel';
import { CasePicker } from './CasePicker';
import { CaseEditor } from './CaseEditor';
import { loadTestCase, loadTestCases } from './api';
import styles from './test-cases.module.css';
const actionLabels = {
  submit: '提交用例评审',
  approve: '通过用例评审',
  return: '退回用例',
  withdraw: '撤回用例评审',
  deprecate: '废弃用例',
} as const;
type Action = keyof typeof actionLabels;
const historyLabels = {
  SUBMITTED: '提交评审',
  APPROVED: '评审通过',
  RETURNED: '退回修改',
  WITHDRAWN: '撤回评审',
} as const;
function Status({ item }: { item: TestCase }) {
  return (
    <Space wrap>
      <Tag
        color={
          item.status === 'READY' && !item.needsReview
            ? 'green'
            : item.status === 'IN_REVIEW'
              ? 'orange'
              : 'default'
        }
      >
        {item.status === 'READY' && item.needsReview
          ? '待重新评审'
          : testCaseStatusLabels[item.status]}
      </Tag>
      {item.needsReview && item.status !== 'READY' && item.status !== 'DEPRECATED' && (
        <Tag color="warning">需求基线已变化</Tag>
      )}
    </Space>
  );
}
function Content({ snapshot }: { snapshot: z.infer<typeof testCaseSnapshotSchema> }) {
  return (
    <>
      <h3>前置条件</h3>
      <p className={styles.content}>{snapshot.preconditions || '未填写'}</p>
      <h3>步骤与预期</h3>
      {!snapshot.steps.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚未编写步骤" />
      )}
      {snapshot.steps.map((step, index) => (
        <section key={index} className={styles.step}>
          <strong>步骤 {index + 1}</strong>
          <h4>操作</h4>
          <p className={styles.content}>{step.action || '未填写'}</p>
          <h4>预期结果</h4>
          <p className={styles.content}>{step.expected || '未填写'}</p>
        </section>
      ))}
    </>
  );
}
function CaseAction({
  item,
  action,
  project,
  session,
  onClose,
}: {
  item: TestCase;
  action: Action;
  project: Project;
  session: SessionResponse;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand(session, () => {
    void message.success('用例状态已更新');
    onClose();
  });
  const reasonRequired =
    ['return', 'withdraw', 'deprecate'].includes(action) ||
    (action === 'approve' && item.reviewer?.id !== session.user.id);
  return (
    <Modal
      open
      title={actionLabels[action]}
      zIndex={1200}
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={command.isPending}
      okText={actionLabels[action]}
      okButtonProps={{ 'aria-label': actionLabels[action] }}
      cancelText="取消"
    >
      <p>
        「{item.title}」· 修订 {item.revision}
      </p>
      {action === 'deprecate' && (
        <Alert type="warning" showIcon title="废弃后不可再次使用，修订内容和评审历史仍可查看。" />
      )}
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      <Form
        form={form}
        layout="vertical"
        onFinish={(values: { reviewerId?: string; comment?: string }) =>
          command.mutate({
            path: `/projects/${project.id}/test-cases/${item.id}/${action}`,
            input: { ...values, comment: values.comment ?? '', version: item.version },
          })
        }
      >
        {action === 'submit' && (
          <Form.Item
            name="reviewerId"
            label="用例评审人"
            rules={[{ required: true, message: '请选择评审人' }]}
          >
            <CasePicker projectId={project.id} session={session} purpose="reviewer" />
          </Form.Item>
        )}
        <Form.Item
          name="comment"
          label={reasonRequired ? '处理原因' : '评审说明'}
          rules={
            reasonRequired ? [{ required: true, whitespace: true, message: '请填写处理原因' }] : []
          }
        >
          <Input.TextArea rows={3} maxLength={2000} />
        </Form.Item>
      </Form>
    </Modal>
  );
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
  onEdit: (item: TestCase) => void;
}) {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const [creatingRecord, setCreatingRecord] = useState(false);
  const [page, setPage] = useState(1),
    [revisionPage, setRevisionPage] = useState(1);
  const [operation, setOperation] = useState<{ action: Action; item: TestCase } | null>(null);
  const detail = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'test-case', id, page, revisionPage],
    queryFn: ({ signal }) => loadTestCase(project.id, id, page, revisionPage, signal),
  });
  const item = detail.data;
  return (
    <>
      {creatingRecord && item && (
        <CreateTestRecord
          project={project}
          session={session}
          seed={{
            testCaseId: item.id,
            requirementId: item.requirements.length === 1 ? item.requirements[0]?.id : undefined,
            type: ['FAILED', 'RETEST'].includes(item.testResult) ? 'RETEST' : 'INITIAL',
          }}
          onClose={() => setCreatingRecord(false)}
          onCreated={(id) => navigate(`/projects/${project.id}?tab=records&record=${id}`)}
        />
      )}
      <Drawer open size="min(780px, 100vw)" title="用例详情" onClose={onClose}>
        {detail.isPending ? (
          <Skeleton active />
        ) : detail.isError || !item ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(detail.error)}
            action={<Button onClick={() => void detail.refetch()}>重新加载用例</Button>}
          />
        ) : (
          <>
            <span className={styles.code}>
              {item.code} · 当前修订 {item.revision}
            </span>
            <h2 className={styles.detailTitle}>{item.title}</h2>
            <Status item={item} />
            <dl className={styles.facts}>
              <div>
                <dt>用例负责人</dt>
                <dd>{item.owner?.name ?? '尚未指定'}</dd>
              </div>
              <div>
                <dt>优先级</dt>
                <dd>{requirementPriorityLabels[item.priority]}</dd>
              </div>
              <div>
                <dt>评审人</dt>
                <dd>{item.reviewer?.name ?? '提交时指定'}</dd>
              </div>
              <div>
                <dt>可用于正式测试</dt>
                <dd>{item.usable ? `是 · 修订 ${item.revision}` : '否，须完成当前修订评审'}</dd>
              </div>
            </dl>
            {item.deprecation && (
              <Alert
                type="info"
                showIcon
                title={`废弃原因：${item.deprecation.reason}`}
                description={`${item.deprecation.actor?.name ?? '成员'} · ${formatTime(item.deprecation.createdAt)}`}
              />
            )}
            {item.needsReview && item.status !== 'DEPRECATED' && (
              <Alert
                showIcon
                type="warning"
                title="关联需求基线已变化，此用例当前不可用于正式测试。"
                description="待需求重新确认后，更新用例草稿或发起修订，再提交评审。"
              />
            )}
            <div className={styles.links}>
              {item.requirements.map((r) => {
                const next = new URLSearchParams({ tab: 'requirements', requirement: r.id });
                if (params.get('list')) next.set('list', params.get('list')!);
                return (
                  <Link key={r.id} to={`/projects/${project.id}?${next}`}>
                    {r.code} · {r.title}
                  </Link>
                );
              })}
            </div>
            <Space wrap>
              {item.usable && canTest(project, session) && (
                <Button type="primary" onClick={() => setCreatingRecord(true)}>
                  添加测试记录
                </Button>
              )}
              {item.allowedActions.map((action) =>
                action === 'edit' || action === 'revise' ? (
                  <Button key={action} onClick={() => onEdit(item)}>
                    {action === 'revise' ? '修订用例' : '编辑用例'}
                  </Button>
                ) : (
                  <Button
                    key={action}
                    danger={action === 'deprecate'}
                    type={action === 'submit' || action === 'approve' ? 'primary' : 'default'}
                    onClick={() => setOperation({ action, item })}
                  >
                    {actionLabels[action]}
                  </Button>
                ),
              )}
            </Space>
            <Tabs
              items={[
                { key: 'content', label: '用例内容', children: <Content snapshot={item} /> },
                {
                  key: 'records',
                  label: '测试记录',
                  children: (
                    <TestRecordsList project={project} session={session} testCaseId={item.id} />
                  ),
                },
                {
                  key: 'revisions',
                  label: `修订历史 (${item.revisions.total})`,
                  children: (
                    <>
                      {item.revisions.items.map((rev) => (
                        <article key={rev.id} className={styles.review}>
                          <strong>
                            修订 {rev.revision} · {rev.snapshot.title}
                          </strong>
                          <p>{rev.reason}</p>
                          <small>
                            {formatTime(rev.createdAt)} ·{' '}
                            {rev.snapshot.editedBy?.name ?? '历史成员'} · 负责人{' '}
                            {rev.snapshot.owner?.name ?? '未指定'}
                          </small>
                          <details>
                            <summary>查看此修订内容</summary>
                            <p>
                              {rev.snapshot.requirements
                                .map((r) => `${r.code} · ${r.title}`)
                                .join('；')}
                            </p>
                            <Content snapshot={rev.snapshot} />
                            <p className={styles.muted}>
                              需求依据：
                              {rev.requirementBasis
                                .map(
                                  (token) =>
                                    `${rev.snapshot.requirements.find((r) => r.id === token.requirementId)?.code ?? token.requirementId} 修订 ${token.revision} / 范围 ${token.scopeVersion}`,
                                )
                                .join('；')}
                            </p>
                          </details>
                        </article>
                      ))}
                      <Pagination
                        current={revisionPage}
                        pageSize={10}
                        total={item.revisions.total}
                        onChange={setRevisionPage}
                        showSizeChanger={false}
                        hideOnSinglePage
                      />
                    </>
                  ),
                },
                {
                  key: 'reviews',
                  label: `评审历史 (${item.history.total})`,
                  children: (
                    <>
                      {!item.history.total && (
                        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="尚无评审记录" />
                      )}
                      {item.history.items.map((review) => (
                        <article key={review.id} className={styles.review}>
                          <strong>
                            第 {review.round} 轮 · 修订 {review.revision} ·{' '}
                            {historyLabels[review.action]}
                          </strong>
                          <p>
                            {review.actor.name} · 指定评审人 {review.reviewer.name} ·{' '}
                            {formatTime(review.createdAt)}
                          </p>
                          <p className={styles.content}>{review.comment || '未填写说明'}</p>
                        </article>
                      ))}
                      <Pagination
                        current={page}
                        pageSize={10}
                        total={item.history.total}
                        onChange={setPage}
                        showSizeChanger={false}
                        hideOnSinglePage
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
                      target={{ targetType: 'TEST_CASE', targetId: item.id }}
                      session={session}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      {operation && (
        <CaseAction
          key={`${operation.action}:${operation.item.version}`}
          {...operation}
          project={project}
          session={session}
          onClose={() => setOperation(null)}
        />
      )}
    </>
  );
}
export function ProjectTestCases({
  project,
  session,
}: {
  project: Project;
  session: SessionResponse;
}) {
  const [params, setParams] = useSearchParams();
  const q = (params.get('cq') ?? '').slice(0, 100);
  const [search, setSearch] = useState(q),
    [editor, setEditor] = useState<TestCase | 'new' | null>(null);
  useEffect(() => setSearch(q), [q]);
  const status = testCaseStatusSchema.safeParse(params.get('cs')),
    priority = requirementPrioritySchema.safeParse(params.get('cpriority'));
  const ownerId = z.uuid().safeParse(params.get('cowner')),
    requirementId = z.uuid().safeParse(params.get('crequirement'));
  const newCase = z.uuid().safeParse(params.get('newCase')),
    caseId = z.uuid().safeParse(params.get('case'));
  const page = readPage(params.get('cp'));
  const usable = params.get('cusable');
  const query = new URLSearchParams({ q, page: String(page), pageSize: '20' });
  if (status.success) query.set('status', status.data);
  if (priority.success) query.set('priority', priority.data);
  if (ownerId.success) query.set('ownerId', ownerId.data);
  if (requirementId.success) query.set('requirementId', requirementId.data);
  if (usable === 'true' || usable === 'false') query.set('usable', usable);
  const set = (key: string, value: string | null | undefined) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'cp' && key !== 'case') next.delete('cp');
      return next;
    });
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'test-cases', query.toString()],
    queryFn: ({ signal }) => loadTestCases(project.id, query.toString(), signal),
  });
  const closeEditor = () => {
    setEditor(null);
    if (newCase.success) set('newCase', null);
  };
  return (
    <>
      <div className={styles.heading}>
        <div>
          <h2>测试用例库</h2>
          <p className={styles.muted}>关联已确认需求，逐步完善步骤，让每次评审都有据可查。</p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            aria-label="新建用例"
            icon={<PlusOutlined />}
            onClick={() => setEditor('new')}
          >
            新建用例
          </Button>
        )}
      </div>
      <div className={styles.toolbar}>
        <Input
          key={q}
          value={search}
          style={{ width: 240 }}
          maxLength={100}
          prefix={<SearchOutlined />}
          aria-label="搜索用例"
          placeholder="搜索用例标题或编号"
          allowClear
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) set('cq', null);
          }}
          onPressEnter={(event) => set('cq', event.currentTarget.value.trim())}
        />
        <Button aria-label="搜索用例列表" onClick={() => set('cq', search.trim())}>
          搜索
        </Button>
        <Select
          aria-label="用例状态筛选"
          style={{ width: 135 }}
          placeholder="全部状态"
          allowClear
          value={status.success ? status.data : undefined}
          options={Object.entries(testCaseStatusLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => set('cs', value)}
        />
        <Select
          aria-label="用例优先级筛选"
          style={{ width: 135 }}
          placeholder="全部优先级"
          allowClear
          value={priority.success ? priority.data : undefined}
          options={Object.entries(requirementPriorityLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => set('cpriority', value)}
        />
        <Select
          aria-label="用例可用性筛选"
          style={{ width: 155 }}
          placeholder="全部可用性"
          allowClear
          value={usable === 'true' || usable === 'false' ? usable : undefined}
          options={[
            { value: 'true', label: '可用于正式测试' },
            { value: 'false', label: '当前不可使用' },
          ]}
          onChange={(value) => set('cusable', value)}
        />
        <div style={{ width: 175 }}>
          <RequirementPicker
            projectId={project.id}
            session={session}
            purpose="filterOwner"
            aria-label="用例负责人筛选"
            value={ownerId.success ? ownerId.data : null}
            onChange={(value) => set('cowner', value)}
          />
        </div>
        <div style={{ width: 220 }}>
          <CasePicker
            projectId={project.id}
            session={session}
            purpose="filterRequirement"
            aria-label="用例关联需求筛选"
            value={requirementId.success ? requirementId.data : null}
            onChange={(value) => set('crequirement', typeof value === 'string' ? value : null)}
          />
        </div>
        {requirementId.success && (
          <Tag closable onClose={() => set('crequirement', null)}>
            已筛选关联需求
          </Tag>
        )}
        {(q ||
          status.success ||
          priority.success ||
          ownerId.success ||
          requirementId.success ||
          usable) && (
          <Button
            type="link"
            onClick={() => {
              setSearch('');
              setParams((previous) => {
                const next = new URLSearchParams(previous);
                ['cq', 'cs', 'cpriority', 'cowner', 'crequirement', 'cusable', 'cp'].forEach(
                  (key) => next.delete(key),
                );
                return next;
              });
            }}
          >
            清除筛选
          </Button>
        )}
      </div>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>重新加载用例列表</Button>}
        />
      ) : list.data && list.data.total > 0 && !list.data.items.length ? (
        <EmptyPage onReset={() => set('cp', null)} />
      ) : (
        <Table<TestCase>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 750 }}
          locale={{
            emptyText: (
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无符合条件的用例" />
            ),
          }}
          columns={[
            {
              title: '用例',
              key: 'title',
              render: (_, item) => (
                <>
                  <span className={styles.code}>{item.code}</span>
                  <Button type="link" className={styles.title} onClick={() => set('case', item.id)}>
                    {item.title}
                  </Button>
                </>
              ),
            },
            {
              title: '状态',
              key: 'status',
              width: 140,
              render: (_, item) => <Status item={item} />,
            },
            {
              title: '最近测试结果',
              key: 'testResult',
              width: 140,
              render: (_, item) => (
                <RecordStatus
                  outcome={item.testResult === 'RETEST' ? 'NOT_RUN' : item.testResult}
                  type={item.testResult === 'RETEST' ? 'RETEST' : undefined}
                />
              ),
            },
            { title: '修订', dataIndex: 'revision', width: 65 },
            {
              title: '优先级',
              dataIndex: 'priority',
              width: 85,
              render: (value) => requirementPriorityLabels[value as TestCase['priority']],
            },
            {
              title: '负责人',
              key: 'owner',
              width: 100,
              render: (_, item) => item.owner?.name ?? '未指定',
            },
            {
              title: '关联需求',
              key: 'requirements',
              width: 110,
              render: (_, item) => `${item.requirements.length} 个需求`,
            },
          ]}
        />
      )}
      <Pagination
        style={{ marginTop: 20, textAlign: 'right' }}
        current={page}
        pageSize={20}
        total={list.data?.total ?? 0}
        onChange={(value) => set('cp', String(value))}
        showSizeChanger={false}
        hideOnSinglePage
        showTotal={(total) => `共 ${total} 条用例`}
      />
      {caseId.success && (
        <Detail
          key={`detail:${caseId.data}`}
          id={caseId.data}
          project={project}
          session={session}
          onClose={() => set('case', null)}
          onEdit={(item) => {
            set('case', null);
            setEditor(item);
          }}
        />
      )}
      {(editor || (newCase.success && list.data?.canCreate)) && (
        <CaseEditor
          key={
            editor && editor !== 'new'
              ? `edit:${editor.id}`
              : `new:${newCase.success ? newCase.data : ''}`
          }
          project={project}
          session={session}
          item={editor && editor !== 'new' ? editor : undefined}
          requirementId={newCase.success ? newCase.data : undefined}
          revision={!!editor && editor !== 'new' && editor.status === 'READY'}
          onClose={closeEditor}
          onSaved={(id) => {
            setEditor(null);
            setParams((previous) => {
              const next = new URLSearchParams(previous);
              next.delete('newCase');
              next.set('case', id);
              return next;
            });
          }}
        />
      )}
    </>
  );
}
