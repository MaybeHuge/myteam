import {
  Body,
  Controller,
  Get,
  Module,
  Param,
  Post,
  Req,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { IdentityModule } from '../identity/identity.module.js';
import { ProjectsModule } from '../projects/projects.module.js';
import { IterationsModule } from '../iterations/iterations.module.js';
import { RequirementDocumentsService } from './requirement-documents.service.js';
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
@Controller('projects/:projectId/requirements/:requirementId/document')
class RequirementDocumentsController {
  constructor(
    private readonly documents: RequirementDocumentsService,
    private readonly requirements: RequirementsService,
  ) {}
  @Get() detail(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Req() req: Request,
  ) {
    return this.documents.detail(id(project), id(requirement), req);
  }
  @Get('versions') versions(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Req() req: Request,
  ) {
    return this.documents.versions(id(project), id(requirement), req);
  }
  @Post() create(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.documents.write(id(project), id(requirement), 'create', body, req);
  }
  @Post('save') save(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.documents.write(id(project), id(requirement), 'save', body, req);
  }
  @Post('reset') reset(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.documents.write(id(project), id(requirement), 'reset', body, req);
  }
  @Post('apply') apply(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.requirements.applyDocument(id(project), id(requirement), body, req);
  }
  @Post('images') upload(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Req() req: Request,
  ) {
    return this.documents.upload(id(project), id(requirement), req);
  }
  @Get('images') images(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Req() req: Request,
  ) {
    return this.documents.images(id(project), id(requirement), req);
  }
  @Get('images/:imageId/preview') async preview(
    @Param('projectId') project: string,
    @Param('requirementId') requirement: string,
    @Param('imageId') imageId: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { image, stream } = await this.documents.preview(
      id(project),
      id(requirement),
      id(imageId),
      req,
    );
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
    return new StreamableFile(stream, {
      type: image.contentType,
      length: image.size,
      disposition: 'inline',
    });
  }
}
@Module({
  imports: [IdentityModule, ProjectsModule, IterationsModule],
  controllers: [RequirementDocumentsController, RequirementsController],
  providers: [RequirementsService, RequirementDocumentsService],
})
export class RequirementsModule {}
