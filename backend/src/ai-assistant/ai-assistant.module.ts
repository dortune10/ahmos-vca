import { Module } from '@nestjs/common';
import { DangerSignMatcherService } from './danger-sign-matcher.service';

@Module({
  providers: [DangerSignMatcherService],
  exports: [DangerSignMatcherService],
})
export class AiAssistantModule {}
