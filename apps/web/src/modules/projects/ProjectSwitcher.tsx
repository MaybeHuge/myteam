import { t, useLocale } from '../../i18n';
import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { useLocation, useMatch, useNavigate } from 'react-router';
import { Button, Empty, Select, Spin } from 'antd';
import type { SessionResponse } from '@myteam/contracts';
import { loadProject, loadProjects, projectKey } from './api';
import { ProjectIcon } from './presentation';
export function ProjectSwitcher({ session }: { session: SessionResponse }) {
  useLocale();
  const navigate = useNavigate();
  const location = useLocation();
  const id = useMatch('/projects/:projectId')?.params.projectId ?? '';
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 250);
    return () => clearTimeout(timer);
  }, [search]);
  const current = useQuery({
    queryKey: projectKey(session.user.id, id),
    queryFn: ({ signal }) => loadProject(id, signal),
    enabled: !!id,
  });
  const projects = useInfiniteQuery({
    queryKey: ['projects', session.user.id, 'switcher', query],
    enabled: open,
    staleTime: 0,
    initialPageParam: 1,
    queryFn: ({ pageParam, signal }) =>
      loadProjects(
        new URLSearchParams({ q: query, page: String(pageParam), pageSize: '20' }).toString(),
        signal,
      ),
    getNextPageParam: (last) =>
      last.page * last.pageSize < last.total ? last.page + 1 : undefined,
  });
  const searching =
    search.trim() !== query ||
    projects.isPending ||
    (projects.isFetching && !projects.isFetchingNextPage);
  const items =
    searching || projects.isError
      ? []
      : [
          ...new Map(
            projects.data?.pages
              .flatMap((page) => page.items)
              .map((project) => [project.id, project]),
          ).values(),
        ];
  return (
    <Select
      className="project-switcher"
      aria-label={t('切换项目')}
      placeholder={t('选择项目空间')}
      showSearch
      filterOption={false}
      labelInValue
      open={open}
      searchValue={search}
      value={
        id
          ? {
              value: id,
              label: current.isError
                ? t('项目不可访问')
                : (items.find((project) => project.id === id)?.name ??
                  current.data?.name ??
                  t('正在加载项目…')),
            }
          : undefined
      }
      onSearch={(text) => setSearch(text.slice(0, 100))}
      onOpenChange={(value) => {
        setOpen(value);
        if (!value) {
          setSearch('');
          setQuery('');
        }
      }}
      onChange={(value: { value: string; label?: string }) => {
        const tab = new URLSearchParams(location.search).get('tab');
        const query =
          tab &&
          [
            'iterations',
            'requirements',
            'tasks',
            'test-cases',
            'releases',
            'records',
            'defects',
            'members',
            'collaboration',
          ].includes(tab)
            ? `?tab=${tab}`
            : '';
        setOpen(false);
        setSearch('');
        setQuery('');
        navigate(`/projects/${value.value}${query}`);
      }}
      loading={open && searching}
      options={items.map((project) => ({ value: project.id, label: project.name, project }))}
      optionRender={(option) => (
        <div className="project-switcher-option">
          <ProjectIcon project={option.data.project} size="small" />
          <div>
            <strong>{option.data.project.name}</strong>
            <small>{option.data.project.key}</small>
          </div>
        </div>
      )}
      popupMatchSelectWidth={false}
      classNames={{ popup: { root: 'project-switcher-popup' } }}
      notFoundContent={
        searching ? (
          <div className="project-switcher-empty">
            <Spin size="small" />
          </div>
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              projects.isError
                ? t('项目加载失败，请重试')
                : query
                  ? t('没有匹配的项目')
                  : t('暂无可访问项目')
            }
          />
        )
      }
      onPopupScroll={(event) => {
        const element = event.currentTarget;
        if (
          element.scrollHeight - element.scrollTop - element.clientHeight < 40 &&
          projects.hasNextPage &&
          !projects.isFetching &&
          !projects.isError
        )
          void projects.fetchNextPage();
      }}
      popupRender={(menu) => (
        <>
          {menu}
          <div className="project-switcher-footer">
            {projects.isError ? (
              <Button
                size="small"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => void projects.refetch()}
              >
                {t('重试加载项目')}
              </Button>
            ) : (
              <>
                <span>
                  {searching
                    ? t('正在加载项目…')
                    : t('共 {{0}} 个项目', { '0': projects.data?.pages[0]?.total ?? 0 })}
                </span>
                {projects.hasNextPage && (
                  <Button
                    size="small"
                    type="link"
                    loading={projects.isFetchingNextPage}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => void projects.fetchNextPage()}
                  >
                    {t('加载更多项目')}
                  </Button>
                )}
              </>
            )}
          </div>
        </>
      )}
    />
  );
}
