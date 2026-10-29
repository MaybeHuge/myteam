import { t, useLocale } from '../../i18n';
import { useState } from 'react';
import { useInfiniteQuery, useQueries } from '@tanstack/react-query';
import { Button, Select, Spin } from 'antd';
import {
  qualityOptionsSchema,
  type qualityOptionSchema,
  type SessionResponse,
} from '@myteam/contracts';
import type { z } from 'zod';
import { request } from '../../api/client';
import { projectKey } from '../projects/api';
type Option = z.infer<typeof qualityOptionSchema>;
export function QualityPicker({
  projectId,
  session,
  kind,
  purpose,
  releaseId,
  runId,
  buildId,
  requirementId,
  testCaseId,
  status,
  value,
  onChange,
  onOptions,
  multiple = false,
  disabled = false,
  validateBuildScope = false,
  ...props
}: {
  projectId: string;
  session: SessionResponse;
  kind?: string;
  purpose?: string;
  releaseId?: string;
  runId?: string;
  buildId?: string;
  requirementId?: string;
  testCaseId?: string;
  status?: string;
  value?: string | string[] | null;
  onChange?: (v: string | string[] | null) => void;
  onOptions?: (options: Option[]) => void;
  multiple?: boolean;
  disabled?: boolean;
  validateBuildScope?: boolean;
  'aria-label'?: string;
}) {
  const locale = useLocale();
  const [search, setSearch] = useState('');
  const [cache, setCache] = useState<Option[]>([]);
  const query = (page: number, q = search, id?: string) =>
    new URLSearchParams({
      page: String(page),
      pageSize: '20',
      q,
      ...(kind ? { kind } : {}),
      ...(purpose ? { purpose } : {}),
      ...(releaseId ? { releaseId } : {}),
      ...(runId ? { runId } : {}),
      ...(buildId ? { buildId } : {}),
      ...(requirementId ? { requirementId } : {}),
      ...(testCaseId ? { testCaseId } : {}),
      ...(status ? { status } : {}),
      ...(id ? { id } : {}),
    }).toString();
  const key = [
    ...projectKey(session.user.id, projectId),
    'quality-options',
    locale,
    kind,
    purpose,
    releaseId,
    runId,
    buildId,
    requirementId,
    testCaseId,
    status,
  ];
  const load = async (page: number, signal: AbortSignal, q?: string, id?: string) =>
    qualityOptionsSchema.parse(
      await request(
        `/projects/${projectId}/quality/${purpose ? 'people' : 'options'}?${query(page, q, id)}`,
        { signal },
      ),
    );
  const results = useInfiniteQuery({
    queryKey: [...key, search],
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) => load(pageParam, signal),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
    enabled: !disabled,
  });
  const selectedIds = Array.isArray(value)
    ? value
    : typeof value === 'string' && value
      ? [value]
      : [];
  const selected = useQueries({
    queries: selectedIds.map((id) => ({
      queryKey: [...key, 'selected', id],
      queryFn: ({ signal }: { signal: AbortSignal }) => load(1, signal, '', id),
      enabled: !!id,
    })),
  });
  const options = [
    ...new Map(
      [
        ...cache.filter((o) => selectedIds.includes(o.id)),
        ...selected.flatMap((q) => q.data?.items ?? []),
        ...(results.data?.pages.flatMap((p) => p.items) ?? []),
      ].map((o) => [o.id, o]),
    ).values(),
  ];
  return (
    <Select
      {...props}
      style={{ width: '100%' }}
      mode={multiple ? 'multiple' : undefined}
      showSearch={{ filterOption: false, onSearch: setSearch }}
      allowClear
      disabled={disabled}
      loading={results.isFetching}
      placeholder={t('请选择，可搜索并继续加载')}
      value={value ?? undefined}
      options={options.map((o) => {
        const invalidScope = validateBuildScope && o.scopeCurrent === false;
        const invalidRequirement = validateBuildScope && o.matchesRequirement === false;
        return {
          value: o.id,
          label: `${o.label}${invalidScope ? t('（范围已失效）') : invalidRequirement ? t('（不含当前需求）') : ''}`,
          disabled: invalidScope || invalidRequirement,
        };
      })}
      onChange={(next) => {
        const ids = Array.isArray(next) ? next : next ? [next] : [];
        const chosen = ids
          .map((id) => options.find((o) => o.id === id))
          .filter((o): o is Option => !!o);
        setCache(chosen);
        onChange?.(next ?? null);
        onOptions?.(chosen);
      }}
      onPopupScroll={(e) => {
        const t = e.currentTarget;
        if (
          t.scrollTop + t.clientHeight >= t.scrollHeight - 30 &&
          results.hasNextPage &&
          !results.isFetching
        )
          void results.fetchNextPage();
      }}
      notFoundContent={
        results.isFetching ? (
          <Spin size="small" />
        ) : results.isError ? (
          t('暂时无法加载，请重试')
        ) : (
          t('没有可选记录')
        )
      }
      popupRender={(menu) => (
        <>
          {menu}
          {results.isError ? (
            <Button type="link" onClick={() => void results.refetch()}>
              {t('重新加载选项')}
            </Button>
          ) : results.hasNextPage ? (
            <Button
              type="link"
              loading={results.isFetchingNextPage}
              onClick={() => void results.fetchNextPage()}
            >
              {t('加载更多')}
            </Button>
          ) : null}
        </>
      )}
    />
  );
}
