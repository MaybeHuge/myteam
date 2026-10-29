import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, App, Form, Input, Modal } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { ApiError, errorMessage, replaceSession, request } from '../../api/client';

export function ChangePassword({
  session,
  onClose,
}: {
  session: SessionResponse;
  onClose: () => void;
}) {
  const [form] = Form.useForm();
  const client = useQueryClient();
  const { message } = App.useApp();
  const change = useMutation({
    mutationFn: (values: { currentPassword: string; newPassword: string }) =>
      request('/auth/password', {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken },
        body: JSON.stringify(values),
      }),
    onSuccess: () => {
      void message.success('密码已修改，其他登录设备已退出');
      onClose();
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
    },
  });
  return (
    <Modal
      open
      title="修改密码"
      onCancel={() => {
        if (!change.isPending) onClose();
      }}
      onOk={() => form.submit()}
      okText="保存新密码"
      cancelText="取消"
      confirmLoading={change.isPending}
      mask={{ closable: !change.isPending }}
      closable={!change.isPending}
      keyboard={!change.isPending}
    >
      {change.isError && <Alert type="error" showIcon title={errorMessage(change.error)} />}
      <p>修改后，其他设备需要使用新密码重新登录。</p>
      <Form
        form={form}
        layout="vertical"
        disabled={change.isPending}
        onFinish={(values: { currentPassword: string; newPassword: string }) =>
          change.mutate({
            currentPassword: values.currentPassword,
            newPassword: values.newPassword,
          })
        }
      >
        <Form.Item
          name="currentPassword"
          label="原密码"
          rules={[{ required: true, message: '请输入原密码' }]}
        >
          <Input.Password autoComplete="current-password" maxLength={128} />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label="新密码"
          rules={[
            { required: true, message: '请输入新密码' },
            { min: 6, message: '至少需要 6 位' },
            { max: 128 },
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} />
        </Form.Item>
        <Form.Item
          name="confirmPassword"
          label="确认新密码"
          dependencies={['newPassword']}
          rules={[
            { required: true, message: '请再次输入新密码' },
            ({ getFieldValue }) => ({
              validator(_, value) {
                return !value || getFieldValue('newPassword') === value
                  ? Promise.resolve()
                  : Promise.reject(new Error('两次输入的密码不一致'));
              },
            }),
          ]}
        >
          <Input.Password autoComplete="new-password" maxLength={128} />
        </Form.Item>
      </Form>
    </Modal>
  );
}
