import { assertQualityHandover } from '../../common/quality-responsibilities.js';
import { assertTestCaseHandover } from '../../common/test-case-responsibilities.js';
import { assertTaskHandover } from '../../common/task-responsibilities.js';
import { assertRequirementHandover } from '../../common/requirement-responsibilities.js';
import { Inject, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import * as argon2 from 'argon2';
import type { Request, Response, CookieOptions } from 'express';
import {
  createUserSchema,
  changePasswordSchema,
  loginSchema,
  userQuerySchema,
  userSchema,
  userStatusSchema,
} from '@myteam/contracts';
import { APP_CONFIG, type AppConfig } from '../../config.js';
import { Database } from '../../infrastructure/database.js';
import { ApiException, digest, secureEqual } from '../../common/http.js';
import { Commands } from '../../common/commands.js';

const randomToken = () => randomBytes(32).toString('hex');

@Injectable()
export class IdentityService {
  private dummyHash!: string;
  constructor(
    private readonly db: Database,
    private readonly commands: Commands,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  async onModuleInit() {
    this.dummyHash = await argon2.hash(randomToken(), { type: argon2.argon2id });
  }
  private cookieOptions(): CookieOptions {
    return { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'lax', path: '/' };
  }
  private csrfCookie() {
    return `${this.config.SESSION_COOKIE}_csrf`;
  }
  private token(req: Request): string | undefined {
    const token: unknown = req.cookies?.[this.config.SESSION_COOKIE];
    return typeof token === 'string' && /^[a-f0-9]{64}$/.test(token) ? token : undefined;
  }
  private checkOrigin(req: Request) {
    const origin = req.get('origin');
    if (this.config.APP_ORIGIN === '*' && origin) {
      try {
        const url = new URL(origin);
        if (
          url.origin === origin &&
          ['http:', 'https:'].includes(url.protocol) &&
          (this.config.NODE_ENV !== 'production' || url.protocol === 'https:')
        )
          return;
      } catch {
        // 通配来源仍须是浏览器的有效 HTTP(S) Origin。
      }
    } else if (origin === this.config.APP_ORIGIN) return;
    throw new ApiException(403, 'FORBIDDEN', '请求来源无效，请从应用页面操作');
  }
  private async findSession(req: Request) {
    const token = this.token(req);
    if (!token) return null;
    const session = await this.db.session.findUnique({
      where: { tokenHash: digest(token) },
      include: { user: true },
    });
    if (!session || !session.user.active || session.expiresAt.getTime() <= Date.now()) return null;
    return session;
  }
  async requireSession(req: Request) {
    const session = await this.findSession(req);
    if (!session) throw new ApiException(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
    return session;
  }
  async csrf(req: Request, res: Response) {
    const session = await this.findSession(req);
    const csrfToken = session?.csrfToken ?? randomToken();
    res.cookie(this.csrfCookie(), csrfToken, {
      ...this.cookieOptions(),
      maxAge: this.config.SESSION_TTL_HOURS * 3600000,
    });
    return { csrfToken };
  }
  async login(input: unknown, req: Request, res: Response) {
    this.checkOrigin(req);
    const csrf: unknown = req.cookies?.[this.csrfCookie()];
    if (!secureEqual(req.get('x-csrf-token'), csrf))
      throw new ApiException(403, 'FORBIDDEN', '页面安全凭据已失效，请刷新后重试');
    const { email, password } = loginSchema.parse(input);
    const ipHash = digest(req.ip ?? 'unknown');
    const since = new Date(Date.now() - 15 * 60000);
    const [emailFailures, ipFailures] = await Promise.all([
      this.db.loginAttempt.count({ where: { email, createdAt: { gte: since } } }),
      this.db.loginAttempt.count({ where: { ipHash, createdAt: { gte: since } } }),
    ]);
    if (emailFailures >= 5 || ipFailures >= 50) {
      res.setHeader('Retry-After', '900');
      throw new ApiException(429, 'RATE_LIMITED', '登录尝试过多，请 15 分钟后重试');
    }
    const user = await this.db.user.findUnique({ where: { email } });
    const valid = await argon2.verify(user?.passwordHash ?? this.dummyHash, password);
    if (!valid || !user?.active) {
      await this.db.loginAttempt.create({ data: { email, ipHash } });
      throw new ApiException(401, 'UNAUTHENTICATED', '邮箱或密码错误');
    }
    const token = randomToken();
    const csrfToken = randomToken();
    const expiresAt = new Date(Date.now() + this.config.SESSION_TTL_HOURS * 3600000);
    const previous = this.token(req);
    await this.db.$transaction(async (tx) => {
      // 与账号停用串行化，防止停用并发时创建新会话。
      const locked = await tx.$queryRaw<
        Array<{ active: boolean; passwordHash: string }>
      >`SELECT active, "passwordHash" FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
      if (!locked[0]?.active || locked[0].passwordHash !== user.passwordHash)
        throw new ApiException(401, 'UNAUTHENTICATED', '邮箱或密码错误');
      if (previous) await tx.session.deleteMany({ where: { tokenHash: digest(previous) } });
      await tx.session.create({
        data: { tokenHash: digest(token), csrfToken, userId: user.id, expiresAt },
      });
      await tx.activityLog.create({
        data: {
          actorId: user.id,
          targetId: user.id,
          action: 'identity.login',
          requestId: req.requestId,
        },
      });
    });
    res.cookie(this.config.SESSION_COOKIE, token, { ...this.cookieOptions(), expires: expiresAt });
    res.cookie(this.csrfCookie(), csrfToken, { ...this.cookieOptions(), expires: expiresAt });
    return { user: userSchema.parse(user), csrfToken, expiresAt: expiresAt.toISOString() };
  }
  async changePassword(input: unknown, req: Request) {
    const session = await this.requireWrite(req);
    const data = changePasswordSchema.parse(input);
    const ipHash = digest(req.ip ?? 'unknown');
    const since = new Date(Date.now() - 15 * 60000);
    const [emailFailures, ipFailures] = await Promise.all([
      this.db.loginAttempt.count({
        where: { email: session.user.email, createdAt: { gte: since } },
      }),
      this.db.loginAttempt.count({ where: { ipHash, createdAt: { gte: since } } }),
    ]);
    if (emailFailures >= 5 || ipFailures >= 50)
      throw new ApiException(429, 'RATE_LIMITED', '尝试过多，请 15 分钟后重试');
    if (!(await argon2.verify(session.user.passwordHash, data.currentPassword))) {
      await this.db.loginAttempt.create({ data: { email: session.user.email, ipHash } });
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '原密码不正确');
    }
    const passwordHash = await argon2.hash(data.newPassword, { type: argon2.argon2id });
    await this.db.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ active: boolean; passwordHash: string }>>`
        SELECT active, "passwordHash" FROM "User" WHERE id = ${session.userId}::uuid FOR UPDATE`;
      if (!locked[0]?.active || locked[0].passwordHash !== session.user.passwordHash)
        throw new ApiException(409, 'CONFLICT', '账号状态或密码已变更，请重新登录');
      const validSession = await tx.session.findUnique({ where: { id: session.id } });
      if (!validSession || validSession.expiresAt.getTime() <= Date.now())
        throw new ApiException(401, 'UNAUTHENTICATED', '登录已失效，请重新登录');
      await tx.user.update({
        where: { id: session.userId },
        data: { passwordHash, version: { increment: 1 } },
      });
      await tx.session.deleteMany({ where: { userId: session.userId, id: { not: session.id } } });
      await tx.activityLog.create({
        data: {
          actorId: session.userId,
          targetId: session.userId,
          action: 'identity.password.changed',
          requestId: req.requestId,
        },
      });
    });
    return { success: true };
  }
  async me(req: Request) {
    const session = await this.requireSession(req);
    return {
      user: userSchema.parse(session.user),
      csrfToken: session.csrfToken,
      expiresAt: session.expiresAt.toISOString(),
    };
  }
  async requireWrite(req: Request) {
    this.checkOrigin(req);
    const session = await this.requireSession(req);
    if (!secureEqual(req.get('x-csrf-token'), session.csrfToken))
      throw new ApiException(403, 'FORBIDDEN', '页面安全凭据已失效，请刷新后重试');
    return session;
  }
  async logout(req: Request, res: Response) {
    const session = await this.requireWrite(req);
    await this.db.$transaction(async (tx) => {
      await tx.session.deleteMany({ where: { id: session.id } });
      await tx.activityLog.create({
        data: {
          actorId: session.userId,
          targetId: session.userId,
          action: 'identity.logout',
          requestId: req.requestId,
        },
      });
    });
    res.clearCookie(this.config.SESSION_COOKIE, this.cookieOptions());
    res.clearCookie(this.csrfCookie(), this.cookieOptions());
    return { success: true };
  }
  async users(req: Request) {
    const session = await this.requireSession(req);
    if (!session.user.isSystemAdmin)
      throw new ApiException(403, 'FORBIDDEN', '只有系统管理员可以管理账号');
    const { page, pageSize, q } = userQuerySchema.parse(req.query);
    const where = q
      ? {
          OR: [
            { name: { contains: q, mode: 'insensitive' as const } },
            { email: { contains: q, mode: 'insensitive' as const } },
          ],
        }
      : {};
    const [items, total, all, active, admins] = await this.db.$transaction([
      this.db.user.findMany({
        where,
        select: {
          id: true,
          email: true,
          name: true,
          active: true,
          isSystemAdmin: true,
          version: true,
        },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        take: pageSize,
        skip: (page - 1) * pageSize,
      }),
      this.db.user.count({ where }),
      this.db.user.count(),
      this.db.user.count({ where: { active: true } }),
      this.db.user.count({ where: { isSystemAdmin: true } }),
    ]);
    return {
      items,
      total,
      page,
      pageSize,
      stats: { total: all, active, inactive: all - active, admins },
    };
  }
  async createUser(input: unknown, req: Request) {
    const session = await this.requireWrite(req);
    if (!session.user.isSystemAdmin)
      throw new ApiException(403, 'FORBIDDEN', '只有系统管理员可以创建账号');
    const data = createUserSchema.parse(input);
    const key = z.uuid().parse(req.get('idempotency-key'));
    // 唯一命令 nonce 派生盐，使重试可比较；摘要仍经过 Argon2，避免保存可快速猜测的密码指纹。
    const salt = Buffer.from(digest(`user-create:${session.userId}:${key}`), 'hex').subarray(0, 16);
    const passwordHash = await argon2.hash(data.password, {
      type: argon2.argon2id,
      salt,
      memoryCost: 65536,
      timeCost: 3,
      parallelism: 4,
    });
    return this.commands.run(
      session.userId,
      key,
      { action: 'user.create', email: data.email, name: data.name, passwordProof: passwordHash },
      async (tx) => {
        const user = await tx.user.create({
          data: { name: data.name, email: data.email, passwordHash, isSystemAdmin: false },
        });
        await tx.activityLog.create({
          data: {
            actorId: session.userId,
            targetId: user.id,
            action: 'identity.user.created',
            requestId: req.requestId,
          },
        });
        return { id: user.id };
      },
    );
  }
  async setUserStatus(id: string, input: unknown, req: Request) {
    const session = await this.requireWrite(req);
    if (!session.user.isSystemAdmin)
      throw new ApiException(403, 'FORBIDDEN', '只有系统管理员可以管理账号');
    const { active, version } = userStatusSchema.parse(input);
    if (id === session.userId && !active)
      throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '不能停用当前登录账号');
    return this.commands.run(
      session.userId,
      req.get('idempotency-key'),
      { action: 'user.status', id, active, version },
      async (tx) => {
        const target = await tx.$queryRaw<
          Array<{ id: string; version: number; isSystemAdmin: boolean }>
        >`SELECT id, version, "isSystemAdmin" FROM "User" WHERE id = ${id}::uuid FOR UPDATE`;
        if (!target[0]) throw new ApiException(404, 'NOT_FOUND', '账号不存在');
        if (target[0].version !== version)
          throw new ApiException(409, 'CONFLICT', '账号已被其他人修改，请刷新');
        if (target[0].isSystemAdmin && !active)
          throw new ApiException(422, 'BUSINESS_RULE_VIOLATION', '首期禁止通过界面停用系统管理员');
        if (
          !active &&
          (await tx.project.count({
            where: { ownerId: id, status: { notIn: ['COMPLETED', 'ARCHIVED'] } },
          }))
        ) {
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '该成员仍负责未结束项目，请先移交项目负责人',
          );
        }
        if (
          !active &&
          (await tx.iteration.count({ where: { ownerId: id, status: { not: 'CLOSED' } } }))
        )
          throw new ApiException(
            422,
            'BUSINESS_RULE_VIOLATION',
            '该成员仍负责未关闭迭代，请先移交迭代负责人',
          );
        if (!active) await assertRequirementHandover(tx, id, { owner: true, reviewer: true });
        if (!active) await assertTaskHandover(tx, id);
        if (!active) await assertQualityHandover(tx, id);
        if (!active) await assertTestCaseHandover(tx, id, { owner: true, reviewer: true });
        await tx.user.update({ where: { id }, data: { active, version: { increment: 1 } } });
        if (!active) await tx.session.deleteMany({ where: { userId: id } });
        await tx.activityLog.create({
          data: {
            actorId: session.userId,
            targetId: id,
            action: active ? 'identity.user.enabled' : 'identity.user.disabled',
            details: { active },
            requestId: req.requestId,
          },
        });
        return { success: true };
      },
    );
  }
}
