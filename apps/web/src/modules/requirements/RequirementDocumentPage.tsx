import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import { Alert, Button, Empty, Pagination, Skeleton, Space, Spin, Tag } from 'antd';
import { ArrowLeftOutlined, EditOutlined, FileTextOutlined } from '@ant-design/icons';
import {
  requirementDocumentSchema,
  documentVersionListSchema,
  type RequirementDocument,
  type SessionResponse,
} from '@myteam/contracts';
import { request, errorMessage } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { projectKey, useProjectCommand } from '../projects/api';
import { formatTime } from '../collaboration/CollaborationPanel';
import { DocumentView, documentUrl } from './DocumentView';
import styles from './documents.module.css';
const DocumentEditor = lazy(() => import('./DocumentEditor'));
export function RequirementDocumentPage({ session }: { session: SessionResponse }) {
  useLocale();
  const { projectId = '', requirementId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const versionId = params.get('versionId');
  const [page, setPage] = useState(1);
  const entered = useRef(false);
  const [editing, setEditing] = useState<RequirementDocument | null>(null);
  const [generation, setGeneration] = useState(0);
  const [startError, setStartError] = useState('');
  const base = `/projects/${projectId}/requirements/${requirementId}/document`;
  const detail = useQuery({
    queryKey: [
      ...projectKey(session.user.id, projectId),
      'requirement-document',
      requirementId,
      versionId,
    ],
    queryFn: async ({ signal }) =>
      requirementDocumentSchema.parse(
        await request(`${base}${versionId ? `?versionId=${encodeURIComponent(versionId)}` : ''}`, {
          signal,
        }),
      ),
  });
  const history = useQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'document-versions', requirementId, page],
    queryFn: async ({ signal }) =>
      documentVersionListSchema.parse(
        await request(`${base}/versions?page=${page}&pageSize=10`, { signal }),
      ),
  });
  const create = useProjectCommand(session);
  const data = detail.data;
  useEffect(() => {
    if (!entered.current && params.get('edit') === '1' && data?.canEdit && data.draft) {
      entered.current = true;
      setEditing(data);
    }
  }, [data, params]);
  const begin = async (template: 'blank' | 'requirement' = 'blank') => {
    if (!data) return;
    setStartError('');
    try {
      if (!data.draft) await create.mutateAsync({ path: base, input: { template } });
      const fresh = await detail.refetch();
      if (fresh.data?.draft && fresh.data.canEdit) setEditing(fresh.data);
      if (fresh.error) setStartError(errorMessage(fresh.error));
    } catch (error) {
      setStartError(errorMessage(error));
    }
  };
  const applied = async () => {
    await detail.refetch();
    setEditing(null);
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        next.delete('edit');
        return next;
      },
      { replace: true },
    );
  };
  const reload = async () => {
    const fresh = await detail.refetch();
    if (!fresh.data?.draft || fresh.error) throw fresh.error ?? new Error(t('无法加载文档草稿'));
    setEditing(fresh.data);
    setGeneration((n) => n + 1);
  };
  return (
    <div className={styles.page}>
      <Link
        aria-label={t('返回当前需求')}
        to={`/projects/${projectId}?tab=requirements&requirement=${requirementId}`}
      >
        <ArrowLeftOutlined /> {t('返回当前需求')}
      </Link>
      <div className={styles.header}>
        <div>
          <small>{data?.requirement.code}</small>
          <h1>
            <FileTextOutlined /> {data?.requirement.title ?? t('需求文档')}
          </h1>
          <small>
            {editing ? t('正在编辑工作草稿') : versionId ? t('历史文档版本，只读') : t('需求文档')}
          </small>
        </div>
        <Space wrap>
          {data?.current && <Tag>{t('文档 V{{0}}', { 0: data.current.number })}</Tag>}
          {!editing && data?.canEdit && (data.draft || data.current) && (
            <Button
              aria-label={t('编辑文档草稿')}
              icon={<EditOutlined />}
              onClick={() => void begin()}
            >
              {t('编辑文档草稿')}
            </Button>
          )}
          {versionId && (
            <Link to={documentUrl(projectId, requirementId)}>
              <Button>{t('返回当前文档')}</Button>
            </Link>
          )}
        </Space>
      </div>
      {detail.isError && (
        <Alert
          type="error"
          showIcon
          title={errorMessage(detail.error)}
          action={<Button onClick={() => void detail.refetch()}>{t('重试')}</Button>}
        />
      )}
      {startError && <Alert type="error" showIcon title={t(startError)} />}
      {data?.hasPendingChanges && !editing && (
        <Alert
          type="warning"
          showIcon
          title={t('有未应用的文档草稿')}
          description={t(
            '评审和阅读使用已应用的文档版本。工作草稿需要明确应用后才会改变需求内容。',
          )}
        />
      )}
      <div className={styles.sheet}>
        {editing?.draft ? (
          <Suspense fallback={<Spin />}>
            <DocumentEditor
              key={`${requirementId}:${generation}`}
              initial={editing}
              session={session}
              onApplied={applied}
              onReload={reload}
            />
          </Suspense>
        ) : detail.isPending ? (
          <Skeleton active />
        ) : data?.current ? (
          <>
            <small className={styles.muted}>
              {data.current.createdBy.name} · {formatTime(data.current.createdAt)}
            </small>
            <DocumentView
              content={data.current.content}
              projectId={projectId}
              requirementId={requirementId}
            />
          </>
        ) : (
          <Empty description={data?.draft ? t('文档草稿尚未应用到需求') : t('此需求尚无文档')}>
            {data?.canEdit && (
              <Space wrap>
                {data.draft ? (
                  <Button type="primary" onClick={() => void begin()}>
                    {t('继续编辑草稿')}
                  </Button>
                ) : (
                  <>
                    <Button
                      type="primary"
                      loading={create.isPending}
                      onClick={() => void begin('blank')}
                    >
                      {t('创建空白文档')}
                    </Button>
                    <Button loading={create.isPending} onClick={() => void begin('requirement')}>
                      {t('使用需求模板')}
                    </Button>
                  </>
                )}
              </Space>
            )}
          </Empty>
        )}
      </div>
      {!editing && (
        <section className={styles.history}>
          <h2>{t('文档历史')}</h2>
          {history.isError ? (
            <Alert
              type="error"
              showIcon
              title={errorMessage(history.error)}
              action={<Button onClick={() => void history.refetch()}>{t('重试')}</Button>}
            />
          ) : history.isPending ? (
            <Skeleton active />
          ) : history.data.items.length ? (
            <>
              {history.data.items.map((version) => (
                <div className={styles.version} key={version.id}>
                  <Link to={documentUrl(projectId, requirementId, version.id)}>
                    {t('查看文档 V{{0}}', { 0: version.number })}
                  </Link>
                  <small>
                    {version.createdBy.name} · {formatTime(version.createdAt)}
                  </small>
                </div>
              ))}
              <Pagination
                current={page}
                total={history.data.total}
                pageSize={10}
                hideOnSinglePage
                showSizeChanger={false}
                onChange={setPage}
              />
            </>
          ) : (
            <p className={styles.muted}>{t('应用文档后将在这里保留固定版本')}</p>
          )}
        </section>
      )}
    </div>
  );
}
