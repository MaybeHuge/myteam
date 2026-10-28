import { describe, expect, it, vi } from 'vitest';
import { ApiError, sessionKey } from '../api/client';
import { createQueryClient } from './query';
describe('会话缓存隔离', () => {
  it('查询返回 401 立即清理旧数据并撤销客户端会话', async () => {
    const client = createQueryClient();
    client.setQueryData(sessionKey, { user: { id: 'old-user' } });
    client.setQueryData(['projects', 'old-user'], { private: true });
    try {
      await expect(
        client.fetchQuery({
          queryKey: ['workbench', 'old-user'],
          queryFn: async () => {
            throw new ApiError(401, 'UNAUTHENTICATED', '登录失效');
          },
        }),
      ).rejects.toThrow();
      await vi.waitFor(() => {
        expect(client.getQueryData(sessionKey)).toBeNull();
        expect(client.getQueryData(['projects', 'old-user'])).toBeUndefined();
      });
    } finally {
      client.clear();
    }
  });
  it('写入返回 401 同样退出，项目 403 则保留有效账号会话', async () => {
    const client = createQueryClient();
    client.setQueryData(sessionKey, { user: { id: 'user' } });
    try {
      await expect(
        client.fetchQuery({
          queryKey: ['denied'],
          queryFn: async () => {
            throw new ApiError(403, 'FORBIDDEN', '没有权限');
          },
        }),
      ).rejects.toThrow();
      expect(client.getQueryData(sessionKey)).toEqual({ user: { id: 'user' } });
      const mutation = client.getMutationCache().build(client, {
        mutationFn: async () => {
          throw new ApiError(401, 'UNAUTHENTICATED', '登录失效');
        },
      });
      await expect(mutation.execute(undefined)).rejects.toThrow();
      await vi.waitFor(() => expect(client.getQueryData(sessionKey)).toBeNull());
    } finally {
      client.clear();
    }
  });
});
