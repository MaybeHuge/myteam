import { ProjectTestRecords } from '../quality/ProjectTestRecords';
import { CollaborationPanel } from '../collaboration/CollaborationPanel';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Form,
  Input,
  Modal,
  Result,
  Skeleton,
  Space,
  Tabs,
  Tooltip,
} from 'antd';
import {
  ArrowLeftOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  CheckOutlined,
  ClockCircleOutlined,
  CrownOutlined,
  EditOutlined,
  FileTextOutlined,
  PauseOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import {
  projectRoleLabels,
  projectStatusLabels,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { ApiError, errorMessage } from '../../api/client';
import { projectListReturn } from './navigation';
import { loadActivity, loadProject, projectKey, useProjectCommand } from './api';
import { PersonAvatar, ProjectIcon, ProjectStatus, relativeDate } from './presentation';
import { ProjectEditor } from './ProjectEditor';
import { ProjectMembers } from './ProjectMembers';
import { ProjectQuality } from '../quality/ProjectQuality';
import { ProjectTestCases } from '../test-cases/ProjectTestCases';
import { ProjectTasks } from '../tasks/ProjectTasks';
import { ProjectRequirements } from '../requirements/ProjectRequirements';
import { ProjectIterations } from '../iterations/ProjectIterations';
import styles from './projects.module.css';

function Activity({ project, session }: { project: Project; session: SessionResponse }) {
  const activity = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'activity'],
    queryFn: ({ signal }) => loadActivity(project.id, signal),
  });
  const label = (item: NonNullable<typeof activity.data>['items'][number]) => {
    const name = typeof item.details?.name === 'string' ? item.details.name : '成员';
    switch (item.action) {
      case 'project.created':
        return '创建了这个项目';
      case 'project.updated':
        return '更新了项目设置';
      case 'project.status.changed':
        return `将项目设为${projectStatusLabels[item.details?.to as Project['status']] ?? '新状态'}`;
      case 'project.member.added':
        return `添加了 ${name}`;
      case 'project.member.removed':
        return `移除了 ${name}`;
      case 'project.member.roles.changed':
        return `调整了 ${name} 的角色`;
      case 'comment.created':
        return '发布了一条评论';
      case 'attachment.uploaded':
        return `上传了附件 ${String(item.details?.filename ?? '')}`;
      case 'iteration.created':
        return `创建了迭代「${name}」`;
      case 'iteration.updated':
        return `更新了迭代「${name}」的计划`;
      case 'iteration.started':
        return `启动了迭代「${name}」`;
      case 'iteration.closed':
        return `关闭了迭代「${name}」`;
      default:
        return item.action.startsWith('testCase.')
          ? `更新了用例「${String(item.details?.title ?? '')}」`
          : item.action.startsWith('task.')
            ? `更新了任务「${String(item.details?.title ?? '')}」`
            : item.action.startsWith('requirement.')
              ? `更新了需求「${String(item.details?.title ?? '')}」`
              : '更新了项目';
    }
  };
  return (
    <section className={styles.activityPanel}>
      <div className={styles.sectionHeading}>
        <h2>最近动态</h2>
        <span>项目的每一步，都有迹可循</span>
      </div>
      {activity.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : activity.isError ? (
        <Alert
          showIcon
          type="error"
          title="动态暂不可用"
          action={
            <Button type="link" onClick={() => void activity.refetch()}>
              重试
            </Button>
          }
        />
      ) : !activity.data?.items.length ? (
        <p className={styles.muted}>暂无项目动态。</p>
      ) : (
        <div className={styles.activityList}>
          {activity.data.items.map((item, index) => (
            <div className={styles.activityItem} key={item.id}>
              <PersonAvatar name={item.actorName} index={index} size={30} />
              <div>
                <p>
                  <strong>{item.actorName}</strong> {label(item)}
                </p>
                <span>{relativeDate(item.createdAt)}</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function ProjectOverview({
  project,
  session,
  onEdit,
  onMembers,
}: {
  project: Project;
  session: SessionResponse;
  onEdit: () => void;
  onMembers: () => void;
}) {
  return (
    <div className={styles.detailGrid}>
      <div className={styles.detailMain}>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>
              <FileTextOutlined />
              项目简介
            </h2>
            {project.allowedActions.includes('edit') && (
              <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit}>
                编辑
              </Button>
            )}
          </div>
          <p className={styles.projectLongDescription}>
            {project.description ||
              '还没有填写项目简介。补充项目目标、交付范围与关键背景，让新加入的伙伴更快了解这次协作。'}
          </p>
          <div className={styles.planDates}>
            <div>
              <span className={styles.dateIcon}>
                <CalendarOutlined />
              </span>
              <div>
                <small>计划开始</small>
                <strong>{project.startDate ?? '尚未设置'}</strong>
              </div>
            </div>
            <span className={styles.dateConnector}>
              <ArrowRightOutlined />
            </span>
            <div>
              <span className={styles.dateIcon}>
                <CheckOutlined />
              </span>
              <div>
                <small>计划结束</small>
                <strong>{project.endDate ?? '尚未设置'}</strong>
              </div>
            </div>
          </div>
        </section>
        <Activity project={project} session={session} />
      </div>
      <aside className={styles.detailAside}>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>项目信息</h2>
          </div>
          <dl className={styles.projectFacts}>
            <div>
              <dt>项目标识</dt>
              <dd>
                <span className={styles.projectCode}>{project.key}</span>
              </dd>
            </div>
            <div>
              <dt>当前状态</dt>
              <dd>
                <ProjectStatus status={project.status} />
              </dd>
            </div>
            <div>
              <dt>负责人</dt>
              <dd className={styles.ownerInline}>
                <PersonAvatar name={project.owner.name} />
                {project.owner.name}
              </dd>
            </div>
            <div>
              <dt>创建日期</dt>
              <dd>
                {new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai' }).format(
                  new Date(project.createdAt),
                )}
              </dd>
            </div>
            <div>
              <dt>最近更新</dt>
              <dd>{relativeDate(project.updatedAt)}</dd>
            </div>
          </dl>
        </section>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>
              项目成员<span className={styles.countPill}>{project.memberCount}</span>
            </h2>
            <Button
              type="text"
              size="small"
              aria-label="查看所有成员"
              icon={<ArrowRightOutlined />}
              onClick={onMembers}
            />
          </div>
          <div className={styles.teamPreview}>
            {project.memberPreview.map((person, index) => (
              <div key={person.id}>
                <PersonAvatar name={person.name} index={index} size={34} />
                <div>
                  <strong>{person.name}</strong>
                  <small>{person.id === project.owner.id ? '项目负责人' : '团队成员'}</small>
                </div>
                {person.id === project.owner.id && <CrownOutlined />}
              </div>
            ))}
          </div>
          {project.allowedActions.includes('manageMembers') && (
            <Button
              className={styles.addTeamButton}
              icon={<PlusOutlined />}
              block
              onClick={onMembers}
            >
              邀请伙伴加入协作
            </Button>
          )}
        </section>
        <div className={styles.accessNote}>
          <SafetyCertificateOutlined />
          <div>
            <strong>{project.access === 'ADMIN' ? '管理员访问' : '项目权限已启用'}</strong>
            <p>
              {project.access === 'ADMIN'
                ? '你正在以系统管理员身份查看此项目。'
                : '项目信息仅向授权成员开放，角色决定可执行的操作。'}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ProjectDetailPage({ session }: { session: SessionResponse }) {
  const { projectId = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const { message } = App.useApp();
  const [editing, setEditing] = useState<Project | null>(null);
  const [stateAction, setStateAction] = useState<'start' | 'pause' | 'resume' | null>(null);
  const [stateVersion, setStateVersion] = useState(0);
  const [stateForm] = Form.useForm();
  const projectQuery = useQuery({
    queryKey: projectKey(session.user.id, projectId),
    queryFn: ({ signal }) => loadProject(projectId, signal),
  });
  const command = useProjectCommand(session, () => {
    void message.success('项目状态已更新');
    setStateAction(null);
  });
  const project = projectQuery.data;
  const openState = (action: 'start' | 'pause' | 'resume') => {
    if (project) {
      setStateVersion(project.version);
      setStateAction(action);
    }
  };
  const tab = [
    'members',
    'iterations',
    'requirements',
    'tasks',
    'test-cases',
    'releases',
    'records',
    'defects',
    'collaboration',
  ].includes(params.get('tab') ?? '')
    ? params.get('tab')!
    : 'overview';
  const backTo = projectListReturn(params);
  const goTab = (value: string) =>
    setParams((previous) => {
      const next = new URLSearchParams();
      const list = previous.get('list');
      if (list) next.set('list', list);
      if (value !== 'overview') next.set('tab', value);
      return next;
    });
  if (projectQuery.isPending)
    return (
      <div className={styles.detailLoading}>
        <Skeleton active avatar={{ size: 64 }} paragraph={{ rows: 8 }} />
      </div>
    );
  if (projectQuery.isError || !project)
    return (
      <Result
        status={
          projectQuery.error instanceof ApiError &&
          [400, 403, 404].includes(projectQuery.error.status)
            ? '404'
            : '500'
        }
        title="项目暂不可访问"
        subTitle={errorMessage(projectQuery.error)}
        extra={
          <Space>
            <Button onClick={() => void projectQuery.refetch()}>重新加载项目</Button>
            <Link to={backTo}>
              <Button type="primary">返回项目空间</Button>
            </Link>
          </Space>
        }
      />
    );
  return (
    <>
      <Link className={styles.backLink} to={backTo} aria-label="返回项目空间">
        <ArrowLeftOutlined aria-hidden />
        返回项目空间
      </Link>
      <div className={styles.detailHeader}>
        <div className={styles.detailIdentity}>
          <ProjectIcon project={project} size="large" />
          <div>
            <div className={styles.detailCode}>
              {project.key}
              <ProjectStatus status={project.status} />
            </div>
            <h1>{project.name}</h1>
            <div className={styles.detailMeta}>
              <span>
                <CrownOutlined />
                {project.owner.name}
              </span>
              <span>
                <TeamOutlined />
                {project.memberCount} 位成员
              </span>
              <span>
                <ClockCircleOutlined />
                {relativeDate(project.updatedAt)}更新
              </span>
            </div>
          </div>
        </div>
        <Space wrap>
          {project.allowedActions.includes('edit') && (
            <Button
              aria-label="项目设置"
              icon={<EditOutlined aria-hidden />}
              onClick={() => setEditing(project)}
            >
              项目设置
            </Button>
          )}
          {project.allowedActions.includes('pause') && (
            <Button
              aria-label="暂停项目"
              icon={<PauseOutlined aria-hidden />}
              onClick={() => openState('pause')}
            >
              暂停项目
            </Button>
          )}
          {(project.allowedActions.includes('start') ||
            project.allowedActions.includes('resume')) && (
            <Button
              aria-label={project.status === 'PENDING' ? '启动项目' : '继续项目'}
              type="primary"
              icon={<PlayCircleOutlined aria-hidden />}
              onClick={() => openState(project.status === 'PENDING' ? 'start' : 'resume')}
            >
              {project.status === 'PENDING' ? '启动项目' : '继续项目'}
            </Button>
          )}
        </Space>
      </div>
      <Tabs
        className={styles.detailTabs}
        activeKey={tab}
        onChange={goTab}
        tabBarExtraContent={
          <Tooltip
            title={
              project.myRoles.map((role) => projectRoleLabels[role]).join('、') || '系统管理员'
            }
          >
            <span className={styles.accessPill}>
              <SafetyCertificateOutlined />
              {project.access === 'ADMIN'
                ? '管理员视图'
                : project.myRoles.includes('VIEWER') && project.myRoles.length === 1
                  ? '只读访问'
                  : '项目成员'}
            </span>
          </Tooltip>
        }
        items={[
          {
            key: 'overview',
            label: '项目概览',
            children: (
              <ProjectOverview
                project={project}
                session={session}
                onEdit={() => setEditing(project)}
                onMembers={() => goTab('members')}
              />
            ),
          },
          {
            key: 'iterations',
            label: '迭代计划',
            children: <ProjectIterations project={project} session={session} />,
          },
          {
            key: 'requirements',
            label: '需求管理',
            children: <ProjectRequirements project={project} session={session} />,
          },
          {
            key: 'tasks',
            label: '任务管理',
            children: <ProjectTasks project={project} session={session} />,
          },
          {
            key: 'test-cases',
            label: '测试用例',
            children: <ProjectTestCases project={project} session={session} />,
          },
          {
            key: 'releases',
            label: '版本与构建',
            children: <ProjectQuality mode="releases" project={project} session={session} />,
          },
          {
            key: 'records',
            label: '测试记录',
            children: <ProjectTestRecords project={project} session={session} />,
          },
          {
            key: 'defects',
            label: '缺陷管理',
            children: <ProjectQuality mode="defects" project={project} session={session} />,
          },
          {
            key: 'collaboration',
            label: '讨论与附件',
            children: (
              <CollaborationPanel
                key={project.id}
                projectId={project.id}
                target={{ targetType: 'PROJECT', targetId: project.id }}
                session={session}
              />
            ),
          },
          {
            key: 'members',
            label: (
              <span>
                成员与权限 <span className={styles.tabCount}>{project.memberCount}</span>
              </span>
            ),
            children: <ProjectMembers project={project} session={session} />,
          },
        ]}
      />
      <ProjectEditor
        key={project.id}
        open={!!editing}
        project={editing ?? project}
        session={session}
        onClose={() => setEditing(null)}
      />
      <Modal
        open={!!stateAction}
        title={
          stateAction === 'pause'
            ? '暂停这个项目？'
            : stateAction === 'resume'
              ? '继续推进项目'
              : '准备好启动了吗？'
        }
        onCancel={() => setStateAction(null)}
        onOk={() => stateForm.submit()}
        confirmLoading={command.isPending}
        okText={
          stateAction === 'pause' ? '确认暂停' : stateAction === 'resume' ? '确认继续' : '确认启动'
        }
        cancelText="取消"
        destroyOnHidden
        afterClose={() => {
          stateForm.resetFields();
          command.reset();
        }}
      >
        <p className={styles.drawerDescription}>
          {stateAction === 'pause'
            ? '记录暂停原因，让团队知道当前的安排。你可以在准备就绪后继续项目。'
            : `「${project.name}」将进入进行中状态，与团队一起把目标向前推进。`}
        </p>
        {command.isError && <Alert showIcon type="error" title={errorMessage(command.error)} />}
        <Form
          form={stateForm}
          layout="vertical"
          onFinish={(values: { reason?: string }) =>
            command.mutate({
              path: `/projects/${project.id}/status`,
              input: {
                status: stateAction === 'pause' ? 'PAUSED' : 'ACTIVE',
                version: stateVersion,
                reason: values.reason ?? '',
              },
            })
          }
        >
          {stateAction === 'pause' && (
            <Form.Item
              name="reason"
              label="暂停原因"
              rules={[{ required: true, whitespace: true, message: '请填写暂停原因' }]}
            >
              <Input.TextArea
                maxLength={500}
                rows={3}
                placeholder="例如：等待业务方案确认后继续推进"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
