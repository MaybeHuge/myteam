import { t, localizeLabels, useLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, App, Button, Form, Input, Modal, Pagination, Select, Space, Tag } from 'antd';
import {
  hasPermission,
  releaseCheckSchema,
  releaseEventListSchema,
  releaseDetailSchema,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import type { z } from 'zod';
import { request, errorMessage } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import { formatTime } from '../collaboration/CollaborationPanel';
import { QualityPicker } from './QualityPicker';
import styles from './quality.module.css';

type Release = z.infer<typeof releaseDetailSchema>;
type Mode = 'publish' | 'verify' | 'rollback';
const labels: Record<string, string> = localizeLabels({
  PUBLISH_SUCCESS: '发布成功',
  PUBLISH_FAILED: '发布失败',
  VERIFY_PASSED: '上线验证通过',
  VERIFY_FAILED: '上线验证失败',
  ROLLBACK: '已回滚',
});
function localNow() {
  const now = new Date();
  return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
}
export function ReleasePublication({
  project,
  session,
  release,
}: {
  project: Project;
  session: SessionResponse;
  release: Release;
}) {
  useLocale();
  const [buildId, setBuildId] = useState<string>();
  const [page, setPage] = useState(1);
  const [mode, setMode] = useState<Mode | null>(null);
  const canManage =
    project.status === 'ACTIVE' &&
    (session.user.isSystemAdmin || hasPermission(project.myRoles, 'release:manage'));
  const base = `/projects/${project.id}/quality/releases/${release.id}`;
  const check = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'release-check',
      release.id,
      buildId ?? '',
    ],
    queryFn: async ({ signal }) =>
      releaseCheckSchema.parse(
        await request(`${base}/check${buildId ? `?buildId=${encodeURIComponent(buildId)}` : ''}`, {
          signal,
        }),
      ),
    enabled: release.status !== 'RELEASED' && release.status !== 'ARCHIVED',
  });
  const events = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'release-events', release.id, page],
    queryFn: async ({ signal }) =>
      releaseEventListSchema.parse(
        await request(`${base}/events?page=${page}&pageSize=20`, { signal }),
      ),
  });
  return (
    <section className={styles.releaseDelivery}>
      <h3>{t('发布与上线')}</h3>
      {release.status !== 'RELEASED' && release.status !== 'ARCHIVED' && (
        <>
          <p className={styles.muted}>
            {t('选择本次实际发布的构建，系统会检查版本范围内的需求和严重缺陷。')}
          </p>
          <Form layout="vertical">
            <Form.Item label={t('发布构建')}>
              <QualityPicker
                projectId={project.id}
                session={session}
                kind="builds"
                validateBuildScope
                releaseId={release.id}
                value={buildId}
                onChange={(value) => setBuildId(typeof value === 'string' ? value : undefined)}
              />
            </Form.Item>
          </Form>
          {check.isPending ? (
            <p className={styles.muted}>{t('正在检查发布条件…')}</p>
          ) : check.isError ? (
            <Alert
              type="error"
              showIcon
              title={errorMessage(check.error)}
              action={<Button onClick={() => void check.refetch()}>{t('重试')}</Button>}
            />
          ) : check.data.canPublish ? (
            <Alert
              type="success"
              showIcon
              title={t('发布检查通过')}
              description={t('已检查需求状态和构建范围；请确认该构建已完成必要测试。')}
            />
          ) : (
            <Alert
              type="warning"
              showIcon
              title={t('发布前需要处理')}
              description={
                <ul className={styles.releaseIssues}>
                  {check.data.issues.map((issue, index) => (
                    <li key={`${issue.kind}-${issue.id}-${index}`}>
                      {issue.id && (issue.kind === 'REQUIREMENT' || issue.kind === 'DEFECT') ? (
                        <Link
                          to={`/projects/${project.id}?tab=${issue.kind === 'DEFECT' ? 'defects' : 'requirements'}&${issue.kind === 'DEFECT' ? 'defect' : 'requirement'}=${issue.id}`}
                        >
                          {t(issue.message)}
                        </Link>
                      ) : (
                        t(issue.message)
                      )}
                    </li>
                  ))}
                </ul>
              }
            />
          )}
          {canManage && (
            <Button
              type="primary"
              className={styles.releaseAction}
              disabled={!buildId || !check.data?.canPublish || check.isFetching}
              onClick={() => setMode('publish')}
            >
              {t('登记发布')}
            </Button>
          )}
        </>
      )}
      {release.status === 'RELEASED' && (
        <>
          <Alert
            type="success"
            showIcon
            title={t('已登记发布')}
            description={
              release.activePublish
                ? t('发布构建：{{0}}', { '0': release.activePublish.buildIdentifier })
                : t('此版本没有可操作的发布记录。')
            }
          />
          {canManage && release.activePublish && (
            <Space wrap className={styles.releaseAction}>
              <Button type="primary" onClick={() => setMode('verify')}>
                {t('登记上线验证')}
              </Button>
              <Button onClick={() => setMode('rollback')}>{t('登记回滚')}</Button>
            </Space>
          )}
        </>
      )}
      <h4>{t('交付记录')}</h4>
      {events.isPending ? (
        <p>{t('加载中…')}</p>
      ) : events.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(events.error)}
          action={<Button onClick={() => void events.refetch()}>{t('重试')}</Button>}
        />
      ) : (
        <>
          {!events.data.items.length && <p className={styles.muted}>{t('暂无交付记录')}</p>}
          {events.data.items.map((event) => (
            <article className={styles.history} key={event.id}>
              <Space wrap>
                <strong>{labels[event.kind]}</strong>
                <Tag>{event.buildIdentifier}</Tag>
              </Space>
              <p>
                {event.actor.name} · {formatTime(event.occurredAt)}
              </p>
              {event.notes && <p className={styles.content}>{event.notes}</p>}
            </article>
          ))}
          <Pagination
            current={page}
            pageSize={20}
            total={events.data.total}
            hideOnSinglePage
            showSizeChanger={false}
            onChange={setPage}
          />
        </>
      )}
      {mode && (
        <DeliveryModal
          mode={mode}
          release={release}
          session={session}
          buildId={buildId}
          base={base}
          onClose={() => setMode(null)}
          onSaved={() => {
            setMode(null);
            setPage(1);
          }}
        />
      )}
    </section>
  );
}

function DeliveryModal({
  mode,
  release,
  session,
  buildId,
  base,
  onClose,
  onSaved,
}: {
  mode: Mode;
  release: Release;
  session: SessionResponse;
  buildId?: string;
  base: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  useLocale();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand(session, () => {
    void message.success(t('交付记录已保存'));
    onSaved();
  });
  return (
    <Modal
      open
      zIndex={1300}
      title={{ publish: t('登记发布'), verify: t('登记上线验证'), rollback: t('登记回滚') }[mode]}
      onCancel={onClose}
      onOk={() => form.submit()}
      okText={t('保存记录')}
      confirmLoading={command.isPending}
    >
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          occurredAt: localNow(),
          outcome: mode === 'publish' ? 'SUCCESS' : 'PASSED',
        }}
        onFinish={(values: { occurredAt: string; outcome: string; notes?: string }) => {
          command.mutate({
            path: `${base}/${mode === 'publish' ? 'publish' : 'followup'}`,
            input: {
              version: release.version,
              occurredAt: new Date(values.occurredAt).toISOString(),
              notes: values.notes ?? '',
              ...(mode === 'publish'
                ? { buildId, outcome: values.outcome }
                : {
                    publishId: release.activePublish?.id,
                    outcome: mode === 'rollback' ? 'ROLLBACK' : values.outcome,
                  }),
            },
          });
        }}
      >
        {mode === 'publish' && (
          <Form.Item name="outcome" label={t('发布结果')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'SUCCESS', label: t('成功') },
                { value: 'FAILED', label: t('失败') },
              ]}
            />
          </Form.Item>
        )}
        {mode === 'verify' && (
          <Form.Item name="outcome" label={t('验证结果')} rules={[{ required: true }]}>
            <Select
              options={[
                { value: 'PASSED', label: t('通过') },
                { value: 'FAILED', label: t('失败') },
              ]}
            />
          </Form.Item>
        )}
        <Form.Item
          name="occurredAt"
          label={
            mode === 'publish' ? t('发布时间') : mode === 'rollback' ? t('回滚时间') : t('验证时间')
          }
          rules={[
            { required: true, message: t('请选择时间') },
            {
              validator: (_, value) =>
                !value || !Number.isNaN(new Date(value).getTime())
                  ? Promise.resolve()
                  : Promise.reject(new Error(t('请选择有效时间'))),
            },
          ]}
        >
          <Input type="datetime-local" />
        </Form.Item>
        <Form.Item
          name="notes"
          label={
            mode === 'publish'
              ? t('发布说明（选填）')
              : mode === 'rollback'
                ? t('回滚说明（选填）')
                : t('验证说明（选填）')
          }
        >
          <Input.TextArea rows={3} maxLength={5000} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
