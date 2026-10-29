import { t, useLocale } from '../../i18n';
import { useEffect, useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, Select, Space } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { loadPeople } from './api';
import { loadIterations } from '../iterations/api';
import { loadMembers, projectKey } from '../projects/api';

export function RequirementPicker({
  projectId,
  session,
  purpose,
  value,
  onChange,
  initial,
  disabled,
  ...props
}: {
  projectId: string;
  session: SessionResponse;
  purpose: 'owner' | 'reviewer' | 'iteration' | 'filterIteration' | 'filterOwner';
  value?: string | null;
  onChange?: (value: string | null) => void;
  initial?: { id: string; name: string } | null;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  useLocale();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState(initial);
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const options = useInfiniteQuery({
    queryKey: [...projectKey(session.user.id, projectId), 'requirement-picker', purpose, query],
    initialPageParam: 1,
    enabled: !disabled,
    queryFn: async ({ pageParam, signal }) => {
      if (purpose === 'iteration' || purpose === 'filterIteration') {
        const result = await loadIterations(
          projectId,
          new URLSearchParams({ q: query, page: String(pageParam), pageSize: '20' }).toString(),
          signal,
        );
        return {
          ...result,
          items: result.items
            .filter((item) => purpose === 'filterIteration' || item.status !== 'CLOSED')
            .map((item) => ({ id: item.id, name: item.name })),
        };
      }
      if (purpose === 'filterOwner') {
        const result = await loadMembers(projectId, pageParam, 20, signal, query);
        return {
          ...result,
          items: result.items.map((item) => ({ id: item.user.id, name: item.user.name })),
        };
      }
      return loadPeople(projectId, purpose, query, pageParam, signal);
    },
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const items = [
    ...new Map(
      options.data?.pages.flatMap((page) => page.items).map((item) => [item.id, item]),
    ).values(),
  ];
  if (selected && !items.some((item) => item.id === selected.id)) items.unshift(selected);
  return (
    <Select
      {...props}
      style={{ minWidth: 160, width: '100%' }}
      disabled={disabled}
      allowClear
      showSearch
      filterOption={false}
      placeholder={
        purpose === 'iteration'
          ? t('暂不安排迭代')
          : purpose === 'filterIteration'
            ? t('全部迭代')
            : purpose === 'filterOwner'
              ? t('全部负责人')
              : t('搜索项目成员')
      }
      value={value ?? undefined}
      onChange={(id) => onChange?.(id ?? null)}
      onSelect={(id) => setSelected(items.find((item) => item.id === id))}
      onSearch={(text) => setSearch(text.slice(0, 100))}
      loading={options.isFetching}
      options={items.map((item) => ({ value: item.id, label: item.name }))}
      notFoundContent={
        options.isError
          ? t('加载失败，请重试')
          : options.isFetching
            ? t('正在加载…')
            : t('没有符合条件的选项')
      }
      popupRender={(menu) => (
        <>
          {menu}
          <Space style={{ padding: 8 }}>
            {options.isError && (
              <Button size="small" onClick={() => void options.refetch()}>
                {t('重新加载选项')}
              </Button>
            )}
            {options.hasNextPage && (
              <Button
                size="small"
                loading={options.isFetchingNextPage}
                onClick={() => void options.fetchNextPage()}
              >
                {t('加载更多选项')}
              </Button>
            )}
          </Space>
        </>
      )}
    />
  );
}
