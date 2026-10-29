import { requirementPriorityLabels, requirementTypeLabels } from '../../i18n/labels';
import { t, useLocale } from '../../i18n';
import { Alert, App, Button, Drawer, Form, Input, Select, Space } from 'antd';
import {
  type CreateRequirement,
  type Project,
  type Requirement,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { useProjectCommand } from '../projects/api';
import { RequirementPicker } from './RequirementPicker';
import styles from './requirements.module.css';
export function RequirementEditor({
  project,
  session,
  item,
  revision = false,
  onClose,
  onCreated,
}: {
  project: Project;
  session: SessionResponse;
  item?: Requirement;
  revision?: boolean;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  useLocale();
  const [form] = Form.useForm();
  const { message } = App.useApp();
  const command = useProjectCommand<{ id: string }>(session, (result) => {
    void message.success(
      revision ? t('新修订已保存，请重新提交评审') : item ? t('需求草稿已保存') : t('需求已创建'),
    );
    onClose();
    if (!item) onCreated(result.id);
  });
  const iterationId = Form.useWatch('iterationId', form);
  return (
    <Drawer
      open
      size={620}
      title={revision ? t('修订需求') : item ? t('编辑需求草稿') : t('新建需求')}
      onClose={onClose}
      footer={
        <div className={styles.footer}>
          <span>{t('先记录想法，再补齐评审信息')}</span>
          <Space>
            <Button onClick={onClose}>{t('取消')}</Button>
            <Button
              aria-label={revision ? t('保存修订') : item ? t('保存需求') : t('创建需求')}
              type="primary"
              loading={command.isPending}
              onClick={() => form.submit()}
            >
              {revision ? t('保存修订') : item ? t('保存需求') : t('创建需求')}
            </Button>
          </Space>
        </div>
      }
    >
      <p className={styles.muted}>{t('提交评审前，请补齐需求描述、负责人和可判断的验收标准。')}</p>
      {command.isError && <Alert showIcon type="error" title={errorMessage(command.error)} />}
      {revision && (
        <Alert
          type="warning"
          showIcon
          title={t('修订后须重新评审，原评审基线及影响记录会保留')}
          description={t('关联任务需核对新基线；旧用例评审、验收和发布检查依据会失效。')}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        initialValues={
          item ?? {
            ownerId: project.owner.id,
            iterationId: null,
            type: 'FUNCTIONAL',
            priority: 'MEDIUM',
            description: '',
            acceptanceCriteria: '',
          }
        }
        onFinish={(values: CreateRequirement & { changeReason?: string }) =>
          command.mutate({
            path: `/projects/${project.id}/requirements${item ? `/${item.id}/${revision ? 'revise' : 'update'}` : ''}`,
            input: {
              ...values,
              ownerId: values.ownerId ?? null,
              iterationId: values.iterationId ?? null,
              ...(item ? { version: item.version } : {}),
            },
          })
        }
      >
        {revision && (
          <>
            <Form.Item
              name="reason"
              label={t('修订原因')}
              rules={[{ required: true, whitespace: true, message: t('请填写修订原因') }]}
            >
              <Input.TextArea rows={2} maxLength={500} />
            </Form.Item>
            <Form.Item
              name="impact"
              label={t('影响范围与处理安排')}
              rules={[{ required: true, whitespace: true, message: t('请说明影响范围和处理安排') }]}
            >
              <Input.TextArea rows={3} maxLength={2000} />
            </Form.Item>
          </>
        )}
        <Form.Item
          name="title"
          label={t('需求标题')}
          rules={[{ required: true, whitespace: true, message: t('请填写需求标题') }]}
        >
          <Input autoFocus maxLength={200} placeholder={t('例如：支持按项目搜索客户资料')} />
        </Form.Item>
        <div className={styles.twoColumns}>
          <Form.Item name="type" label={t('需求类型')}>
            <Select
              options={Object.entries(requirementTypeLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
          <Form.Item name="priority" label={t('优先级')}>
            <Select
              options={Object.entries(requirementPriorityLabels).map(([value, label]) => ({
                value,
                label,
              }))}
            />
          </Form.Item>
        </div>
        <Form.Item name="description" label={t('需求描述')}>
          <Input.TextArea
            rows={5}
            maxLength={10000}
            showCount
            placeholder={t('谁遇到了什么问题？希望实现怎样的行为？')}
          />
        </Form.Item>
        <Form.Item name="acceptanceCriteria" label={t('验收标准')}>
          <Input.TextArea
            rows={4}
            maxLength={5000}
            showCount
            placeholder={t(
              '例如：输入项目名称后，仅显示当前用户有权访问的资料；无结果时显示提示。',
            )}
          />
        </Form.Item>
        <Form.Item name="ownerId" label={t('需求负责人')}>
          <RequirementPicker
            projectId={project.id}
            session={session}
            purpose="owner"
            initial={item?.owner ?? project.owner}
          />
        </Form.Item>
        <Form.Item
          name="iterationId"
          label={t('所属迭代')}
          extra={
            item?.iterationId
              ? t('已纳入迭代的需求只能调整至其他未关闭迭代，调整时需记录原因。')
              : t('可先留在项目中，后续再安排到迭代。')
          }
        >
          <RequirementPicker
            projectId={project.id}
            session={session}
            purpose="iteration"
            initial={item?.iteration}
          />
        </Form.Item>
        {item?.iterationId && iterationId !== item.iterationId && (
          <Form.Item
            name="changeReason"
            label={t('迭代调整原因')}
            rules={[{ required: true, whitespace: true, message: t('请填写调整原因') }]}
          >
            <Input.TextArea rows={2} maxLength={500} />
          </Form.Item>
        )}
      </Form>
    </Drawer>
  );
}
