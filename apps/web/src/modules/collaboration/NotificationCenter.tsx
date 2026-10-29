import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Badge, Button, Drawer, Empty, Pagination, Skeleton, Switch } from 'antd';
import { BellOutlined, CheckOutlined } from '@ant-design/icons';
import { notificationListSchema, type SessionResponse } from '@myteam/contracts';
import { ApiError, errorMessage, replaceSession, request } from '../../api/client';
import { formatTime } from './CollaborationPanel';
import styles from './collaboration.module.css';
export function NotificationCenter({ session }: { session: SessionResponse }) {
  useLocale();
  const [open, setOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const client = useQueryClient();
  const notifications = useQuery({
    queryKey: ['notifications', session.user.id, page, unread],
    queryFn: async ({ signal }) =>
      notificationListSchema.parse(
        await request(`/notifications?page=${page}&unread=${unread}`, { signal }),
      ),
    refetchInterval: 30000,
  });
  const read = useMutation({
    mutationFn: (id: string) =>
      request(`/notifications/${id}/read`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
      }),
    onSuccess: async () => {
      if (unread) setPage(1);
      await client.invalidateQueries({ queryKey: ['notifications'] });
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
    },
  });
  return (
    <>
      <Badge count={notifications.data?.unread ?? 0} size="small">
        <Button
          type="text"
          aria-label={t('站内通知')}
          icon={<BellOutlined />}
          onClick={() => setOpen(true)}
        />
      </Badge>
      <Drawer title={t('站内通知')} open={open} onClose={() => setOpen(false)} size={440}>
        <div className={styles.notificationIntro}>
          <div>
            <span className={styles.eyebrow}>TEAM UPDATES</span>
            <h2>{t('与你有关的进展')}</h2>
            <p>{t('评论、资料和迭代安排，及时接续。')}</p>
          </div>
          <Switch
            checked={unread}
            checkedChildren={t('仅未读')}
            unCheckedChildren={t('全部')}
            aria-label={t('仅看未读通知')}
            onChange={(value) => {
              setUnread(value);
              setPage(1);
            }}
          />
        </div>
        {read.isError && <Alert type="error" showIcon title={errorMessage(read.error)} />}
        {notifications.isPending ? (
          <Skeleton active />
        ) : notifications.isError ? (
          <Alert
            type="error"
            showIcon
            title={errorMessage(notifications.error)}
            action={<Button onClick={() => void notifications.refetch()}>{t('重试')}</Button>}
          />
        ) : (
          <>
            {!notifications.data.items.length ? (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={unread ? t('所有进展都已读完') : t('暂时没有通知')}
              />
            ) : (
              <div className={styles.notifications}>
                {notifications.data.items.map((item) => (
                  <article key={item.id} className={!item.readAt ? styles.unread : ''}>
                    <span className={styles.notificationDot} />
                    <div>
                      <Link
                        to={
                          ['RELEASE', 'TEST_RECORD', 'DEFECT'].includes(item.targetType)
                            ? `/projects/${item.projectId}?tab=${item.targetType === 'RELEASE' ? 'releases' : item.targetType === 'TEST_RECORD' ? 'records' : 'defects'}&${item.targetType === 'RELEASE' ? 'release' : item.targetType === 'TEST_RECORD' ? 'record' : 'defect'}=${item.targetId}`
                            : item.targetType === 'ITERATION'
                              ? `/projects/${item.projectId}?tab=iterations&iteration=${item.targetId}`
                              : item.targetType === 'TASK'
                                ? `/projects/${item.projectId}?tab=tasks&task=${item.targetId}`
                                : item.targetType === 'TEST_CASE'
                                  ? `/projects/${item.projectId}?tab=test-cases&case=${item.targetId}`
                                  : item.targetType === 'REQUIREMENT'
                                    ? `/projects/${item.projectId}?tab=requirements&requirement=${item.targetId}`
                                    : `/projects/${item.projectId}?tab=collaboration`
                        }
                        onClick={() => {
                          if (!item.readAt) read.mutate(item.id);
                          setOpen(false);
                        }}
                      >
                        {t(item.title)}
                      </Link>
                      <time>{formatTime(item.createdAt)}</time>
                      {!item.readAt && (
                        <Button
                          size="small"
                          type="text"
                          aria-label={t('标为已读')}
                          icon={<CheckOutlined aria-hidden />}
                          loading={read.isPending && read.variables === item.id}
                          onClick={() => read.mutate(item.id)}
                        >
                          {t('标为已读')}
                        </Button>
                      )}
                    </div>
                  </article>
                ))}
              </div>
            )}
            <Pagination
              size="small"
              current={page}
              total={notifications.data.total}
              pageSize={20}
              hideOnSinglePage
              showSizeChanger={false}
              onChange={setPage}
            />
          </>
        )}
      </Drawer>
    </>
  );
}
