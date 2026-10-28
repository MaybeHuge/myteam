import {
  testCaseListSchema,
  testCaseDetailSchema,
  testCasePeopleSchema,
  testCaseRequirementOptionsSchema,
} from '@myteam/contracts';
import { request } from '../../api/client';
export const loadTestCases = async (projectId: string, query: string, signal?: AbortSignal) =>
  testCaseListSchema.parse(await request(`/projects/${projectId}/test-cases?${query}`, { signal }));
export const loadTestCase = async (
  projectId: string,
  id: string,
  page: number,
  revisionPage: number,
  signal?: AbortSignal,
) =>
  testCaseDetailSchema.parse(
    await request(
      `/projects/${projectId}/test-cases/${id}?page=${page}&revisionPage=${revisionPage}&pageSize=10`,
      { signal },
    ),
  );
export const loadCasePeople = async (
  projectId: string,
  purpose: string,
  q: string,
  page: number,
  signal?: AbortSignal,
) =>
  testCasePeopleSchema.parse(
    await request(
      `/projects/${projectId}/test-cases/people?${new URLSearchParams({ purpose, q, page: String(page), pageSize: '20' })}`,
      { signal },
    ),
  );
export const loadCaseRequirements = async (
  projectId: string,
  q: string,
  page: number,
  signal?: AbortSignal,
) =>
  testCaseRequirementOptionsSchema.parse(
    await request(
      `/projects/${projectId}/test-cases/requirements?${new URLSearchParams({ q, page: String(page), pageSize: '20' })}`,
      { signal },
    ),
  );
