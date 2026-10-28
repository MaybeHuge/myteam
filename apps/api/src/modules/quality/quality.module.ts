import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { TestCasesModule } from '../test-cases/test-cases.module.js';
import { QualitySupport } from './quality.support.js';
import { TestingService } from './testing.service.js';
import { TestRecordsService } from './test-records.service.js';
import { DefectsService } from './defects.service.js';
const uuid = (s: string) => z.uuid().parse(s);
@Controller('projects/:projectId/quality')
class QualityController {
  constructor(
    readonly testing: TestingService,
    readonly defects: DefectsService,
    readonly records: TestRecordsService,
  ) {}
  @Get('people') people(@Param('projectId') p: string, @Req() r: Request) {
    return this.testing.people(uuid(p), r);
  }
  @Get('options') options(@Param('projectId') p: string, @Req() r: Request) {
    return this.testing.options(uuid(p), r);
  }
  @Get('defects') defectList(@Param('projectId') p: string, @Req() r: Request) {
    return this.defects.list(uuid(p), r);
  }
  @Get('defects/:id') defectDetail(
    @Param('projectId') p: string,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.defects.detail(uuid(p), uuid(id), r);
  }
  @Post('defects') createDefect(
    @Param('projectId') p: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.defects.create(uuid(p), b, r);
  }
  @Post('defects/:id/:action') defectAction(
    @Param('projectId') p: string,
    @Param('id') id: string,
    @Param('action') a: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.defects.action(
      uuid(p),
      uuid(id),
      z.enum(['confirm', 'assign', 'start', 'fix', 'retest', 'reopen', 'dispose', 'link']).parse(a),
      b,
      r,
    );
  }
  @Post('releases') releaseCreate(
    @Param('projectId') p: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.testing.releaseCommand(uuid(p), null, b, r);
  }
  @Post('releases/:id/update') releaseUpdate(
    @Param('projectId') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.testing.releaseCommand(uuid(p), uuid(id), b, r);
  }
  @Post('builds') buildCreate(
    @Param('projectId') p: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.testing.createBuild(uuid(p), b, r);
  }
  @Get('records') recordsList(@Param('projectId') p: string, @Req() r: Request) {
    return this.records.list(uuid(p), r);
  }
  @Get('records/:id') recordDetail(
    @Param('projectId') p: string,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.records.detail(uuid(p), uuid(id), r);
  }
  @Post('records') recordCreate(
    @Param('projectId') p: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.records.create(uuid(p), b, r);
  }
  @Post('records/:id/finish') recordFinish(
    @Param('projectId') p: string,
    @Param('id') id: string,
    @Body() b: unknown,
    @Req() r: Request,
  ) {
    return this.records.finish(uuid(p), uuid(id), b, r);
  }
  @Get(':kind') list(@Param('projectId') p: string, @Param('kind') k: string, @Req() r: Request) {
    return this.testing.list(uuid(p), z.enum(['releases', 'builds']).parse(k), r);
  }
  @Get(':kind/:id') detail(
    @Param('projectId') p: string,
    @Param('kind') k: string,
    @Param('id') id: string,
    @Req() r: Request,
  ) {
    return this.testing.detail(uuid(p), z.enum(['releases']).parse(k), uuid(id), r);
  }
}
@Module({
  imports: [IdentityModule, ProjectsModule, TestCasesModule],
  controllers: [QualityController],
  providers: [QualitySupport, TestingService, DefectsService, TestRecordsService],
})
export class QualityModule {}
