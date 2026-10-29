import { Alert, App, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { CheckOutlined, FolderAddOutlined, SettingOutlined } from '@ant-design/icons';
import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import {
  projectColors,
  projectIcons,
  type CreateProject,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { loadMembers, projectKey, useProjectCommand } from './api';
import { ProjectIcon } from './presentation';
import styles from './projects.module.css';

function ColorChoices({
  value = 'teal',
  onChange,
}: {
  value?: Project['color'];
  onChange?: (value: Project['color']) => void;
}) {
  return (
    <div className={styles.colorChoices}>
      {projectColors.map((color) => (
        <button
          type="button"
          key={color}
          aria-label={`选择${{ teal: '青绿', blue: '蓝色', violet: '紫色', amber: '琥珀', rose: '玫瑰' }[color]}主题`}
          aria-pressed={value === color}
          className={`${styles.colorChoice} ${styles[color]}`}
          onClick={() => onChange?.(color)}
        >
          {value === color && <CheckOutlined aria-hidden />}
        </button>
      ))}
    </div>
  );
}

export function ProjectEditor({
  open,
  project,
  session,
  onClose,
  onCreated,
}: {
  open: boolean;
  project?: Project;
  session: SessionResponse;
  onClose: () => void;
  onCreated?: (id: string) => void;
}) {
  const [form] = Form.useForm();
  const [memberSearch, setMemberSearch] = useState('');
  const { message } = App.useApp();
  const color = Form.useWatch('color', form) ?? project?.color ?? 'teal';
  const icon = Form.useWatch('icon', form) ?? project?.icon ?? 'layers';
  const members = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project?.id ?? ''),
      'members',
      'picker',
      memberSearch,
    ],
    queryFn: ({ signal }) => loadMembers(project!.id, 1, 100, signal, memberSearch),
    enabled: open && !!project,
  });
  const mutation = useProjectCommand<{ id: string }>(session, (result) => {
    void message.success(project ? '项目设置已保存' : '项目已创建');
    onClose();
    if (!project) onCreated?.(result.id);
  });
  const initial = project
    ? {
        ...project,
        ownerId: project.owner.id,
        startDate: project.startDate ?? '',
        endDate: project.endDate ?? '',
      }
    : { color: 'teal', icon: 'layers', description: '', startDate: '', endDate: '' };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      size={520}
      destroyOnHidden
      title={
        <span className={styles.drawerTitle}>
          {project ? <SettingOutlined /> : <FolderAddOutlined />}
          {project ? '项目设置' : '创建新项目'}
        </span>
      }
      footer={
        <div className={styles.drawerFooter}>
          <span>让团队从清晰的目标开始</span>
          <Space>
            <Button onClick={onClose}>取消</Button>
            <Button type="primary" loading={mutation.isPending} onClick={() => form.submit()}>
              {project ? '保存修改' : '创建项目'}
            </Button>
          </Space>
        </div>
      }
    >
      <div className={styles.editorIntro}>
        <ProjectIcon project={{ color, icon }} size="large" />
        <div>
          <strong>{project ? '把项目细节整理好' : '为新的协作留一个空间'}</strong>
          <p>设置名称、目标和计划，开始与团队一起推进。</p>
        </div>
      </div>
      {mutation.isError && (
        <Alert
          className={styles.inlineAlert}
          showIcon
          type="error"
          title={errorMessage(mutation.error)}
        />
      )}
      <Form
        form={form}
        layout="vertical"
        requiredMark="optional"
        initialValues={initial}
        onFinish={(values: CreateProject & { ownerId?: string }) => {
          const input = {
            ...values,
            startDate: values.startDate || null,
            endDate: values.endDate || null,
            ...(project ? { version: project.version } : {}),
          };
          mutation.mutate({
            path: project ? `/projects/${project.id}/update` : '/projects',
            input,
          });
        }}
      >
        <Form.Item
          name="name"
          label="项目名称"
          rules={[{ required: true, whitespace: true, message: '请输入项目名称' }, { max: 80 }]}
        >
          <Input placeholder="例如：官网改版计划" size="large" maxLength={80} autoFocus />
        </Form.Item>
        {!project && (
          <Form.Item
            name="key"
            label="项目标识"
            extra="2–12 位字母或数字，用于快速识别项目；创建后不再修改。"
            normalize={(value: string) => value.toUpperCase()}
            rules={[
              { required: true, message: '请输入项目标识' },
              {
                pattern: /^[A-Z][A-Z0-9]{1,11}$/,
                message: '以字母开头，使用 2–12 位大写字母或数字',
              },
            ]}
          >
            <Input placeholder="例如：WEB" maxLength={12} />
          </Form.Item>
        )}
        <Form.Item name="description" label="项目简介">
          <Input.TextArea
            placeholder="这个项目要解决什么问题？希望达成什么目标？"
            rows={4}
            maxLength={2000}
            showCount
          />
        </Form.Item>
        <div className={styles.formSectionLabel}>个性化标识</div>
        <Form.Item name="icon" label="项目图标">
          <Select
            options={projectIcons.map((value) => ({
              value,
              label: (
                <span className={styles.iconOption}>
                  <ProjectIcon project={{ icon: value, color }} size="small" />
                  {
                    {
                      layers: '协作',
                      rocket: '探索',
                      code: '研发',
                      compass: '规划',
                      shield: '质量',
                      cube: '产品',
                    }[value]
                  }
                </span>
              ),
            }))}
          />
        </Form.Item>
        <Form.Item name="color" label="主题颜色">
          <ColorChoices />
        </Form.Item>
        <div className={styles.formSectionLabel}>计划与负责人</div>
        <div className={styles.dateFields}>
          <Form.Item name="startDate" label="计划开始">
            <Input type="date" />
          </Form.Item>
          <Form.Item
            name="endDate"
            label="计划结束"
            dependencies={['startDate']}
            rules={[
              ({ getFieldValue }) => ({
                validator(_, value) {
                  const start = getFieldValue('startDate') as string;
                  return !value || !start || value >= start
                    ? Promise.resolve()
                    : Promise.reject(new Error('结束日期不能早于开始日期'));
                },
              }),
            ]}
          >
            <Input type="date" />
          </Form.Item>
        </div>
        {project ? (
          <Form.Item
            name="ownerId"
            label="项目负责人"
            extra="新负责人需已加入项目；移交后原有成员角色会保留。"
          >
            <Select
              loading={members.isPending}
              showSearch
              filterOption={false}
              onSearch={(value) => setMemberSearch(value.slice(0, 100))}
              options={[
                ...(!memberSearch &&
                !members.data?.items.some((member) => member.user.id === project.owner.id)
                  ? [
                      {
                        value: project.owner.id,
                        label: `${project.owner.name} · ${project.owner.email}`,
                      },
                    ]
                  : []),
                ...(members.data?.items ?? [])
                  .filter((member) => member.user.active)
                  .map((member) => ({
                    value: member.user.id,
                    label: `${member.user.name} · ${member.user.email}`,
                  })),
              ]}
            />
          </Form.Item>
        ) : (
          <div className={styles.ownerHint}>
            <span className={styles.personAvatar}>{session.user.name.slice(0, 1)}</span>
            <span>你将成为这个项目的首位负责人</span>
          </div>
        )}
      </Form>
    </Drawer>
  );
}
