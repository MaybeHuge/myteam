import { t, useLocale } from '../../i18n';
import { useEffect, useState, type AriaAttributes } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Alert, Button, Empty, Select, Spin } from 'antd';
import type { ProjectMemberOption } from '@myteam/contracts';
import { errorMessage } from '../../api/client';
import { loadMemberOptions, projectKey } from './api';
import { PersonAvatar } from './presentation';
import styles from './projects.module.css';

export function MemberSelect({
  projectId,
  userId,
  value,
  onChange,
  id,
  ...aria
}: {
  projectId: string;
  userId: string;
  value?: string;
  onChange?: (email?: string) => void;
  id?: string;
} & Pick<AriaAttributes, 'aria-describedby' | 'aria-invalid' | 'aria-required'>) {
  useLocale();
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<ProjectMemberOption>();
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const candidates = useInfiniteQuery({
    staleTime: 0,
    gcTime: 0,
    queryKey: [...projectKey(userId, projectId), 'member-options', query],
    queryFn: ({ pageParam, signal }) => loadMemberOptions(projectId, query, pageParam, signal),
    initialPageParam: 1,
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const searching = search.trim() !== query || candidates.isPending;
  const people =
    searching || candidates.isError
      ? []
      : [
          ...new Map(
            candidates.data?.pages
              .flatMap((page) => page.items)
              .map((person) => [person.id, person]),
          ).values(),
        ];
  const selectedLabel =
    selected && selected.email === value ? `${selected.name} · ${selected.email}` : value;
  return (
    <div>
      <Select
        {...aria}
        id={id}
        aria-label={t('选择成员')}
        autoFocus
        size="large"
        style={{ width: '100%' }}
        placeholder={t('选择账号，或搜索姓名 / 邮箱')}
        showSearch
        filterOption={false}
        labelInValue
        allowClear
        value={value ? { value, label: selectedLabel } : undefined}
        searchValue={search}
        onSearch={(text) => setSearch(text.slice(0, 100))}
        onChange={(item: { value: string; label?: string } | undefined) => {
          setSelected(people.find((person) => person.email === item?.value));
          onChange?.(item?.value);
          setSearch('');
        }}
        loading={searching || candidates.isFetching}
        options={people.map((person) => ({
          value: person.email,
          label: `${person.name} · ${person.email}`,
          person,
        }))}
        optionRender={(option) => (
          <div className={`${styles.memberIdentity} ${styles.memberOption}`}>
            <PersonAvatar name={option.data.person.name} size={32} />
            <span>
              <strong>{option.data.person.name}</strong>
              <small>{option.data.person.email}</small>
            </span>
          </div>
        )}
        notFoundContent={
          searching ? (
            <div className={styles.memberSelectLoading}>
              <Spin size="small" />
            </div>
          ) : (
            <Empty
              image={Empty.PRESENTED_IMAGE_SIMPLE}
              description={
                candidates.isError
                  ? t('候选成员加载失败，请重试')
                  : query
                    ? t('没有匹配的可添加账号')
                    : t('暂无可添加账号')
              }
            />
          )
        }
        onPopupScroll={(event) => {
          const target = event.currentTarget;
          if (
            target.scrollHeight - target.scrollTop - target.clientHeight < 40 &&
            candidates.hasNextPage &&
            !candidates.isFetching &&
            !searching &&
            !candidates.isError
          )
            void candidates.fetchNextPage();
        }}
        popupRender={(menu) => (
          <>
            {menu}
            {!searching && !candidates.isError && (
              <div className={styles.memberSelectFooter}>
                <span>
                  {t('共 ')}
                  {candidates.data?.pages[0]?.total ?? 0} {t(' 位可添加成员')}
                </span>
                {candidates.hasNextPage && (
                  <Button
                    size="small"
                    type="link"
                    loading={candidates.isFetchingNextPage}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void candidates.fetchNextPage()}
                  >
                    {t('加载更多')}
                  </Button>
                )}
              </div>
            )}
          </>
        )}
      />
      {candidates.isError && (
        <Alert
          className={styles.inlineAlert}
          type="error"
          showIcon
          title={errorMessage(candidates.error)}
          action={
            <Button size="small" onClick={() => void candidates.refetch()}>
              {t('重试')}
            </Button>
          }
        />
      )}
    </div>
  );
}
