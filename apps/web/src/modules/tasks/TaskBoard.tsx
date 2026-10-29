import { taskStatusLabels, taskPriorityLabels } from '../../i18n/labels';
import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Pagination, Space, Spin, Tag } from 'antd';
import { type Project, type Task, type SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { projectKey } from '../projects/api';
import { loadTaskBoard } from './api';
import { TaskActionDialog, type TaskAction } from './TaskActionDialog';
import styles from './tasks.module.css';
const pageNames: Record<Task['status'], string> = {
  TODO: 'todoPage',
  IN_PROGRESS: 'progressPage',
  COMPLETED: 'completedPage',
};
export function TaskBoard({
  project,
  session,
  query,
  onOpen,
}: {
  project: Project;
  session: SessionResponse;
  query: string;
  onOpen: (id: string) => void;
}) {
  useLocale();
  const [pages, setPages] = useState<Record<string, number>>({}),
    [dragged, setDragged] = useState<Task | null>(null),
    [operation, setOperation] = useState<{ action: TaskAction; task: Task } | null>(null),
    [error, setError] = useState('');
  const parameters = new URLSearchParams(query);
  parameters.delete('status');
  parameters.delete('page');
  parameters.set('pageSize', '12');
  for (const [name, page] of Object.entries(pages)) parameters.set(name, String(page));
  const board = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'task-board', parameters.toString()],
    queryFn: ({ signal }) => loadTaskBoard(project.id, parameters.toString(), signal),
  });
  const drop = (status: string) => {
    if (!dragged) return;
    const task = dragged;
    setDragged(null);
    if (task.status === status) return;
    const action =
      status === 'IN_PROGRESS' && task.status === 'TODO'
        ? 'start'
        : status === 'COMPLETED' && task.status === 'IN_PROGRESS'
          ? 'complete'
          : status === 'IN_PROGRESS' && task.status === 'COMPLETED'
            ? 'reopen'
            : status === 'TODO'
              ? 'reset'
              : null;
    if (!action || !task.allowedActions.includes(action)) {
      setError(
        t('当前状态或权限不允许此移动，任务保留原位置。请先核对需求、负责人、阻塞和计划条件。'),
      );
      return;
    }
    setError('');
    setOperation({ action, task });
  };
  return (
    <section aria-label={t('任务看板')}>
      {error && (
        <Alert type="warning" showIcon title={t(error)} closable onClose={() => setError('')} />
      )}
      {board.isPending ? (
        <Spin />
      ) : board.isError ? (
        <Alert
          type="error"
          showIcon
          title={errorMessage(board.error)}
          action={<Button onClick={() => void board.refetch()}>{t('重试加载看板')}</Button>}
        />
      ) : (
        <>
          <p>
            {t('共 ')}
            {board.data.summary.total} {t(' 项 · ')}
            {board.data.summary.blocked} {t(' 项阻塞 ·')} {board.data.summary.overdue}{' '}
            {t(' 项逾期')}
          </p>
          <div className={styles.board}>
            {board.data.columns.map((column) => (
              <section
                className={styles.column}
                key={column.status}
                aria-label={t('{{0}}列', { '0': taskStatusLabels[column.status] })}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  drop(column.status);
                }}
              >
                <h3>
                  {taskStatusLabels[column.status]} <Tag>{column.total}</Tag>
                </h3>
                {!column.items.length ? (
                  <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t('当前页暂无任务')} />
                ) : (
                  column.items.map((task) => (
                    <article
                      key={task.id}
                      className={styles.card}
                      draggable={
                        task.allowedActions.includes('start') ||
                        task.allowedActions.includes('complete') ||
                        task.allowedActions.includes('reopen') ||
                        task.allowedActions.includes('reset')
                      }
                      onDragStart={(event) => {
                        setDragged(task);
                        event.dataTransfer.setData('text/plain', task.id);
                        event.dataTransfer.effectAllowed = 'move';
                      }}
                      onDragEnd={() => setDragged(null)}
                      aria-label={t('任务卡片 {{0}}', { '0': task.title })}
                    >
                      <small>
                        {task.code} · {taskPriorityLabels[task.priority]}
                      </small>
                      <Button className={styles.title} type="link" onClick={() => onOpen(task.id)}>
                        {task.title}
                      </Button>
                      <p>
                        {task.assignee?.name ?? t('待分配')} · {task.dueDate ?? t('无截止日')}
                      </p>
                      {task.blocked && (
                        <Tag color="orange">
                          {t('阻塞 · ')}
                          {task.helper?.name}
                        </Tag>
                      )}
                      {task.needsRequirementReview && (
                        <Tag color="orange">{t('待核对需求变更')}</Tag>
                      )}
                      <Space wrap>
                        {(
                          [
                            'start',
                            'complete',
                            'reopen',
                            'reset',
                            'block',
                            'resume',
                            'acknowledge',
                          ] as const
                        )
                          .filter((action) => task.allowedActions.includes(action))
                          .map((action) => (
                            <Button
                              key={action}
                              size="small"
                              onClick={() => setOperation({ action, task })}
                            >
                              {action === 'start'
                                ? t('开始')
                                : action === 'block'
                                  ? task.blocked
                                    ? t('调整阻塞')
                                    : t('阻塞')
                                  : action === 'resume'
                                    ? t('恢复')
                                    : action === 'complete'
                                      ? t('完成')
                                      : action === 'reopen'
                                        ? t('重新开始')
                                        : action === 'reset'
                                          ? t('待开始')
                                          : t('核对变更')}
                            </Button>
                          ))}
                      </Space>
                    </article>
                  ))
                )}
                {column.page > 1 && !column.items.length && (
                  <Button
                    onClick={() =>
                      setPages((previous) => ({ ...previous, [pageNames[column.status]]: 1 }))
                    }
                  >
                    {t('返回第一页')}
                  </Button>
                )}
                <Pagination
                  size="small"
                  current={column.page}
                  total={column.total}
                  pageSize={12}
                  showSizeChanger={false}
                  hideOnSinglePage
                  onChange={(page) =>
                    setPages((previous) => ({ ...previous, [pageNames[column.status]]: page }))
                  }
                />
              </section>
            ))}
          </div>
        </>
      )}
      <TaskActionDialog
        operation={operation}
        projectId={project.id}
        session={session}
        onClose={() => setOperation(null)}
      />
    </section>
  );
}
