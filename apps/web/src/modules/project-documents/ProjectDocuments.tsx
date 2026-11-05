import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Alert,
  App,
  Button,
  Input,
  Modal,
  Pagination,
  Radio,
  Space,
  Table,
  Tag,
  Typography,
} from 'antd';
import { useNavigate } from 'react-router';
import {
  projectDocumentListSchema,
  projectDocumentRequirementOptionsSchema,
  type Project,
  type SessionResponse,
} from '@myteam/contracts';
import { request, errorMessage } from '../../api/client';
import { t, useLocale } from '../../i18n';
import { projectKey, useProjectCommand } from '../projects/api';

type Item = {
  id: string;
  title: string;
  kind: 'project' | 'requirement';
  requirementId: string | null;
  requirementCode: string | null;
  status: 'draft' | 'applied' | 'document';
  updatedAt: string;
  updatedBy: string;
};
type Choice = { id: string; code: string; title: string; hasDocument: boolean; canCreate: boolean };
export function ProjectDocuments({
  project,
  session,
}: {
  project: Project;
  session: SessionResponse;
}) {
  useLocale();
  const navigate = useNavigate();
  const { message } = App.useApp();
  const [page, setPage] = useState(1),
    [q, setQ] = useState(''),
    [kind, setKind] = useState('all');
  const [creating, setCreating] = useState(false),
    [mode, setMode] = useState<'project' | 'requirement'>('project');
  const [title, setTitle] = useState(''),
    [selected, setSelected] = useState<string>(),
    [search, setSearch] = useState(''),
    [choicePage, setChoicePage] = useState(1);
  const base = `/projects/${project.id}/documents`;
  const list = useQuery({
    queryKey: [...projectKey(session.user.id, project.id), 'documents', page, q, kind],
    queryFn: ({ signal }) =>
      request<unknown>(
        `${base}?${new URLSearchParams({ page: String(page), pageSize: '20', q, kind })}`,
        { signal },
      ).then((value) => projectDocumentListSchema.parse(value)),
  });
  const choices = useQuery({
    queryKey: [
      ...projectKey(session.user.id, project.id),
      'document-requirements',
      choicePage,
      search,
    ],
    enabled: creating && mode === 'requirement',
    queryFn: ({ signal }) =>
      request<unknown>(
        `${base}/requirements?${new URLSearchParams({ page: String(choicePage), pageSize: '10', q: search })}`,
        { signal },
      ).then((value) => projectDocumentRequirementOptionsSchema.parse(value)),
  });
  const command = useProjectCommand<{ id: string }>(session);
  const create = async () => {
    try {
      if (mode === 'requirement') {
        if (!selected) {
          void message.error(t('请选择需求'));
          return;
        }
        await command.mutateAsync({
          path: `/projects/${project.id}/requirements/${selected}/document`,
          input: { template: 'blank' },
        });
        navigate(`/projects/${project.id}/requirements/${selected}/document?edit=1`);
      } else {
        if (!title.trim()) {
          void message.error(t('请输入文档标题'));
          return;
        }
        const result = await command.mutateAsync({ path: base, input: { title } });
        navigate(`/projects/${project.id}/documents/${result.id}?edit=1`);
      }
    } catch (error) {
      void message.error(errorMessage(error));
      if (mode === 'requirement') void choices.refetch();
    }
  };
  return (
    <section>
      <Space style={{ width: '100%', justifyContent: 'space-between', marginBottom: 16 }}>
        <Typography.Title level={3}>{t('项目文档')}</Typography.Title>
        {list.data?.canCreate && (
          <Button
            type="primary"
            onClick={() => {
              setTitle('');
              setSelected(undefined);
              setMode('project');
              setSearch('');
              setChoicePage(1);
              setCreating(true);
            }}
          >
            {t('新建文档')}
          </Button>
        )}
      </Space>
      <Space wrap style={{ marginBottom: 16 }}>
        <Input.Search
          placeholder={t('搜索文档标题')}
          allowClear
          onSearch={(value) => {
            setQ(value);
            setPage(1);
          }}
        />
        <Radio.Group
          value={kind}
          onChange={(event) => {
            setKind(event.target.value);
            setPage(1);
          }}
          options={[
            { label: t('全部'), value: 'all' },
            { label: t('项目文档'), value: 'project' },
            { label: t('需求文档'), value: 'requirement' },
          ]}
        />
      </Space>
      {list.isError && (
        <Alert
          type="error"
          showIcon
          title={errorMessage(list.error)}
          action={<Button onClick={() => void list.refetch()}>{t('重试')}</Button>}
        />
      )}
      <Table
        rowKey={(row) => `${row.kind}:${row.id}`}
        loading={list.isPending}
        dataSource={list.data?.items ?? []}
        pagination={false}
        columns={[
          {
            title: t('标题'),
            render: (_: unknown, row: Item) => (
              <Button
                type="link"
                onClick={() =>
                  navigate(
                    row.kind === 'requirement'
                      ? `/projects/${project.id}/requirements/${row.id}/document`
                      : `/projects/${project.id}/documents/${row.id}`,
                  )
                }
              >
                {row.title}
              </Button>
            ),
          },
          {
            title: t('类型'),
            render: (_: unknown, row: Item) =>
              t(row.kind === 'requirement' ? '需求文档' : '项目文档'),
          },
          {
            title: t('状态'),
            render: (_: unknown, row: Item) => (
              <Tag>
                {t(row.status === 'draft' ? '草稿' : row.status === 'applied' ? '已应用' : '文档')}
              </Tag>
            ),
          },
          { title: t('关联需求'), render: (_: unknown, row: Item) => row.requirementCode ?? '—' },
          { title: t('更新人'), dataIndex: 'updatedBy' },
          {
            title: t('更新时间'),
            dataIndex: 'updatedAt',
            render: (value: string) => new Date(value).toLocaleString(),
          },
        ]}
      />
      <Pagination
        current={page}
        pageSize={20}
        total={list.data?.total ?? 0}
        showSizeChanger={false}
        style={{ marginTop: 16, textAlign: 'right' }}
        onChange={setPage}
      />
      <Modal
        open={creating}
        title={t('新建文档')}
        onCancel={() => setCreating(false)}
        onOk={() => void create()}
        confirmLoading={command.isPending}
        width={760}
      >
        <p>{t('文档归属于当前项目。')}</p>
        <Radio.Group
          value={mode}
          onChange={(event) => {
            setMode(event.target.value);
            setSelected(undefined);
          }}
          options={[
            { label: t('不关联需求'), value: 'project' },
            { label: t('关联需求'), value: 'requirement' },
          ]}
        />
        {mode === 'project' ? (
          <Input
            style={{ marginTop: 16 }}
            aria-label={t('文档标题')}
            placeholder={t('请输入文档标题')}
            maxLength={200}
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
        ) : (
          <div style={{ marginTop: 16 }}>
            <p>{t('每个需求只能关联一份需求文档；已创建文档的需求不可选择。')}</p>
            <Input.Search
              placeholder={t('搜索需求标题')}
              allowClear
              onSearch={(value) => {
                setSearch(value);
                setChoicePage(1);
                setSelected(undefined);
              }}
            />
            {choices.isError && <Alert type="error" title={errorMessage(choices.error)} />}
            <Table
              size="small"
              rowKey="id"
              loading={choices.isFetching}
              dataSource={choices.data?.items ?? []}
              pagination={false}
              rowSelection={{
                type: 'radio',
                selectedRowKeys: selected ? [selected] : [],
                onChange: (keys) => setSelected(String(keys[0])),
                getCheckboxProps: (row) => ({ disabled: !row.canCreate }),
              }}
              columns={[
                {
                  title: t('需求'),
                  render: (_: unknown, row: Choice) => `${row.code} ${row.title}`,
                },
                {
                  title: t('状态'),
                  render: (_: unknown, row: Choice) =>
                    row.hasDocument
                      ? t('已有文档')
                      : row.canCreate
                        ? t('可关联')
                        : t('当前不可编辑'),
                },
              ]}
            />
            <Pagination
              current={choicePage}
              pageSize={10}
              total={choices.data?.total ?? 0}
              showSizeChanger={false}
              onChange={(value) => {
                setChoicePage(value);
                setSelected(undefined);
              }}
            />
          </div>
        )}
      </Modal>
    </section>
  );
}
