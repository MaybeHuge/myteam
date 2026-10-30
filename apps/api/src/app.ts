import 'reflect-metadata';
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
    IdentityModule,
    ProjectsModule,
    IterationsModule,
    CollaborationModule,
    WorkbenchModule,
    RequirementsModule,
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
  app.useGlobalFilters(new ErrorFilter());
  app.enableShutdownHooks();
  await app.init();
  return app;
}
