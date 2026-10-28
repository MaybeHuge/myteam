import { iterationDetailSchema, iterationListSchema } from '@myteam/contracts';
import { request } from '../../api/client';
export const loadIterations = async (projectId: string, query: string, signal?: AbortSignal) =>
  iterationListSchema.parse(
    await request(`/projects/${projectId}/iterations?${query}`, { signal }),
  );
export const loadIteration = async (
  projectId: string,
  id: string,
  page: number,
  signal?: AbortSignal,
) =>
  iterationDetailSchema.parse(
    await request(`/projects/${projectId}/iterations/${id}?page=${page}&pageSize=20`, { signal }),
  );
