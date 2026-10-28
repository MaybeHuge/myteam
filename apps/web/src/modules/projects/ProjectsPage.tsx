import { readPage } from '../../shared/list-state';
import { EmptyPage } from '../../shared/EmptyPage';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router';
import {
  Alert,
  Button,
  Dropdown,
  Empty,
  Input,
  Pagination,
  Segmented,
  Select,
  Skeleton,
  Table,
} from 'antd';
import {
  AppstoreOutlined,
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  FolderOpenOutlined,
  MoreOutlined,
  PauseCircleOutlined,
  PlusOutlined,
  SearchOutlined,
  UnorderedListOutlined,
} from '@ant-design/icons';
import { projectStatusLabels, type Project, type SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { projectHref } from './navigation';
import { loadProjects } from './api';
import { ProjectEditor } from './ProjectEditor';
import { formatDate, PersonAvatar, ProjectIcon, ProjectStatus, relativeDate } from './presentation';
import styles from './projects.module.css';

export function ProjectCard({
  project,
  onEdit,
}: {
  project: Project;
  onEdit?: (project: Project) => void;
}) {
  const navigate = useNavigate();
  const location = useLocation();
  return (
    <article className={styles.projectCard}>
      <div className={styles.cardTop}>
        <ProjectIcon project={project} />
        <div className={styles.cardTopActions}>
          <ProjectStatus status={project.status} />
          <Dropdown
            trigger={['click']}
            menu={{
              items: [
                {
                  key: 'view',
                  label: '查看项目',
                  onClick: () => navigate(projectHref(project.id, location)),
                },
                ...(onEdit && project.allowedActions.includes('edit')
                  ? [{ key: 'edit', label: '编辑项目', onClick: () => onEdit(project) }]
                  : []),
              ],
            }}
          >
            <Button
              type="text"
              size="small"
              aria-label={`${project.name}更多操作`}
              icon={<MoreOutlined />}
            />
          </Dropdown>
        </div>
      </div>
      <Link className={styles.cardTitle} to={projectHref(project.id, location)}>
        {project.name}
        <ArrowRightOutlined />
      </Link>
      <p className={styles.cardDescription}>
        {project.description || '还没有项目简介，清晰的目标是高效协作的开始。'}
      </p>
      <div className={styles.cardMetadata}>
        <span className={styles.projectCode}>{project.key}</span>
        <span>
          <CalendarOutlined />
          {project.endDate ? `${formatDate(project.endDate)} 计划结束` : '未设结束日期'}
        </span>
      </div>
      <div className={styles.cardFooter}>
        <div className={styles.avatarStack}>
          {project.memberPreview.map((person, index) => (
            <PersonAvatar key={person.id} name={person.name} index={index} />
          ))}
          <span className={styles.memberCount}>{project.memberCount} 位成员</span>
        </div>
        <span className={styles.updatedAt}>{relativeDate(project.updatedAt)}更新</span>
      </div>
    </article>
  );
}

export function ProjectStats({
  stats,
}: {
  stats?: { total: number; active: number; pending: number; paused: number };
}) {
  const items = [
    {
      label: '全部项目',
      value: stats?.total,
      icon: <FolderOpenOutlined />,
      tone: 'teal',
      caption: '你可访问的项目空间',
    },
    {
      label: '进行中',
      value: stats?.active,
      icon: <CheckCircleOutlined />,
      tone: 'blue',
      caption: '向着共同目标推进',
    },
    {
      label: '待启动',
      value: stats?.pending,
      icon: <ClockCircleOutlined />,
      tone: 'violet',
      caption: '准备开启新的协作',
    },
    {
      label: '已暂停',
      value: stats?.paused,
      icon: <PauseCircleOutlined />,
      tone: 'amber',
      caption: '等待合适时机继续',
    },
  ];
  return (
    <div className={styles.statsGrid}>
      {items.map((item) => (
        <div className={styles.statCard} key={item.label}>
          <div>
            <span className={styles.statLabel}>{item.label}</span>
            <strong>{item.value ?? '—'}</strong>
            <small>{item.caption}</small>
          </div>
          <span className={`${styles.statIcon} ${styles[item.tone]}`}>{item.icon}</span>
        </div>
      ))}
    </div>
  );
}

export function ProjectsPage({ session }: { session: SessionResponse }) {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const [editor, setEditor] = useState<{ open: boolean; project?: Project }>({ open: false });
  const search = params.get('q') ?? '';
  const scope = params.get('scope') ?? 'all';
  const status = params.get('status') ?? '';
  const view = params.get('view') === 'list' ? 'list' : 'grid';
  const page = readPage(params.get('page'));
  const query = new URLSearchParams({
    q: search,
    scope,
    page: String(page),
    pageSize: '9',
    ...(status ? { status } : {}),
  });
  const projects = useQuery({
    queryKey: ['projects', session.user.id, 'list', query.toString()],
    queryFn: ({ signal }) => loadProjects(query.toString(), signal),
  });
  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    if (key !== 'page' && key !== 'view') next.delete('page');
    setParams(next, { replace: key === 'q' });
  };
  const data = projects.isError ? undefined : projects.data;
  return (
    <>
      <div className={styles.pageIntro}>
        <div>
          <span className={styles.eyebrow}>PROJECTS / 项目协作</span>
          <h1>
            项目空间
            <span aria-hidden="true" className={styles.headingDot}>
              .
            </span>
          </h1>
          <p>把目标变成有序的行动，让每一次协作更进一步。</p>
        </div>
        {session.user.isSystemAdmin && (
          <Button
            className={styles.primaryAction}
            aria-label="新建项目"
            type="primary"
            size="large"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditor({ open: true })}
          >
            新建项目
          </Button>
        )}
      </div>
      <ProjectStats stats={data?.stats} />
      <div className={styles.projectSection}>
        <div className={styles.toolbar}>
          <Segmented
            aria-label="项目范围"
            value={scope}
            onChange={(value) => update('scope', value)}
            options={[
              { label: '全部项目', value: 'all' },
              { label: '我负责的', value: 'owned' },
              { label: '我参与的', value: 'joined' },
            ]}
          />
          <div className={styles.toolbarFilters}>
            <Input
              maxLength={100}
              aria-label="搜索项目"
              placeholder="搜索项目名称或标识"
              value={search}
              onChange={(event) => update('q', event.target.value)}
              allowClear
              prefix={<SearchOutlined />}
              className={styles.searchInput}
            />
            <Select
              aria-label="项目状态筛选"
              value={status}
              onChange={(value) => update('status', value)}
              className={styles.statusFilter}
              options={[
                { value: '', label: '全部状态' },
                ...Object.entries(projectStatusLabels).map(([value, label]) => ({ value, label })),
              ]}
            />
            <div className={styles.viewSwitcher} role="group" aria-label="显示方式">
              <Button
                type="text"
                className={view === 'grid' ? styles.viewActive : ''}
                aria-label="卡片视图"
                aria-pressed={view === 'grid'}
                icon={<AppstoreOutlined />}
                onClick={() => update('view', 'grid')}
              />
              <Button
                type="text"
                className={view === 'list' ? styles.viewActive : ''}
                aria-label="列表视图"
                aria-pressed={view === 'list'}
                icon={<UnorderedListOutlined />}
                onClick={() => update('view', 'list')}
              />
            </div>
          </div>
        </div>
        <div className={styles.resultsCaption}>
          <span>
            {data ? `共 ${data.total} 个项目` : '正在加载项目…'}
            {session.user.isSystemAdmin && <span className={styles.adminNote}>管理员视图</span>}
          </span>
          <span>按最近更新排序</span>
        </div>
        {projects.isError ? (
          <Alert
            type="error"
            showIcon
            title="暂时无法加载项目"
            description={errorMessage(projects.error)}
            action={<Button onClick={() => void projects.refetch()}>重试</Button>}
          />
        ) : projects.isPending ? (
          <div className={styles.projectGrid}>
            {[1, 2, 3].map((item) => (
              <div className={styles.projectCard} key={item}>
                <Skeleton active avatar paragraph={{ rows: 3 }} />
              </div>
            ))}
          </div>
        ) : data && data.total > 0 && !data.items.length ? (
          <EmptyPage onReset={() => update('page', '1')} />
        ) : !data?.items.length ? (
          <div className={styles.emptyState}>
            <div className={styles.emptyArt}>
              <div />
              <div />
              <span>
                <FolderOpenOutlined />
              </span>
            </div>
            <Empty
              image={false}
              description={
                <>
                  <h3>
                    {search || status ? '没有找到符合条件的项目' : '每一个好项目，都从这里开始'}
                  </h3>
                  <p>
                    {search || status
                      ? '试试其他关键词，或调整筛选条件。'
                      : session.user.isSystemAdmin
                        ? '创建一个项目，邀请伙伴，把下一次交付变成现实。'
                        : '加入项目后，就能在这里与团队一起协作。请联系项目负责人添加你。'}
                  </p>
                </>
              }
            />
            {search || status ? (
              <Button onClick={() => setParams({})}>清除筛选</Button>
            ) : (
              session.user.isSystemAdmin && (
                <Button
                  type="primary"
                  icon={<PlusOutlined />}
                  onClick={() => setEditor({ open: true })}
                >
                  创建第一个项目
                </Button>
              )
            )}
          </div>
        ) : view === 'grid' ? (
          <div className={styles.projectGrid}>
            {data.items.map((project) => (
              <ProjectCard
                key={project.id}
                project={project}
                onEdit={(project) => setEditor({ open: true, project })}
              />
            ))}
          </div>
        ) : (
          <Table<Project>
            className={styles.projectTable}
            rowKey="id"
            dataSource={data.items}
            pagination={false}
            scroll={{ x: 760 }}
            columns={[
              {
                title: '项目',
                render: (_, project) => (
                  <Link className={styles.projectTableName} to={projectHref(project.id, location)}>
                    <ProjectIcon project={project} />
                    <span>
                      <strong>{project.name}</strong>
                      <small>{project.key}</small>
                    </span>
                  </Link>
                ),
              },
              { title: '状态', render: (_, project) => <ProjectStatus status={project.status} /> },
              {
                title: '负责人',
                render: (_, project) => (
                  <span className={styles.ownerInline}>
                    <PersonAvatar name={project.owner.name} />
                    {project.owner.name}
                  </span>
                ),
              },
              { title: '成员', dataIndex: 'memberCount', render: (count: number) => `${count} 人` },
              {
                title: '计划结束',
                dataIndex: 'endDate',
                render: (value: string | null) => formatDate(value),
              },
              {
                title: '最近更新',
                dataIndex: 'updatedAt',
                render: (value: string) => relativeDate(value),
              },
            ]}
          />
        )}
        {(data?.total ?? 0) > 9 && (
          <Pagination
            className={styles.pagination}
            current={page}
            pageSize={9}
            total={data?.total}
            showSizeChanger={false}
            onChange={(value) => update('page', String(value))}
          />
        )}
      </div>
      <ProjectEditor
        key={editor.project?.id ?? 'new'}
        open={editor.open}
        project={editor.project}
        session={session}
        onClose={() => setEditor((value) => ({ ...value, open: false }))}
        onCreated={(id) => navigate(`/projects/${id}`)}
      />
    </>
  );
}
