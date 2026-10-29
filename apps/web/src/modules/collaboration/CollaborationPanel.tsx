import { t, useLocale, getLocale } from '../../i18n';
import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Avatar, Button, Empty, Input, Pagination, Skeleton, Tabs, Upload } from 'antd';
import {
  CommentOutlined,
  DownloadOutlined,
  PaperClipOutlined,
  SendOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import {
  attachmentListSchema,
  commentListSchema,
  type CollaborationTarget,
  type SessionResponse,
} from '@myteam/contracts';
import { ApiError, errorMessage, replaceSession, request } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import styles from './collaboration.module.css';

export function CollaborationPanel({
  projectId,
  target,
  session,
  initialTab = 'comments',
}: {
  projectId: string;
  target: CollaborationTarget;
  session: SessionResponse;
  initialTab?: string;
}) {
  useLocale();
  const [tab, setTab] = useState(initialTab);
  const [commentPage, setCommentPage] = useState(1);
  const [filePage, setFilePage] = useState(1);
  const [body, setBody] = useState('');
  const client = useQueryClient();
  const { message } = App.useApp();
  const base = `/projects/${projectId}/collaboration/${target.targetType}/${target.targetId}`;
  const comments = useQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'comments', target, commentPage],
    queryFn: async ({ signal }) =>
      commentListSchema.parse(await request(`${base}/comments?page=${commentPage}`, { signal })),
  });
  const files = useQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'attachments', target, filePage],
    queryFn: async ({ signal }) =>
      attachmentListSchema.parse(await request(`${base}/attachments?page=${filePage}`, { signal })),
  });
  const comment = useProjectCommand(session, () => {
    setBody('');
    setCommentPage(1);
    comment.reset();
    void message.success(t('评论已发布'));
  });
  const uploadKey = useRef<{ file: File; key: string } | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      if (uploadKey.current?.file !== file) uploadKey.current = { file, key: crypto.randomUUID() };
      return request(`${base}/attachments?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST',
        body: file,
        headers: {
          'Content-Type': 'application/octet-stream',
          'X-CSRF-Token': session.csrfToken,
          'Idempotency-Key': uploadKey.current.key,
        },
        signal: AbortSignal.timeout(60000),
      });
    },
    onSuccess: () => {
      uploadKey.current = null;
      setFilePage(1);
      void client.invalidateQueries({ queryKey: ['projects'] });
      void message.success(t('附件已上传'));
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
      else if (error instanceof ApiError && error.status === 403)
        void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  const retry = (error: unknown, refetch: () => unknown) => (
    <Alert
      showIcon
      type="error"
      title={errorMessage(error)}
      action={<Button onClick={() => void refetch()}>{t('重试')}</Button>}
    />
  );
  return (
    <section className={styles.panel} aria-label={t('协作记录')}>
      <div className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>TEAM CONVERSATIONS</span>
          <h2>{t('让进展与共识留在一起')}</h2>
          <p>{t('记录讨论，补充资料，为下一步留下清晰的依据。')}</p>
        </div>
        <CommentOutlined />
      </div>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          {
            key: 'comments',
            label: (
              <span>
                <CommentOutlined /> {t(' 讨论记录')}
                {comments.data ? ` · ${comments.data.total}` : ''}
              </span>
            ),
            children: (
              <>
                {comments.isPending ? (
                  <Skeleton active />
                ) : comments.isError ? (
                  retry(comments.error, comments.refetch)
                ) : (
                  <>
                    {comments.data.canWrite ? (
                      <div className={styles.composer}>
                        <Input.TextArea
                          disabled={comment.isPending}
                          aria-label={t('评论内容')}
                          placeholder={t('写下你的进展、问题或建议…')}
                          value={body}
                          maxLength={5000}
                          showCount
                          rows={3}
                          onChange={(e) => {
                            setBody(e.target.value);
                            comment.reset();
                          }}
                        />
                        <div>
                          <span>{t('讨论会通知当前负责人')}</span>
                          <Button
                            type="primary"
                            aria-label={t('发布评论')}
                            icon={<SendOutlined aria-hidden />}
                            disabled={!body.trim()}
                            loading={comment.isPending}
                            onClick={() =>
                              comment.mutate({ path: `${base}/comments`, input: { body } })
                            }
                          >
                            {t('发布评论')}
                          </Button>
                        </div>
                      </div>
                    ) : (
                      <p className={styles.hint}>{t('当前对象仅可查看讨论和附件。')}</p>
                    )}
                    {comment.isError &&
                      retry(comment.error, () =>
                        comment.mutate({ path: `${base}/comments`, input: { body } }),
                      )}
                    {!comments.data.items.length ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t('还没有讨论，清晰的共识从第一条记录开始')}
                      />
                    ) : (
                      <div className={styles.records}>
                        {comments.data.items.map((item) => (
                          <article key={item.id}>
                            <Avatar className={styles.avatar}>{item.authorName.slice(0, 1)}</Avatar>
                            <div>
                              <header>
                                <strong>{item.authorName}</strong>
                                <time>{formatTime(item.createdAt)}</time>
                              </header>
                              <p>{item.body}</p>
                            </div>
                          </article>
                        ))}
                      </div>
                    )}
                    <Pagination
                      size="small"
                      current={commentPage}
                      total={comments.data.total}
                      pageSize={20}
                      hideOnSinglePage
                      showSizeChanger={false}
                      onChange={setCommentPage}
                    />
                  </>
                )}
              </>
            ),
          },
          {
            key: 'attachments',
            label: (
              <span>
                <PaperClipOutlined /> {t(' 共享附件')}
                {files.data ? ` · ${files.data.total}` : ''}
              </span>
            ),
            children: (
              <>
                {files.isPending ? (
                  <Skeleton active />
                ) : files.isError ? (
                  retry(files.error, files.refetch)
                ) : (
                  <>
                    {files.data.canWrite && (
                      <div className={styles.upload}>
                        <div>
                          <strong>{t('把资料放在团队找得到的地方')}</strong>
                          <p>{t('图片、PDF、TXT 或 Markdown，单文件最多 20 MiB。')}</p>
                        </div>
                        <Upload
                          accept=".png,.jpg,.jpeg,.webp,.pdf,.txt,.md"
                          showUploadList={false}
                          disabled={upload.isPending}
                          beforeUpload={(file) => {
                            if (!file.size || file.size > 20 * 1024 * 1024) {
                              void message.error(t('附件大小须在 1 字节至 20 MiB 之间'));
                              return false;
                            }
                            upload.mutate(file);
                            return false;
                          }}
                        >
                          <Button
                            aria-label={t('上传附件')}
                            icon={<UploadOutlined aria-hidden />}
                            loading={upload.isPending}
                          >
                            {t('上传附件')}
                          </Button>
                        </Upload>
                      </div>
                    )}
                    {upload.isError && (
                      <Alert
                        showIcon
                        type="error"
                        title={errorMessage(upload.error)}
                        action={
                          upload.variables && (
                            <Button onClick={() => upload.mutate(upload.variables)}>
                              {t('重试')}
                            </Button>
                          )
                        }
                      />
                    )}
                    {!files.data.items.length ? (
                      <Empty
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                        description={t('还没有共享附件')}
                      />
                    ) : (
                      <div className={styles.files}>
                        {files.data.items.map((file) => (
                          <article key={file.id}>
                            <PaperClipOutlined />
                            <div>
                              <strong>{file.filename}</strong>
                              <small>
                                {file.uploaderName} · {formatBytes(file.size)} ·{' '}
                                {formatTime(file.createdAt)}
                              </small>
                            </div>
                            <Button
                              aria-label={t('下载 {{0}}', { '0': file.filename })}
                              icon={<DownloadOutlined />}
                              href={`/api/v1/projects/${projectId}/attachments/${file.id}/download`}
                            >
                              {t('下载')}
                            </Button>
                          </article>
                        ))}
                      </div>
                    )}
                    <Pagination
                      size="small"
                      current={filePage}
                      total={files.data.total}
                      pageSize={20}
                      hideOnSinglePage
                      showSizeChanger={false}
                      onChange={setFilePage}
                    />
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </section>
  );
}
export const formatTime = (value: string) =>
  new Intl.DateTimeFormat(getLocale(), {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Shanghai',
  }).format(new Date(value));
const formatBytes = (size: number) =>
  size < 1024
    ? `${size} B`
    : size < 1024 * 1024
      ? `${(size / 1024).toFixed(1)} KB`
      : `${(size / 1024 / 1024).toFixed(1)} MB`;
