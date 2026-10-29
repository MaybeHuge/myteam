import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useNavigate, useSearchParams } from 'react-router';
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
  hasPermission,
  qualityLabels,
  releaseListSchema,
  releaseDetailSchema,
  defectListSchema,
  defectDetailSchema,
  releaseStatusSchema,
  defectStatusSchema,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import type { z } from 'zod';
import { request, errorMessage } from '../../api/client';
import { projectKey } from '../projects/api';
import { CollaborationPanel, formatTime } from '../collaboration/CollaborationPanel';
import { QualityModal, actionLabels, type Operation } from './QualityModal';
import { AttachmentImages } from './AttachmentImages';
import { CreateTestRecord, RecordStatus, type RecordSeed } from './ProjectTestRecords';
import styles from './quality.module.css';
type Common = { project: Project; session: SessionResponse };
type ReleaseDetail = z.infer<typeof releaseDetailSchema>;
type DefectDetail = z.infer<typeof defectDetailSchema>;
type Mode = 'releases' | 'defects';
function Status({ status }: { status: string }) {
  return (
    <Tag
      color={
        ['PASSED', 'CLOSED', 'COMPLETED'].includes(status)
          ? 'green'
          : ['FAILED', 'CRITICAL', 'MAJOR'].includes(status)
            ? 'red'
            : 'default'
      }
    >
      {qualityLabels[status] ?? status}
    </Tag>
  );
}
function Detail({
  mode,
  id,
  onClose,
  onOperation,
  ...props
}: Common & { mode: Mode; id: string; onClose: () => void; onOperation: (op: Operation) => void }) {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [seed, setSeed] = useState<RecordSeed | null>(null);
  const detail = useQuery({
    queryKey: [
      ...projectKey(props.session.user.id, props.project.id),
      'quality-detail',
      mode,
      id,
      page,
    ],
    queryFn: async ({ signal }) => {
      const raw = await request(
        `/projects/${props.project.id}/quality/${mode}/${id}?page=${page}&pageSize=20`,
        { signal },
      );
      return mode === 'releases' ? releaseDetailSchema.parse(raw) : defectDetailSchema.parse(raw);
    },
  });
  const row = detail.data;
  const act = (action: string) => {
    if (!row) return;
    if (mode === 'releases') {
      const r = row as ReleaseDetail;
      onOperation({
        entity: mode,
        action,
        id,
        version: r.version,
        initial: {
          ...r,
          requirementIds: r.scope.filter((w) => w.kind === 'REQUIREMENT').map((w) => w.id),
          taskIds: r.scope.filter((w) => w.kind === 'TASK').map((w) => w.id),
        },
      });
    } else {
      const d = row as DefectDetail;
      if (action === 'retest' && d.testCases.length) {
        setSeed({
          requirementId: d.requirementId,
          testCaseId: d.testCases.length === 1 ? d.testCases[0]?.id : undefined,
          type: 'RETEST',
          defectIds: [d.id],
          buildId: d.fixedBuildId,
        });
        return;
      }
      onOperation({
        entity: mode,
        action,
        id,
        version: d.version,
        initial: {
          ...d,
          assigneeId: d.assignee.id,
          retesterId: d.retester.id,
          testCaseIds: d.testCases.map((c) => c.id),
          testRecordIds: d.testRecords.map((r) => r.id),
          passed: 'pass',
        },
      });
    }
  };
  const release = row && mode === 'releases' ? (row as ReleaseDetail) : null;
  const defect = row && mode === 'defects' ? (row as DefectDetail) : null;
  return (
    <>
      <Drawer
        open
        size="min(800px, 100vw)"
        title={mode === 'releases' ? '版本详情' : '缺陷详情'}
        onClose={onClose}
      >
        {detail.isPending ? (
          <Skeleton active />
        ) : detail.isError || !row ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(detail.error)}
            action={<Button onClick={() => void detail.refetch()}>重新加载详情</Button>}
          />
        ) : (
          <>
            {defect ? (
              <div className={styles.defectHeader}>
                <div className={styles.defectCode}>
                  {defect.code} · {defect.source === 'PRODUCTION' ? '生产发现' : '测试发现'}
                </div>
                <h2>{defect.title}</h2>
                <div className={styles.headerTags}>
                  <Status status={defect.status} />
                  <Status status={defect.severity} />
                </div>
              </div>
            ) : (
              <>
                <h2>{release?.name}</h2>
                <Status status={row.status} />
              </>
            )}
            <Space wrap style={{ display: 'flex', margin: '16px 0' }}>
              {[...row.allowedActions]
                .sort(
                  (a, b) =>
                    Number(['confirm', 'start', 'fix', 'retest'].includes(b)) -
                    Number(['confirm', 'start', 'fix', 'retest'].includes(a)),
                )
                .map((action) => (
                  <Button
                    key={action}
                    type={
                      ['confirm', 'start', 'fix', 'retest'].includes(action) ? 'primary' : 'default'
                    }
                    onClick={() => act(action)}
                  >
                    {action === 'retest' && defect?.testCases.length
                      ? '发起复测'
                      : (actionLabels[action] ?? action)}
                  </Button>
                ))}
            </Space>
            <Tabs
              items={[
                {
                  key: 'content',
                  label: defect ? '问题详情' : '内容与记录',
                  children: (
                    <>
                      {release && (
                        <>
                          <h3>交付范围 · 第 {release.scopeVersion} 版</h3>
                          <p>{release.description}</p>
                          {release.scope.map((w) => (
                            <p key={w.id}>
                              <Link
                                to={`/projects/${props.project.id}?tab=${w.kind === 'TASK' ? 'tasks' : 'requirements'}&${w.kind === 'TASK' ? 'task' : 'requirement'}=${w.id}`}
                              >
                                {w.code} · {w.title}
                              </Link>
                            </p>
                          ))}
                          <Space>
                            <h3>构建记录</h3>
                            {props.project.status === 'ACTIVE' &&
                              (props.session.user.isSystemAdmin ||
                                hasPermission(props.project.myRoles, 'submission:write') ||
                                hasPermission(props.project.myRoles, 'release:manage')) && (
                                <Button
                                  onClick={() =>
                                    onOperation({
                                      entity: 'builds',
                                      action: 'create',
                                      initial: { releaseId: release.id },
                                    })
                                  }
                                >
                                  登记构建
                                </Button>
                              )}
                          </Space>
                          {!release.builds.total && (
                            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无构建" />
                          )}
                          {release.builds.items.map((b) => (
                            <article className={styles.card} key={b.id}>
                              <strong>{b.identifier}</strong>
                              <p>{b.notes}</p>
                              {b.codeUrl && (
                                <a href={b.codeUrl} target="_blank" rel="noreferrer">
                                  代码链接
                                </a>
                              )}{' '}
                              {b.artifactUrl && (
                                <a href={b.artifactUrl} target="_blank" rel="noreferrer">
                                  产物链接
                                </a>
                              )}
                              <p>{formatTime(b.createdAt)}</p>
                            </article>
                          ))}
                          <Pagination
                            current={page}
                            pageSize={20}
                            total={release.builds.total}
                            hideOnSinglePage
                            showSizeChanger={false}
                            onChange={setPage}
                          />
                        </>
                      )}
                      {defect && (
                        <>
                          {defect.status === 'DEFERRED' && (
                            <Alert
                              type="warning"
                              showIcon
                              title="此缺陷已延期，仍未修复"
                              description={defect.deferUntil ?? '请跟进目标版本'}
                            />
                          )}
                          <section className={styles.detailSection}>
                            <h3>问题描述</h3>
                            <div className={styles.descriptionBlock}>
                              <h4>复现步骤</h4>
                              <p className={styles.content}>{defect.reproduction}</p>
                            </div>
                            <div className={styles.behaviorGrid}>
                              <div className={styles.descriptionBlock}>
                                <h4>预期表现</h4>
                                <p className={styles.content}>{defect.expected}</p>
                              </div>
                              <div className={styles.descriptionBlock}>
                                <h4>实际表现</h4>
                                <p className={styles.content}>{defect.actual}</p>
                              </div>
                            </div>
                            <div className={styles.environment}>
                              <span>发现环境</span>
                              <p className={styles.content}>{defect.environment}</p>
                            </div>
                            <AttachmentImages
                              id={id}
                              targetType="DEFECT"
                              title="问题截图"
                              {...props}
                            />
                          </section>
                          <section className={styles.detailSection}>
                            <h3>处理概览</h3>
                            <dl className={styles.facts}>
                              <div>
                                <dt>开发负责人</dt>
                                <dd>{defect.assignee.name}</dd>
                              </div>
                              <div>
                                <dt>复测负责人</dt>
                                <dd>{defect.retester.name}</dd>
                              </div>
                              <div>
                                <dt>关联需求</dt>
                                <dd>
                                  <Link
                                    to={`/projects/${props.project.id}?tab=requirements&requirement=${defect.requirementId}`}
                                  >
                                    查看需求
                                  </Link>
                                </dd>
                              </div>
                              <div>
                                <dt>发现构建</dt>
                                <dd>{defect.foundBuildIdentifier ?? '未指定'}</dd>
                              </div>
                              <div>
                                <dt>修复构建</dt>
                                <dd>{defect.fixedBuildIdentifier ?? '未指定'}</dd>
                              </div>
                              {defect.duplicateOfId && (
                                <div>
                                  <dt>主缺陷</dt>
                                  <dd>
                                    <Link
                                      to={`/projects/${props.project.id}?tab=defects&defect=${defect.duplicateOfId}`}
                                    >
                                      查看主缺陷
                                    </Link>
                                  </dd>
                                </div>
                              )}
                            </dl>
                          </section>
                        </>
                      )}
                    </>
                  ),
                },
                ...(defect
                  ? [
                      {
                        key: 'related',
                        label: '关联与处理记录',
                        children: (
                          <div className={styles.relatedSection}>
                            <h3>关联测试用例</h3>
                            {defect.testCases.length ? (
                              <Space wrap>
                                {defect.testCases.map((c) => (
                                  <Link
                                    key={c.id}
                                    to={`/projects/${props.project.id}?tab=test-cases&case=${c.id}`}
                                  >
                                    {c.code} · {c.title}
                                  </Link>
                                ))}
                              </Space>
                            ) : (
                              <p>未关联用例</p>
                            )}
                            <h3>关联测试记录</h3>
                            {defect.testRecords.length ? (
                              defect.testRecords.map((r) => (
                                <p key={r.id}>
                                  <Link
                                    to={`/projects/${props.project.id}?tab=records&record=${r.id}`}
                                  >
                                    {r.code} · {r.caseTitle}
                                  </Link>{' '}
                                  <RecordStatus outcome={r.outcome} type={r.type} />
                                </p>
                              ))
                            ) : (
                              <p>未关联测试记录</p>
                            )}
                            <h3>修复及复测历史（{defect.dispositions.total}）</h3>
                            {defect.dispositions.items.map((d) => (
                              <article key={d.id} className={styles.history}>
                                <Space>
                                  <strong>{actionLabels[d.action] ?? d.action}</strong>
                                  <Status status={d.fromStatus} />
                                  <span>→</span>
                                  <Status status={d.toStatus} />
                                </Space>
                                <p>
                                  {d.actor.name} · {formatTime(d.createdAt)}
                                </p>
                                <p className={styles.content}>{d.reason}</p>
                                <p className={styles.content}>{d.evidence}</p>
                              </article>
                            ))}
                            <Pagination
                              current={page}
                              pageSize={20}
                              total={defect.dispositions.total}
                              hideOnSinglePage
                              showSizeChanger={false}
                              onChange={setPage}
                            />
                          </div>
                        ),
                      },
                    ]
                  : []),
                {
                  key: 'history',
                  label: `活动记录 (${row.history.total})`,
                  children: row.history.items.map((h) => (
                    <article className={styles.history} key={h.id}>
                      <strong>{h.actor?.name ?? '历史成员'}</strong> · {formatTime(h.createdAt)}
                      <p>
                        {h.action === 'defect.created'
                          ? h.details &&
                            typeof h.details === 'object' &&
                            'testRecordId' in h.details
                            ? '测试失败自动创建缺陷'
                            : '创建缺陷'
                          : h.action}
                      </p>
                    </article>
                  )),
                },
                {
                  key: 'collaboration',
                  label: '讨论与附件',
                  children: (
                    <CollaborationPanel
                      projectId={props.project.id}
                      session={props.session}
                      target={{
                        targetType: mode === 'releases' ? 'RELEASE' : 'DEFECT',
                        targetId: id,
                      }}
                    />
                  ),
                },
              ]}
            />
          </>
        )}
      </Drawer>
      {seed && (
        <CreateTestRecord
          {...props}
          seed={seed}
          onClose={() => setSeed(null)}
          onCreated={(id) => navigate(`/projects/${props.project.id}?tab=records&record=${id}`)}
        />
      )}
    </>
  );
}
export function ProjectQuality({ mode, project, session }: Common & { mode: Mode }) {
  const [params, setParams] = useSearchParams();
  const [operation, setOperation] = useState<Operation | null>(null);
  const key = mode === 'releases' ? 'release' : 'defect';
  const q = params.get('qq') ?? '';
  const status = params.get('qs') ?? '';
  const page = Math.max(1, Number(params.get('qp')) || 1);
  const id = params.get(key);
  const query = new URLSearchParams({
    q,
    page: String(page),
    pageSize: '20',
    ...(status ? { status } : {}),
  }).toString();
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'quality', mode, query],
    queryFn: async ({ signal }) => {
      const raw = await request(`/projects/${project.id}/quality/${mode}?${query}`, { signal });
      return mode === 'releases' ? releaseListSchema.parse(raw) : defectListSchema.parse(raw);
    },
  });
  const set = (patch: Record<string, string | null>) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      for (const [k, v] of Object.entries(patch))
        if (v) next.set(k, v);
        else next.delete(k);
      return next;
    });
  const title = mode === 'releases' ? '版本与构建' : '缺陷管理';
  return (
    <section>
      <div className={styles.heading}>
        <div>
          <h2>{title}</h2>
          <p>
            {mode === 'releases'
              ? '管理交付范围和构建来源。'
              : '记录问题、修复和复测，关联用例与测试记录。'}
          </p>
        </div>
        {list.data?.canCreate && (
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setOperation({ entity: mode, action: 'create' })}
          >
            {mode === 'releases' ? '新建版本' : '报告缺陷'}
          </Button>
        )}
      </div>
      <Space wrap style={{ marginBottom: 18 }}>
        <Input.Search
          aria-label="搜索质量记录"
          placeholder="搜索标题"
          defaultValue={q}
          onSearch={(v) => set({ qq: v, qp: null })}
          allowClear
        />
        <Select
          aria-label="质量状态筛选"
          placeholder="全部状态"
          allowClear
          value={status || undefined}
          style={{ width: 160 }}
          options={(mode === 'releases'
            ? releaseStatusSchema.options
            : defectStatusSchema.options
          ).map((value) => ({ value, label: qualityLabels[value] ?? value }))}
          onChange={(v) => set({ qs: v ?? null, qp: null })}
        />
      </Space>
      {list.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>重新加载列表</Button>}
        />
      ) : (
        <Table<{
          id: string;
          status: string;
          createdAt: string;
          name?: string;
          title?: string;
          code?: string;
          assignee?: { name: string };
          severity?: string;
        }>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          scroll={{ x: 660 }}
          columns={[
            {
              title: mode === 'releases' ? '版本' : '缺陷',
              key: 'title',
              render: (_, r) => (
                <>
                  <small>{r.code}</small>
                  <Button type="link" onClick={() => set({ [key]: r.id })}>
                    {r.name ?? r.title}
                  </Button>
                </>
              ),
            },
            { title: '状态', key: 'status', render: (_, r) => <Status status={r.status} /> },
            ...(mode === 'defects'
              ? [
                  {
                    title: '严重程度',
                    key: 'severity',
                    render: (_: unknown, r: { severity?: string }) => (
                      <Status status={r.severity ?? ''} />
                    ),
                  },
                  {
                    title: '负责人',
                    key: 'assignee',
                    render: (_: unknown, r: { assignee?: { name: string } }) => r.assignee?.name,
                  },
                ]
              : []),
            { title: '创建时间', dataIndex: 'createdAt', render: formatTime },
          ]}
        />
      )}
      <Pagination
        current={page}
        pageSize={20}
        total={list.data?.total ?? 0}
        hideOnSinglePage
        showSizeChanger={false}
        onChange={(v) => set({ qp: String(v) })}
        style={{ marginTop: 20 }}
      />
      {id && (
        <Detail
          key={`${mode}:${id}`}
          mode={mode}
          id={id}
          project={project}
          session={session}
          onClose={() => set({ [key]: null })}
          onOperation={setOperation}
        />
      )}
      {operation && (
        <QualityModal
          operation={operation}
          project={project}
          session={session}
          onClose={() => setOperation(null)}
          onSaved={(id, entity) => {
            if (entity !== 'builds') set({ [entity === 'releases' ? 'release' : 'defect']: id });
          }}
        />
      )}
    </section>
  );
}
