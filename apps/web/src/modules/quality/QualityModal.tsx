import { qualityLabels } from '../../i18n/labels';
import { t, localizeLabels, useLocale } from '../../i18n';
import { useRef, useState } from 'react';
import { App, Alert, Button, Collapse, Form, Input, Modal, Select, Steps, Upload } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { UploadFile } from 'antd';
import { createBuildSchema, type Project, type SessionResponse } from '@myteam/contracts';
import { errorMessage, request } from '../../api/client';
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
export const actionLabels: Record<string, string> = localizeLabels({
  create: '创建',
  update: '保存修改',
  assign: '改派责任人',
  start: '开始修复',
  confirm: '确认缺陷',
  fix: '提交修复',
  updateFixBuild: '更新修复构建',
  retest: '登记复测',
  reopen: '重新打开缺陷',
  dispose: '登记特殊结论',
  link: '关联用例 / 测试记录',
});
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
  useLocale();
  const [form] = Form.useForm();
  const [step, setStep] = useState(0);
  const [files, setFiles] = useState<UploadFile[]>([]);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const uploadKeys = useRef(new Map<string, { key: string; done: boolean }>());
  const create = op.action === 'create';
  const edit = create || op.action === 'update';
  const defectCreate = create && op.entity === 'defects';
  const { message } = App.useApp();
  const command = useProjectCommand<{ id: string }>(session, (r) => {
    if (!defectCreate) {
      void message.success(t('记录已保存'));
      onSaved(r.id, op.entity);
      onClose();
    }
  });
  const title = create
    ? { releases: t('新建版本'), builds: t('登记构建'), defects: t('报告缺陷') }[op.entity]
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
  const close = () => {
    if (uploading || command.isPending) return;
    if (createdId) onSaved(createdId, op.entity);
    onClose();
  };
  const saveDefect = async (body: Record<string, unknown>) => {
    setUploading(true);
    setUploadError('');
    try {
      const id =
        createdId ??
        (
          await command.mutateAsync({
            path: `/projects/${project.id}/quality/defects`,
            input: body,
          })
        ).id;
      if (!createdId) setCreatedId(id);
      for (const item of files) {
        let entry = uploadKeys.current.get(item.uid);
        if (!entry) {
          entry = { key: crypto.randomUUID(), done: false };
          uploadKeys.current.set(item.uid, entry);
        }
        if (entry.done) continue;
        const file = item.originFileObj;
        if (!file) throw new Error(t('无法读取图片，请重新选择'));
        await request(
          `/projects/${project.id}/collaboration/DEFECT/${id}/attachments?filename=${encodeURIComponent(file.name)}`,
          {
            method: 'POST',
            body: file,
            headers: {
              'Content-Type': 'application/octet-stream',
              'X-CSRF-Token': session.csrfToken,
              'Idempotency-Key': entry.key,
            },
            signal: AbortSignal.timeout(60000),
          },
        );
        entry.done = true;
      }
      void message.success(t('缺陷已报告'));
      onSaved(id, 'defects');
      onClose();
    } catch (error) {
      setUploadError(errorMessage(error));
    } finally {
      setUploading(false);
    }
  };
  return (
    <Modal
      open
      title={title}
      width={700}
      zIndex={1300}
      style={defectCreate ? { top: 24 } : undefined}
      styles={
        defectCreate ? { body: { maxHeight: 'calc(100vh - 180px)', overflowY: 'auto' } } : undefined
      }
      closable={!uploading}
      mask={{ closable: !uploading }}
      keyboard={!uploading}
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
      onCancel={close}
      footer={
        defectCreate && step === 1 ? (
          <>
            <Button disabled={uploading} onClick={close}>
              {t('取消')}
            </Button>
            <Button disabled={uploading || !!createdId} onClick={() => setStep(0)}>
              {t('上一步')}
            </Button>
            <Button
              type="primary"
              loading={command.isPending || uploading}
              onClick={() => form.submit()}
            >
              {t('报告缺陷')}
            </Button>
          </>
        ) : undefined
      }
      okText={defectCreate && step === 0 ? t('下一步') : title}
      confirmLoading={command.isPending}
    >
      {defectCreate && (
        <Steps
          className={styles.formSteps}
          current={step}
          size="small"
          items={[{ title: t('基本信息') }, { title: t('问题描述') }]}
        />
      )}
      {uploadError && (
        <Alert
          type="error"
          showIcon
          title={t(uploadError)}
          description={
            createdId ? t('缺陷已创建，可重试上传，或关闭后在详情中补充附件。') : undefined
          }
        />
      )}
      {!defectCreate && command.isError && (
        <Alert type="error" showIcon title={errorMessage(command.error)} />
      )}
      {createdId && (
        <Alert type="info" showIcon title={t('缺陷已创建，基本信息已锁定，可重试上传图片。')} />
      )}
      <Form
        form={form}
        layout="vertical"
        disabled={defectCreate && (!!createdId || uploading)}
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
          if (defectCreate) {
            void saveDefect(body);
            return;
          }
          command.mutate({
            path: `/projects/${project.id}/quality/${op.entity}${op.id ? `/${op.id}/${op.action}` : ''}`,
            input: body,
          });
        }}
      >
        {edit && op.entity === 'releases' && (
          <>
            <Form.Item
              name="name"
              label={t('版本名称')}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            {text('description', t('版本说明'), false)}
            <Form.Item name="requirementIds" label={t('关联需求')}>
              {picker('requirements', { multiple: true })}
            </Form.Item>
            <Form.Item name="taskIds" label={t('关联任务')}>
              {picker('tasks', { multiple: true })}
            </Form.Item>
          </>
        )}
        {op.entity === 'builds' && (
          <>
            <Form.Item name="releaseId" label={t('所属版本')} rules={[{ required: true }]}>
              {picker('releases')}
            </Form.Item>
            <Form.Item
              name="identifier"
              label={t('构建标识')}
              rules={[{ required: true, whitespace: true }]}
            >
              <Input maxLength={100} />
            </Form.Item>
            {['codeUrl', 'artifactUrl'].map((name) => (
              <Form.Item
                key={name}
                name={name}
                label={name === 'codeUrl' ? t('代码链接') : t('产物链接')}
                rules={[
                  {
                    validator: (_, value) => {
                      const r = createBuildSchema.shape.codeUrl.safeParse(value ?? '');
                      return r.success
                        ? Promise.resolve()
                        : Promise.reject(
                            new Error(t(r.error.issues[0]?.message ?? '请检查输入内容')),
                          );
                    },
                  },
                ]}
              >
                <Input maxLength={2000} />
              </Form.Item>
            ))}
            {text('notes', t('登记说明'), false)}
          </>
        )}
        {defectCreate && (
          <>
            <div hidden={step !== 0}>
              <Form.Item
                name="title"
                label={t('缺陷标题')}
                rules={[{ required: true, whitespace: true }]}
              >
                <Input maxLength={200} placeholder={t('简要描述遇到的问题')} />
              </Form.Item>
              <Form.Item
                name="requirementId"
                label={t('缺陷关联需求')}
                rules={[{ required: true }]}
              >
                {picker('requirements')}
              </Form.Item>
              <div className={styles.formGrid}>
                <Form.Item name="severity" label={t('严重程度')} rules={[{ required: true }]}>
                  <Select
                    options={['CRITICAL', 'MAJOR', 'MINOR', 'TRIVIAL'].map((value) => ({
                      value,
                      label: qualityLabels[value],
                    }))}
                  />
                </Form.Item>
                <Form.Item name="source" label={t('发现来源')}>
                  <Select
                    options={[
                      { value: 'TESTING', label: t('测试发现') },
                      { value: 'PRODUCTION', label: t('生产发现') },
                    ]}
                  />
                </Form.Item>
                <Form.Item name="assigneeId" label={t('开发负责人')} rules={[{ required: true }]}>
                  {person('assignee')}
                </Form.Item>
                <Form.Item name="retesterId" label={t('复测负责人')} rules={[{ required: true }]}>
                  {person('retester')}
                </Form.Item>
              </div>
              {source === 'PRODUCTION' && (
                <Form.Item
                  name="foundBuildId"
                  label={t('发现构建')}
                  extra={t('生产发现的缺陷需要关联已发布版本的构建。')}
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
                    label: t('更多关联（可选）'),
                    forceRender: true,
                    children: (
                      <div className={styles.formGrid}>
                        <Form.Item name="taskId" label={t('缺陷关联任务')}>
                          {picker('tasks', { requirementId })}
                        </Form.Item>
                        <Form.Item name="testCaseIds" label={t('关联测试用例（可选）')}>
                          {picker('cases', { multiple: true, requirementId })}
                        </Form.Item>
                        <Form.Item name="testRecordIds" label={t('关联测试记录（可选）')}>
                          {picker('records', { multiple: true, requirementId })}
                        </Form.Item>
                        {source !== 'PRODUCTION' && (
                          <Form.Item name="foundBuildId" label={t('发现构建（可选）')}>
                            {picker('builds')}
                          </Form.Item>
                        )}
                        <Form.Item name="targetReleaseId" label={t('计划修复版本（可选）')}>
                          {picker('releases')}
                        </Form.Item>
                      </div>
                    ),
                  },
                ]}
              />
            </div>
            <div hidden={step !== 1}>
              <p className={styles.formHint}>{t('补充复现信息，帮助开发快速定位问题。')}</p>
              {text('environment', t('发现环境'))}
              {text('reproduction', t('复现步骤'), true, 10000)}
              <div className={styles.formGrid}>
                {text('expected', t('预期表现'))}
                {text('actual', t('实际表现'))}
              </div>
            </div>
          </>
        )}
        {op.action === 'assign' && (
          <>
            <Form.Item name="assigneeId" label={t('开发负责人')} rules={[{ required: true }]}>
              {person('assignee')}
            </Form.Item>
            <Form.Item name="retesterId" label={t('复测负责人')} rules={[{ required: true }]}>
              {person('retester')}
            </Form.Item>
            <Form.Item name="targetReleaseId" label={t('计划修复版本（可选）')}>
              {picker('releases')}
            </Form.Item>
          </>
        )}
        {op.action === 'fix' && (
          <>
            <Form.Item
              name="buildId"
              label={t('实际修复构建')}
              rules={op.initial?.foundBuildId ? [{ required: true }] : []}
            >
              {picker('builds', {
                releaseId:
                  typeof op.initial?.targetReleaseId === 'string'
                    ? op.initial.targetReleaseId
                    : undefined,
                requirementId:
                  typeof op.initial?.requirementId === 'string'
                    ? op.initial.requirementId
                    : undefined,
                validateBuildScope: true,
              })}
            </Form.Item>
            {text('evidence', t('修复证据说明（选填）'), false)}
          </>
        )}
        {op.action === 'updateFixBuild' && (
          <>
            <Alert
              type="info"
              showIcon
              title={t('请选择实际包含此缺陷修复的当前范围构建。')}
              description={t('更新后，测试人员需要基于新构建创建复测记录。')}
            />
            <Form.Item name="buildId" label={t('实际修复构建')} rules={[{ required: true }]}>
              {picker('builds', {
                releaseId:
                  typeof op.initial?.targetReleaseId === 'string'
                    ? op.initial.targetReleaseId
                    : undefined,
                requirementId:
                  typeof op.initial?.requirementId === 'string'
                    ? op.initial.requirementId
                    : undefined,
                validateBuildScope: true,
              })}
            </Form.Item>
          </>
        )}
        {op.action === 'retest' && (
          <>
            <Form.Item name="testRecordId" label={t('复测记录（可选）')}>
              {picker('records', { requirementId: String(op.initial?.requirementId ?? '') })}
            </Form.Item>
            <Form.Item name="passed" label={t('复测结论')} rules={[{ required: true }]}>
              <Select
                options={[
                  { value: 'pass', label: t('通过并关闭') },
                  { value: 'fail', label: t('未通过并重新打开') },
                ]}
              />
            </Form.Item>
            {text('evidence', t('复测证据说明'))}
          </>
        )}
        {op.action === 'link' && (
          <>
            <Form.Item name="testCaseIds" label={t('关联测试用例（可选）')}>
              {picker('cases', {
                multiple: true,
                requirementId: String(op.initial?.requirementId ?? ''),
              })}
            </Form.Item>
            <Form.Item name="testRecordIds" label={t('关联测试记录（可选）')}>
              {picker('records', {
                multiple: true,
                requirementId: String(op.initial?.requirementId ?? ''),
              })}
            </Form.Item>
          </>
        )}
        {op.action === 'dispose' && (
          <>
            <Form.Item name="conclusion" label={t('特殊处理结论')} rules={[{ required: true }]}>
              <Select
                options={['DUPLICATE', 'NOT_A_DEFECT', 'CANNOT_REPRODUCE', 'DEFERRED'].map(
                  (value) => ({ value, label: qualityLabels[value] }),
                )}
              />
            </Form.Item>
            {conclusion === 'DUPLICATE' && (
              <Form.Item name="duplicateOfId" label={t('主缺陷')} rules={[{ required: true }]}>
                {picker('defects')}
              </Form.Item>
            )}
            {conclusion === 'DEFERRED' && (
              <>
                <Form.Item name="targetReleaseId" label={t('延期目标版本')}>
                  {picker('releases')}
                </Form.Item>
                <Form.Item name="deferUntil" label={t('延期跟进日期')}>
                  <Input type="date" />
                </Form.Item>
              </>
            )}
            {text('evidence', t('处理依据与证据'))}
          </>
        )}
        {!edit &&
          op.action !== 'link' &&
          text(
            'reason',
            op.action === 'fix'
              ? t('修复说明（选填）')
              : op.action === 'updateFixBuild'
                ? t('更换说明（选填）')
                : t('处理说明'),
            op.action !== 'fix' && op.action !== 'updateFixBuild',
          )}
      </Form>
      {defectCreate && step === 1 && (
        <div className={styles.defectUpload}>
          <div className={styles.defectUploadTitle}>{t('问题截图（可选）')}</div>
          <p className={styles.formHint}>{t('支持 PNG、JPG、WebP，单张不超过 20 MiB。')}</p>
          <Upload
            listType="picture-card"
            accept=".png,.jpg,.jpeg,.webp"
            multiple
            fileList={files}
            disabled={uploading}
            beforeUpload={(file) => {
              if (!/\.(png|jpe?g|webp)$/i.test(file.name)) {
                void message.error(t('请选择 PNG、JPG 或 WebP 图片'));
                return Upload.LIST_IGNORE;
              }
              if (!file.size || file.size > 20 * 1024 * 1024) {
                void message.error(t('图片大小须在 1 字节至 20 MiB 之间'));
                return Upload.LIST_IGNORE;
              }
              return false;
            }}
            onRemove={(file) => {
              if (uploadKeys.current.get(file.uid)?.done) {
                void message.info(t('图片已上传，不能在此移除。'));
                return false;
              }
              return true;
            }}
            onChange={({ fileList }) => setFiles(fileList)}
          >
            <div>
              <PlusOutlined />
              <div>{t('选择图片')}</div>
            </div>
          </Upload>
        </div>
      )}
      {command.isPending && <Button loading style={{ display: 'none' }} />}
    </Modal>
  );
}
