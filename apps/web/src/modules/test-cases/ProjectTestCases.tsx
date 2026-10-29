import { testCaseStatusLabels, requirementPriorityLabels } from '../../i18n/labels';
import { t, localizeLabels, useLocale } from '../../i18n';
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
  requirementPrioritySchema,
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
const actionLabels = localizeLabels({
  submit: '提交用例评审',
  approve: '通过用例评审',
  return: '退回用例',
  withdraw: '撤回用例评审',
  deprecate: '废弃用例',
} as const);
type Action = keyof typeof actionLabels;
const historyLabels = localizeLabels({
  SUBMITTED: '提交评审',
  APPROVED: '评审通过',
  RETURNED: '退回修改',
  WITHDRAWN: '撤回评审',
} as const);
function Status({ item }: { item: TestCase }) {
  useLocale();
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
          ? t('待重新评审')
          : testCaseStatusLabels[item.status]}
      </Tag>
      {item.needsReview && item.status !== 'READY' && item.status !== 'DEPRECATED' && (
        <Tag color="warning">{t('需求基线已变化')}</Tag>
      )}
    </Space>
  );
}
function Content({ snapshot }: { snapshot: z.infer<typeof testCaseSnapshotSchema> }) {
  useLocale();
  return (
    <>
      <h3>{t('前置条件')}</h3>
      <p className={styles.content}>{snapshot.preconditions || t('未填写')}</p>
      <h3>{t('步骤与预期')}</h3>
      {!snapshot.steps.length && (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('尚未编写步骤')} />
      )}
      {snapshot.steps.map((step, index) => (
        <section key={index} className={styles.step}>
          <strong>
            {t('步骤 ')}
            {index + 1}
          </strong>
          <h4>{t('操作')}</h4>
          <p className={styles.content}>{step.action || t('未填写')}</p>
          <h4>{t('预期结果')}</h4>
          <p className={styles.content}>{step.expected || t('未填写')}</p>
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
  useLocale();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand(session, () => {
    void message.success(t('用例状态已更新'));
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
      cancelText={t('取消')}
    >
      <p>
        「{item.title}
        {t('」· 修订 ')}
        {item.revision}
      </p>
      {action === 'deprecate' && (
        <Alert
          type="warning"
          showIcon
          title={t('废弃后不可再次使用，修订内容和评审历史仍可查看。')}
        />
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
            label={t('用例评审人')}
            rules={[{ required: true, message: t('请选择评审人') }]}
          >
            <CasePicker projectId={project.id} session={session} purpose="reviewer" />
          </Form.Item>
        )}
        <Form.Item
          name="comment"
          label={reasonRequired ? t('处理原因') : t('评审说明')}
          rules={
            reasonRequired
              ? [{ required: true, whitespace: true, message: t('请填写处理原因') }]
              : []
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
  useLocale();
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
      <Drawer open size="min(780px, 100vw)" title={t('用例详情')} onClose={onClose}>
        {detail.isPending ? (
          <Skeleton active />
        ) : detail.isError || !item ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(detail.error)}
            action={<Button onClick={() => void detail.refetch()}>{t('重新加载用例')}</Button>}
          />
        ) : (
          <>
            <span className={styles.code}>
              {item.code} {t(' · 当前修订 ')}
              {item.revision}
            </span>
            <h2 className={styles.detailTitle}>{item.title}</h2>
            <Status item={item} />
            <dl className={styles.facts}>
              <div>
                <dt>{t('用例负责人')}</dt>
                <dd>{item.owner?.name ?? t('尚未指定')}</dd>
              </div>
              <div>
                <dt>{t('优先级')}</dt>
                <dd>{requirementPriorityLabels[item.priority]}</dd>
              </div>
              <div>
                <dt>{t('评审人')}</dt>
                <dd>{item.reviewer?.name ?? t('提交时指定')}</dd>
              </div>
              <div>
                <dt>{t('可用于正式测试')}</dt>
                <dd>
                  {item.usable
                    ? t('是 · 修订 {{0}}', { '0': item.revision })
                    : t('否，须完成当前修订评审')}
                </dd>
              </div>
            </dl>
            {item.deprecation && (
              <Alert
                type="info"
                showIcon
                title={t('废弃原因：{{0}}', { '0': item.deprecation.reason })}
                description={`${item.deprecation.actor?.name ?? t('成员')} · ${formatTime(item.deprecation.createdAt)}`}
              />
            )}
            {item.needsReview && item.status !== 'DEPRECATED' && (
              <Alert
                showIcon
                type="warning"
                title={t('关联需求基线已变化，此用例当前不可用于正式测试。')}
                description={t('待需求重新确认后，更新用例草稿或发起修订，再提交评审。')}
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
                  {t('添加测试记录')}
                </Button>
              )}
              {item.allowedActions.map((action) =>
                action === 'edit' || action === 'revise' ? (
                  <Button key={action} onClick={() => onEdit(item)}>
                    {action === 'revise' ? t('修订用例') : t('编辑用例')}
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
                { key: 'content', label: t('用例内容'), children: <Content snapshot={item} /> },
                {
                  key: 'records',
                  label: t('测试记录'),
                  children: (
                    <TestRecordsList project={project} session={session} testCaseId={item.id} />
                  ),
                },
                {
                  key: 'revisions',
                  label: t('修订历史 ({{0}})', { '0': item.revisions.total }),
                  children: (
                    <>
                      {item.revisions.items.map((rev) => (
                        <article key={rev.id} className={styles.review}>
                          <strong>
                            {t('修订 ')}
                            {rev.revision} · {rev.snapshot.title}
                          </strong>
                          <p>{rev.reason}</p>
                          <small>
                            {formatTime(rev.createdAt)} ·{' '}
                            {rev.snapshot.editedBy?.name ?? t('历史成员')} {t(' · 负责人')}{' '}
                            {rev.snapshot.owner?.name ?? t('未指定')}
                          </small>
                          <details>
                            <summary>{t('查看此修订内容')}</summary>
                            <p>
                              {rev.snapshot.requirements
                                .map((r) => `${r.code} · ${r.title}`)
                                .join('；')}
                            </p>
                            <Content snapshot={rev.snapshot} />
                            <p className={styles.muted}>
                              {t('需求依据：')}
                              {rev.requirementBasis
                                .map((token) =>
                                  t('{{0}} 修订 {{1}} / 范围 {{2}}', {
                                    '0':
                                      rev.snapshot.requirements.find(
                                        (r) => r.id === token.requirementId,
                                      )?.code ?? token.requirementId,
                                    '1': token.revision,
                                    '2': token.scopeVersion,
                                  }),
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
                  label: t('评审历史 ({{0}})', { '0': item.history.total }),
                  children: (
                    <>
                      {!item.history.total && (
                        <Empty
                          image={Empty.PRESENTED_IMAGE_SIMPLE}
                          description={t('尚无评审记录')}
                        />
                      )}
                      {item.history.items.map((review) => (
                        <article key={review.id} className={styles.review}>
                          <strong>
                            {t('第 ')}
                            {review.round} {t(' 轮 · 修订 ')}
                            {review.revision} · {historyLabels[review.action]}
                          </strong>
                          <p>
                            {review.actor.name} {t(' · 指定评审人 ')}
                            {review.reviewer.name} · {formatTime(review.createdAt)}
                          </p>
                          <p className={styles.content}>{review.comment || t('未填写说明')}</p>
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
                  label: t('讨论与附件'),
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
  useLocale();
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
          <h2>{t('测试用例库')}</h2>
          <p className={styles.muted}>
            {t('关联已确认需求，逐步完善步骤，让每次评审都有据可查。')}
          </p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            aria-label={t('新建用例')}
            icon={<PlusOutlined />}
            onClick={() => setEditor('new')}
          >
            {t('新建用例')}
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
          aria-label={t('搜索用例')}
          placeholder={t('搜索用例标题或编号')}
          allowClear
          onChange={(event) => {
            setSearch(event.target.value);
            if (!event.target.value) set('cq', null);
          }}
          onPressEnter={(event) => set('cq', event.currentTarget.value.trim())}
        />
        <Button aria-label={t('搜索用例列表')} onClick={() => set('cq', search.trim())}>
          {t('搜索')}
        </Button>
        <Select
          aria-label={t('用例状态筛选')}
          style={{ width: 135 }}
          placeholder={t('全部状态')}
          allowClear
          value={status.success ? status.data : undefined}
          options={Object.entries(testCaseStatusLabels).map(([value, label]) => ({ value, label }))}
          onChange={(value) => set('cs', value)}
        />
        <Select
          aria-label={t('用例优先级筛选')}
          style={{ width: 135 }}
          placeholder={t('全部优先级')}
          allowClear
          value={priority.success ? priority.data : undefined}
          options={Object.entries(requirementPriorityLabels).map(([value, label]) => ({
            value,
            label,
          }))}
          onChange={(value) => set('cpriority', value)}
        />
        <Select
          aria-label={t('用例可用性筛选')}
          style={{ width: 155 }}
          placeholder={t('全部可用性')}
          allowClear
          value={usable === 'true' || usable === 'false' ? usable : undefined}
          options={[
            { value: 'true', label: t('可用于正式测试') },
            { value: 'false', label: t('当前不可使用') },
          ]}
          onChange={(value) => set('cusable', value)}
        />
        <div style={{ width: 175 }}>
          <RequirementPicker
            projectId={project.id}
            session={session}
            purpose="filterOwner"
            aria-label={t('用例负责人筛选')}
            value={ownerId.success ? ownerId.data : null}
            onChange={(value) => set('cowner', value)}
          />
        </div>
        <div style={{ width: 220 }}>
          <CasePicker
            projectId={project.id}
            session={session}
            purpose="filterRequirement"
            aria-label={t('用例关联需求筛选')}
            value={requirementId.success ? requirementId.data : null}
            onChange={(value) => set('crequirement', typeof value === 'string' ? value : null)}
          />
        </div>
        {requirementId.success && (
          <Tag closable onClose={() => set('crequirement', null)}>
            {t('已筛选关联需求')}
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
            {t('清除筛选')}
          </Button>
        )}
      </div>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{t('重新加载用例列表')}</Button>}
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
              <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('暂无符合条件的用例')} />
            ),
          }}
          columns={[
            {
              title: t('用例'),
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
              title: t('状态'),
              key: 'status',
              width: 140,
              render: (_, item) => <Status item={item} />,
            },
            {
              title: t('最近测试结果'),
              key: 'testResult',
              width: 140,
              render: (_, item) => (
                <RecordStatus
                  outcome={item.testResult === 'RETEST' ? 'NOT_RUN' : item.testResult}
                  type={item.testResult === 'RETEST' ? 'RETEST' : undefined}
                />
              ),
            },
            { title: t('修订'), dataIndex: 'revision', width: 65 },
            {
              title: t('优先级'),
              dataIndex: 'priority',
              width: 85,
              render: (value) => requirementPriorityLabels[value as TestCase['priority']],
            },
            {
              title: t('负责人'),
              key: 'owner',
              width: 100,
              render: (_, item) => item.owner?.name ?? t('未指定'),
            },
            {
              title: t('关联需求'),
              key: 'requirements',
              width: 110,
              render: (_, item) => t('{{0}} 个需求', { '0': item.requirements.length }),
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
        showTotal={(total) => t('共 {{0}} 条用例', { '0': total })}
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
