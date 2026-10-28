import { z } from 'zod';

const configSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_HOST: z.string().default('127.0.0.1'),
  API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  APP_ORIGIN: z.union([z.literal('*'), z.url().transform((value) => new URL(value).origin)]),
  DATABASE_URL: z.string().startsWith('postgresql://'),
  SESSION_COOKIE: z
    .string()
    .regex(/^[a-zA-Z0-9_-]+$/)
    .default('myteam_session'),
  SESSION_TTL_HOURS: z.coerce.number().int().min(1).max(24).default(8),
  COOKIE_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  S3_ENDPOINT: z.url().refine((value) => {
    const url = new URL(value);
    return (
      ['http:', 'https:'].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      url.pathname === '/'
    );
  }),
  S3_REGION: z.string().min(1).default('us-east-1'),
  S3_BUCKET: z
    .string()
    .min(3)
    .max(63)
    .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
  S3_ACCESS_KEY_ID: z.string().min(1),
  S3_SECRET_ACCESS_KEY: z.string().min(12),
  S3_FORCE_PATH_STYLE: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  S3_PREFIX: z
    .string()
    .min(1)
    .max(32)
    .regex(/^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9_-]+)*\/$/)
    .default('attachments/'),
});

export type AppConfig = z.infer<typeof configSchema>;
export function readConfig(): AppConfig {
  const result = configSchema.safeParse(process.env);
  if (!result.success)
    throw new Error(
      `配置无效：${result.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  if (
    result.data.NODE_ENV === 'production' &&
    (!result.data.COOKIE_SECURE ||
      (result.data.APP_ORIGIN !== '*' && !result.data.APP_ORIGIN.startsWith('https://')))
  ) {
    throw new Error('生产环境必须使用 HTTPS 和 Secure Cookie');
  }
  return result.data;
}
export const APP_CONFIG = Symbol('APP_CONFIG');
