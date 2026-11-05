import { ProjectDocumentsModule } from './modules/project-documents/project-documents.module.js';
import 'reflect-metadata';
import { AiModule } from './modules/ai/ai.module.js';
import { QualityModule } from './modules/quality/quality.module.js';
import { TestCasesModule } from './modules/test-cases/test-cases.module.js';
import { TasksModule } from './modules/tasks/tasks.module.js';
import { RequirementsModule } from './modules/requirements/requirements.module.js';
import { WorkbenchModule } from './modules/workbench/workbench.module.js';
import { CollaborationModule } from './modules/collaboration/collaboration.module.js';
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { static as serveStatic } from 'express';
import { existsSync } from 'node:fs';
import { extname, resolve } from 'node:path';
import type { Request, Response, NextFunction } from 'express';
import { InfrastructureModule } from './infrastructure/infrastructure.module.js';
import { ErrorFilter, requestContext } from './common/http.js';
import { IdentityModule } from './modules/identity/identity.module.js';
import { HealthController } from './modules/health.controller.js';
import { OpenApiController } from './modules/openapi.controller.js';
import { ProjectsModule } from './modules/projects/projects.module.js';
import { IterationsModule } from './modules/iterations/iterations.module.js';

@Module({
  imports: [
    InfrastructureModule,
    AiModule,
    IdentityModule,
    ProjectsModule,
    IterationsModule,
    CollaborationModule,
    WorkbenchModule,
    RequirementsModule,
    ProjectDocumentsModule,
    TasksModule,
    TestCasesModule,
    QualityModule,
  ],
  controllers: [HealthController, OpenApiController],
})
class AppModule {}

export async function createApp() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    logger: process.env.NODE_ENV === 'test' ? false : ['log', 'warn', 'error'],
  });
  app.useBodyParser('json', { limit: '1mb' });
  app.disable('x-powered-by');
  app.setGlobalPrefix('api/v1');
  app.use(helmet());
  app.use(cookieParser());
  app.use(requestContext);
  if (process.env.WEB_DIST_PATH) {
    const root = resolve(process.env.WEB_DIST_PATH);
    const index = resolve(root, 'index.html');
    if (!existsSync(index)) throw new Error('WEB_DIST_PATH 中缺少 index.html');
    const staticFiles = serveStatic(root, { index: false });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/api' || req.path.startsWith('/api/')) return next();
      return staticFiles(req, res, next);
    });
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (
        (req.method !== 'GET' && req.method !== 'HEAD') ||
        req.path === '/api' ||
        req.path.startsWith('/api/') ||
        extname(req.path) ||
        !req.accepts('html')
      )
        return next();
      return res.sendFile(index);
    });
  }
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
