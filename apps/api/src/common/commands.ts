import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import type { Prisma } from '../generated/prisma/client.js';
import { Database } from '../infrastructure/database.js';
import { ApiException, digest } from './http.js';

@Injectable()
export class Commands {
  constructor(private readonly db: Database) {}
  async run(
    actorId: string,
    key: unknown,
    input: unknown,
    apply: (tx: Prisma.TransactionClient) => Promise<Prisma.InputJsonValue>,
    authorize?: (tx: Prisma.TransactionClient) => Promise<void>,
  ) {
    const commandKey = z.uuid().parse(key);
    const requestHash = digest(JSON.stringify(input));
    return this.db.$transaction(async (tx) => {
      // 相同操作者和幂等键串行执行；结果与业务写入在同一事务内提交。
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${actorId}:${commandKey}`}, 0))`;
      // 重放旧结果前也执行当前授权，角色收回后不能借旧幂等键访问。
      await authorize?.(tx);
      const existing = await tx.idempotencyRecord.findUnique({
        where: { actorId_key: { actorId, key: commandKey } },
      });
      if (existing && existing.expiresAt > new Date()) {
        if (existing.requestHash !== requestHash)
          throw new ApiException(409, 'CONFLICT', '该请求编号已用于不同操作，请刷新后重试');
        return existing.result;
      }
      if (existing) await tx.idempotencyRecord.delete({ where: { id: existing.id } });
      const result = await apply(tx);
      await tx.idempotencyRecord.create({
        data: {
          actorId,
          key: commandKey,
          requestHash,
          result,
          expiresAt: new Date(Date.now() + 24 * 3600000),
        },
      });
      return result;
    });
  }
}
