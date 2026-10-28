import {
  requirementListSchema,
  requirementDetailSchema,
  requirementPeopleSchema,
} from '@myteam/contracts';
import { request } from '../../api/client';
export const loadRequirements = async (projectId: string, query: string, signal?: AbortSignal) =>
  requirementListSchema.parse(
    await request(`/projects/${projectId}/requirements?${query}`, { signal }),
  );
export const loadRequirement = async (
  projectId: string,
  id: string,
  page: number,
  signal?: AbortSignal,
  taskPage = 1,
  casePage = 1,
) =>
  requirementDetailSchema.parse(
    await request(
      `/projects/${projectId}/requirements/${id}?page=${page}&pageSize=20&taskPage=${taskPage}&casePage=${casePage}`,
      { signal },
    ),
  );
export const loadPeople = async (
  projectId: string,
  purpose: string,
  q: string,
  page: number,
  signal?: AbortSignal,
) =>
  requirementPeopleSchema.parse(
    await request(
      `/projects/${projectId}/requirements/people?${new URLSearchParams({ purpose, q, page: String(page), pageSize: '20' })}`,
      { signal },
    ),
  );
