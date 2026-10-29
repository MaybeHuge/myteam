import { t, useLocale } from '../i18n';
import {
  App as AntApp,
  Alert,
  Avatar,
  Button,
  ConfigProvider,
  Input,
  Result,
  Spin,
  Tooltip,
} from 'antd';
import zhCN from 'antd/locale/zh_CN';
import enUS from 'antd/locale/en_US';
import { LanguageSwitcher } from '../i18n/LanguageSwitcher';
import {
  ArrowRightOutlined,
  FolderOpenOutlined,
  HomeOutlined,
  KeyOutlined,
  LogoutOutlined,
  SearchOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BrowserRouter,
  Link,
  Route,
  Routes,
  useLocation,
  useNavigate,
  useParams,
} from 'react-router';
import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import type { InputRef } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import {
  ApiError,
  errorMessage,
  getSession,
  replaceSession,
  request,
  sessionKey,
} from '../api/client';
import { NotificationCenter } from '../modules/collaboration/NotificationCenter';
import { LoginPage } from '../modules/identity/LoginPage';
import { ChangePassword } from '../modules/identity/ChangePassword';
import { loadProjects, recentProjectsKey } from '../modules/projects/api';
import { ProjectSwitcher } from '../modules/projects/ProjectSwitcher';
import { ProjectIcon } from '../modules/projects/presentation';

const UsersPage = lazy(() =>
  import('../modules/identity/UsersPage').then((module) => ({ default: module.UsersPage })),
);
const OverviewPage = lazy(() =>
  import('../modules/projects/OverviewPage').then((module) => ({ default: module.OverviewPage })),
);
const ProjectsPage = lazy(() =>
  import('../modules/projects/ProjectsPage').then((module) => ({ default: module.ProjectsPage })),
);
const ProjectDetailPage = lazy(() =>
  import('../modules/projects/ProjectDetailPage').then((module) => ({
    default: module.ProjectDetailPage,
  })),
);

function ProjectRoute({ session }: { session: SessionResponse }) {
  useLocale();
  const { projectId } = useParams();
  return <ProjectDetailPage key={projectId} session={session} />;
}

function Workspace({ session }: { session: SessionResponse }) {
  useLocale();
  const location = useLocation();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { message } = AntApp.useApp();
  const searchRef = useRef<InputRef>(null);
  const [changingPassword, setChangingPassword] = useState(false);
  const recent = useQuery({
    queryKey: recentProjectsKey(session.user.id),
    queryFn: ({ signal }) => loadProjects('pageSize=3', signal),
  });
  const recentData = recent.isError ? undefined : recent.data;
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const logout = useMutation({
    mutationFn: () =>
      request('/auth/logout', { method: 'POST', headers: { 'X-CSRF-Token': session.csrfToken } }),
    onSuccess: () => replaceSession(client, null),
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
      else void message.error(errorMessage(error));
    },
  });
  const inProjects = location.pathname.startsWith('/projects');
  const navigation = [
    { path: '/', label: t('工作台'), icon: <HomeOutlined /> },
    { path: '/projects', label: t('项目空间'), icon: <FolderOpenOutlined /> },
    ...(session.user.isSystemAdmin
      ? [{ path: '/settings/users', label: t('账号管理'), icon: <TeamOutlined /> }]
      : []),
  ];
  return (
    <div className="workspace">
      <aside className="sidebar">
        <Link className="brand brand-light" to="/">
          <span className="brand-mark">m</span>MyTeam<span className="brand-dot">.</span>
        </Link>
        <div className="workspace-identity">
          <span className="workspace-identity-icon">
            <TeamOutlined />
          </span>
          <div>
            <strong>{t('团队工作空间')}</strong>
            <span>{t('让每一步，都走向交付')}</span>
          </div>
          <span className="workspace-identity-dot" />
        </div>
        <span className="sidebar-label">{t('工作空间')}</span>
        <nav className="workspace-nav" aria-label={t('主导航')}>
          {navigation.map((item) => (
            <span key={item.path}>
              <Link
                to={item.path}
                className={
                  (item.path === '/projects' ? inProjects : location.pathname === item.path)
                    ? 'workspace-nav-link is-active'
                    : 'workspace-nav-link'
                }
                aria-label={item.label}
                aria-current={
                  (item.path === '/projects' ? inProjects : location.pathname === item.path)
                    ? 'page'
                    : undefined
                }
              >
                {item.icon}
                <span>{item.label}</span>
                {item.path === '/projects' && recentData && <small>{recentData.stats.total}</small>}
              </Link>
            </span>
          ))}
        </nav>
        {!!recentData?.items.length && (
          <div className="sidebar-recents">
            <span className="sidebar-label">{t('最近更新')}</span>
            {recentData.items.map((project) => (
              <Link to={`/projects/${project.id}`} className="recent-project-link" key={project.id}>
                <ProjectIcon project={project} size="small" />
                <span>{project.name}</span>
              </Link>
            ))}
          </div>
        )}
        <div className="sidebar-bottom">
          <div className="sidebar-avatar">{session.user.name.slice(0, 1)}</div>
          <div>
            <strong>{session.user.name}</strong>
            <span>{session.user.isSystemAdmin ? t('系统管理员') : t('团队成员')}</span>
          </div>
        </div>
      </aside>
      <div className="workspace-body">
        <header className="topbar">
          <div className="topbar-context">
            <div className="breadcrumb">
              <span>{t('工作空间')}</span>
              <span className="breadcrumb-divider">/</span>
              <strong>
                {inProjects
                  ? t('项目空间')
                  : location.pathname === '/settings/users'
                    ? t('账号管理')
                    : t('工作台')}
              </strong>
            </div>
            <ProjectSwitcher session={session} />
          </div>
          <div className="topbar-actions">
            <LanguageSwitcher />
            <Input
              ref={searchRef}
              aria-label={t('快速搜索项目')}
              placeholder={t('搜索项目…')}
              prefix={<SearchOutlined />}
              suffix={<kbd>Ctrl K</kbd>}
              onPressEnter={(event) => {
                if (event.nativeEvent.isComposing) return;
                const value = event.currentTarget.value.trim();
                navigate(`/projects${value ? `?q=${encodeURIComponent(value)}` : ''}`);
              }}
              className="global-search"
            />
            <NotificationCenter session={session} />
            <span className="header-divider" />
            <Tooltip title={session.user.name}>
              <Avatar size={30} className="header-avatar">
                {session.user.name.slice(0, 1)}
              </Avatar>
            </Tooltip>
            <Tooltip title={t('修改密码')}>
              <Button
                type="text"
                icon={<KeyOutlined />}
                aria-label={t('修改密码')}
                onClick={() => setChangingPassword(true)}
              />
            </Tooltip>
            <Tooltip title={t('退出登录')}>
              <Button
                type="text"
                icon={<LogoutOutlined />}
                aria-label={t('退出登录')}
                loading={logout.isPending}
                onClick={() => logout.mutate()}
              />
            </Tooltip>
          </div>
        </header>
        {changingPassword && (
          <ChangePassword session={session} onClose={() => setChangingPassword(false)} />
        )}
        <main className="workspace-main">
          <Suspense
            fallback={
              <div className="route-loading">
                <Spin />
                <p>{t('正在整理工作空间…')}</p>
              </div>
            }
          >
            <Routes>
              <Route path="/" element={<OverviewPage session={session} />} />
              <Route path="/projects" element={<ProjectsPage session={session} />} />
              <Route path="/projects/:projectId" element={<ProjectRoute session={session} />} />
              <Route
                path="/settings/users"
                element={
                  session.user.isSystemAdmin ? (
                    <UsersPage session={session} />
                  ) : (
                    <Alert
                      type="warning"
                      showIcon
                      title={t('没有访问权限')}
                      description={t('此页面仅向系统管理员开放。')}
                    />
                  )
                }
              />
              <Route
                path="*"
                element={
                  <Result
                    status="404"
                    title={t('页面不存在')}
                    subTitle={t('这个地址暂时没有对应页面。')}
                    extra={
                      <Link to="/">
                        <Button type="primary">{t('返回工作台')}</Button>
                      </Link>
                    }
                  />
                }
              />
            </Routes>
          </Suspense>
        </main>
        <footer className="workspace-footer">
          <span>{t('MyTeam · 把协作连接成一次次交付')}</span>
          <Link to="/projects">
            {t('前往项目空间 ')}
            <ArrowRightOutlined />
          </Link>
        </footer>
      </div>
    </div>
  );
}
function SessionGate() {
  useLocale();
  const client = useQueryClient();
  const session = useQuery({
    queryKey: sessionKey,
    queryFn: ({ signal }) => getSession(signal),
    retry: false,
    refetchInterval: 30000,
  });
  useEffect(() => {
    if (session.data === null) void replaceSession(client, null);
  }, [client, session.data]);
  if (session.isPending)
    return (
      <main className="full-page-state">
        <Spin size="large" />
        <p>{t('正在进入工作空间…')}</p>
      </main>
    );
  if (session.isError)
    return (
      <main className="full-page-state">
        <Alert
          type="error"
          showIcon
          title={t('暂时无法进入工作空间')}
          description={errorMessage(session.error)}
          action={<Button onClick={() => void session.refetch()}>{t('重新连接')}</Button>}
        />
      </main>
    );
  return session.data ? (
    <Workspace key={session.data.user.id} session={session.data} />
  ) : (
    <LoginPage />
  );
}
export function App() {
  const locale = useLocale();
  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t('MyTeam · 团队协作');
    document
      .querySelector('meta[name="description"]')
      ?.setAttribute('content', t('MyTeam 研发团队协作工作空间'));
  }, [locale]);
  return (
    <ConfigProvider
      locale={locale === 'en-US' ? enUS : zhCN}
      theme={{
        token: {
          colorPrimary: '#26785e',
          colorText: '#304538',
          colorTextSecondary: '#65725f',
          colorBgLayout: '#f5f7f2',
          colorBorder: '#dde5d9',
          borderRadius: 8,
          fontFamily: 'Inter, "PingFang SC", "Microsoft YaHei", sans-serif',
        },
        components: {
          Button: { controlHeight: 36, fontWeight: 500, primaryShadow: '0 3px 8px #26785e12' },
          Table: {
            headerBg: '#f7f9f4',
            headerColor: '#829372',
            rowHoverBg: '#f8fbf5',
            borderColor: '#edf1e8',
            cellPaddingBlock: 17,
          },
          Drawer: { paddingLG: 28 },
          Tabs: { inkBarColor: '#39815c' },
        },
      }}
    >
      <AntApp>
        <BrowserRouter>
          <SessionGate />
        </BrowserRouter>
      </AntApp>
    </ConfigProvider>
  );
}
