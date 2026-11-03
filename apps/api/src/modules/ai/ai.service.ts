import { Injectable } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import { Database } from '../../infrastructure/database.js';
import { ApiException } from '../../common/http.js';
import { IdentityService } from '../identity/identity.service.js';

export const providerSchema = z.enum(['bailian', 'openai', 'deepseek']);
type Provider = z.infer<typeof providerSchema>;
const defaults: Record<Provider, { name: string; baseUrl: string; model: string }> = {
  bailian: {
    name: '阿里百炼',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    model: 'qwen3.8-flash',
  },
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4.1-mini' },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
};
const inputSchema = z.object({
  baseUrl: z.string().trim().max(500),
  model: z.string().trim().min(1).max(200),
  apiKey: z.string().trim().max(4096).optional(),
  enabled: z.boolean(),
  version: z.number().int().nonnegative(),
});
function checkUrl(provider: Provider, input: string) {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new ApiException(400, 'VALIDATION_ERROR', 'AI 服务地址无效');
  }
  const host = url.hostname.toLowerCase();
  const allowed =
    provider === 'openai'
      ? host === 'api.openai.com'
      : provider === 'deepseek'
        ? host === 'api.deepseek.com'
        : host === 'dashscope.aliyuncs.com' ||
          /^[a-z0-9-]+\.(cn-beijing|cn-shanghai|ap-southeast-1)\.maas\.aliyuncs\.com$/.test(host);
  if (
    url.protocol !== 'https:' ||
    !allowed ||
    url.username ||
    url.password ||
    url.port ||
    url.search ||
    url.hash ||
    url.pathname.includes('..')
  )
    throw new ApiException(400, 'VALIDATION_ERROR', 'AI 服务地址不属于所选平台');
  return url.toString().replace(/\/$/, '');
}
function encryptionKey() {
  const value = process.env.AI_CONFIG_ENCRYPTION_KEY || '';
  if (!/^[0-9a-f]{64}$/i.test(value))
    throw new ApiException(503, 'INTERNAL_ERROR', '请配置 AI 密钥加密密钥');
  return Buffer.from(value, 'hex');
}
function encrypt(value: string) {
  const iv = randomBytes(12),
    cipher = createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return [
    'v1',
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    ciphertext.toString('base64'),
  ].join(':');
}
function decrypt(value: string) {
  try {
    const [version, iv, tag, ciphertext] = value.split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error();
    const cipher = createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64'));
    cipher.setAuthTag(Buffer.from(tag, 'base64'));
    return Buffer.concat([
      cipher.update(Buffer.from(ciphertext, 'base64')),
      cipher.final(),
    ]).toString('utf8');
  } catch {
    throw new ApiException(503, 'INTERNAL_ERROR', '无法解密 AI 平台密钥，请检查加密配置');
  }
}
@Injectable()
export class AiService {
  constructor(
    private readonly db: Database,
    private readonly identity: IdentityService,
  ) {}
  private async admin(req: Request, write = false) {
    const actor = write
      ? await this.identity.requireWrite(req)
      : await this.identity.requireSession(req);
    if (!actor.user.isSystemAdmin)
      throw new ApiException(403, 'FORBIDDEN', '仅系统管理员可以管理 AI 平台');
    return actor;
  }
  async listAdmin(req: Request) {
    await this.admin(req);
    const rows = await this.db.aiProviderConfig.findMany();
    return Object.entries(defaults).map(([id, def]) => {
      const row = rows.find((r) => r.provider === id);
      return {
        id,
        name: def.name,
        baseUrl: row?.baseUrl ?? def.baseUrl,
        model: row?.model ?? def.model,
        enabled: row?.enabled ?? false,
        hasKey: !!row?.secret,
        version: row?.version ?? 0,
      };
    });
  }
  async listAvailable() {
    const rows = await this.db.aiProviderConfig.findMany({
      where: { enabled: true },
      select: { provider: true, model: true },
    });
    const result = rows
      .filter((r) => providerSchema.safeParse(r.provider).success)
      .map((r) => ({
        id: r.provider,
        name: defaults[r.provider as Provider].name,
        model: r.model,
      }));
    return result;
  }
  async save(provider: Provider, raw: unknown, req: Request) {
    const actor = await this.admin(req, true);
    const data = inputSchema.parse(raw),
      baseUrl = checkUrl(provider, data.baseUrl);
    return this.db.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`ai-provider:${provider}`}, 0))`;
      const existing = await tx.aiProviderConfig.findUnique({ where: { provider } });
      if ((existing?.version ?? 0) !== data.version)
        throw new ApiException(409, 'CONFLICT', 'AI 平台配置已变更，请刷新后重试');
      if (!data.apiKey && !existing)
        throw new ApiException(400, 'VALIDATION_ERROR', '请填写 API Key');
      const secret = data.apiKey ? encrypt(data.apiKey) : existing!.secret;
      await tx.aiProviderConfig.upsert({
        where: { provider },
        create: { provider, baseUrl, model: data.model, secret, enabled: data.enabled },
        update: {
          baseUrl,
          model: data.model,
          secret,
          enabled: data.enabled,
          version: { increment: 1 },
        },
      });
      await tx.activityLog.create({
        data: {
          actorId: actor.userId,
          targetId: actor.userId,
          action: 'aiProvider.updated',
          requestId: req.requestId,
          details: { provider, enabled: data.enabled, keyChanged: !!data.apiKey },
        },
      });
      return { ok: true };
    });
  }
  async resolve(id: string) {
    if (providerSchema.safeParse(id).success) {
      const row = await this.db.aiProviderConfig.findUnique({ where: { provider: id } });
      if (row?.enabled)
        return {
          id,
          name: defaults[id as Provider].name,
          baseUrl: checkUrl(id as Provider, row.baseUrl),
          model: row.model,
          apiKey: decrypt(row.secret),
          disableThinking: id === 'bailian',
        };
    }
    throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', 'AI 平台不可用，请重新选择');
  }
}
