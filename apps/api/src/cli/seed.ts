import * as argon2 from 'argon2';
import { passwordSchema } from '@myteam/contracts';
import { createDatabase } from '../infrastructure/database.js';

if (process.env.NODE_ENV === 'production' || process.env.ALLOW_DEMO_SEED !== 'true')
  throw new Error('演示数据只允许在非生产环境显式设置 ALLOW_DEMO_SEED=true 后初始化');
const password = passwordSchema.parse(process.env.DEMO_PASSWORD);
const db = createDatabase(process.env.DATABASE_URL!);
try {
  const passwordHash = await argon2.hash(password, { type: argon2.argon2id });
  for (const [email, name] of [
    ['product@example.test', '产品体验账号'],
    ['developer@example.test', '开发体验账号'],
    ['tester@example.test', '测试体验账号'],
  ]) {
    if (!(await db.user.findUnique({ where: { email } })))
      await db.user.create({ data: { email: email!, name: name!, passwordHash } });
  }
  console.log('演示账号初始化完成；未覆盖已有账号。');
} finally {
  await db.$disconnect();
}
