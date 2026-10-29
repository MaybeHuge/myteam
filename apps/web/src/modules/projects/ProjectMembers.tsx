import { projectRoleLabels } from '../../i18n/labels';
import { t, localizeLabels, useLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { EmptyPage } from '../../shared/EmptyPage';
import { readPage } from '../../shared/list-state';
import { useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Drawer,
  Form,
  Input,
  Popconfirm,
  Space,
  Table,
  Tag,
} from 'antd';
import {
  CrownOutlined,
  SearchOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  UserAddOutlined,
} from '@ant-design/icons';
import {
  projectRoles,
  type Project,
  type ProjectMember,
  type ProjectRole,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { loadMembers, projectKey, useProjectCommand } from './api';
import { PersonAvatar } from './presentation';
import { MemberSelect } from './MemberSelect';
import styles from './projects.module.css';

const descriptions: Record<ProjectRole, string> = localizeLabels({
  OWNER: '管理项目设置、成员与交付',
  PRODUCT: '维护需求，评审与业务验收',
  DEVELOPER: '开发任务、构建登记和缺陷修复',
  TESTER: '用例、测试记录与缺陷复测',
  RELEASE_MANAGER: '检查版本，登记发布与验证',
  VIEWER: '仅此角色时只可浏览',
});
function RolePicker({
  value = [],
  onChange,
  protectOwner = false,
}: {
  value?: ProjectRole[];
  onChange?: (value: ProjectRole[]) => void;
  protectOwner?: boolean;
}) {
  useLocale();
  return (
    <Checkbox.Group
      value={value}
      onChange={(values) => onChange?.(values as ProjectRole[])}
      className={styles.roleGrid}
    >
      {projectRoles.map((role) => (
        <Checkbox
          key={role}
          className={`${styles.roleOption} ${value.includes(role) ? styles.roleSelected : ''}`}
          value={role}
          aria-label={projectRoleLabels[role]}
          disabled={protectOwner && role === 'OWNER'}
        >
          <span>
            <strong>{projectRoleLabels[role]}</strong>
            <small>{descriptions[role]}</small>
          </span>
        </Checkbox>
      ))}
    </Checkbox.Group>
  );
}

function MemberDrawer({
  project,
  session,
  member,
  onClose,
}: {
  project: Project;
  session: SessionResponse;
  member?: ProjectMember;
  onClose: () => void;
}) {
  useLocale();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand(session, () => {
    void message.success(member ? t('项目角色已更新') : t('成员已加入项目'));
    onClose();
  });
  return (
    <Drawer
      open
      onClose={onClose}
      size={540}
      destroyOnHidden
      title={
        <span className={styles.drawerTitle}>
          <UserAddOutlined />
          {member ? t('调整项目角色') : t('添加项目成员')}
        </span>
      }
      footer={
        <div className={styles.drawerFooter}>
          <span>{t('每一个角色，都有清晰的责任')}</span>
          <Space>
            <Button aria-label={t('取消')} onClick={onClose}>
              {t('取消')}
            </Button>
            <Button
              aria-label={member ? t('保存角色') : t('添加到项目')}
              type="primary"
              icon={!member ? <PlusOutlined aria-hidden /> : undefined}
              loading={command.isPending}
              onClick={() => form.submit()}
            >
              {member ? t('保存角色') : t('添加到项目')}
            </Button>
          </Space>
        </div>
      }
    >
      <p className={styles.drawerDescription}>
        {member ? (
          <>
            {t('为 ')}
            <strong>{member.user.name}</strong> {t(' 选择在「')}
            {project.name}
            {t('」中的协作角色。')}
          </>
        ) : (
          t('从已有账号中选择伙伴，支持按姓名或邮箱搜索。新账号可由系统管理员在账号管理中创建。')
        )}
      </p>
      {command.isError && (
        <Alert
          className={styles.inlineAlert}
          type="error"
          showIcon
          title={errorMessage(command.error)}
        />
      )}
      <Form
        layout="vertical"
        form={form}
        initialValues={member ? { roles: member.roles } : { roles: ['DEVELOPER'] }}
        onFinish={(values: { email?: string; roles: ProjectRole[] }) =>
          command.mutate({
            path: member
              ? `/projects/${project.id}/members/${member.user.id}/roles`
              : `/projects/${project.id}/members`,
            input: member ? { roles: values.roles, version: member.version } : values,
          })
        }
      >
        {!member && (
          <Form.Item
            name="email"
            label={t('选择成员')}
            extra={t('仅显示尚未加入本项目的可用账号。')}
            rules={[{ required: true, message: t('请选择要添加的成员') }]}
          >
            <MemberSelect projectId={project.id} userId={session.user.id} />
          </Form.Item>
        )}
        <Form.Item
          name="roles"
          label={t('项目角色')}
          rules={[{ required: true, type: 'array', min: 1, message: t('至少选择一个角色') }]}
        >
          <RolePicker protectOwner={member?.user.id === project.owner.id} />
        </Form.Item>
        {member?.user.id === project.owner.id && (
          <div className={styles.permissionNote}>
            <CrownOutlined />
            <span>{t('主负责人必须保留负责人角色；如需移交，请在项目设置中更换负责人。')}</span>
          </div>
        )}
      </Form>
    </Drawer>
  );
}

export function ProjectMembers({
  project,
  session,
}: {
  project: Project;
  session: SessionResponse;
}) {
  useLocale();
  const [params, setParams] = useSearchParams();
  const page = readPage(params.get('mp'));
  const q = params.get('mq') ?? '';
  const setPage = (page: number) =>
    setParams((previous) => {
      const next = new URLSearchParams(previous);
      if (page > 1) next.set('mp', String(page));
      else next.delete('mp');
      return next;
    });
  const [dialog, setDialog] = useState<{ open: boolean; member?: ProjectMember }>({ open: false });
  const { message } = App.useApp();
  const navigate = useNavigate();
  const canManage = project.allowedActions.includes('manageMembers');
  const members = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'members', page, q],
    queryFn: ({ signal }) => loadMembers(project.id, page, 20, signal, q),
  });
  const data = members.isError ? undefined : members.data;
  const remove = useProjectCommand(session, () => {
    void message.success(t('成员已移出项目'));
  });
  return (
    <section className={styles.membersPanel}>
      <div className={styles.panelHeading}>
        <div>
          <h2>
            {t('一起推进项目的人')}
            <span className={styles.countPill}>{project.memberCount}</span>
          </h2>
          <p>{t('明确分工与权限，让每个人在合适的位置协作。')}</p>
        </div>
        {canManage && (
          <Button
            aria-label={t('添加成员')}
            type="primary"
            icon={<UserAddOutlined aria-hidden />}
            onClick={() => {
              setDialog({ open: true });
            }}
          >
            {t('添加成员')}
          </Button>
        )}
      </div>
      <div className={styles.permissionNote}>
        <SafetyCertificateOutlined />
        <span>
          {canManage
            ? t('多选时会合并所选角色的权限。调整后，访问权限立即生效。')
            : t('你可以查看项目成员；成员与角色由项目负责人管理。')}
        </span>
      </div>
      <Input
        aria-label={t('搜索项目成员')}
        placeholder={t('搜索项目成员姓名或邮箱')}
        maxLength={100}
        prefix={<SearchOutlined />}
        value={q}
        allowClear
        className={styles.memberSearch}
        onChange={(event) =>
          setParams(
            (previous) => {
              const next = new URLSearchParams(previous);
              if (event.target.value) next.set('mq', event.target.value);
              else next.delete('mq');
              next.delete('mp');
              return next;
            },
            { replace: true },
          )
        }
      />
      {members.isError && (
        <Alert
          showIcon
          type="error"
          title={errorMessage(members.error)}
          action={<Button onClick={() => void members.refetch()}>{t('重试')}</Button>}
        />
      )}
      {remove.isError && (
        <Alert
          showIcon
          type="error"
          className={styles.inlineAlert}
          title={errorMessage(remove.error)}
        />
      )}
      {data && data.total > 0 && !data.items.length ? (
        <EmptyPage onReset={() => setPage(1)} />
      ) : (
        <Table<ProjectMember>
          rowKey={(member) => member.user.id}
          dataSource={data?.items}
          loading={members.isPending}
          scroll={{ x: 680 }}
          pagination={{
            current: page,
            pageSize: 20,
            total: data?.total,
            showSizeChanger: false,
            onChange: setPage,
          }}
          columns={[
            {
              title: t('成员'),
              render: (_, member) => (
                <div className={styles.memberIdentity}>
                  <PersonAvatar name={member.user.name} size={36} />
                  <span>
                    <strong>
                      {member.user.name}
                      {member.user.id === session.user.id && (
                        <span className={styles.youLabel}>{t('你')}</span>
                      )}
                    </strong>
                    <small>{member.user.email}</small>
                  </span>
                </div>
              ),
            },
            {
              title: t('项目角色'),
              render: (_, member) => (
                <div className={styles.roleTags}>
                  {member.roles.map((role) => (
                    <span
                      className={`${styles.roleTag} ${role === 'OWNER' ? styles.ownerRole : ''}`}
                      key={role}
                    >
                      {role === 'OWNER' && <CrownOutlined />}
                      {projectRoleLabels[role]}
                    </span>
                  ))}
                </div>
              ),
            },
            {
              title: t('状态'),
              render: (_, member) => (
                <Tag color={member.user.active ? 'success' : 'default'}>
                  {member.user.active ? t('可用') : t('已停用')}
                </Tag>
              ),
            },
            {
              title: t('操作'),
              render: (_, member) =>
                canManage ? (
                  <Space size={4}>
                    <Button
                      type="link"
                      size="small"
                      onClick={() => setDialog({ open: true, member })}
                    >
                      {t('调整角色')}
                    </Button>
                    {member.user.id !== project.owner.id ? (
                      <Popconfirm
                        title={t('移除{{0}}？', { '0': member.user.name })}
                        description={t('移除后将失去本项目的访问权限，账号会保留。')}
                        okText={t('移除成员')}
                        cancelText={t('取消')}
                        onConfirm={async () => {
                          try {
                            await remove.mutateAsync({
                              path: `/projects/${project.id}/members/${member.user.id}/remove`,
                              input: { version: member.version },
                            });
                            if (member.user.id === session.user.id) navigate('/projects');
                          } catch {
                            /* 错误由面板展示，保留当前操作上下文。 */
                          }
                        }}
                      >
                        <Button
                          type="text"
                          danger
                          size="small"
                          loading={
                            remove.isPending && remove.variables?.path.includes(member.user.id)
                          }
                        >
                          {t('移除')}
                        </Button>
                      </Popconfirm>
                    ) : (
                      <span className={styles.primaryOwnerLabel}>{t('主负责人')}</span>
                    )}
                  </Space>
                ) : (
                  <span className={styles.muted}>{t('仅查看')}</span>
                ),
            },
          ]}
        />
      )}
      {dialog.open && (
        <MemberDrawer
          project={project}
          session={session}
          member={dialog.member}
          onClose={() => setDialog({ open: false })}
        />
      )}
    </section>
  );
}
