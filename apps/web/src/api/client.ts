import {
  errorResponseSchema,
  sessionResponseSchema,
  csrfResponseSchema,
  type SessionResponse,
} from '@myteam/contracts';
import type { QueryClient } from '@tanstack/react-query';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string,
  ) {
    super(message);
  }
}

export async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`/api/v1${path}`, {
      ...options,
      credentials: 'same-origin',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...options.headers,
      },
      signal: options.signal ?? AbortSignal.timeout(15000),
    });
  } catch {
    throw new ApiError(0, 'NETWORK_ERROR', '无法连接服务，请检查网络后重试');
  }
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const parsed = errorResponseSchema.safeParse(body);
    throw new ApiError(
      response.status,
      parsed.success ? parsed.data.code : 'HTTP_ERROR',
      parsed.success ? parsed.data.message : '服务暂时无法处理请求',
      parsed.success ? parsed.data.requestId : undefined,
    );
  }
  return body as T;
}

export const sessionKey = ['session'] as const;
export async function replaceSession(client: QueryClient, session: SessionResponse | null) {
  await client.cancelQueries();
  client.removeQueries({ predicate: (query) => query.queryKey[0] !== 'session' });
  client.setQueryData(sessionKey, session);
}
export async function getSession(signal?: AbortSignal): Promise<SessionResponse | null> {
  try {
    return sessionResponseSchema.parse(await request('/auth/me', { signal }));
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}
export async function login(email: string, password: string) {
  const { csrfToken } = csrfResponseSchema.parse(await request('/auth/csrf'));
  return sessionResponseSchema.parse(
    await request('/auth/login', {
      method: 'POST',
      headers: { 'X-CSRF-Token': csrfToken },
      body: JSON.stringify({ email, password }),
    }),
  );
}
export const errorMessage = (error: unknown) =>
  error instanceof Error ? error.message : '操作失败，请稍后重试';
