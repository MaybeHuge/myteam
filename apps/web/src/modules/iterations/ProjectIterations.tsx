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
import {
  iterationStatusLabels,
  type Iteration,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import { PersonAvatar } from '../projects/presentation';
import { loadIteration, loadIterations } from './api';
import { IterationEditor } from './IterationEditor';
import styles from './iterations.module.css';

function Status({ item }: { item: Iteration }) {
  return (
    <span className={`${styles.status} ${styles[item.status]}`}>
      <i />
      {iterationStatusLabels[item.status]}
    </span>
  );
}
function WorkProgress({ item }: { item: Iteration }) {
  const resolved = item.work.done + item.work.canceled;
  return (
    <div className={styles.workProgress}>
      <span>{item.work.total ? `${resolved} / ${item.work.total} 项已处理` : '尚未关联事项'}</span>
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
    void message.success(action?.type === 'close' ? '迭代已关闭' : '迭代已启动');
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
          aria-label="编辑迭代"
          icon={<EditOutlined aria-hidden />}
          onClick={() => setEditor({ item })}
        >
          编辑计划
        </Button>
      )}
      {item.allowedActions.includes('start') && (
        <Button
          aria-label="启动迭代"
          type="primary"
          icon={<PlayCircleOutlined aria-hidden />}
          onClick={() => openAction(item, 'start')}
        >
          启动迭代
        </Button>
      )}
      {item.allowedActions.includes('close') && (
        <Button
          aria-label="关闭迭代"
          icon={<CheckCircleOutlined aria-hidden />}
          onClick={() => openAction(item, 'close')}
        >
          关闭迭代
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
          <h2>把目标，变成一段段进展</h2>
          <p>明确这一轮的方向、时间与责任，让团队带着共识出发。</p>
        </div>
        {list.data?.canCreate && (
          <Button
            aria-label="新建迭代"
            type="primary"
            icon={<PlusOutlined aria-hidden />}
            onClick={() => setEditor({})}
          >
            新建迭代
          </Button>
        )}
      </div>
      {list.data && (
        <div className={styles.stats}>
          {[
            {
              label: '全部迭代',
              value: list.data.stats.total,
              icon: <CalendarOutlined />,
              status: '',
            },
            {
              label: '规划中',
              value: list.data.stats.planning,
              icon: <FlagOutlined />,
              status: 'PLANNING',
            },
            {
              label: '进行中',
              value: list.data.stats.active,
              icon: <ClockCircleOutlined />,
              status: 'ACTIVE',
            },
            {
              label: '已关闭',
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
          aria-label="搜索迭代"
          prefix={<SearchOutlined />}
          placeholder="搜索迭代名称或目标"
          value={q}
          maxLength={100}
          allowClear
          onChange={(event) => changeParams({ iq: event.target.value, ip: null })}
        />
        <Select
          aria-label="迭代范围"
          value={mine ? 'mine' : 'all'}
          onChange={(value) => changeParams({ im: value === 'mine' ? '1' : null, ip: null })}
          options={[
            { value: 'all', label: '全部负责人' },
            { value: 'mine', label: '我负责的' },
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
          action={<Button onClick={() => void list.refetch()}>重试</Button>}
        />
      ) : list.data && list.data.total > 0 && !list.data.items.length ? (
        <EmptyPage onReset={() => changeParams({ ip: null })} />
      ) : !list.data?.items.length ? (
        <div className={styles.empty}>
          <Empty
            description={
              q || status || mine ? '没有符合条件的迭代' : '还没有迭代，从一个清晰的小目标开始'
            }
          />
          {q || status || mine ? (
            <Button onClick={() => changeParams({ iq: null, is: null, im: null, ip: null })}>
              清除迭代筛选
            </Button>
          ) : (
            list.data.canCreate && (
              <Button type="primary" onClick={() => setEditor({})}>
                创建第一个迭代
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
                <p className={styles.goal}>{item.goal || '目标尚未填写，启动前请补齐。'}</p>
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
                    aria-label={`查看迭代 ${item.name}`}
                    icon={<ArrowRightOutlined aria-hidden />}
                    onClick={() => changeParams({ iteration: item.id, wp: null })}
                  >
                    查看计划
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
          title="迭代计划"
          onClose={() => changeParams({ iteration: null, wp: null })}
        >
          {detail.isPending ? (
            <Skeleton active paragraph={{ rows: 8 }} />
          ) : detail.isError || !detail.data ? (
            <Alert
              type="error"
              showIcon
              title={errorMessage(detail.error)}
              action={<Button onClick={() => void detail.refetch()}>重试</Button>}
            />
          ) : (
            <div className={styles.detail}>
              <Status item={detail.data} />
              <h2>{detail.data.name}</h2>
              <p className={styles.detailGoal}>{detail.data.goal || '目标尚未填写'}</p>
              <div className={styles.detailMeta}>
                <span className={styles.owner}>
                  <PersonAvatar name={detail.data.owner.name} />
                  {detail.data.owner.name}
                </span>
                <span>
                  <CalendarOutlined />
                  {detail.data.startDate} 至 {detail.data.endDate}
                </span>
              </div>
              {actions(detail.data)}
              <section className={styles.scope}>
                <h3>
                  迭代范围 <span>{detail.data.work.total}</span>
                </h3>
                {detail.data.work.total > 0 && <WorkProgress item={detail.data} />}
                {detail.data.work.open > 0 && (
                  <Alert
                    className={styles.alert}
                    type="warning"
                    showIcon
                    title={`仍有 ${detail.data.work.open} 项未完成事项，暂不能关闭`}
                  />
                )}
                {!detail.data.items.total ? (
                  <div className={styles.scopeEmpty}>
                    <FlagOutlined />
                    <p>尚未关联事项</p>
                    <span>本轮尚未关联事项，关闭前会检查是否仍有未完成工作。</span>
                  </div>
                ) : (
                  <>
                    <div className={styles.workList}>
                      {detail.data.items.items.map((work) => (
                        <div key={work.id}>
                          <span>
                            <Tag>{work.kind === 'REQUIREMENT' ? '需求' : '任务'}</Tag>
                            <strong>{work.title}</strong>
                          </span>
                          <Tag color={work.resolution === 'OPEN' ? 'gold' : 'default'}>
                            {
                              { OPEN: '未完成', DONE: '已完成', CANCELED: '已取消' }[
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
                    迭代总结
                  </h3>
                  <p>{detail.data.closeSummary}</p>
                  <small>
                    关闭时间：
                    {new Intl.DateTimeFormat('zh-CN', {
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
        title={action?.type === 'close' ? '关闭本轮迭代' : '准备开始这一轮协作'}
        okText={action?.type === 'close' ? '确认关闭迭代' : '确认启动迭代'}
        cancelText="取消"
        confirmLoading={command.isPending}
        forceRender
        onCancel={() => setAction(null)}
        onOk={() => form.submit()}
      >
        <p className={styles.modalText}>
          {action?.type === 'close'
            ? '请确认本轮范围已处理完毕，并留下总结。关闭后计划只读，服务端会再次检查未完成事项。'
            : '启动后团队可以围绕这一轮的目标推进工作，请先确认目标、负责人和日期。'}
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
              label="迭代总结"
              rules={[{ required: true, whitespace: true, message: '请填写迭代总结' }]}
            >
              <Input.TextArea
                rows={4}
                maxLength={2000}
                placeholder="这一轮完成了什么？有哪些经验值得带到下一轮？"
              />
            </Form.Item>
          )}
        </Form>
      </Modal>
    </section>
  );
}
