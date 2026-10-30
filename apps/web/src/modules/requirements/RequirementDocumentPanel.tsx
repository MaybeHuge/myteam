import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Skeleton, Space, Tag } from 'antd';
import { Link } from 'react-router';
import { requirementDocumentSchema, type SessionResponse } from '@myteam/contracts';
import { request, errorMessage } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { projectKey } from '../projects/api';
import { DocumentView, documentUrl } from './DocumentView';
export function RequirementDocumentPanel({
  projectId,
  requirementId,
  session,
}: {
  projectId: string;
  requirementId: string;
  session: SessionResponse;
}) {
  useLocale();
  const query = useQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'requirement-document', requirementId],
    queryFn: async ({ signal }) =>
      requirementDocumentSchema.parse(
        await request(`/projects/${projectId}/requirements/${requirementId}/document`, { signal }),
      ),
  });
  if (query.isPending) return <Skeleton active />;
  if (query.isError)
    return (
      <Alert
        type="error"
        showIcon
        title={errorMessage(query.error)}
        action={<Button onClick={() => void query.refetch()}>{t('重试')}</Button>}
      />
    );
  const data = query.data;
  return (
    <>
      <Space wrap style={{ marginBottom: 16 }}>
        {data.current && <Tag>{t('文档 V{{0}}', { 0: data.current.number })}</Tag>}
        {data.hasPendingChanges && <Tag color="orange">{t('有未应用的文档草稿')}</Tag>}
        <Link to={documentUrl(projectId, requirementId)}>
          <Button>
            {data.current
              ? t('打开完整文档')
              : data.canEdit
                ? t('创建或编辑需求文档')
                : t('查看文档')}
          </Button>
        </Link>
      </Space>
      {data.current ? (
        <DocumentView
          content={data.current.content}
          projectId={projectId}
          requirementId={requirementId}
        />
      ) : (
        <Empty description={data.draft ? t('文档草稿尚未应用到需求') : t('此需求尚无文档')} />
      )}
    </>
  );
}
