import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Alert, App, Button, Drawer, Form, Input, Select, Space } from 'antd';
import { CalendarOutlined } from '@ant-design/icons';
import type { CreateIteration, Iteration, Project, SessionResponse } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { loadMembers, projectKey, useProjectCommand } from '../projects/api';
import styles from './iterations.module.css';

export function IterationEditor({
  project,
  session,
  item,
  onClose,
  onCreated,
}: {
  project: Project;
  session: SessionResponse;
  item?: Iteration;
  onClose: () => void;
  onCreated: (id: string) => void;
}) {
  useLocale();
  const [form] = Form.useForm();
  const [search, setSearch] = useState('');
  const initialOwner = item?.owner ?? project.owner;
  const [selectedOwner, setSelectedOwner] = useState({
    id: initialOwner.id,
    label: `${initialOwner.name} · ${initialOwner.email}`,
  });
  const { message } = App.useApp();
  const members = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'members', 'iteration-picker', search],
    queryFn: ({ signal }) => loadMembers(project.id, 1, 100, signal, search),
  });
  const command = useProjectCommand<{ id: string }>(session, (result) => {
    void message.success(item ? t('迭代计划已更新') : t('迭代已创建'));
    onClose();
    if (!item) onCreated(result.id);
  });
  return (
    <Drawer
      open
      size={540}
      onClose={onClose}
      title={
        <span className={styles.drawerTitle}>
          <CalendarOutlined />
          {item ? t('编辑迭代计划') : t('新建迭代')}
        </span>
      }
      footer={
        <div className={styles.drawerFooter}>
          <span>{t('让每个阶段都有明确的目标')}</span>
          <Space>
            <Button aria-label={t('取消')} onClick={onClose}>
              {t('取消')}
            </Button>
            <Button
              aria-label={item ? t('保存迭代') : t('创建迭代')}
              type="primary"
              loading={command.isPending}
              onClick={() => form.submit()}
            >
              {item ? t('保存迭代') : t('创建迭代')}
            </Button>
          </Space>
        </div>
      }
    >
      <p className={styles.intro}>
        {t('为「')}
        {project.name}
        {t('」安排下一段协作。明确目标、负责人和时间，再一起开始推进。')}
      </p>
      {command.isError && (
        <Alert className={styles.alert} type="error" showIcon title={errorMessage(command.error)} />
      )}
      <Form
        layout="vertical"
        form={form}
        initialValues={
          item
            ? {
                name: item.name,
                goal: item.goal,
                ownerId: item.owner.id,
                startDate: item.startDate,
                endDate: item.endDate,
              }
            : { ownerId: project.owner.id, goal: '' }
        }
        onFinish={(values: CreateIteration) =>
          command.mutate({
            path: `/projects/${project.id}/iterations${item ? `/${item.id}/update` : ''}`,
            input: { ...values, ...(item ? { version: item.version } : {}) },
          })
        }
      >
        <Form.Item
          name="name"
          label={t('迭代名称')}
          rules={[{ required: true, whitespace: true, message: t('请输入迭代名称') }, { max: 80 }]}
        >
          <Input
            size="large"
            maxLength={80}
            placeholder={t('例如：第一阶段 · 登录与工作空间')}
            autoFocus
          />
        </Form.Item>
        <Form.Item
          name="goal"
          label={t('迭代目标')}
          extra={t('规划时可先留空，启动前请补齐目标。')}
        >
          <Input.TextArea
            rows={4}
            maxLength={2000}
            showCount
            placeholder={t('这一轮希望解决什么问题？准备交付哪些成果？')}
          />
        </Form.Item>
        <Form.Item
          name="ownerId"
          label={t('迭代负责人')}
          extra={t('从本项目的可用成员中选择，支持搜索姓名或邮箱。')}
          rules={[{ required: true, message: t('请选择迭代负责人') }]}
        >
          <Select
            showSearch
            filterOption={false}
            loading={members.isPending}
            onSearch={(value) => setSearch(value.slice(0, 100))}
            onSelect={(value, option) => setSelectedOwner({ id: value, label: option.label })}
            labelRender={({ value, label }) =>
              value === selectedOwner.id ? selectedOwner.label : label
            }
            options={[
              ...(!search &&
              !members.data?.items.some((member) => member.user.id === initialOwner.id)
                ? [
                    {
                      value: initialOwner.id,
                      label: `${initialOwner.name} · ${initialOwner.email}`,
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
        {members.isError && (
          <Alert
            className={styles.alert}
            type="error"
            title={errorMessage(members.error)}
            action={
              <Button size="small" onClick={() => void members.refetch()}>
                {t('重试')}
              </Button>
            }
          />
        )}
        <div className={styles.dateFields}>
          <Form.Item
            name="startDate"
            label={t('开始日期')}
            rules={[{ required: true, message: t('请选择开始日期') }]}
          >
            <Input
              type="date"
              min={project.startDate ?? undefined}
              max={project.endDate ?? undefined}
            />
          </Form.Item>
          <Form.Item
            name="endDate"
            label={t('结束日期')}
            dependencies={['startDate']}
            rules={[
              { required: true, message: t('请选择结束日期') },
              ({ getFieldValue }) => ({
                validator(_, value) {
                  return !value ||
                    !getFieldValue('startDate') ||
                    value >= getFieldValue('startDate')
                    ? Promise.resolve()
                    : Promise.reject(new Error(t('结束日期不能早于开始日期')));
                },
              }),
            ]}
          >
            <Input
              type="date"
              min={project.startDate ?? undefined}
              max={project.endDate ?? undefined}
            />
          </Form.Item>
        </div>
        {(project.startDate || project.endDate) && (
          <div className={styles.note}>
            {t('项目计划：')}
            {project.startDate ?? t('未限制开始日期')} {t(' 至')}{' '}
            {project.endDate ?? t('未限制结束日期')}
            {t('。迭代日期须在此范围内。')}
          </div>
        )}
      </Form>
    </Drawer>
  );
}
