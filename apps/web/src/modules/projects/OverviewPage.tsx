import { WorkbenchTodos } from '../workbench/WorkbenchTodos';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router';
import { Alert, Button, Skeleton } from 'antd';
import {
  ArrowRightOutlined,
  FolderOpenOutlined,
  PlusOutlined,
  SafetyCertificateOutlined,
  TeamOutlined,
} from '@ant-design/icons';
import type { SessionResponse } from '@myteam/contracts';
import { loadProjects, recentProjectsKey } from './api';
import { ProjectCard, ProjectStats } from './ProjectsPage';
import { errorMessage } from '../../api/client';
import styles from './projects.module.css';

export function OverviewPage({ session }: { session: SessionResponse }) {
  const projects = useQuery({
    queryKey: recentProjectsKey(session.user.id),
    queryFn: ({ signal }) => loadProjects('pageSize=3', signal),
  });
  return (
    <>
      <div className={styles.pageIntro}>
        <div>
          <span className={styles.eyebrow}>WORKSPACE / 团队工作台</span>
          <h1>你好，{session.user.name}。</h1>
          <p>新的进展，从一次清晰的协作开始。</p>
        </div>
        <Link to="/projects">
          <Button icon={<FolderOpenOutlined />}>进入项目空间</Button>
        </Link>
      </div>
      <WorkbenchTodos session={session} />
      <section className="workspace-welcome">
        <div className="welcome-copy">
          <span>ONE TEAM, SHARED PURPOSE</span>
          <h2>让想法落地，让团队同行。</h2>
          <p>把目标放在共同的空间，让每一步行动都有清晰的方向。</p>
          <Link to="/projects">
            查看我的项目 <ArrowRightOutlined />
          </Link>
        </div>
        <div className="welcome-art" aria-hidden="true">
          <div className="art-card art-card-back">
            <i />
            <i />
            <i />
          </div>
          <div className="art-card art-card-front">
            <span>↗</span>
            <i />
            <i />
            <div>
              <b />
              <b />
              <b />
            </div>
          </div>
          <span className="art-orbit" />
          <span className="art-spark">✧</span>
        </div>
      </section>
      <ProjectStats stats={projects.isError ? undefined : projects.data?.stats} />
      <div className="dashboard-section-heading">
        <div>
          <h2>最近更新的项目</h2>
          <p>接续团队的进展，从这里继续。</p>
        </div>
        <Link to="/projects">
          查看全部 <ArrowRightOutlined />
        </Link>
      </div>
      {projects.isPending ? (
        <div className={styles.projectGrid}>
          {[1, 2, 3].map((key) => (
            <div key={key} className={styles.projectCard}>
              <Skeleton active avatar paragraph={{ rows: 3 }} />
            </div>
          ))}
        </div>
      ) : projects.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(projects.error)}
          action={<Button onClick={() => void projects.refetch()}>重试</Button>}
        />
      ) : projects.data?.items.length ? (
        <div className={styles.projectGrid}>
          {projects.data.items.map((project) => (
            <ProjectCard key={project.id} project={project} />
          ))}
        </div>
      ) : (
        <div className="dashboard-empty">
          <span>
            <FolderOpenOutlined />
          </span>
          <div>
            <h3>你的下一个项目，从这里开始</h3>
            <p>
              {session.user.isSystemAdmin
                ? '建立项目空间，添加成员，一起把目标向前推进。'
                : '加入项目后，最近的项目进展将在这里呈现。'}
            </p>
          </div>
          <Link to="/projects">
            <Button icon={session.user.isSystemAdmin ? <PlusOutlined /> : <ArrowRightOutlined />}>
              {session.user.isSystemAdmin ? '创建项目' : '查看项目'}
            </Button>
          </Link>
        </div>
      )}
      <div className="dashboard-bottom">
        <div>
          <span className="mini-tip-icon">
            <SafetyCertificateOutlined />
          </span>
          <div>
            <h3>专注协作，清晰分工</h3>
            <p>每位成员在项目中拥有明确角色，项目信息仅向授权成员开放。</p>
          </div>
        </div>
        {session.user.isSystemAdmin ? (
          <Link className="dashboard-team-link" to="/settings/users">
            <TeamOutlined />
            <span>管理工作空间账号</span>
            <ArrowRightOutlined />
          </Link>
        ) : (
          <div className="dashboard-team-link">
            <TeamOutlined />
            <span>在项目中找到你的团队</span>
          </div>
        )}
      </div>
    </>
  );
}
