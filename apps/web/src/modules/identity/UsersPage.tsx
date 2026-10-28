import { EmptyPage } from '../../shared/EmptyPage';
import { readPage } from '../../shared/list-state';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
  Typography,
  App,
} from 'antd';
import { useState } from 'react';
import { useProjectCommand } from '../projects/api';
import styles from '../projects/projects.module.css';
import { ReloadOutlined, SearchOutlined, TeamOutlined, UserAddOutlined } from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { managedUsersSchema, type ManagedUser, type SessionResponse } from '@myteam/contracts';
import { useSearchParams } from 'react-router';
import { ApiError, errorMessage, replaceSession, request } from '../../api/client';

export function UsersPage({ session }: { session: SessionResponse }) {
  const client = useQueryClient();
  const [creating, setCreating] = useState(false);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const [params, setParams] = useSearchParams();
  const search = params.get('q') ?? '';
  const current = readPage(params.get('page'));
  const users = useQuery({
    queryKey: ['users', session.user.id, current, search],
    queryFn: async ({ signal }) =>
      managedUsersSchema.parse(
        await request(`/users?page=${current}&pageSize=10&q=${encodeURIComponent(search)}`, {
          signal,
        }),
      ),
  });
  const data = users.isError ? undefined : users.data;
  const create = useProjectCommand<{ id: string }>(session, () => {
    void client.invalidateQueries({ queryKey: ['users'] });
    void message.success('账号已创建，可以将该成员加入项目');
    setCreating(false);
  });
  const mutation = useMutation({
    mutationFn: (user: ManagedUser) =>
      request(`/users/${user.id}/status`, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': crypto.randomUUID() },
        body: JSON.stringify({ active: !user.active, version: user.version }),
      }),
    onSuccess: async () => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['users'] }),
        client.invalidateQueries({ queryKey: ['projects'] }),
      ]);
      void message.success('账号状态已更新');
    },
    onError: (error) => {
      void message.error(errorMessage(error));
      if (error instanceof ApiError && error.status === 401) {
        void replaceSession(client, null);
      }
    },
  });
  return (
    <>
      <div className={styles.pageIntro}>
        <div>
          <span className={styles.eyebrow}>PEOPLE / 成员与访问</span>
          <h1>
            账号管理
            <span aria-hidden="true" className={styles.headingDot}>
              .
            </span>
          </h1>
          <p>查看工作空间成员，管理账号的访问状态。</p>
        </div>
        <Space>
          <Button
            aria-label="新建账号"
            type="primary"
            icon={<UserAddOutlined aria-hidden />}
            onClick={() => setCreating(true)}
          >
            新建账号
          </Button>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => void users.refetch()}
            loading={users.isFetching}
          >
            刷新
          </Button>
        </Space>
      </div>
      {users.isError && (
        <Alert
          showIcon
          type="error"
          title={errorMessage(users.error)}
          action={<Button onClick={() => void users.refetch()}>重试</Button>}
        />
      )}
      <div className="people-summary">
        <div>
          <span>工作空间账号</span>
          <strong>{data?.stats.total ?? '—'}</strong>
          <small>共用一个协作空间</small>
        </div>
        <div>
          <span>可用账号</span>
          <strong>{data?.stats.active ?? '—'}</strong>
          <small>可以登录并参与协作</small>
        </div>
        <div>
          <span>已停用</span>
          <strong>{data?.stats.inactive ?? '—'}</strong>
          <small>已收回登录权限</small>
        </div>
      </div>
      <Card
        className="content-card"
        extra={
          <Input
            maxLength={100}
            aria-label="搜索账号"
            placeholder="搜索姓名或邮箱"
            value={search}
            allowClear
            prefix={<SearchOutlined />}
            onChange={(event) =>
              setParams(event.target.value ? { q: event.target.value } : {}, { replace: true })
            }
            className="people-search"
          />
        }
        title={
          <Space>
            <TeamOutlined />
            工作空间账号
          </Space>
        }
      >
        {data && data.total > 0 && !data.items.length ? (
          <EmptyPage onReset={() => setParams(search ? { q: search } : {})} />
        ) : (
          <Table<ManagedUser>
            rowKey="id"
            dataSource={data?.items}
            loading={users.isPending}
            pagination={{
              current,
              total: data?.total,
              pageSize: 10,
              showSizeChanger: false,
              onChange: (page) =>
                setParams({ ...(search ? { q: search } : {}), page: String(page) }),
            }}
            scroll={{ x: 640 }}
            locale={{ emptyText: <Empty description="暂无账号" /> }}
            columns={[
              {
                title: '成员',
                dataIndex: 'name',
                render: (name: string, user) => (
                  <div className="user-cell">
                    <span className="small-avatar">{name.slice(0, 1)}</span>
                    <div>
                      <strong>{name}</strong>
                      <Typography.Text type="secondary" className="user-email">
                        {user.email}
                      </Typography.Text>
                    </div>
                  </div>
                ),
              },
              {
                title: '系统角色',
                dataIndex: 'isSystemAdmin',
                render: (value: boolean) => (
                  <Tag color={value ? 'blue' : 'default'}>{value ? '系统管理员' : '普通成员'}</Tag>
                ),
              },
              {
                title: '状态',
                dataIndex: 'active',
                render: (value: boolean) => (
                  <Tag color={value ? 'success' : 'default'}>{value ? '可用' : '已停用'}</Tag>
                ),
              },
              {
                title: '操作',
                render: (_, user) =>
                  user.isSystemAdmin ? (
                    <Typography.Text type="secondary">—</Typography.Text>
                  ) : (
                    <Popconfirm
                      title={user.active ? '停用该账号？' : '启用该账号？'}
                      description={
                        user.active ? '该成员的现有登录将立即失效。' : '该成员将可以重新登录。'
                      }
                      onConfirm={() => mutation.mutateAsync(user).then(() => undefined)}
                      okText="确认"
                      cancelText="取消"
                    >
                      <Button
                        aria-label={user.active ? '停用' : '启用'}
                        aria-busy={mutation.isPending && mutation.variables?.id === user.id}
                        type="link"
                        danger={user.active}
                        loading={mutation.isPending && mutation.variables?.id === user.id}
                      >
                        {user.active ? '停用' : '启用'}
                      </Button>
                    </Popconfirm>
                  ),
              },
            ]}
          />
        )}
      </Card>
      <Drawer
        open={creating}
        onClose={() => setCreating(false)}
        size={480}
        destroyOnHidden
        title={
          <span className={styles.drawerTitle}>
            <UserAddOutlined />
            新建工作空间账号
          </span>
        }
        afterOpenChange={(open) => {
          if (!open) {
            form.resetFields();
            create.reset();
          }
        }}
        footer={
          <div className={styles.drawerFooter}>
            <span>新账号默认没有项目访问权限</span>
            <Space>
              <Button onClick={() => setCreating(false)}>取消</Button>
              <Button type="primary" loading={create.isPending} onClick={() => form.submit()}>
                创建账号
              </Button>
            </Space>
          </div>
        }
      >
        <p className={styles.drawerDescription}>
          先为伙伴建立账号，再由项目负责人添加到对应项目。初始密码请通过合适的渠道告知本人。
        </p>
        {create.isError && (
          <Alert
            type="error"
            showIcon
            title={errorMessage(create.error)}
            className={styles.inlineAlert}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          clearOnDestroy
          requiredMark="optional"
          onFinish={(values: { name: string; email: string; password: string }) =>
            create.mutate({ path: '/users', input: values })
          }
        >
          <Form.Item
            name="name"
            label="姓名"
            rules={[{ required: true, whitespace: true, message: '请输入姓名' }, { max: 80 }]}
          >
            <Input size="large" placeholder="伙伴的名字" autoFocus />
          </Form.Item>
          <Form.Item
            name="email"
            label="登录邮箱"
            rules={[
              { required: true, message: '请输入邮箱' },
              { type: 'email', message: '请输入有效邮箱' },
            ]}
          >
            <Input placeholder="name@company.com" autoComplete="off" maxLength={254} />
          </Form.Item>
          <Form.Item
            name="password"
            label="初始密码"
            extra="至少 12 位，不会通过站内通知或邮件自动发送。"
            rules={[
              { required: true, message: '请设置初始密码' },
              { min: 12, message: '至少需要 12 位' },
              { max: 128 },
            ]}
          >
            <Input.Password
              autoComplete="new-password"
              placeholder="为账号设置初始密码"
              maxLength={128}
            />
          </Form.Item>
          <div className={styles.permissionNote}>
            账号的系统角色为普通成员，具体项目权限由项目内角色决定。
          </div>
        </Form>
      </Drawer>
    </>
  );
}
