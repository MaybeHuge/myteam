import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IterationsModule } from '../iterations/iterations.module.js';
import { RequirementsService } from './requirements.service.js';
const id = (value: string) => z.uuid().parse(value);
@Controller('projects/:projectId/requirements')
class RequirementsController {
  constructor(private readonly service: RequirementsService) {}
  @Get() list(@Param('projectId') project: string, @Req() req: Request) {
    return this.service.list(id(project), req);
  }
  @Get('people') people(@Param('projectId') project: string, @Req() req: Request) {
    return this.service.people(id(project), req);
  }
  @Post() create(@Param('projectId') project: string, @Body() input: unknown, @Req() req: Request) {
    return this.service.create(id(project), input, req);
  }
  @Get(':id') detail(
    @Param('projectId') project: string,
    @Param('id') item: string,
    @Req() req: Request,
  ) {
    return this.service.detail(id(project), id(item), req);
  }
  @Post(':id/update') update(
    @Param('projectId') project: string,
    @Param('id') item: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.service.update(id(project), id(item), input, req);
  }
  @Post(':id/revise') revise(
    @Param('projectId') project: string,
    @Param('id') item: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.service.revise(id(project), id(item), input, req);
  }
  @Post(':id/:action') action(
    @Param('projectId') project: string,
    @Param('id') item: string,
    @Param('action') action: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.service.transition(
      id(project),
      id(item),
      z.enum(['submit', 'approve', 'return', 'withdraw', 'cancel']).parse(action),
      input,
      req,
    );
  }
}
@Module({
  imports: [IdentityModule, ProjectsModule, IterationsModule],
  controllers: [RequirementsController],
  providers: [RequirementsService],
})
export class RequirementsModule {}
