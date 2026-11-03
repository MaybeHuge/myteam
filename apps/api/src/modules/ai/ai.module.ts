import { Body, Controller, Get, Module, Param, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import { IdentityModule } from '../identity/identity.module.js';
import { AiService, providerSchema } from './ai.service.js';
@Controller('settings/ai-providers')
class AiController {
  constructor(private readonly ai: AiService) {}
  @Get() list(@Req() req: Request) {
    return this.ai.listAdmin(req);
  }
  @Post(':provider') save(
    @Param('provider') provider: string,
    @Body() body: unknown,
    @Req() req: Request,
  ) {
    return this.ai.save(providerSchema.parse(provider), body, req);
  }
}
@Module({
  imports: [IdentityModule],
  providers: [AiService],
  controllers: [AiController],
  exports: [AiService],
})
export class AiModule {}
