import { qualityLabels } from '../../i18n/labels';
import { t, localizeLabels, useLocale } from '../../i18n';
import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router';
import { Alert, Button, Empty, Input, Pagination, Select, Skeleton, Tag } from 'antd';
import { ArrowRightOutlined, ReloadOutlined, SearchOutlined } from '@ant-design/icons';
import {
  workbenchListSchema,
  workbenchKindSchema,
  workbenchQuerySchema,
  type SessionResponse,
  type workbenchItemSchema,
} from '@myteam/contracts';
import type { z } from 'zod';
import { errorMessage, request } from '../../api/client';
import { readPage } from '../../shared/list-state';
import { EmptyPage } from '../../shared/EmptyPage';
import { ProjectIcon } from '../projects/presentation';
import styles from './workbench.module.css';
const kindLabels = localizeLabels({
  ITERATION_FOLLOW_UP: '迭代跟进',
  TASK: '我的任务',
  REQUIREMENT_REVIEW: '待评审需求',
  TASK_ASSIST: '待协助任务',
  TEST_CASE_REVIEW: '待评审用例',
  TEST_CASE_RECHECK: '需求变化复查',
  TEST_RECORD: '待填写测试记录',
  DEFECT_TRIAGE: '待确认缺陷',
  DEFECT_FIX: '缺陷修复',
  DEFECT_RETEST: '缺陷复测',
  DEFECT_FOLLOW_UP: '延期跟进',
} as const);
const statusLabels: Record<string, string> = localizeLabels({
  ...qualityLabels,
  PLANNING: '规划中',
  ACTIVE: '进行中',
  TODO: '待开始',
  IN_PROGRESS: '进行中',
  IN_REVIEW: '待评审',
  NEEDS_REVIEW: '待复查',
  NOT_RUN: '待测试',
} as const);
type Item = z.infer<typeof workbenchItemSchema>;
const href = (item: Item) => {
  const tab =
    item.kind === 'ITERATION_FOLLOW_UP'
      ? 'iterations'
      : item.kind === 'REQUIREMENT_REVIEW'
        ? 'requirements'
        : item.kind.startsWith('TEST_CASE')
          ? 'test-cases'
          : item.kind === 'TEST_RECORD'
            ? 'records'
            : item.kind.startsWith('DEFECT')
              ? 'defects'
              : 'tasks';
  const key =
    tab === 'iterations'
      ? 'iteration'
      : tab === 'requirements'
        ? 'requirement'
        : tab === 'test-cases'
          ? 'case'
          : tab === 'records'
            ? 'record'
            : tab === 'defects'
              ? 'defect'
              : 'task';
  return `/projects/${item.project.id}?tab=${tab}&${key}=${item.id}`;
};
const action = (item: Item) =>
  item.kind === 'ITERATION_FOLLOW_UP'
    ? t('跟进迭代')
    : item.kind === 'REQUIREMENT_REVIEW'
      ? t('评审需求')
      : item.kind === 'TEST_CASE_REVIEW'
        ? t('评审用例')
        : item.kind === 'TEST_CASE_RECHECK'
          ? t('复查用例')
          : item.kind === 'TASK_ASSIST'
            ? t('协助任务')
            : item.kind === 'TASK'
              ? t('处理任务')
              : kindLabels[item.kind];
export function WorkbenchTodos({ session }: { session: SessionResponse }) {
  useLocale();
  const [params, setParams] = useSearchParams(),
    q = params.get('wq') ?? '',
    page = readPage(params.get('wp'));
  const kind = workbenchKindSchema.safeParse(params.get('wk')),
    status = workbenchQuerySchema.shape.status.safeParse(params.get('ws') ?? 'all');
  const state = status.success ? status.data : 'all',
    iterationOnly = kind.success && kind.data === 'ITERATION_FOLLOW_UP';
  const change = (patch: Record<string, string | null>, replace = false) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(patch))
          if (value) next.set(key, value);
          else next.delete(key);
        return next;
      },
      { replace },
    );
  const query = new URLSearchParams({
    q,
    status: state,
    page: String(page),
    pageSize: '6',
    ...(kind.success ? { kind: kind.data } : {}),
  }).toString();
  const todos = useQuery({
    queryKey: ['workbench', session.user.id, query],
    queryFn: async ({ signal }) =>
      workbenchListSchema.parse(await request(`/workbench/todos?${query}`, { signal })),
    refetchInterval: 30000,
  });
  const data = todos.isError ? undefined : todos.data;
  const cards = [
    {
      label: iterationOnly ? t('全部跟进') : t('全部待办'),
      value: data?.summary.total,
      status: 'all',
    },
    {
      label: iterationOnly ? t('规划中') : t('待开始'),
      value: data?.summary.planning,
      status: iterationOnly ? 'PLANNING' : 'pending',
    },
    {
      label: t('进行中'),
      value: data?.summary.active,
      status: iterationOnly ? 'ACTIVE' : 'active',
    },
    { label: t('已逾期'), value: data?.summary.overdue, status: 'overdue' },
  ];
  return (
    <section className={styles.panel} aria-label={t('我的待办')}>
      <header className={styles.heading}>
        <div>
          <span className={styles.eyebrow}>YOUR NEXT STEPS</span>
          <h2>{t('我的待办')}</h2>
          <p>{t('接续任务、需求与用例评审、需求变化复查和迭代安排。')}</p>
        </div>
        <Button
          aria-label={t('刷新待办')}
          icon={<ReloadOutlined aria-hidden />}
          loading={todos.isFetching}
          onClick={() => void todos.refetch()}
        >
          {t('刷新')}
        </Button>
      </header>
      <div className={styles.stats}>
        {cards.map((card) => (
          <button
            key={card.status}
            className={state === card.status ? styles.selected : ''}
            aria-pressed={state === card.status}
            aria-label={`${card.label} ${card.value ?? (todos.isError ? t('暂不可用') : t('加载中'))}`}
            onClick={() => change({ ws: card.status === 'all' ? null : card.status, wp: null })}
          >
            <span>{card.label}</span>
            <strong>{card.value ?? '—'}</strong>
          </button>
        ))}
      </div>
      <div className={styles.toolbar}>
        <Input
          aria-label={t('搜索待办')}
          placeholder={t('搜索任务、需求、迭代或项目')}
          prefix={<SearchOutlined />}
          maxLength={100}
          allowClear
          value={q}
          onChange={(event) => change({ wq: event.target.value, wp: null }, true)}
        />
        <Select
          aria-label={t('待办类型')}
          style={{ minWidth: 150 }}
          value={kind.success ? kind.data : ''}
          options={[
            { value: '', label: t('全部类型') },
            ...Object.entries(kindLabels).map(([value, label]) => ({ value, label })),
          ]}
          onChange={(value) => change({ wk: value || null, ws: null, wp: null })}
        />
        <Button
          type={state === 'blocked' ? 'primary' : 'default'}
          onClick={() => change({ ws: state === 'blocked' ? null : 'blocked', wp: null })}
        >
          {t('待处理阻塞')}
        </Button>
      </div>
      {todos.isPending ? (
        <Skeleton active paragraph={{ rows: 5 }} />
      ) : todos.isError ? (
        <Alert
          showIcon
          type="error"
          title={t('暂时无法加载待办')}
          description={errorMessage(todos.error)}
          action={<Button onClick={() => void todos.refetch()}>{t('重试加载待办')}</Button>}
        />
      ) : !todos.data.items.length ? (
        todos.data.total > 0 ? (
          <EmptyPage onReset={() => change({ wp: null })} />
        ) : (
          <div className={styles.empty}>
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                q || state !== 'all' ? t('没有符合条件的待办') : t('当前没有需要处理的待办')
              }
            />
            {q || state !== 'all' ? (
              <Button onClick={() => change({ wq: null, ws: null, wp: null })}>
                {t('清除待办筛选')}
              </Button>
            ) : (
              <p>{t('新的安排会出现在这里；完成评审、取消、恢复或改派后自动更新。')}</p>
            )}
          </div>
        )
      ) : (
        <>
          <div className={styles.items}>
            {todos.data.items.map((item) => (
              <article key={`${item.kind}:${item.id}`}>
                <ProjectIcon project={item.project} size="small" />
                <div>
                  <div className={styles.itemHeading}>
                    <Link aria-label={`${action(item)} ${item.title}`} to={href(item)}>
                      {item.title}
                    </Link>
                    <Tag
                      color={
                        item.status === 'IN_REVIEW' || item.status === 'NEEDS_REVIEW'
                          ? 'orange'
                          : item.status === 'IN_PROGRESS' || item.status === 'ACTIVE'
                            ? 'green'
                            : 'default'
                      }
                    >
                      {statusLabels[item.status]}
                    </Tag>
                    {item.overdue && <Tag color="orange">{t('已逾期')}</Tag>}
                    {item.blocked && <Tag color="orange">{t('阻塞')}</Tag>}
                  </div>
                  <span className={styles.project}>
                    {item.project.key} · {item.project.name} · {kindLabels[item.kind]}
                  </span>
                  <span className={styles.dates}>
                    {item.kind === 'ITERATION_FOLLOW_UP'
                      ? t('{{0}} 至 {{1}}', { '0': item.startDate, '1': item.endDate })
                      : item.dueDate
                        ? t('截止 {{0}}', { '0': item.dueDate })
                        : t('无截止日')}
                  </span>
                </div>
                <Link
                  className={styles.open}
                  aria-label={t('查看待办 {{0}}', { '0': item.title })}
                  to={href(item)}
                >
                  <ArrowRightOutlined />
                </Link>
              </article>
            ))}
          </div>
          <Pagination
            size="small"
            current={page}
            pageSize={6}
            total={todos.data.total}
            showSizeChanger={false}
            hideOnSinglePage
            onChange={(next) => change({ wp: String(next) })}
          />
        </>
      )}
    </section>
  );
}
