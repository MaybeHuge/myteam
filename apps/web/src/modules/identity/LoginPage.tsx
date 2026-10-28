import { Alert, Button, Form, Input, Typography } from 'antd';
import {
  ArrowRightOutlined,
  CheckCircleFilled,
  LockOutlined,
  MailOutlined,
} from '@ant-design/icons';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { loginSchema } from '@myteam/contracts';
import { errorMessage, login, replaceSession } from '../../api/client';

export function LoginPage() {
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (values: { email: string; password: string }) => {
      const input = loginSchema.parse(values);
      return login(input.email, input.password);
    },
    onSuccess: (session) => replaceSession(client, session),
  });
  return (
    <main className="login-layout">
      <section className="login-story" aria-label="MyTeam 团队协作">
        <a href="/" className="brand brand-light">
          <span className="brand-mark">m</span>MyTeam<span className="brand-dot">.</span>
        </a>
        <div className="story-copy">
          <span className="eyebrow">BUILD TOGETHER, DELIVER BETTER</span>
          <h1>
            让团队的每一步，
            <br />
            都走向交付。
          </h1>
          <p>
            连接需求、开发与测试，
            <br />
            让工作有序推进，让协作清晰可见。
          </p>
          <div className="flow-line">
            <span>需求</span>
            <i />
            <span>开发</span>
            <i />
            <span>测试</span>
            <i />
            <span>交付</span>
          </div>
        </div>
        <div className="story-footer">
          <CheckCircleFilled /> 团队协作，从一个共同的工作空间开始
        </div>
        <div className="orbit orbit-one" />
        <div className="orbit orbit-two" />
      </section>
      <section className="login-form-panel">
        <div className="login-form-wrap">
          <span className="form-kicker">你的团队工作空间</span>
          <Typography.Title level={2}>欢迎回来</Typography.Title>
          <Typography.Paragraph type="secondary">
            登录 MyTeam，继续与你的团队一起推进工作。
          </Typography.Paragraph>
          {mutation.isError && (
            <Alert
              type="error"
              showIcon
              title={errorMessage(mutation.error)}
              className="form-alert"
              role="alert"
            />
          )}
          <Form
            layout="vertical"
            requiredMark={false}
            onFinish={(values: { email: string; password: string }) => mutation.mutate(values)}
            autoComplete="on"
          >
            <Form.Item
              name="email"
              label="邮箱"
              rules={[
                { required: true, message: '请输入邮箱' },
                { type: 'email', message: '请输入有效的邮箱地址' },
              ]}
            >
              <Input
                prefix={<MailOutlined />}
                placeholder="输入你的工作邮箱"
                size="large"
                autoComplete="username"
                maxLength={254}
              />
            </Form.Item>
            <Form.Item
              name="password"
              label="密码"
              rules={[{ required: true, message: '请输入密码' }]}
            >
              <Input.Password
                prefix={<LockOutlined />}
                placeholder="输入登录密码"
                size="large"
                autoComplete="current-password"
                maxLength={128}
              />
            </Form.Item>
            <Button
              type="primary"
              htmlType="submit"
              block
              size="large"
              loading={mutation.isPending}
              icon={<ArrowRightOutlined />}
              iconPlacement="end"
            >
              登录工作空间
            </Button>
          </Form>
          <p className="account-note">还没有账号？请联系你的系统管理员。</p>
        </div>
        <footer className="login-footer">MyTeam · 让协作成为交付的力量</footer>
      </section>
    </main>
  );
}
