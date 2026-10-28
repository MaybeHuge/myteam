import {
  taskListSchema,
  taskBoardSchema,
  taskDetailSchema,
  taskPeopleSchema,
  taskRequirementOptionsSchema,
} from '@myteam/contracts';
import { request } from '../../api/client';
export const loadTasks = async (projectId: string, query: string, signal?: AbortSignal) =>
  taskListSchema.parse(await request(`/projects/${projectId}/tasks?${query}`, { signal }));
export const loadTask = async (projectId: string, id: string, page: number, signal?: AbortSignal) =>
  taskDetailSchema.parse(
    await request(`/projects/${projectId}/tasks/${id}?page=${page}&pageSize=20`, { signal }),
  );
export const loadTaskOptions = async (
  projectId: string,
  purpose: 'people' | 'requirements' | 'helpers',
  q: string,
  page: number,
  signal?: AbortSignal,
) => {
  const result = await request(
    `/projects/${projectId}/tasks/${purpose === 'helpers' ? 'people' : purpose}?${new URLSearchParams({ q, page: String(page), pageSize: '20', ...(purpose === 'helpers' ? { purpose: 'helper' } : {}) })}`,
    { signal },
  );
  if (purpose === 'people' || purpose === 'helpers') {
    const data = taskPeopleSchema.parse(result);
    return {
      ...data,
      items: data.items.map((person) => ({ id: person.id, label: person.name, iteration: null })),
    };
  }
  const data = taskRequirementOptionsSchema.parse(result);
  return {
    ...data,
    items: data.items.map((item) => ({
      id: item.id,
      label: `${item.code} · ${item.title}`,
      iteration: item.iteration,
    })),
  };
};

export const loadTaskBoard = async (projectId: string, query: string, signal?: AbortSignal) =>
  taskBoardSchema.parse(await request(`/projects/${projectId}/tasks/board?${query}`, { signal }));
