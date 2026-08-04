import { Module } from '@nestjs/common';
import { EpisodeModule } from '../episode/episode.module';
import { RiskModule } from '../risk/risk.module';
import { TasksModule } from '../tasks/tasks.module';
import { ReferralModule } from '../referral/referral.module';
import { DangerSignMatcherService } from './danger-sign-matcher.service';
import { ProfileContextService } from './profile-context.service';

@Module({
  imports: [EpisodeModule, RiskModule, TasksModule, ReferralModule],
  providers: [DangerSignMatcherService, ProfileContextService],
  exports: [DangerSignMatcherService, ProfileContextService],
})
export class AiAssistantModule {}
