import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { z } from 'zod';
import { IterationsService } from './iterations.service.js';
const uuid = (value: string) => z.uuid().parse(value);
@Controller('projects/:projectId/iterations')
export class IterationsController {
  constructor(private readonly iterations: IterationsService) {}
  @Get() list(@Param('projectId') projectId: string, @Req() req: Request) {
    return this.iterations.list(uuid(projectId), req);
  }
  @Post() create(
    @Param('projectId') projectId: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.iterations.create(uuid(projectId), input, req);
  }
  @Get(':id') detail(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Req() req: Request,
  ) {
    return this.iterations.detail(uuid(projectId), uuid(id), req);
  }
  @Post(':id/update') update(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.iterations.update(uuid(projectId), uuid(id), input, req);
  }
  @Post(':id/start') start(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.iterations.changeState(uuid(projectId), uuid(id), input, req);
  }
  @Post(':id/close') close(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Body() input: unknown,
    @Req() req: Request,
  ) {
    return this.iterations.changeState(uuid(projectId), uuid(id), input, req, true);
  }
}
