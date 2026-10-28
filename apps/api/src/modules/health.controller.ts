import { Controller, Get } from '@nestjs/common';
import { S3Storage } from '../infrastructure/s3-storage.js';
import { Database } from '../infrastructure/database.js';
import { ApiException } from '../common/http.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly db: Database,
    private readonly storage: S3Storage,
  ) {}
  @Get('live') live() {
    return { status: 'ok', service: 'myteam-api' };
  }
  @Get('ready') async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      await this.storage.ready();
      return { status: 'ok', service: 'myteam-api', database: 'up', storage: 'up' };
    } catch {
      throw new ApiException(503, 'SERVICE_UNAVAILABLE', '数据库或附件存储暂不可用');
    }
  }
}
