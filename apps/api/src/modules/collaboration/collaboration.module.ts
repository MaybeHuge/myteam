import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { CollaborationService } from './collaboration.service.js';
import {
  CollaborationController,
  AttachmentsController,
  NotificationsController,
} from './collaboration.controller.js';
@Module({
  imports: [IdentityModule, ProjectsModule],
  providers: [CollaborationService],
  controllers: [CollaborationController, AttachmentsController, NotificationsController],
})
export class CollaborationModule {}
