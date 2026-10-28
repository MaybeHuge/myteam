import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TestCasesService } from './test-cases.service.js';
const id = (value: string) => z.uuid().parse(value);
@Controller('projects/:projectId/test-cases')
class TestCasesController {
  constructor(private readonly service: TestCasesService) {}
  @Get() list(@Param('projectId') project: string, @Req() req: Request) {
    return this.service.list(id(project), req);
  }
  @Get('people') people(@Param('projectId') project: string, @Req() req: Request) {
    return this.service.people(id(project), req);
  }
  @Get('requirements') requirements(@Param('projectId') project: string, @Req() req: Request) {
    return this.service.requirements(id(project), req);
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
    return this.service.update(id(project), id(item), input, req, true);
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
      z.enum(['submit', 'approve', 'return', 'withdraw', 'deprecate']).parse(action),
      input,
      req,
    );
  }
}
@Module({
  imports: [IdentityModule, ProjectsModule],
  controllers: [TestCasesController],
  providers: [TestCasesService],
  exports: [TestCasesService],
})
export class TestCasesModule {}
