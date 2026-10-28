import { Body, Controller, Get, Param, Post, Req, Res } from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { IdentityService } from './identity.service.js';

@Controller()
export class IdentityController {
  constructor(private readonly identity: IdentityService) {}
  @Get('auth/csrf')
  csrf(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.identity.csrf(req, res);
  }
  @Post('auth/login')
  login(@Body() input: unknown, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.identity.login(input, req, res);
  }
  @Get('auth/me')
  me(@Req() req: Request) {
    return this.identity.me(req);
  }
  @Post('auth/logout')
  logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    return this.identity.logout(req, res);
  }
  @Get('users')
  users(@Req() req: Request) {
    return this.identity.users(req);
  }
  @Post('users')
  createUser(@Body() input: unknown, @Req() req: Request) {
    return this.identity.createUser(input, req);
  }
  @Post('users/:id/status')
  status(@Param('id') id: string, @Body() input: unknown, @Req() req: Request) {
    return this.identity.setUserStatus(z.uuid().parse(id), input, req);
  }
}
