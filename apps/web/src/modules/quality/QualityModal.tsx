import { useState } from 'react';
import { App, Alert, Button, Collapse, Form, Input, Modal, Select, Steps } from 'antd';
import {
  createBuildSchema,
  qualityLabels,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { useProjectCommand } from '../projects/api';
import { QualityPicker } from './QualityPicker';
import styles from './quality.module.css';
export type Operation = {
  entity: 'releases' | 'builds' | 'defects';
  action: string;
  id?: string;
  version?: number;
  initial?: Record<string, unknown>;
};
export const actionLabels: Record<string, string> = {
  create: '创建',
  update: '保存修改',
  assign: '改派责任人',
  start: '开始修复',
  confirm: '确认缺陷',
  fix: '提交修复',
  retest: '登记复测',
  reopen: '重新打开缺陷',
  dispose: '登记特殊结论',
  link: '关联用例 / 测试记录',
};
export function QualityModal({
  operation: op,
  project,
  session,
  onClose,
  onSaved,
}: {
  operation: Operation;
  project: Project;
  session: SessionResponse;
  onClose: () => void;
  onSaved: (id: string, entity: Operation['entity']) => void;
}) {
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const { message } = App.useApp();
  const command = useProjectCommand<{ id: string }>(session, (r) => {
    void message.success('记录已保存');
    onSaved(r.id, op.entity);
    onClose();
  });
  const create = op.action === 'create';
  const edit = create || op.action === 'update';
  const defectCreate = create && op.entity === 'defects';
  const title = create
    ? { releases: '新建版本', builds: '登记构建', defects: '报告缺陷' }[op.entity]
    : actionLabels[op.action];
  const requirementId = Form.useWatch('requirementId', form) as string | undefined;
  const conclusion = Form.useWatch('conclusion', form) as string | undefined;
  const source = Form.useWatch('source', form) as string | undefined;
  const picker = (kind: string, extra: Partial<Parameters<typeof QualityPicker>[0]> = {}) => (
    <QualityPicker projectId={project.id} session={session} kind={kind} {...extra} />
  );
  const person = (purpose: string) => (
    <QualityPicker projectId={project.id} session={session} purpose={purpose} />
  );
  const text = (name: string, label: string, required = true, max = 5000) => (
    <Form.Item
      name={name}
      label={label}
      rules={required ? [{ required: true, whitespace: true }] : []}
    >
      <Input.TextArea rows={3} maxLength={max} />
    </Form.Item>
  );
  return (
    <Modal
      open
      title={title}
      width={700}
      zIndex={1300}
      onOk={() => {
        if (defectCreate && step === 0) {
          void form
            .validateFields([
              'title',
              'severity',
              'requirementId',
              'assigneeId',
              'retesterId',
              ...(source === 'PRODUCTION' ? ['foundBuildId'] : []),
            ])
            .then(() => setStep(1))
            .catch(() => undefined);
        } else form.submit();
      }}
      onCancel={onClose}
      footer={
        defectCreate && step === 1 ? (
          <>
            <Button onClick={onClose}>取消</Button>
            <Button onClick={() => setStep(0)}>上一步</Button>
            <Button type="primary" loading={command.isPending} onClick={() => form.submit()}>
              报告缺陷
            </Button>
          </>
        ) : undefined
      }
      okText={defectCreate && step === 0 ? '下一步' : title}
      confirmLoading={command.isPending}
    >
      {defectCreate && (
        <Steps
          className={styles.formSteps}
          current={step}
          size="small"
          items={[{ title: '基本信息' }, { title: '问题描述' }]}
        />
      )}
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{ source: 'TESTING', severity: 'MAJOR', passed: 'pass', ...op.initial }}
        onValuesChange={(changed) => {
          if ('requirementId' in changed)
            form.setFieldsValue({ taskId: null, testCaseIds: [], testRecordIds: [] });
        }}
        onFinish={(values) => {
          const body: Record<string, unknown> = { ...values, version: op.version };
          for (const [key, value] of Object.entries(body))
            if (value == null || (value === '' && (key.endsWith('Id') || key === 'deferUntil')))
              delete body[key];
          if (op.action === 'retest') body.passed = values.passed === 'pass';
          command.mutate({
            path: `/projects/${project.id}/quality/${op.entity}${op.id ? `/${op.id}/${op.action}` : ''}`,
            input: body,
          });
        }}
      >
        {edit && op.entity === 'releases' && (
          <>
            <Form.Item name="name" label="版本名称" rules={[{ required: true, whitespace: true }]}>
              <Input maxLength={100} />
            </Form.Item>
            {text('description', '版本说明', false)}
            <Form.Item name="requirementIds" label="关联需求">
              {picker('requirements', { multiple: true })}
            </Form.Item>
            <Form.Item name="taskIds" label="关联任务">
              {picker('tasks', { multiple: true })}
            </Form.Item>
          </>
        )}
        {op.entity === 'builds' && (
          <>
            <Form.Item name="releaseId" label="所属版本" rules={[{ required: true }]}>
              {picker('releases')}
            </Form.Item>
            <Form.Item
              name="identifier"
              label="构建标识"
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            {['codeUrl', 'artifactUrl'].map((name) => (
              <Form.Item
                key={name}
                name={name}
                label={name === 'codeUrl' ? '代码链接' : '产物链接'}
                rules={[
                  {
                    validator: (_, value) => {
                      const r = createBuildSchema.shape.codeUrl.safeParse(value ?? '');
                      return r.success
                        ? Promise.resolve()
                        : Promise.reject(new Error(r.error.issues[0]?.message));
                    },
                  },
                ]}
              >
                <Input maxLength={2000} />
              </Form.Item>
            ))}
            {text('notes', '登记说明', false)}
          </>
        )}
        {defectCreate && (
          <>
            <div hidden={step !== 0}>
              <Form.Item
                name="title"
                label="缺陷标题"
                rules={[{ required: true, whitespace: true }]}
              >
                <Input maxLength={200} placeholder="简要描述遇到的问题" />
              </Form.Item>
              <Form.Item name="requirementId" label="缺陷关联需求" rules={[{ required: true }]}>
                {picker('requirements')}
              </Form.Item>
              <div className={styles.formGrid}>
                <Form.Item name="severity" label="严重程度" rules={[{ required: true }]}>
                  <Select
                    options={['CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'].map((value) => ({
                      value,
                      label: qualityLabels[value],
                    }))}
                  />
                </Form.Item>
                <Form.Item name="source" label="发现来源">
                  <Select
                    options={[
                      { value: 'TESTING', label: '测试发现' },
                      { value: 'PRODUCTION', label: '生产发现' },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="assigneeId" label="开发负责人" rules={[{ required: true }]}>
                  {person('assignee')}
                </Form.Item>
                <Form.Item name="retesterId" label="复测负责人" rules={[{ required: true }]}>
                  {person('retester')}
                </Form.Item>
              </div>
              {source === 'PRODUCTION' && (
                <Form.Item
                  name="foundBuildId"
                  label="发现构建"
                  extra="生产发现的缺陷需要关联已发布版本的构建。"
                  rules={[{ required: true }]}
                >
                  {picker('builds')}
                </Form.Item>
              )}
              <Collapse
                className={styles.optionalFields}
                items={[
                  {
                    key: 'links',
                    label: '更多关联（可选）',
                    forceRender: true,
                    children: (
                      <div className={styles.formGrid}>
                        <Form.Item name="taskId" label="缺陷关联任务">
                          {picker('tasks', { requirementId })}
                        </Form.Item>
                        <Form.Item name="testCaseIds" label="关联测试用例（可选）">
                          {picker('cases', { multiple: true, requirementId })}
                        </Form.Item>
                        <Form.Item name="testRecordIds" label="关联测试记录（可选）">
                          {picker('records', { multiple: true, requirementId })}
                        </Form.Item>
                        {source !== 'PRODUCTION' && (
                          <Form.Item name="foundBuildId" label="发现构建（可选）">
                            {picker('builds')}
                          </Form.Item>
                        )}
                        <Form.Item name="targetReleaseId" label="计划修复版本（可选）">
                          {picker('releases')}
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div hidden={step !== 1}>
              <p className={styles.formHint}>补充复现信息，帮助开发快速定位问题。</p>
              {text('environment', '发现环境')}
              {text('reproduction', '复现步骤', true, 10000)}
              <div className={styles.formGrid}>
                {text('expected', '预期表现')}
                {text('actual', '实际表现')}
              </div>
            </div>
          </>
        )}
        {op.action === 'assign' && (
          <>
            <Form.Item name="assigneeId" label="开发负责人" rules={[{ required: true }]}>
              {person('assignee')}
            </Form.Item>
            <Form.Item name="retesterId" label="复测负责人" rules={[{ required: true }]}>
              {person('retester')}
            </Form.Item>
            <Form.Item name="targetReleaseId" label="计划修复版本（可选）">
              {picker('releases')}
            </Form.Item>
          </>
        )}
        {op.action === 'fix' && (
          <>
            <Form.Item
              name="buildId"
              label="实际修复构建"
              rules={op.initial?.foundBuildId ? [{ required: true }] : []}
            >
              {picker('builds', {
                releaseId:
                  typeof op.initial?.targetReleaseId === 'string'
                    ? op.initial.targetReleaseId
                    : undefined,
              })}
            </Form.Item>
            {text('evidence', '修复证据说明')}
          </>
        )}
        {op.action === 'retest' && (
          <>
            <Form.Item name="testRecordId" label="复测记录（可选）">
              {picker('records', { requirementId: String(op.initial?.requirementId ?? '') })}
            </Form.Item>
            <Form.Item name="passed" label="复测结论" rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'pass', label: '通过并关闭' },
                  { value: 'fail', label: '未通过并重新打开' },
                ]}
              />
            </Form.Item>
            {text('evidence', '复测证据说明')}
          </>
        )}
        {op.action === 'link' && (
          <>
            <Form.Item name="testCaseIds" label="关联测试用例（可选）">
              {picker('cases', {
                multiple: true,
                requirementId: String(op.initial?.requirementId ?? ''),
              })}
            </Form.Item>
            <Form.Item name="testRecordIds" label="关联测试记录（可选）">
              {picker('records', {
                multiple: true,
                requirementId: String(op.initial?.requirementId ?? ''),
              })}
            </Form.Item>
          </>
        )}
        {op.action === 'dispose' && (
          <>
            <Form.Item name="conclusion" label="特殊处理结论" rules={[{ required: true }]}>
              <Select
                options={['DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE', 'DEFERRED'].map(
                  (value) => ({ value, label: qualityLabels[value] }),
                )}
              />
            </Form.Item>
            {conclusion === 'DUPLICATE' && (
              <Form.Item name="duplicateOfId" label="主缺陷" rules={[{ required: true }]}>
                {picker('defects')}
              </Form.Item>
            )}
            {conclusion === 'DEFERRED' && (
              <>
                <Form.Item name="targetReleaseId" label="延期目标版本">
                  {picker('releases')}
                </Form.Item>
                <Form.Item name="deferUntil" label="延期跟进日期">
                  <Input type="date" />
                </Form.Item>
              </>
            )}
            {text('evidence', '处理依据与证据')}
          </>
        )}
        {!edit &&
          op.action !== 'link' &&
          text('reason', op.action === 'fix' ? '修复说明' : '处理说明')}
      </Form>
      {command.isPending && <Button loading style={{ display: 'none' }} />}
    </Modal>
  );
}
