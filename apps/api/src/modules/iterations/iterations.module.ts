import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IterationsController } from './iterations.controller.js';
import { IterationsService } from './iterations.service.js';
@Module({
  imports: [IdentityModule, ProjectsModule],
  controllers: [IterationsController],
  providers: [IterationsService],
  exports: [IterationsService],
})
export class IterationsModule {}
