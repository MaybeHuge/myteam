import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Image, Pagination } from 'antd';
import { attachmentListSchema, type Project, type SessionResponse } from '@myteam/contracts';
import { request } from '../../api/client';
import { projectKey } from '../projects/api';
import styles from './quality.module.css';
type Common = { project: Project; session: SessionResponse };
export function AttachmentImages({
  id,
  project,
  session,
  targetType,
  title,
}: Common & { id: string; targetType: 'DEFECT' | 'TEST_RECORD'; title: string }) {
  useLocale();
  const [page, setPage] = useState(1);
  const images = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'attachment-images',
      targetType,
      id,
      page,
    ],
    queryFn: async ({ signal }) =>
      attachmentListSchema.parse(
        await request(
          `/projects/${project.id}/collaboration/${targetType}/${id}/attachments?page=${page}&pageSize=100`,
          { signal },
        ),
      ),
  });
  if (images.isPending) return null;
  if (images.isError)
    return (
      <Alert
        type="error"
        showIcon
        title={t('图片加载失败')}
        action={<Button onClick={() => void images.refetch()}>{t('重试')}</Button>}
      />
    );
  const files = images.data.items.filter((file) =>
    ['image/png', 'image/jpeg', 'image/webp'].includes(file.contentType),
  );
  if (!files.length && images.data.total <= 100) return null;
  return (
    <div className={styles.defectImages}>
      <h4>{title}</h4>
      {files.length ? (
        <Image.PreviewGroup>
          <div className={styles.defectImageGrid}>
            {files.map((file) => (
              <figure key={file.id}>
                <Image
                  width={160}
                  height={120}
                  style={{ objectFit: 'contain', background: '#f5f8f2' }}
                  alt={file.filename}
                  src={`/api/v1/projects/${project.id}/attachments/${file.id}/preview`}
                />
                <figcaption title={file.filename}>{file.filename}</figcaption>
              </figure>
            ))}
          </div>
        </Image.PreviewGroup>
      ) : (
        <p className={styles.muted}>{t('此页没有图片附件')}</p>
      )}
      <Pagination
        size="small"
        current={page}
        pageSize={100}
        total={images.data.total}
        hideOnSinglePage
        showSizeChanger={false}
        onChange={setPage}
      />
    </div>
  );
}
