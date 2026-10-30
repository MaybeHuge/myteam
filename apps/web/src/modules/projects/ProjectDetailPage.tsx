import { projectRoleLabels, projectStatusLabels } from '../../i18n/labels';
import { t, useLocale, getLocale } from '../../i18n';
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
import { type Project, type SessionResponse } from '@myteam/contracts';
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
  useLocale();
  const activity = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'activity'],
    queryFn: ({ signal }) => loadActivity(project.id, signal),
  });
  const label = (item: NonNullable<typeof activity.data>['items'][number]) => {
    const name = typeof item.details?.name === 'string' ? item.details.name : t('成员');
    switch (item.action) {
      case 'project.created':
        return t('创建了这个项目');
      case 'project.updated':
        return t('更新了项目设置');
      case 'project.status.changed':
        return t('将项目设为{{0}}', {
          '0': projectStatusLabels[item.details?.to as Project['status']] ?? t('新状态'),
        });
      case 'project.member.added':
        return t('添加了 {{0}}', { '0': name });
      case 'project.member.removed':
        return t('移除了 {{0}}', { '0': name });
      case 'project.member.roles.changed':
        return t('调整了 {{0}} 的角色', { '0': name });
      case 'comment.created':
        return t('发布了一条评论');
      case 'requirement.document.create':
        return t('创建了需求文档草稿');
      case 'requirement.document.save':
        return t('保存了需求文档草稿');
      case 'requirement.document.reset':
        return t('重置了需求文档草稿');
      case 'requirement.document.image':
        return t('上传了文档图片 {{0}}', { '0': String(item.details?.filename ?? '') });
      case 'attachment.uploaded':
        return t('上传了附件 {{0}}', { '0': String(item.details?.filename ?? '') });
      case 'iteration.created':
        return t('创建了迭代「{{0}}」', { '0': name });
      case 'iteration.updated':
        return t('更新了迭代「{{0}}」的计划', { '0': name });
      case 'iteration.started':
        return t('启动了迭代「{{0}}」', { '0': name });
      case 'iteration.closed':
        return t('关闭了迭代「{{0}}」', { '0': name });
      default:
        return item.action.startsWith('testCase.')
          ? t('更新了用例「{{0}}」', { '0': String(item.details?.title ?? '') })
          : item.action.startsWith('task.')
            ? t('更新了任务「{{0}}」', { '0': String(item.details?.title ?? '') })
            : item.action.startsWith('requirement.')
              ? t('更新了需求「{{0}}」', { '0': String(item.details?.title ?? '') })
              : t('更新了项目');
    }
  };
  return (
    <section className={styles.activityPanel}>
      <div className={styles.sectionHeading}>
        <h2>{t('最近动态')}</h2>
        <span>{t('项目的每一步，都有迹可循')}</span>
      </div>
      {activity.isPending ? (
        <Skeleton active paragraph={{ rows: 3 }} />
      ) : activity.isError ? (
        <Alert
          showIcon
          type="error"
          title={t('动态暂不可用')}
          action={
            <Button type="link" onClick={() => void activity.refetch()}>
              {t('重试')}
            </Button>
          }
        />
      ) : !activity.data?.items.length ? (
        <p className={styles.muted}>{t('暂无项目动态。')}</p>
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
  useLocale();
  return (
    <div className={styles.detailGrid}>
      <div className={styles.detailMain}>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>
              <FileTextOutlined />
              {t('项目简介')}
            </h2>
            {project.allowedActions.includes('edit') && (
              <Button type="text" size="small" icon={<EditOutlined />} onClick={onEdit}>
                {t('编辑')}
              </Button>
            )}
          </div>
          <p className={styles.projectLongDescription}>
            {project.description ||
              t(
                '还没有填写项目简介。补充项目目标、交付范围与关键背景，让新加入的伙伴更快了解这次协作。',
              )}
          </p>
          <div className={styles.planDates}>
            <div>
              <span className={styles.dateIcon}>
                <CalendarOutlined />
              </span>
              <div>
                <small>{t('计划开始')}</small>
                <strong>{project.startDate ?? t('尚未设置')}</strong>
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
                <small>{t('计划结束')}</small>
                <strong>{project.endDate ?? t('尚未设置')}</strong>
              </div>
            </div>
          </div>
        </section>
        <Activity project={project} session={session} />
      </div>
      <aside className={styles.detailAside}>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>{t('项目信息')}</h2>
          </div>
          <dl className={styles.projectFacts}>
            <div>
              <dt>{t('项目标识')}</dt>
              <dd>
                <span className={styles.projectCode}>{project.key}</span>
              </dd>
            </div>
            <div>
              <dt>{t('当前状态')}</dt>
              <dd>
                <ProjectStatus status={project.status} />
              </dd>
            </div>
            <div>
              <dt>{t('负责人')}</dt>
              <dd className={styles.ownerInline}>
                <PersonAvatar name={project.owner.name} />
                {project.owner.name}
              </dd>
            </div>
            <div>
              <dt>{t('创建日期')}</dt>
              <dd>
                {new Intl.DateTimeFormat(getLocale(), { timeZone: 'Asia/Shanghai' }).format(
                  new Date(project.createdAt),
                )}
              </dd>
            </div>
            <div>
              <dt>{t('最近更新')}</dt>
              <dd>{relativeDate(project.updatedAt)}</dd>
            </div>
          </dl>
        </section>
        <section className={styles.overviewPanel}>
          <div className={styles.sectionHeading}>
            <h2>
              {t('项目成员')}
              <span className={styles.countPill}>{project.memberCount}</span>
            </h2>
            <Button
              type="text"
              size="small"
              aria-label={t('查看所有成员')}
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
                  <small>{person.id === project.owner.id ? t('项目负责人') : t('团队成员')}</small>
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
              {t('邀请伙伴加入协作')}
            </Button>
          )}
        </section>
        <div className={styles.accessNote}>
          <SafetyCertificateOutlined />
          <div>
            <strong>{project.access === 'ADMIN' ? t('管理员访问') : t('项目权限已启用')}</strong>
            <p>
              {project.access === 'ADMIN'
                ? t('你正在以系统管理员身份查看此项目。')
                : t('项目信息仅向授权成员开放，角色决定可执行的操作。')}
            </p>
          </div>
        </div>
      </aside>
    </div>
  );
}

export function ProjectDetailPage({ session }: { session: SessionResponse }) {
  useLocale();
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
    void message.success(t('项目状态已更新'));
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
        title={t('项目暂不可访问')}
        subTitle={errorMessage(projectQuery.error)}
        extra={
          <Space>
            <Button onClick={() => void projectQuery.refetch()}>{t('重新加载项目')}</Button>
            <Link to={backTo}>
              <Button type="primary">{t('返回项目空间')}</Button>
            </Link>
          </Space>
        }
      />
    );
  return (
    <>
      <Link className={styles.backLink} to={backTo} aria-label={t('返回项目空间')}>
        <ArrowLeftOutlined aria-hidden />
        {t('返回项目空间')}
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
                {project.memberCount} {t(' 位成员')}
              </span>
              <span>
                <ClockCircleOutlined />
                {t('{{0}}更新', { 0: relativeDate(project.updatedAt) })}
              </span>
            </div>
          </div>
        </div>
        <Space wrap>
          {project.allowedActions.includes('edit') && (
            <Button
              aria-label={t('项目设置')}
              icon={<EditOutlined aria-hidden />}
              onClick={() => setEditing(project)}
            >
              {t('项目设置')}
            </Button>
          )}
          {project.allowedActions.includes('pause') && (
            <Button
              aria-label={t('暂停项目')}
              icon={<PauseOutlined aria-hidden />}
              onClick={() => openState('pause')}
            >
              {t('暂停项目')}
            </Button>
          )}
          {(project.allowedActions.includes('start') ||
            project.allowedActions.includes('resume')) && (
            <Button
              aria-label={project.status === 'PENDING' ? t('启动项目') : t('继续项目')}
              type="primary"
              icon={<PlayCircleOutlined aria-hidden />}
              onClick={() => openState(project.status === 'PENDING' ? 'start' : 'resume')}
            >
              {project.status === 'PENDING' ? t('启动项目') : t('继续项目')}
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
              project.myRoles.map((role) => projectRoleLabels[role]).join('、') || t('系统管理员')
            }
          >
            <span className={styles.accessPill}>
              <SafetyCertificateOutlined />
              {project.access === 'ADMIN'
                ? t('管理员视图')
                : project.myRoles.includes('VIEWER') && project.myRoles.length === 1
                  ? t('只读访问')
                  : t('项目成员')}
            </span>
          </Tooltip>
        }
        items={[
          {
            key: 'overview',
            label: t('项目概览'),
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
            label: t('迭代计划'),
            children: <ProjectIterations project={project} session={session} />,
          },
          {
            key: 'requirements',
            label: t('需求管理'),
            children: <ProjectRequirements project={project} session={session} />,
          },
          {
            key: 'tasks',
            label: t('任务管理'),
            children: <ProjectTasks project={project} session={session} />,
          },
          {
            key: 'test-cases',
            label: t('测试用例'),
            children: <ProjectTestCases project={project} session={session} />,
          },
          {
            key: 'releases',
            label: t('版本与构建'),
            children: <ProjectQuality mode="releases" project={project} session={session} />,
          },
          {
            key: 'records',
            label: t('测试记录'),
            children: <ProjectTestRecords project={project} session={session} />,
          },
          {
            key: 'defects',
            label: t('缺陷管理'),
            children: <ProjectQuality mode="defects" project={project} session={session} />,
          },
          {
            key: 'collaboration',
            label: t('讨论与附件'),
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
                {t('成员与权限 ')}
                <span className={styles.tabCount}>{project.memberCount}</span>
              </span>
            ),
            children: <ProjectMembers project={project} session={session} />,
          },
        ]}
      />
      {editing && (
        <ProjectEditor open project={editing} session={session} onClose={() => setEditing(null)} />
      )}
      <Modal
        open={!!stateAction}
        title={
          stateAction === 'pause'
            ? t('暂停这个项目？')
            : stateAction === 'resume'
              ? t('继续推进项目')
              : t('准备好启动了吗？')
        }
        onCancel={() => setStateAction(null)}
        onOk={() => stateForm.submit()}
        confirmLoading={command.isPending}
        okText={
          stateAction === 'pause'
            ? t('确认暂停')
            : stateAction === 'resume'
              ? t('确认继续')
              : t('确认启动')
        }
        cancelText={t('取消')}
        destroyOnHidden
        afterClose={() => {
          stateForm.resetFields();
          command.reset();
        }}
      >
        <p className={styles.drawerDescription}>
          {stateAction === 'pause'
            ? t('记录暂停原因，让团队知道当前的安排。你可以在准备就绪后继续项目。')
            : t('「{{0}}」将进入进行中状态，与团队一起把目标向前推进。', { '0': project.name })}
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
              label={t('暂停原因')}
              rules={[{ required: true, whitespace: true, message: t('请填写暂停原因') }]}
            >
              <Input.TextArea
                maxLength={500}
                rows={3}
                placeholder={t('例如：等待业务方案确认后继续推进')}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </>
  );
}
