import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Select, Space } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { projectKey } from '../projects/api';
import { loadRequirements } from '../requirements/api';
import { loadCasePeople, loadCaseRequirements } from './api';
type Option = { id: string; name: string };
export function CasePicker({
  projectId,
  session,
  purpose,
  value,
  onChange,
  initial = [],
  ...props
}: {
  projectId: string;
  session: SessionResponse;
  purpose: 'owner' | 'reviewer' | 'requirements' | 'filterRequirement';
  value?: string | string[] | null;
  onChange?: (value: string | string[] | null) => void;
  initial?: Option[];
  id?: string;
  'aria-label'?: string;
}) {
  const [search, setSearch] = useState(''),
    [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Option[]>(initial);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const options = useInfiniteQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'case-picker', purpose, query],
    initialPageParam: 1,
    queryFn: async ({ pageParam, signal }) => {
      if (purpose === 'filterRequirement') {
        const result = await loadRequirements(
          projectId,
          new URLSearchParams({ q: query, page: String(pageParam), pageSize: '20' }).toString(),
          signal,
        );
        return {
          ...result,
          items: result.items.map((r) => ({ id: r.id, name: `${r.code} · ${r.title}` })),
        };
      }
      if (purpose !== 'requirements')
        return loadCasePeople(projectId, purpose, query, pageParam, signal);
      const result = await loadCaseRequirements(projectId, query, pageParam, signal);
      return {
        ...result,
        items: result.items.map((r) => ({ id: r.id, name: `${r.code} · ${r.title}` })),
      };
    },
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const items = [
    ...new Map(
      [...selected, ...(options.data?.pages.flatMap((page) => page.items) ?? [])].map((item) => [
        item.id,
        item,
      ]),
    ).values(),
  ];
  return (
    <Select
      {...props}
      style={{ width: '100%', minWidth: 160 }}
      allowClear
      showSearch
      filterOption={false}
      mode={purpose === 'requirements' ? 'multiple' : undefined}
      value={value ?? undefined}
      placeholder={
        purpose === 'requirements'
          ? '搜索已确认需求，可多选'
          : purpose === 'filterRequirement'
            ? '全部关联需求'
            : '搜索具有用例权限的成员'
      }
      onChange={(id) => {
        onChange?.(id ?? null);
        setSelected(
          items.filter((item) => (Array.isArray(id) ? id.includes(item.id) : item.id === id)),
        );
      }}
      onSearch={(text) => setSearch(text.slice(0, 100))}
      loading={options.isFetching}
      options={items.map((item) => ({ value: item.id, label: item.name }))}
      notFoundContent={
        options.isError
          ? '加载失败，请重试'
          : options.isFetching
            ? '正在加载…'
            : '没有符合条件的选项'
      }
      popupRender={(menu) => (
        <>
          {menu}
          <Space style={{ padding: 8 }}>
            {options.isError && (
              <Button size="small" onClick={() => void options.refetch()}>
                重新加载选项
              </Button>
            )}
            {options.hasNextPage && (
              <Button
                size="small"
                loading={options.isFetchingNextPage}
                onClick={() => void options.fetchNextPage()}
              >
                加载更多选项
              </Button>
            )}
          </Space>
        </>
      )}
    />
  );
}
