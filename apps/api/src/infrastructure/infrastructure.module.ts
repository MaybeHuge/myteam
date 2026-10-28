import { RequirementValidity } from '../common/requirement-validity.js';
import { CollaborationEvents } from '../common/collaboration-events.js';
import { Global, Module } from '@nestjs/common';
import { APP_CONFIG, readConfig } from '../config.js';
import { Commands } from '../common/commands.js';
import { S3Storage } from './s3-storage.js';
import { Database } from './database.js';

@Global()
@Module({
  providers: [
    Database,
    Commands,
    CollaborationEvents,
    RequirementValidity,
    S3Storage,
    { provide: APP_CONFIG, useFactory: readConfig },
  ],
  exports: [Database, Commands, CollaborationEvents, RequirementValidity, S3Storage, APP_CONFIG],
})
export class InfrastructureModule {}
