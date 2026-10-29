import { iterationStatusLabels } from '../../i18n/labels';
import { t, useLocale, getLocale } from '../../i18n';
import { readPage } from '../../shared/list-state';
import { EmptyPage } from '../../shared/EmptyPage';
import { CollaborationPanel } from '../collaboration/CollaborationPanel';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router';
import {
  Alert,
  App,
  Button,
  Drawer,
  Empty,
  Form,
  Input,
  Modal,
  Pagination,
  Progress,
  Select,
  Skeleton,
  Space,
  Tag,
} from 'antd';
import {
  ArrowRightOutlined,
  CalendarOutlined,
  CheckCircleOutlined,
  ClockCircleOutlined,
  EditOutlined,
  FlagOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SearchOutlined,
} from '@ant-design/icons';
import { type Iteration, type Project, type SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import { PersonAvatar } from '../projects/presentation';
import { loadIteration, loadIterations } from './api';
import { IterationEditor } from './IterationEditor';
import styles from './iterations.module.css';

function Status({ item }: { item: Iteration }) {
  useLocale();
  return (
    <span className={`${styles.status} ${styles[item.status]}`}>
      <i />
      {iterationStatusLabels[item.status]}
    </span>
  );
}
function WorkProgress({ item }: { item: Iteration }) {
  useLocale();
  const resolved = item.work.done + item.work.canceled;
  return (
    <div className={styles.workProgress}>
      <span>
        {item.work.total
          ? t('{{0}} / {{1}} 项已处理', { '0': resolved, '1': item.work.total })
          : t('尚未关联事项')}
      </span>
      {item.work.total > 0 && (
        <Progress
          size="small"
          showInfo={false}
          percent={item.work.total ? Math.round((resolved / item.work.total) * 100) : 0}
          strokeColor="#397a60"
          railColor="#edf1e9"
        />
      )}
    </div>
  );
}

export function ProjectIterations({
  project,
  session,
}: {
  project: Project;
  session: SessionResponse;
}) {
  useLocale();
  const [params, setParams] = useSearchParams();
  const q = params.get('iq') ?? '';
  const status = params.get('is') ?? '';
  const page = readPage(params.get('ip'));
  const detailId = params.get('iteration') ?? '';
  const workPage = readPage(params.get('wp'));
  const mine = params.get('im') === '1';
  const changeParams = (changes: Record<string, string | null>) =>
    setParams(
      (previous) => {
        const next = new URLSearchParams(previous);
        for (const [key, value] of Object.entries(changes)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        return next;
      },
      { replace: Object.keys(changes).some((key) => key === 'iq') },
    );
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'iterations', q, status, page, mine],
    queryFn: ({ signal }) =>
      loadIterations(
        project.id,
        new URLSearchParams({
          q,
          ...(status ? { status } : {}),
          ...(mine ? { ownerId: session.user.id } : {}),
          page: String(page),
          pageSize: '12',
        }).toString(),
        signal,
      ),
  });
  const detail = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'iteration', detailId, workPage],
    queryFn: ({ signal }) => loadIteration(project.id, detailId, workPage, signal),
    enabled: !!detailId,
  });
  const [editor, setEditor] = useState<{ item?: Iteration } | null>(null);
  const [action, setAction] = useState<{ item: Iteration; type: 'start' | 'close' } | null>(null);
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand(session, () => {
    void message.success(action?.type === 'close' ? t('迭代已关闭') : t('迭代已启动'));
    setAction(null);
  });
  const openAction = (item: Iteration, type: 'start' | 'close') => {
    command.reset();
    form.resetFields();
    setAction({ item, type });
  };
  const actions = (item: Iteration) => (
    <Space wrap>
      {item.allowedActions.includes('edit') && (
        <Button
          aria-label={t('编辑迭代')}
          icon={<EditOutlined aria-hidden />}
          onClick={() => setEditor({ item })}
        >
          {t('编辑计划')}
        </Button>
      )}
      {item.allowedActions.includes('start') && (
        <Button
          aria-label={t('启动迭代')}
          type="primary"
          icon={<PlayCircleOutlined aria-hidden />}
          onClick={() => openAction(item, 'start')}
        >
          {t('启动迭代')}
        </Button>
      )}
      {item.allowedActions.includes('close') && (
        <Button
          aria-label={t('关闭迭代')}
          icon={<CheckCircleOutlined aria-hidden />}
          onClick={() => openAction(item, 'close')}
        >
          {t('关闭迭代')}
        </Button>
      )}
    </Space>
  );
  return (
    <section className={styles.root}>
      <div className={styles.heading}>
        <div>
          <div className={styles.eyebrow}>
            <CalendarOutlined /> ITERATION PLANNING
          </div>
          <h2>{t('把目标，变成一段段进展')}</h2>
          <p>{t('明确这一轮的方向、时间与责任，让团队带着共识出发。')}</p>
        </div>
        {list.data?.canCreate && (
          <Button
            aria-label={t('新建迭代')}
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditor({})}
          >
            {t('新建迭代')}
          </Button>
        )}
      </div>
      {list.data && (
        <div className={styles.stats}>
          {[
            {
              label: t('全部迭代'),
              value: list.data.stats.total,
              icon: <CalendarOutlined />,
              status: '',
            },
            {
              label: t('规划中'),
              value: list.data.stats.planning,
              icon: <FlagOutlined />,
              status: 'PLANNING',
            },
            {
              label: t('进行中'),
              value: list.data.stats.active,
              icon: <ClockCircleOutlined />,
              status: 'ACTIVE',
            },
            {
              label: t('已关闭'),
              value: list.data.stats.closed,
              icon: <CheckCircleOutlined />,
              status: 'CLOSED',
            },
          ].map((stat) => (
            <button
              key={stat.label}
              className={status === stat.status ? styles.statSelected : ''}
              onClick={() => changeParams({ is: stat.status, ip: null })}
              aria-label={`${stat.label} ${stat.value}`}
              aria-pressed={status === stat.status}
            >
              <span>
                {stat.icon}
                {stat.label}
              </span>
              <strong>{stat.value}</strong>
            </button>
          ))}
        </div>
      )}
      <div className={styles.filters}>
        <Input
          aria-label={t('搜索迭代')}
          prefix={<SearchOutlined />}
          placeholder={t('搜索迭代名称或目标')}
          value={q}
          maxLength={100}
          allowClear
          onChange={(event) => changeParams({ iq: event.target.value, ip: null })}
        />
        <Select
          aria-label={t('迭代范围')}
          value={mine ? 'mine' : 'all'}
          onChange={(value) => changeParams({ im: value === 'mine' ? '1' : null, ip: null })}
          options={[
            { value: 'all', label: t('全部负责人') },
            { value: 'mine', label: t('我负责的') },
          ]}
        />
      </div>
      {list.isPending ? (
        <Skeleton active paragraph={{ rows: 7 }} />
      ) : list.isError ? (
        <Alert
          showIcon
          type="error"
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{t('重试')}</Button>}
        />
      ) : list.data && list.data.total > 0 && !list.data.items.length ? (
        <EmptyPage onReset={() => changeParams({ ip: null })} />
      ) : !list.data?.items.length ? (
        <div className={styles.empty}>
          <Empty
            description={
              q || status || mine
                ? t('没有符合条件的迭代')
                : t('还没有迭代，从一个清晰的小目标开始')
            }
          />
          {q || status || mine ? (
            <Button onClick={() => changeParams({ iq: null, is: null, im: null, ip: null })}>
              {t('清除迭代筛选')}
            </Button>
          ) : (
            list.data.canCreate && (
              <Button type="primary" onClick={() => setEditor({})}>
                {t('创建第一个迭代')}
              </Button>
            )
          )}
        </div>
      ) : (
        <>
          <div className={styles.cards}>
            {list.data.items.map((item) => (
              <article key={item.id} className={styles.card}>
                <div className={styles.cardHeader}>
                  <span className={styles.calendarIcon}>
                    <CalendarOutlined />
                  </span>
                  <Status item={item} />
                </div>
                <h3>
                  <button onClick={() => changeParams({ iteration: item.id, wp: null })}>
                    {item.name}
                  </button>
                </h3>
                <p className={styles.goal}>{item.goal || t('目标尚未填写，启动前请补齐。')}</p>
                <div className={styles.dates}>
                  <CalendarOutlined />
                  {item.startDate}
                  <ArrowRightOutlined />
                  {item.endDate}
                </div>
                <WorkProgress item={item} />
                <div className={styles.cardFooter}>
                  <span className={styles.owner}>
                    <PersonAvatar name={item.owner.name} />
                    {item.owner.name}
                  </span>
                  <Button
                    type="text"
                    aria-label={t('查看迭代 {{0}}', { '0': item.name })}
                    icon={<ArrowRightOutlined aria-hidden />}
                    onClick={() => changeParams({ iteration: item.id, wp: null })}
                  >
                    {t('查看计划')}
                  </Button>
                </div>
              </article>
            ))}
          </div>
          <Pagination
            align="end"
            current={page}
            pageSize={12}
            total={list.data.total}
            showSizeChanger={false}
            onChange={(next) => changeParams({ ip: String(next) })}
          />
        </>
      )}
      {!!detailId && (
        <Drawer
          open
          size={660}
          title={t('迭代计划')}
          onClose={() => changeParams({ iteration: null, wp: null })}
        >
          {detail.isPending ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : detail.isError || !detail.data ? (
            <Alert
              type="error"
              showIcon
              title={errorMessage(detail.error)}
              action={<Button onClick={() => void detail.refetch()}>{t('重试')}</Button>}
            />
          ) : (
            <div className={styles.detail}>
              <Status item={detail.data} />
              <h2>{detail.data.name}</h2>
              <p className={styles.detailGoal}>{detail.data.goal || t('目标尚未填写')}</p>
              <div className={styles.detailMeta}>
                <span className={styles.owner}>
                  <PersonAvatar name={detail.data.owner.name} />
                  {detail.data.owner.name}
                </span>
                <span>
                  <CalendarOutlined />
                  {detail.data.startDate} {t(' 至 ')}
                  {detail.data.endDate}
                </span>
              </div>
              {actions(detail.data)}
              <section className={styles.scope}>
                <h3>
                  {t('迭代范围 ')}
                  <span>{detail.data.work.total}</span>
                </h3>
                {detail.data.work.total > 0 && <WorkProgress item={detail.data} />}
                {detail.data.work.open > 0 && (
                  <Alert
                    className={styles.alert}
                    type="warning"
                    showIcon
                    title={t('仍有 {{0}} 项未完成事项，暂不能关闭', { '0': detail.data.work.open })}
                  />
                )}
                {!detail.data.items.total ? (
                  <div className={styles.scopeEmpty}>
                    <FlagOutlined />
                    <p>{t('尚未关联事项')}</p>
                    <span>{t('本轮尚未关联事项，关闭前会检查是否仍有未完成工作。')}</span>
                  </div>
                ) : (
                  <>
                    <div className={styles.workList}>
                      {detail.data.items.items.map((work) => (
                        <div key={work.id}>
                          <span>
                            <Tag>{work.kind === 'REQUIREMENT' ? t('需求') : t('任务')}</Tag>
                            <strong>{work.title}</strong>
                          </span>
                          <Tag color={work.resolution === 'OPEN' ? 'gold' : 'default'}>
                            {
                              { OPEN: t('未完成'), DONE: t('已完成'), CANCELED: t('已取消') }[
                                work.resolution
                              ]
                            }
                          </Tag>
                        </div>
                      ))}
                    </div>
                    <Pagination
                      size="small"
                      current={workPage}
                      pageSize={20}
                      total={detail.data.items.total}
                      showSizeChanger={false}
                      onChange={(next) => changeParams({ wp: String(next) })}
                    />
                  </>
                )}
              </section>
              <CollaborationPanel
                key={detail.data.id}
                projectId={project.id}
                target={{ targetType: 'ITERATION', targetId: detail.data.id }}
                session={session}
              />
              {detail.data.status === 'CLOSED' && (
                <section className={styles.summary}>
                  <h3>
                    <CheckCircleOutlined aria-hidden />
                    {t('迭代总结')}
                  </h3>
                  <p>{detail.data.closeSummary}</p>
                  <small>
                    {t('关闭时间：')}
                    {new Intl.DateTimeFormat(getLocale(), {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: 'Asia/Shanghai',
                    }).format(new Date(detail.data.closedAt!))}
                  </small>
                </section>
              )}
            </div>
          )}
        </Drawer>
      )}
      {editor && (
        <IterationEditor
          project={project}
          session={session}
          item={editor.item}
          onClose={() => setEditor(null)}
          onCreated={(id) => changeParams({ iteration: id, wp: null })}
        />
      )}
      <Modal
        zIndex={1200}
        open={!!action}
        title={action?.type === 'close' ? t('关闭本轮迭代') : t('准备开始这一轮协作')}
        okText={action?.type === 'close' ? t('确认关闭迭代') : t('确认启动迭代')}
        cancelText={t('取消')}
        confirmLoading={command.isPending}
        forceRender
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
      >
        <p className={styles.modalText}>
          {action?.type === 'close'
            ? t(
                '请确认本轮范围已处理完毕，并留下总结。关闭后计划只读，服务端会再次检查未完成事项。',
              )
            : t('启动后团队可以围绕这一轮的目标推进工作，请先确认目标、负责人和日期。')}
        </p>
        {command.isError && (
          <Alert
            className={styles.alert}
            type="error"
            showIcon
            title={errorMessage(command.error)}
          />
        )}
        <Form
          form={form}
          layout="vertical"
          clearOnDestroy
          onFinish={(values: { summary?: string }) =>
            action &&
            command.mutate({
              path: `/projects/${project.id}/iterations/${action.item.id}/${action.type}`,
              input: {
                version: action.item.version,
                ...(action.type === 'close' ? { summary: values.summary } : {}),
              },
            })
          }
        >
          {action?.type === 'close' && (
            <Form.Item
              name="summary"
              label={t('迭代总结')}
              rules={[{ required: true, whitespace: true, message: t('请填写迭代总结') }]}
            >
              <Input.TextArea
                rows={4}
                maxLength={2000}
                placeholder={t('这一轮完成了什么？有哪些经验值得带到下一轮？')}
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </section>
  );
}
