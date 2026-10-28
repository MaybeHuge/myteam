export function projectHref(id: string, location?: { pathname: string; search: string }) {
  return `/projects/${id}${location?.pathname === '/projects' && location.search ? `?list=${encodeURIComponent(location.search)}` : ''}`;
}
export function projectListReturn(params: URLSearchParams) {
  const list = params.get('list');
  return `/projects${list?.startsWith('?') && list.length <= 2000 ? list : ''}`;
}
