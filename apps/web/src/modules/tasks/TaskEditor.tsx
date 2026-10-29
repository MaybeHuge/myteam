import { taskPriorityLabels } from '../../i18n/labels';
import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { Alert, App, Button, Drawer, Form, Input, InputNumber, Select, Space } from 'antd';
import { type Task, type Project, type Requirement, type SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { useProjectCommand } from '../projects/api';
import { RequirementPicker } from '../requirements/RequirementPicker';
import { TaskPicker } from './TaskPicker';
import styles from '../requirements/requirements.module.css';
export function TaskEditor({
  project,
  session,
  item,
  requirement,
  onClose,
  onCreated,
}: {
  project: Project;
  session: SessionResponse;
  item?: Task;
  requirement?: Requirement;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  useLocale();
  const [form] = Form.useForm(),
    iterationId = Form.useWatch('iterationId', form);
  const [pickedIteration, setPickedIteration] = useState(item?.iteration ?? requirement?.iteration);
  const { message } = App.useApp();
  const command = useProjectCommand<{ id: string }>(session, (result) => {
    void message.success(item ? t('任务已保存') : t('任务已创建'));
    onClose();
    if (!item) onCreated(result.id);
  });
  return (
    <Drawer
      open
      size={620}
      title={item ? t('编辑任务') : t('拆分新任务')}
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <span>{t('明确下一步的交付工作')}</span>
          <Space>
            <Button onClick={onClose}>{t('取消')}</Button>
            <Button
              aria-label={item ? t('保存任务') : t('创建任务')}
              type="primary"
              loading={command.isPending}
              onClick={() => form.submit()}
            >
              {item ? t('保存任务') : t('创建任务')}
            </Button>
          </Space>
        </div>
      }
    >
      <p className={styles.muted}>
        {t('任务先安排为待开始。关联需求确认后，由任务负责人开始推进。')}
      </p>
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={
          item
            ? { ...item, iterationId: item.iteration?.id ?? null }
            : {
                requirementId: requirement?.id,
                iterationId: requirement?.iterationId ?? null,
                assigneeId: null,
                description: '',
                priority: 'MEDIUM',
                estimatedHours: null,
                dueDate: null,
              }
        }
        onFinish={(values) =>
          command.mutate({
            path: `/projects/${project.id}/tasks${item ? `/${item.id}/update` : ''}`,
            input: {
              ...values,
              iterationId: values.iterationId ?? null,
              dueDate: values.dueDate || null,
              estimatedHours: values.estimatedHours ?? null,
              ...(item ? { version: item.version } : { assigneeId: values.assigneeId ?? null }),
            },
          })
        }
      >
        {item ? (
          <Form.Item label={t('关联需求')}>
            <span>
              {item.requirement.code} · {item.requirement.title}
            </span>
          </Form.Item>
        ) : (
          <Form.Item
            name="requirementId"
            label={t('关联需求')}
            rules={[{ required: true, message: t('请选择本项目需求') }]}
          >
            <TaskPicker
              projectId={project.id}
              session={session}
              purpose="requirements"
              initial={
                requirement
                  ? { id: requirement.id, label: `${requirement.code} · ${requirement.title}` }
                  : null
              }
              onPicked={(iteration) => {
                form.setFieldValue('iterationId', iteration?.id ?? null);
                setPickedIteration(iteration);
              }}
            />
          </Form.Item>
        )}
        <Form.Item
          name="title"
          label={t('任务标题')}
          rules={[{ required: true, whitespace: true, message: t('请填写任务标题') }]}
        >
          <Input autoFocus maxLength={200} placeholder={t('例如：实现客户资料搜索接口')} />
        </Form.Item>
        <Form.Item name="description" label={t('任务说明')}>
          <Input.TextArea
            rows={5}
            maxLength={10000}
            showCount
            placeholder={t('记录实现范围、交付结果和需要关注的细节')}
          />
        </Form.Item>
        <div className={styles.twoColumns}>
          <Form.Item name="priority" label={t('任务优先级')}>
            <Select
              options={Object.entries(taskPriorityLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item
            name="estimatedHours"
            label={t('估算工时（小时）')}
            extra={t('可留空，按 0.25 小时填写。')}
          >
            <InputNumber min={0} max={10000} step={0.25} precision={2} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="dueDate" label={t('截止日期')}>
          <Input type="date" />
        </Form.Item>
        {!item && (
          <Form.Item
            name="assigneeId"
            label={t('任务负责人')}
            extra={t('可先不分配；开发人员可分配给自己，负责人可分配给其他成员。')}
          >
            <TaskPicker projectId={project.id} session={session} purpose="people" />
          </Form.Item>
        )}
        <Form.Item
          name="iterationId"
          label={t('任务所属迭代')}
          extra={t('新建时默认沿用需求迭代，也可按任务安排选择其他未关闭迭代。')}
        >
          <RequirementPicker
            key={pickedIteration?.id ?? 'none'}
            projectId={project.id}
            session={session}
            purpose="iteration"
            initial={pickedIteration}
          />
        </Form.Item>
        {item && (iterationId ?? null) !== (item.iteration?.id ?? null) && (
          <Form.Item
            name="changeReason"
            label={t('任务迭代调整原因')}
            rules={[{ required: true, whitespace: true, message: t('请填写调整原因') }]}
          >
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}
