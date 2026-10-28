import { Body, Controller, Get, Param, Post, Req, Res, StreamableFile } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { CollaborationService } from './collaboration.service.js';
const uuid = (value: string) => z.uuid().parse(value);
@Controller('projects/:projectId/collaboration/:targetType/:targetId')
export class CollaborationController {
  constructor(private readonly service: CollaborationService) {}
  @Get('comments') comments(@Param() p: Record<string, string>, @Req() req: Request) {
    return this.service.list(uuid(p.projectId!), p, req);
  }
  @Post('comments') comment(
    @Param() p: Record<string, string>,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.service.comment(uuid(p.projectId!), p, body, req);
  }
  @Get('attachments') attachments(@Param() p: Record<string, string>, @Req() req: Request) {
    return this.service.list(uuid(p.projectId!), p, req, true);
  }
  @Post('attachments') upload(@Param() p: Record<string, string>, @Req() req: Request) {
    return this.service.upload(uuid(p.projectId!), p, req);
  }
}
@Controller('projects/:projectId/attachments')
export class AttachmentsController {
  constructor(private readonly service: CollaborationService) {}
  @Get(':id/download') async download(
    @Param('projectId') projectId: string,
    @Param('id') id: string,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const { row, stream } = await this.service.download(uuid(projectId), uuid(id), req);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    return new StreamableFile(stream, {
      type: row.contentType,
      length: row.size,
      disposition: `attachment; filename="download"; filename*=UTF-8''${encodeURIComponent(row.filename).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}`,
    });
  }
}
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly service: CollaborationService) {}
  @Get() list(@Req() req: Request) {
    return this.service.notifications(req);
  }
  @Post(':id/read') read(@Param('id') id: string, @Req() req: Request) {
    return this.service.readNotification(uuid(id), req);
  }
}
