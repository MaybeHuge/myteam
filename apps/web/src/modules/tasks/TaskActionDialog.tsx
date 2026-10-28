import { Alert, App, Form, Input, Modal } from 'antd';
import type { Task, SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { useProjectCommand } from '../projects/api';
import { TaskPicker } from './TaskPicker';
export const taskActionLabels = {
  assign: '分配任务',
  claim: '认领任务',
  start: '开始任务',
  block: '标记阻塞',
  resume: '恢复任务',
  complete: '完成任务',
  reopen: '重新开始',
  reset: '退回待开始',
  acknowledge: '核对需求变更',
} as const;
export type TaskAction = keyof typeof taskActionLabels;
export function TaskActionDialog({
  operation,
  projectId,
  session,
  onClose,
}: {
  operation: { action: TaskAction; task: Task } | null;
  projectId: string;
  session: SessionResponse;
  onClose: () => void;
}) {
  return operation ? (
    <Dialog
      key={`${operation.task.id}:${operation.action}`}
      operation={operation}
      projectId={projectId}
      session={session}
      onClose={onClose}
    />
  ) : null;
}
function Dialog({
  operation,
  projectId,
  session,
  onClose,
}: {
  operation: { action: TaskAction; task: Task };
  projectId: string;
  session: SessionResponse;
  onClose: () => void;
}) {
  const [form] = Form.useForm(),
    { message } = App.useApp(),
    { action, task } = operation;
  const command = useProjectCommand(session, () => {
    void message.success('任务已更新');
    onClose();
  });
  const reasonLabel =
    action === 'complete'
      ? '完成说明'
      : action === 'reopen'
        ? '重新开始说明'
        : action === 'start'
          ? '开始说明'
          : action === 'block'
            ? '阻塞原因'
            : action === 'resume'
              ? '恢复说明'
              : action === 'reset'
                ? '调整说明'
                : action === 'acknowledge'
                  ? '核对说明'
                  : '分配 / 认领原因';
  return (
    <Modal
      open
      zIndex={1200}
      title={taskActionLabels[action]}
      okText={taskActionLabels[action]}
      okButtonProps={{ 'aria-label': taskActionLabels[action], danger: action === 'reset' }}
      cancelText="取消"
      onCancel={onClose}
      onOk={() => form.submit()}
      confirmLoading={command.isPending}
    >
      <p>
        {action === 'reset'
          ? '退回待开始后，本需求已有测试结果将失效。'
          : action === 'block'
            ? '说明阻塞问题并安排协助人，任务保留当前业务状态。'
            : action === 'resume'
              ? '记录解决情况，清除阻塞标记，保留当前业务状态。'
              : action === 'acknowledge'
                ? '请先核对新需求与验收标准，并说明任务的调整或确认结论。'
                : action === 'complete'
                  ? '完成表示开发工作结束，需求下所有任务完成后进入待测试。'
                  : action === 'reopen'
                    ? '重新开始会使本需求已有测试结果失效，需要重新测试。'
                    : action === 'start'
                      ? '开始后任务进入进行中，关联的已确认需求会进入实现中。'
                      : '记录安排原因，方便新旧负责人接续工作。'}
      </p>
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={action === 'block' ? { helperId: task.helper?.id } : undefined}
        onFinish={(values) =>
          command.mutate({
            path: `/projects/${projectId}/tasks/${task.id}/${action === 'claim' ? 'assign' : action}`,
            input: {
              ...values,
              version: task.version,
              ...(action === 'acknowledge'
                ? { requirementRevision: task.requirement.revision }
                : {}),
              ...(action === 'claim'
                ? { assigneeId: session.user.id }
                : action === 'assign'
                  ? { assigneeId: values.assigneeId ?? null }
                  : {}),
            },
          })
        }
      >
        {action === 'assign' && (
          <Form.Item
            name="assigneeId"
            label="任务负责人"
            extra="待开始任务可留空，进行中必须保留负责人。"
          >
            <TaskPicker projectId={projectId} session={session} purpose="people" />
          </Form.Item>
        )}
        {action === 'block' && (
          <Form.Item
            name="helperId"
            label="协助人"
            rules={[{ required: true, message: '请选择协助人' }]}
          >
            <TaskPicker
              projectId={projectId}
              session={session}
              purpose="helpers"
              initial={task.helper ? { id: task.helper.id, label: task.helper.name } : null}
            />
          </Form.Item>
        )}
        <Form.Item
          name="reason"
          label={reasonLabel}
          rules={
            action !== 'start' || task.assignee?.id !== session.user.id
              ? [{ required: true, whitespace: true, message: '请填写原因或处理说明' }]
              : []
          }
        >
          <Input.TextArea
            rows={4}
            maxLength={action === 'assign' || action === 'claim' || action === 'start' ? 500 : 2000}
          />
        </Form.Item>
      </Form>
    </Modal>
  );
}
