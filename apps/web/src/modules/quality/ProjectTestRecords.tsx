import { useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
  Upload,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import {
  attachmentListSchema,
  hasPermission,
  testRecordDetailSchema,
  testRecordListSchema,
  testRecordLabels,
  qualityLabels,
  type Project,
  type SessionResponse,
  type TestRecord,
} from '@myteam/contracts';
import { request, errorMessage } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import { CollaborationPanel, formatTime } from '../collaboration/CollaborationPanel';
import { QualityPicker } from './QualityPicker';
import styles from './quality.module.css';
type Common = { project: Project; session: SessionResponse };
export type RecordSeed = {
  testCaseId?: string;
  requirementId?: string;
  type?: 'INITIAL' | 'RETEST';
  defectIds?: string[];
  buildId?: string | null;
};
export function RecordStatus({ outcome, type }: { outcome: string; type?: string }) {
  return (
    <Tag color={outcome === 'PASSED' ? 'green' : outcome === 'FAILED' ? 'red' : 'orange'}>
      {type === 'RETEST'
        ? outcome === 'NOT_RUN'
          ? '待复测'
          : `复测${testRecordLabels[outcome]}`
        : testRecordLabels[outcome]}
    </Tag>
  );
}
function ResultFields({
  project,
  session,
  requirementId,
  outcome,
}: Common & { requirementId?: string; outcome?: string }) {
  return (
    <>
      <Form.Item name="outcome" label="测试结果" rules={[{ required: true }]}>
        <Select
          options={[
            { value: 'PASSED', label: '通过' },
            { value: 'FAILED', label: '未通过' },
          ]}
        />
      </Form.Item>
      <Form.Item name="actual" label="实际表现" rules={[{ required: true, whitespace: true }]}>
        <Input.TextArea rows={3} maxLength={5000} />
      </Form.Item>
      <Form.Item name="evidence" label="补充说明">
        <Input.TextArea rows={2} maxLength={5000} />
      </Form.Item>
      <Form.Item name="defectIds" label="关联已有缺陷（可选）">
        <QualityPicker
          projectId={project.id}
          session={session}
          kind="defects"
          requirementId={requirementId}
          multiple
        />
      </Form.Item>
      {outcome === 'FAILED' && (
        <>
          <Alert type="info" showIcon title="没有可复用的缺陷时，会根据本次结果自动创建缺陷。" />
          <Form.Item name="severity" label="新缺陷严重程度">
            <Select
              options={['CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'].map((value) => ({
                value,
                label: qualityLabels[value],
              }))}
            />
          </Form.Item>
          <Form.Item
            name="assigneeId"
            label="新缺陷开发负责人"
            extra="未指定时优先使用该需求下任务的负责人。"
          >
            <QualityPicker projectId={project.id} session={session} purpose="assignee" />
          </Form.Item>
          <Form.Item name="retesterId" label="新缺陷复测负责人" extra="默认由当前测试人员复测。">
            <QualityPicker projectId={project.id} session={session} purpose="retester" />
          </Form.Item>
        </>
      )}
    </>
  );
}
export function CreateTestRecord({
  project,
  session,
  seed = {},
  onClose,
  onCreated,
}: Common & { seed?: RecordSeed; onClose: () => void; onCreated: (id: string) => void }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const requirementId = Form.useWatch('requirementId', form) as string | undefined;
  const outcome = Form.useWatch('outcome', form) as string | undefined;
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [created, setCreated] = useState<{ id: string; version: number } | null>(null);
  const uploaded = useRef(new Map<string, { key: string; id?: string }>());
  const create = useProjectCommand<{ id: string; version: number }>(session);
  const finish = useProjectCommand(session);
  const close = () => {
    if (pending) return;
    if (created) onCreated(created.id);
    onClose();
  };
  const save = async (values: Record<string, unknown>, draft: boolean) => {
    setSaveError('');
    setPending(true);
    try {
      const record =
        created ??
        (await create.mutateAsync({
          path: `/projects/${project.id}/quality/records`,
          input: {
            requirementId: values.requirementId,
            testCaseId: values.testCaseId,
            type: values.type,
            environment: values.environment,
            buildId: values.buildId ?? null,
            defectIds: draft ? (values.defectIds ?? []) : (seed.defectIds ?? []),
          },
        }));
      if (!created) setCreated(record);
      const attachmentIds: string[] = [];
      for (const item of files) {
        let entry = uploaded.current.get(item.uid);
        if (!entry) {
          entry = { key: crypto.randomUUID() };
          uploaded.current.set(item.uid, entry);
        }
        if (!entry.id) {
          const file = item.originFileObj;
          if (!file) throw new Error('无法读取附件，请重新选择文件');
          const result = await request<{ id: string }>(
            `/projects/${project.id}/collaboration/TEST_RECORD/${record.id}/attachments?filename=${encodeURIComponent(file.name)}`,
            {
              method: 'POST',
              body: file,
              headers: {
                'Content-Type': 'application/octet-stream',
                'X-CSRF-Token': session.csrfToken,
                'Idempotency-Key': entry.key,
              },
              signal: AbortSignal.timeout(60000),
            },
          );
          entry.id = result.id;
        }
        attachmentIds.push(entry.id);
      }
      if (!draft)
        await finish.mutateAsync({
          path: `/projects/${project.id}/quality/records/${record.id}/finish`,
          input: {
            version: record.version,
            outcome: values.outcome,
            actual: values.actual,
            evidence: values.evidence ?? '',
            defectIds: values.defectIds ?? [],
            severity: values.severity ?? 'MAJOR',
            ...(values.assigneeId ? { assigneeId: values.assigneeId } : {}),
            ...(values.retesterId ? { retesterId: values.retesterId } : {}),
            attachmentIds,
          },
        });
      void message.success(draft ? '待测试记录已保存' : '测试结果已保存');
      onCreated(record.id);
      onClose();
    } catch (error) {
      setSaveError(errorMessage(error));
    } finally {
      setPending(false);
    }
  };
  const saveDraft = async () => {
    try {
      await form.validateFields(['requirementId', 'testCaseId', 'type', 'environment']);
      await save(form.getFieldsValue(), true);
    } catch {
      /* 字段校验提示由表单显示 */
    }
  };
  return (
    <Modal
      open
      title="添加测试记录"
      width={700}
      zIndex={1300}
      style={{ top: 24 }}
      styles={{ body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } }}
      onCancel={close}
      closable={!pending}
      mask={{ closable: !pending }}
      keyboard={!pending}
      footer={
        <>
          <Button disabled={pending} onClick={close}>
            取消
          </Button>
          <Button loading={pending} onClick={() => void saveDraft()}>
            保存待测试
          </Button>
          <Button type="primary" loading={pending} onClick={() => form.submit()}>
            保存测试结果
          </Button>
        </>
      }
    >
      {saveError && (
        <Alert
          type="error"
          showIcon
          title={saveError}
          description={
            created ? '记录已创建，请修改结果后重试，或关闭窗口前往记录详情继续填写。' : undefined
          }
        />
      )}
      {created && <Alert type="info" showIcon title="测试记录已创建，基本信息已锁定。" />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ type: 'INITIAL', severity: 'MAJOR', ...seed }}
        onValuesChange={(changed) => {
          if ('requirementId' in changed && !seed.testCaseId)
            form.setFieldsValue({ testCaseId: undefined, defectIds: [] });
        }}
        onFinish={(values) => void save(values, false)}
      >
        <div className={styles.recordFormSection}>
          <h3>测试信息</h3>
          <Form.Item name="requirementId" label="验证需求" rules={[{ required: true }]}>
            <QualityPicker
              projectId={project.id}
              session={session}
              kind="requirements"
              testCaseId={seed.testCaseId}
              disabled={!!seed.requirementId || !!created}
            />
          </Form.Item>
          <Form.Item name="testCaseId" label="测试用例" rules={[{ required: true }]}>
            <QualityPicker
              projectId={project.id}
              session={session}
              kind="cases"
              requirementId={requirementId}
              disabled={!!seed.testCaseId || !!created}
            />
          </Form.Item>
          <div className={styles.formGrid}>
            <Form.Item name="type" label="测试类型" rules={[{ required: true }]}>
              <Select
                disabled={!!created}
                options={[
                  { value: 'INITIAL', label: '首次测试' },
                  { value: 'RETEST', label: '复测' },
                ]}
              />
            </Form.Item>
            <Form.Item name="buildId" label="测试构建（可选）">
              <QualityPicker
                projectId={project.id}
                session={session}
                kind="builds"
                disabled={!!created}
              />
            </Form.Item>
          </div>
          <Form.Item
            name="environment"
            label="测试环境"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input.TextArea rows={2} maxLength={2000} disabled={!!created} />
          </Form.Item>
        </div>
        <div className={styles.recordFormSection}>
          <h3>测试结果</h3>
          <p className={styles.formHint}>也可先保存待测试记录；测试结果需稍后在详情中填写。</p>
          <ResultFields
            project={project}
            session={session}
            requirementId={requirementId}
            outcome={outcome}
          />
          <Form.Item label="截图与附件" extra="支持图片、PDF、TXT 或 Markdown，单文件最多 20 MiB。">
            <Upload
              accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md"
              multiple
              fileList={files}
              disabled={pending}
              beforeUpload={(file) => {
                if (!file.size || file.size > 20 * 1024 * 1024) {
                  void message.error('附件大小须在 1 字节至 20 MiB 之间');
                  return Upload.LIST_IGNORE;
                }
                if (files.length >= 100) {
                  void message.error('最多选择 100 个附件');
                  return Upload.LIST_IGNORE;
                }
                return false;
              }}
              onChange={({ fileList }) => setFiles(fileList.slice(0, 100))}
            >
              <Button icon={<UploadOutlined />} disabled={pending}>
                选择附件
              </Button>
            </Upload>
          </Form.Item>
        </div>
      </Form>
    </Modal>
  );
}
function FinishRecord({ record, ...props }: Common & { record: TestRecord }) {
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [collectError, setCollectError] = useState('');
  const [collecting, setCollecting] = useState(false);
  const outcome = Form.useWatch('outcome', form) as string | undefined;
  const command = useProjectCommand(props.session, () => {
    void message.success('测试结果已保存');
  });
  const submit = async (values: Record<string, unknown>) => {
    setCollectError('');
    setCollecting(true);
    try {
      const files = attachmentListSchema.parse(
        await request(
          `/projects/${props.project.id}/collaboration/TEST_RECORD/${record.id}/attachments?pageSize=100`,
        ),
      );
      command.mutate({
        path: `/projects/${props.project.id}/quality/records/${record.id}/finish`,
        input: {
          ...values,
          version: record.version,
          attachmentIds: files.items.map((f) => f.id),
          defectIds: values.defectIds ?? record.defects.map((d) => d.id),
        },
      });
    } catch (error) {
      setCollectError(errorMessage(error));
    } finally {
      setCollecting(false);
    }
  };
  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ defectIds: record.defects.map((d) => d.id), severity: 'MAJOR' }}
      onFinish={(values) => void submit(values)}
    >
      {(command.isError || collectError) && (
        <Alert type="error" showIcon title={collectError || errorMessage(command.error)} />
      )}
      <ResultFields
        project={props.project}
        session={props.session}
        requirementId={record.requirementId}
        outcome={outcome}
      />
      <p>截图可在下方“附件”中上传，保存结果时会一并引用。</p>
      <Button type="primary" htmlType="submit" loading={command.isPending || collecting}>
        保存测试结果
      </Button>
    </Form>
  );
}
export function TestRecordDetail({
  id,
  onClose,
  ...props
}: Common & { id: string; onClose: () => void }) {
  const detail = useQuery({
    queryKey: [...projectKey(props.session.user.id, props.project.id), 'test-record', id],
    queryFn: async ({ signal }) =>
      testRecordDetailSchema.parse(
        await request(`/projects/${props.project.id}/quality/records/${id}`, { signal }),
      ),
  });
  const record = detail.data;
  return (
    <Drawer open size="min(800px, 100vw)" title="测试记录详情" onClose={onClose}>
      {detail.isPending ? (
        <Skeleton active />
      ) : detail.isError || !record ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(detail.error)}
          action={<Button onClick={() => void detail.refetch()}>重新加载</Button>}
        />
      ) : (
        <>
          <small>
            {record.code} · {formatTime(record.createdAt)}
          </small>
          <h2>{record.caseTitle}</h2>
          <Space wrap>
            <RecordStatus outcome={record.outcome} type={record.type} />
            {!record.current && <Tag>已失效</Tag>}
            <span>测试人：{record.executor.name}</span>
          </Space>
          <p>
            需求：
            <Link
              to={`/projects/${props.project.id}?tab=requirements&requirement=${record.requirementId}`}
            >
              {record.requirementTitle}
            </Link>{' '}
            · 需求修订 {record.requirementRevision} · 第 {record.cycle} 轮
          </p>
          <p>
            用例：
            <Link to={`/projects/${props.project.id}?tab=test-cases&case=${record.testCaseId}`}>
              {record.caseCode}
            </Link>{' '}
            · 修订 {record.caseRevision}
          </p>
          <p>
            环境：{record.environment} · 构建：{record.buildIdentifier ?? '未指定'}
          </p>
          <Tabs
            items={[
              {
                key: 'result',
                label: '测试结果',
                children: (
                  <>
                    {!record.current && (
                      <Alert
                        type="warning"
                        showIcon
                        title="需求、用例或开发范围已变化，本记录保留供查询，不计入当前完成条件。"
                      />
                    )}
                    {record.allowedActions.includes('finish') ? (
                      <FinishRecord record={record} {...props} />
                    ) : (
                      <>
                        <h3>实际表现</h3>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{record.actual || '尚未记录'}</p>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{record.evidence}</p>
                      </>
                    )}
                    <h3>关联缺陷</h3>
                    {record.defects.length ? (
                      <Space wrap>
                        {record.defects.map((d) => (
                          <Link
                            key={d.id}
                            to={`/projects/${props.project.id}?tab=defects&defect=${d.id}`}
                          >
                            {d.code} · {d.title}（{qualityLabels[d.status]}）
                          </Link>
                        ))}
                      </Space>
                    ) : (
                      <p>暂无关联缺陷</p>
                    )}
                  </>
                ),
              },
              {
                key: 'case',
                label: '本次测试内容',
                children: (
                  <>
                    <h3>前置条件</h3>
                    <p>{record.snapshot.content.preconditions || '无'}</p>
                    {record.snapshot.content.steps.map((step, i) => (
                      <article key={i} className={styles.card}>
                        <strong>步骤 {i + 1}</strong>
                        <p style={{ whiteSpace: 'pre-wrap' }}>{step.action}</p>
                        <p style={{ whiteSpace: 'pre-wrap' }}>预期：{step.expected}</p>
                      </article>
                    ))}
                  </>
                ),
              },
            ]}
          />
          <CollaborationPanel
            projectId={props.project.id}
            session={props.session}
            target={{ targetType: 'TEST_RECORD', targetId: record.id }}
            initialTab="attachments"
          />
        </>
      )}
    </Drawer>
  );
}
export function TestRecordsList({
  testCaseId,
  requirementId,
  ...props
}: Common & { testCaseId?: string; requirementId?: string }) {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<string | null>(null);
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '10',
    ...(testCaseId ? { testCaseId } : {}),
    ...(requirementId ? { requirementId } : {}),
  }).toString();
  const list = useQuery({
    queryKey: [...projectKey(props.session.user.id, props.project.id), 'test-records', query],
    queryFn: async ({ signal }) =>
      testRecordListSchema.parse(
        await request(`/projects/${props.project.id}/quality/records?${query}`, { signal }),
      ),
  });
  return (
    <>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>重试</Button>}
        />
      ) : (
        <Table<TestRecord>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 640 }}
          locale={{
            emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无测试记录" />,
          }}
          columns={[
            {
              title: '测试记录',
              key: 'title',
              render: (_, r) => (
                <Button type="link" onClick={() => setSelected(r.id)}>
                  {r.code} · {r.caseTitle}
                </Button>
              ),
            },
            { title: '需求', dataIndex: 'requirementTitle' },
            {
              title: '结果',
              key: 'outcome',
              render: (_, r) => (
                <>
                  <RecordStatus outcome={r.outcome} type={r.type} />
                  {!r.current && <Tag>已失效</Tag>}
                </>
              ),
            },
            { title: '测试人', key: 'executor', render: (_, r) => r.executor.name },
            { title: '时间', dataIndex: 'createdAt', render: formatTime },
          ]}
        />
      )}
      <Pagination
        current={page}
        pageSize={10}
        total={list.data?.total ?? 0}
        onChange={setPage}
        hideOnSinglePage
        showSizeChanger={false}
      />
      {selected && <TestRecordDetail id={selected} {...props} onClose={() => setSelected(null)} />}
    </>
  );
}
export function ProjectTestRecords(props: Common) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState(params.get('rq') ?? '');
  const page = Math.max(1, Number(params.get('rp')) || 1);
  const outcome = params.get('ro') ?? '';
  const requirementId = params.get('rrequirement') ?? '';
  const testCaseId = params.get('rcase') ?? '';
  const query = new URLSearchParams({
    page: String(page),
    pageSize: '20',
    q: params.get('rq') ?? '',
    ...(outcome ? { outcome } : {}),
    ...(requirementId ? { requirementId } : {}),
    ...(testCaseId ? { testCaseId } : {}),
  }).toString();
  const list = useQuery({
    queryKey: [...projectKey(props.session.user.id, props.project.id), 'test-records', query],
    queryFn: async ({ signal }) =>
      testRecordListSchema.parse(
        await request(`/projects/${props.project.id}/quality/records?${query}`, { signal }),
      ),
  });
  const set = (key: string, value: string | null) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (value) next.set(key, value);
      else next.delete(key);
      if (key !== 'rp') next.delete('rp');
      return next;
    });
  return (
    <section>
      <div className={styles.heading}>
        <div>
          <h2>测试记录</h2>
          <p>按需求验证用例，记录每次测试、复测和发现的问题。</p>
        </div>
        {list.data?.canCreate && (
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>
            添加测试记录
          </Button>
        )}
      </div>
      <Space wrap style={{ marginBottom: 20 }}>
        <Input.Search
          aria-label="搜索测试记录"
          placeholder="搜索用例、实际表现或环境"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          onSearch={(v) => set('rq', v)}
          allowClear
        />
        <Select
          aria-label="测试结果筛选"
          placeholder="全部结果"
          allowClear
          value={outcome || undefined}
          style={{ width: 140 }}
          options={['NOT_RUN', 'PASSED', 'FAILED'].map((value) => ({
            value,
            label: testRecordLabels[value],
          }))}
          onChange={(v) => set('ro', v ?? null)}
        />
        <div style={{ width: 240 }}>
          <QualityPicker
            projectId={props.project.id}
            session={props.session}
            kind="requirements"
            aria-label="测试需求筛选"
            value={requirementId}
            onChange={(v) => set('rrequirement', typeof v === 'string' ? v : null)}
          />
        </div>
        {testCaseId && (
          <Tag closable onClose={() => set('rcase', null)}>
            已筛选测试用例
          </Tag>
        )}
      </Space>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>重试</Button>}
        />
      ) : (
        <Table<TestRecord>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            {
              title: '测试记录 / 用例',
              key: 'title',
              render: (_, r) => (
                <>
                  <small>{r.code}</small>
                  <br />
                  <Button type="link" onClick={() => set('record', r.id)}>
                    {r.caseTitle}
                  </Button>
                </>
              ),
            },
            { title: '需求', dataIndex: 'requirementTitle' },
            {
              title: '结果',
              key: 'outcome',
              render: (_, r) => (
                <>
                  <RecordStatus outcome={r.outcome} type={r.type} />
                  {!r.current && <Tag>已失效</Tag>}
                </>
              ),
            },
            {
              title: '环境 / 构建',
              key: 'env',
              render: (_, r) => (
                <>
                  {r.environment}
                  <br />
                  {r.buildIdentifier ?? '未指定构建'}
                </>
              ),
            },
            { title: '测试人', key: 'executor', render: (_, r) => r.executor.name },
            { title: '创建时间', dataIndex: 'createdAt', render: formatTime },
            {
              title: '缺陷',
              key: 'defects',
              render: (_, r) => (r.defects.length ? `${r.defects.length} 个` : '—'),
            },
          ]}
        />
      )}
      <Pagination
        current={page}
        total={list.data?.total ?? 0}
        pageSize={20}
        showSizeChanger={false}
        hideOnSinglePage
        onChange={(v) => set('rp', String(v))}
        style={{ marginTop: 20 }}
      />
      {creating && (
        <CreateTestRecord
          {...props}
          seed={{ requirementId: requirementId || undefined, testCaseId: testCaseId || undefined }}
          onClose={() => setCreating(false)}
          onCreated={(id) => navigate(`/projects/${props.project.id}?tab=records&record=${id}`)}
        />
      )}
      {params.get('record') && (
        <TestRecordDetail
          {...props}
          id={params.get('record')!}
          onClose={() => set('record', null)}
        />
      )}
    </section>
  );
}
export function canTest(project: Project, session: SessionResponse) {
  return (
    project.status === 'ACTIVE' &&
    (session.user.isSystemAdmin || hasPermission(project.myRoles, 'test:execute'))
  );
}
