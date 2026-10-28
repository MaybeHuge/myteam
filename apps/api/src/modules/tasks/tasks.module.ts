import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IterationsModule } from '../iterations/iterations.module.js';
import { TasksService } from './tasks.service.js';
const uuid = (value: string) => z.uuid().parse(value);
@Controller('projects/:projectId/tasks')
class TasksController {
  constructor(private readonly service: TasksService) {}
  @Get() list(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.service.list(uuid(projectId), req);
  }
  @Get('board') board(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.service.board(uuid(projectId), req);
  }
  @Get('people') people(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.service.people(uuid(projectId), req);
  }
  @Get('requirements') requirements(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.service.requirements(uuid(projectId), req);
  }
  @Get(':id') detail(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.service.detail(uuid(projectId), uuid(id), req);
  }
  @Post() create(
    @Param('projectId') projectId: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.service.create(uuid(projectId), body, req);
  }
  @Post(':id/:action') command(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Param('action') action: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    const parsed = z
      .enum([
        'update',
        'assign',
        'start',
        'block',
        'resume',
        'acknowledge',
        'complete',
        'reopen',
        'reset',
      ])
      .parse(action);
    if (
      parsed === 'block' ||
      parsed === 'resume' ||
      parsed === 'complete' ||
      parsed === 'reopen' ||
      parsed === 'reset' ||
      parsed === 'acknowledge'
    )
      return this.service.transition(uuid(projectId), uuid(id), parsed, body, req);
    return this.service[parsed](uuid(projectId), uuid(id), body, req);
  }
}
@Module({
  imports: [IdentityModule, ProjectsModule, IterationsModule],
  controllers: [TasksController],
  providers: [TasksService],
})
export class TasksModule {}
