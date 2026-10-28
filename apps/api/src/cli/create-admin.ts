import { randomUUID } from 'node:crypto';
import * as argon2 from 'argon2';
import { z } from 'zod';
import { loginSchema, passwordSchema } from '@myteam/contracts';
import { createDatabase } from '../infrastructure/database.js';

const input = loginSchema
  .extend({ password: passwordSchema, name: z.string().trim().min(1).max(80) })
  .parse({
    email: process.env.ADMIN_EMAIL,
    password: process.env.ADMIN_PASSWORD,
    name: process.env.ADMIN_NAME,
  });
const url = z.string().startsWith('postgresql://').parse(process.env.DATABASE_URL);
const db = createDatabase(url);
try {
  if (await db.user.findUnique({ where: { email: input.email } }))
    throw new Error('该邮箱已存在；初始化命令不会覆盖密码或提升已有账号权限');
  const passwordHash = await argon2.hash(input.password, { type: argon2.argon2id });
  await db.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: { email: input.email, name: input.name, passwordHash, isSystemAdmin: true },
    });
    await tx.activityLog.create({
      data: {
        actorId: user.id,
        targetId: user.id,
        action: 'identity.admin.initialized',
        requestId: randomUUID(),
      },
    });
  });
  console.log('管理员已创建；初始化命令不会输出密码。');
} finally {
  await db.$disconnect();
}
