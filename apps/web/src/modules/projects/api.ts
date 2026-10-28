import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  projectActivitySchema,
  projectListSchema,
  projectMembersSchema,
  projectMemberOptionsSchema,
  projectSchema,
  type SessionResponse,
} from '@myteam/contracts';
import { ApiError, replaceSession, request } from '../../api/client';

export const recentProjectsKey = (userId: string) => ['projects', userId, 'recent'] as const;
export const projectKey = (userId: string, projectId: string) =>
  ['projects', userId, projectId] as const;
export const loadProjects = async (query = '', signal?: AbortSignal) =>
  projectListSchema.parse(await request(`/projects?${query}`, { signal }));
export const loadProject = async (id: string, signal?: AbortSignal) =>
  projectSchema.parse(await request(`/projects/${id}`, { signal }));
export const loadMembers = async (
  id: string,
  page = 1,
  pageSize = 20,
  signal?: AbortSignal,
  q = '',
) =>
  projectMembersSchema.parse(
    await request(
      `/projects/${id}/members?page=${page}&pageSize=${pageSize}&q=${encodeURIComponent(q)}`,
      { signal },
    ),
  );
export const loadActivity = async (id: string, signal?: AbortSignal) =>
  projectActivitySchema.parse(await request(`/projects/${id}/activity`, { signal }));
export const loadMemberOptions = async (
  id: string,
  q: string,
  page: number,
  signal?: AbortSignal,
) =>
  projectMemberOptionsSchema.parse(
    await request(
      `/projects/${id}/member-options?${new URLSearchParams({ q, page: String(page), pageSize: '20' })}`,
      { signal },
    ),
  );

export function useProjectCommand<T>(session: SessionResponse, onSuccess?: (result: T) => void) {
  const client = useQueryClient();
  const previous = useRef<{ body: string; key: string } | null>(null);
  const mutation = useMutation({
    gcTime: 0,
    mutationFn: ({ path, input }: { path: string; input: unknown }) => {
      const body = JSON.stringify({ path, input });
      if (previous.current?.body !== body) previous.current = { body, key: crypto.randomUUID() };
      return request<T>(path, {
        method: 'POST',
        headers: { 'X-CSRF-Token': session.csrfToken, 'Idempotency-Key': previous.current.key },
        body: JSON.stringify(input),
      });
    },
    onSuccess: async (result) => {
      await Promise.all([
        client.invalidateQueries({ queryKey: ['projects'] }),
        client.invalidateQueries({ queryKey: ['workbench'] }),
        client.invalidateQueries({ queryKey: ['notifications'] }),
      ]);
      onSuccess?.(result);
    },
    onError: (error) => {
      if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
      else if (error instanceof ApiError && [403, 409].includes(error.status))
        void client.invalidateQueries({ queryKey: ['projects'] });
    },
  });
  return {
    ...mutation,
    reset: () => {
      previous.current = null;
      mutation.reset();
    },
  };
}
