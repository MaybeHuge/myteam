import { requirementPriorityLabels } from '../../i18n/labels';
import { t, useLocale } from '../../i18n';
import { Alert, App, Button, Drawer, Form, Input, Select, Space, Skeleton } from 'antd';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowUpOutlined,
  ArrowDownOutlined,
  DeleteOutlined,
  PlusOutlined,
} from '@ant-design/icons';
import {
  type CreateTestCase,
  type Project,
  type TestCase,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { projectKey, useProjectCommand } from '../projects/api';
import { loadRequirement } from '../requirements/api';
import { CasePicker } from './CasePicker';
import styles from './test-cases.module.css';
export function CaseEditor({
  project,
  session,
  item,
  requirementId,
  revision = false,
  onClose,
  onSaved,
}: {
  project: Project;
  session: SessionResponse;
  item?: TestCase;
  requirementId?: string;
  revision?: boolean;
  onClose: () => void;
  onSaved: (id: string) => void;
}) {
  useLocale();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const initialRequirement = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'case-initial-requirement',
      requirementId,
    ],
    queryFn: ({ signal }) => loadRequirement(project.id, requirementId!, 1, signal),
    enabled: !!requirementId && !item,
  });
  const command = useProjectCommand<{ id: string }>(session, (result) => {
    void message.success(revision ? t('新修订已保存，请重新评审') : t('用例草稿已保存'));
    onSaved(result.id);
  });
  return (
    <Drawer
      open
      size={720}
      title={revision ? t('修订用例') : item ? t('编辑用例草稿') : t('新建用例')}
      onClose={onClose}
      footer={
        <Space wrap>
          <Button onClick={onClose}>{t('取消')}</Button>
          <Button
            type="primary"
            aria-label={revision ? t('保存用例修订') : item ? t('保存用例') : t('创建用例')}
            loading={command.isPending}
            disabled={!!requirementId && !item && !initialRequirement.data}
            onClick={() => form.submit()}
          >
            {revision ? t('保存用例修订') : item ? t('保存用例') : t('创建用例')}
          </Button>
        </Space>
      }
    >
      <p className={styles.muted}>
        {t('草稿可以逐步完善。送审前请指定负责人，并为每个步骤填写操作与预期结果。')}
      </p>
      {revision && (
        <Alert
          type="warning"
          showIcon
          title={t('保存后进入草稿，重新通过评审后才可使用。旧修订和评审结论将保留。')}
        />
      )}
      {command.isError && <Alert type="error" showIcon title={errorMessage(command.error)} />}
      {requirementId && !item && initialRequirement.isPending ? (
        <Skeleton active />
      ) : initialRequirement.isError ? (
        <Alert
          type="error"
          title={errorMessage(initialRequirement.error)}
          action={
            <Button onClick={() => void initialRequirement.refetch()}>{t('重新加载需求')}</Button>
          }
        />
      ) : (
        <Form
          form={form}
          layout="vertical"
          initialValues={
            item
              ? { ...item, requirementIds: item.requirements.map((r) => r.id) }
              : {
                  priority: 'MEDIUM',
                  ownerId: session.user.id,
                  preconditions: '',
                  steps: [],
                  requirementIds: requirementId ? [requirementId] : [],
                }
          }
          onFinish={(values: CreateTestCase & { reason?: string }) =>
            command.mutate({
              path: `/projects/${project.id}/test-cases${item ? `/${item.id}/${revision ? 'revise' : 'update'}` : ''}`,
              input: {
                ...values,
                ownerId: values.ownerId ?? null,
                steps: values.steps ?? [],
                ...(item ? { version: item.version } : {}),
              },
            })
          }
        >
          {revision && (
            <Form.Item
              name="reason"
              label={t('用例修订原因')}
              rules={[{ required: true, whitespace: true, message: t('请填写修订原因') }]}
            >
              <Input.TextArea rows={2} maxLength={2000} />
            </Form.Item>
          )}
          <Form.Item
            name="title"
            label={t('用例标题')}
            rules={[{ required: true, whitespace: true, message: t('请填写用例标题') }]}
          >
            <Input
              autoFocus
              maxLength={200}
              placeholder={t('例如：正确验证码可以完成手机号登录')}
            />
          </Form.Item>
          <Form.Item
            name="requirementIds"
            label={t('关联需求')}
            rules={[
              {
                required: true,
                type: 'array',
                min: 1,
                max: 50,
                message: t('请关联 1 至 50 个已确认需求'),
              },
            ]}
          >
            <CasePicker
              projectId={project.id}
              session={session}
              purpose="requirements"
              initial={(
                item?.requirements ?? (initialRequirement.data ? [initialRequirement.data] : [])
              ).map((r) => ({ id: r.id, name: `${r.code} · ${r.title}` }))}
            />
          </Form.Item>
          <div className={styles.twoColumns}>
            <Form.Item name="priority" label={t('用例优先级')}>
              <Select
                options={Object.entries(requirementPriorityLabels).map(([value, label]) => ({
                  value,
                  label,
                }))}
              />
            </Form.Item>
            <Form.Item name="ownerId" label={t('用例负责人')}>
              <CasePicker
                projectId={project.id}
                session={session}
                purpose="owner"
                initial={
                  item?.owner ? [item.owner] : [{ id: session.user.id, name: session.user.name }]
                }
              />
            </Form.Item>
          </div>
          <Form.Item name="preconditions" label={t('前置条件')}>
            <Input.TextArea
              rows={3}
              maxLength={5000}
              placeholder={t('例如：已有可用测试账号，已收到有效验证码')}
            />
          </Form.Item>
          <Form.List name="steps">
            {(fields, { add, remove, move }) => (
              <>
                <h3>{t('测试步骤与预期')}</h3>
                {fields.map((field, index) => (
                  <section
                    className={styles.step}
                    key={field.key}
                    aria-label={t('步骤 {{0}}', { '0': index + 1 })}
                  >
                    <div className={styles.stepHeading}>
                      <strong>
                        {t('步骤 ')}
                        {index + 1}
                      </strong>
                      <Space>
                        <Button
                          type="text"
                          size="small"
                          aria-label={t('上移步骤 {{0}}', { '0': index + 1 })}
                          disabled={index === 0}
                          icon={<ArrowUpOutlined />}
                          onClick={() => move(index, index - 1)}
                        />
                        <Button
                          type="text"
                          size="small"
                          aria-label={t('下移步骤 {{0}}', { '0': index + 1 })}
                          disabled={index === fields.length - 1}
                          icon={<ArrowDownOutlined />}
                          onClick={() => move(index, index + 1)}
                        />
                        <Button
                          type="text"
                          size="small"
                          danger
                          aria-label={t('删除步骤 {{0}}', { '0': index + 1 })}
                          icon={<DeleteOutlined />}
                          onClick={() => remove(index)}
                        />
                      </Space>
                    </div>
                    <Form.Item
                      name={[field.name, 'action']}
                      label={t('步骤 {{0}} 操作', { '0': index + 1 })}
                    >
                      <Input.TextArea rows={2} maxLength={2000} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'expected']}
                      label={t('步骤 {{0}} 预期', { '0': index + 1 })}
                    >
                      <Input.TextArea rows={2} maxLength={2000} />
                    </Form.Item>
                  </section>
                ))}
                <Button
                  block
                  disabled={fields.length >= 100}
                  aria-label={t('添加步骤')}
                  icon={<PlusOutlined aria-hidden />}
                  onClick={() => add({ action: '', expected: '' })}
                >
                  {t('添加步骤')}
                </Button>
              </>
            )}
          </Form.List>
        </Form>
      )}
    </Drawer>
  );
}
