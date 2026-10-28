import { Catch, HttpException, type ArgumentsHost, type ExceptionFilter } from '@nestjs/common';
import type { Request, Response } from 'express';
import { randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { ZodError } from 'zod';
import { Prisma } from '../generated/prisma/client.js';
import type { ApiErrorResponse } from '@myteam/contracts';

declare module 'express-serve-static-core' {
  interface Request {
    requestId: string;
  }
}

export class ApiException extends HttpException {
  constructor(status: number, code: ApiErrorResponse['code'], message: string, details?: unknown) {
    super({ code, message, ...(details === undefined ? {} : { details }) }, status);
  }
}
export function secureEqual(left: unknown, right: unknown): boolean {
  if (
    typeof left !== 'string' ||
    typeof right !== 'string' ||
    left.length > 512 ||
    right.length > 512
  )
    return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}
export const digest = (value: string): string => createHash('sha256').update(value).digest('hex');

export function requestContext(req: Request, res: Response, next: () => void) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-Id', req.requestId);
  res.setHeader('Cache-Control', 'no-store');
  const start = Date.now();
  res.on('finish', () => {
    if (process.env.NODE_ENV !== 'test')
      process.stdout.write(
        `${JSON.stringify({ level: 'info', requestId: req.requestId, method: req.method, path: req.path, status: res.statusCode, durationMs: Date.now() - start })}\n`,
      );
  });
  next();
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<Request>();
    let status = 500;
    let body: Omit<ApiErrorResponse, 'requestId'> = {
      code: 'INTERNAL_ERROR',
      message: '服务暂时无法处理请求，请稍后重试',
    };
    if (error instanceof ZodError) {
      status = 400;
      body = {
        code: 'VALIDATION_ERROR',
        message: '请检查输入内容',
        details: error.issues.map(({ path, message }) => ({ path, message })),
      };
    } else if (error instanceof ApiException) {
      status = error.getStatus();
      body = error.getResponse() as typeof body;
    } else if (error instanceof HttpException) {
      status = error.getStatus();
      body = {
        code: status === 404 ? 'NOT_FOUND' : status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
        message: status === 404 ? '请求的资源不存在' : '请求无法处理',
      };
    } else if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      status = 409;
      body = { code: 'CONFLICT', message: '该标识、账号或关联已经存在，请检查后重试' };
    } else {
      process.stderr.write(
        `${JSON.stringify({ level: 'error', requestId: request.requestId, error: error instanceof Error ? error.name : 'UnknownError' })}\n`,
      );
    }
    response.status(status).json({ ...body, requestId: request.requestId });
  }
}
