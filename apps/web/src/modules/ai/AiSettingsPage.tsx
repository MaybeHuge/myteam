import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Button, Card, Form, Input, Modal, Space, Switch, Tag } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { errorMessage, request } from '../../api/client';
import { t, useLocale } from '../../i18n';
import styles from '../projects/projects.module.css';
import { providerLabel } from './provider-label';

type Provider = {
  id: string;
  name: string;
  baseUrl: string;
  model: string;
  enabled: boolean;
  hasKey: boolean;
  version: number;
};
export function AiSettingsPage({ session }: { session: SessionResponse }) {
  useLocale();
  const client = useQueryClient(),
    { message } = App.useApp();
  const [editing, setEditing] = useState<Provider | null>(null);
  const [form] = Form.useForm();
  const query = useQuery({
    queryKey: ['ai-settings', session.user.id],
    queryFn: ({ signal }) => request<Provider[]>('/settings/ai-providers', { signal }),
  });
  const save = useMutation({
    mutationFn: (values: { baseUrl: string; model: string; apiKey?: string; enabled: boolean }) =>
      request(`/settings/ai-providers/${editing!.id}`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify({ ...values, version: editing!.version }),
      }),
    onSuccess: async () => {
      await client.invalidateQueries({ queryKey: ['ai-settings'] });
      await client.invalidateQueries({ queryKey: ['ai-providers'] });
      setEditing(null);
      form.resetFields();
      void message.success(t('AI 平台配置已保存'));
    },
    onError: (error) => {
      if (error instanceof Error) void message.error(errorMessage(error));
    },
  });
  return (
    <>
      <div className={styles.pageIntro}>
        <div>
          <h1>{t('AI 平台设置')}</h1>
          <p>{t('配置团队可使用的 AI 平台和模型。密钥保存后不会再次显示。')}</p>
        </div>
      </div>
      <Alert type="info" showIcon title={t('只有系统管理员可以管理平台。修改配置后立即生效。')} />
      {query.isError && (
        <Alert
          type="error"
          title={errorMessage(query.error)}
          action={<Button onClick={() => void query.refetch()}>{t('重试')}</Button>}
        />
      )}
      <div style={{ display: 'grid', gap: 16, marginTop: 20 }}>
        {query.data?.map((p) => (
          <Card
            key={p.id}
            title={providerLabel(p.id, p.name)}
            extra={
              <Button
                onClick={() => {
                  form.setFieldsValue({ ...p, apiKey: '' });
                  setEditing(p);
                }}
              >
                {t('配置')}
              </Button>
            }
          >
            <Space wrap>
              <Tag color={p.enabled ? 'green' : 'default'}>
                {p.enabled ? t('已启用') : t('未启用')}
              </Tag>
              <span>
                {t('模型')}：{p.model}
              </span>
              <span>{p.hasKey ? t('已配置密钥') : t('未配置密钥')}</span>
            </Space>
          </Card>
        ))}
      </div>
      <Modal
        open={!!editing}
        title={`${t('配置 AI 平台')} · ${editing ? providerLabel(editing.id, editing.name) : ''}`}
        onCancel={() => {
          setEditing(null);
          form.resetFields();
        }}
        confirmLoading={save.isPending}
        onOk={() => form.submit()}
        okText={t('保存')}
        cancelText={t('取消')}
        forceRender
      >
        <Form form={form} layout="vertical" onFinish={(values) => save.mutate(values)}>
          <Form.Item name="baseUrl" label={t('服务地址')} rules={[{ required: true }]}>
            <Input maxLength={500} />
          </Form.Item>
          <Form.Item name="model" label={t('模型')} rules={[{ required: true, whitespace: true }]}>
            <Input maxLength={200} />
          </Form.Item>
          <Form.Item
            name="apiKey"
            label="API Key"
            extra={
              editing?.hasKey
                ? t('留空则保留现有密钥；填写新值可替换。')
                : t('请输入平台 API Key。')
            }
            rules={editing?.hasKey ? [] : [{ required: true, whitespace: true }]}
          >
            <Input.Password autoComplete="new-password" maxLength={4096} />
          </Form.Item>
          <Form.Item name="enabled" label={t('启用平台')} valuePropName="checked">
            <Switch />
          </Form.Item>
        </Form>
      </Modal>
    </>
  );
}
