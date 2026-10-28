import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Select } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { projectKey } from '../projects/api';
import { loadTaskOptions } from './api';
export function TaskPicker({
  projectId,
  session,
  purpose,
  value,
  onChange,
  initial,
  onPicked,
  ...props
}: {
  projectId: string;
  session: SessionResponse;
  purpose: 'people' | 'requirements' | 'helpers';
  value?: string | null;
  onChange?: (id: string | null) => void;
  initial?: { id: string; label: string } | null;
  onPicked?: (iteration: { id: string; name: string } | null) => void;
  id?: string;
  'aria-label'?: string;
}) {
  const [search, setSearch] = useState(''),
    [q, setQ] = useState(''),
    [picked, setPicked] = useState(initial);
  useEffect(() => {
    const timer = setTimeout(() => setQ(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const query = useInfiniteQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'task-picker', purpose, q],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => loadTaskOptions(projectId, purpose, q, pageParam, signal),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const items = [
    ...new Map(
      query.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
    ).values(),
  ];
  const options = items.map((item) => ({ value: item.id, label: item.label }));
  if (picked && !options.some((item) => item.value === picked.id))
    options.unshift({ value: picked.id, label: picked.label });
  return (
    <Select
      {...props}
      showSearch
      allowClear
      filterOption={false}
      style={{ width: '100%' }}
      value={value ?? undefined}
      placeholder={
        purpose === 'people'
          ? '搜索可分配成员'
          : purpose === 'helpers'
            ? '搜索可协助成员'
            : '搜索关联需求'
      }
      loading={query.isFetching}
      onChange={(id) => onChange?.(id ?? null)}
      onSearch={(text) => setSearch(text.slice(0, 100))}
      options={options}
      onSelect={(id) => {
        const item = items.find((row) => row.id === id);
        if (item) {
          setPicked(item);
          onPicked?.(item.iteration);
        }
      }}
      notFoundContent={
        query.isFetching ? '正在加载…' : query.isError ? '加载失败，请重试' : '没有符合条件的选项'
      }
      popupRender={(menu) => (
        <>
          {menu}
          {query.isError && (
            <Button size="small" onClick={() => void query.refetch()}>
              重试加载选项
            </Button>
          )}
          {query.hasNextPage && (
            <Button
              size="small"
              loading={query.isFetchingNextPage}
              onClick={() => void query.fetchNextPage()}
            >
              加载更多选项
            </Button>
          )}
        </>
      )}
    />
  );
}
