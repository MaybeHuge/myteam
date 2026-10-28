import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { ProjectsService } from './projects.service.js';

const id = (value: string) => z.uuid().parse(value);
@Controller('projects')
export class ProjectsController {
  constructor(private readonly projects: ProjectsService) {}
  @Get() list(@Req() req: Request) {
    return this.projects.list(req);
  }
  @Post() create(@Body() input: unknown, @Req() req: Request) {
    return this.projects.create(input, req);
  }
  @Get(':id') detail(@Param('id') projectId: string, @Req() req: Request) {
    return this.projects.detail(id(projectId), req);
  }
  @Post(':id/update') update(
    @Param('id') projectId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.projects.update(id(projectId), input, req);
  }
  @Post(':id/status') state(
    @Param('id') projectId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.projects.changeState(id(projectId), input, req);
  }
  @Get(':id/members') members(@Param('id') projectId: string, @Req() req: Request) {
    return this.projects.members(id(projectId), req);
  }
  @Get(':id/member-options') memberOptions(@Param('id') projectId: string, @Req() req: Request) {
    return this.projects.memberOptions(id(projectId), req);
  }
  @Post(':id/members') add(
    @Param('id') projectId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.projects.addMember(id(projectId), input, req);
  }
  @Post(':id/members/:userId/roles') roles(
    @Param('id') projectId: string,
    @Param('userId') userId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.projects.updateMember(id(projectId), id(userId), input, req);
  }
  @Post(':id/members/:userId/remove') remove(
    @Param('id') projectId: string,
    @Param('userId') userId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.projects.updateMember(id(projectId), id(userId), input, req, true);
  }
  @Get(':id/activity') activity(@Param('id') projectId: string, @Req() req: Request) {
    return this.projects.activity(id(projectId), req);
  }
}
