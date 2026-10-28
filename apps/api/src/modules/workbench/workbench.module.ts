import { Controller, Get, Module, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityModule } from '../identity/identity.module.js';
import { WorkbenchService } from './workbench.service.js';
@Controller('workbench')
class WorkbenchController {
  constructor(private readonly workbench: WorkbenchService) {}
  @Get('todos') list(@Req() req: Request) {
    return this.workbench.list(req);
  }
}
@Module({
  imports: [IdentityModule],
  controllers: [WorkbenchController],
  providers: [WorkbenchService],
})
export class WorkbenchModule {}
