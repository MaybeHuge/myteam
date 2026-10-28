import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiError, replaceSession } from '../api/client';
export function createQueryClient() {
  const expire = (error: unknown) => {
    if (error instanceof ApiError && error.status === 401) void replaceSession(client, null);
  };
  const client = new QueryClient({
    queryCache: new QueryCache({ onError: expire }),
    mutationCache: new MutationCache({ onError: expire }),
    defaultOptions: {
      queries: {
        staleTime: 30000,
        retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 1,
        refetchOnWindowFocus: true,
      },
      mutations: { retry: false, gcTime: 0 },
    },
  });
  return client;
}
export const queryClient = createQueryClient();
