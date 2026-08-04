import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { EpisodeModule } from '../episode/episode.module';
import { RiskModule } from '../risk/risk.module';
import { TasksModule } from '../tasks/tasks.module';
import { ReferralModule } from '../referral/referral.module';
import { UsersModule } from '../users/users.module';
import { DangerSignMatcherService } from './danger-sign-matcher.service';
import { ProfileContextService } from './profile-context.service';
import { AiAssistantService, AI_ASSISTANT_ANTHROPIC_CLIENT } from './ai-assistant.service';
import { EscalationService } from './escalation.service';

@Module({
  imports: [EpisodeModule, RiskModule, TasksModule, ReferralModule, UsersModule],
  providers: [
    DangerSignMatcherService,
    ProfileContextService,
    AiAssistantService,
    EscalationService,
    {
      // Falls back to a placeholder key when ANTHROPIC_API_KEY isn't set, mirroring
      // risk.module.ts's exact rationale: this module (and the app) must still boot without
      // a real key; any real call against the placeholder simply fails Anthropic's own auth
      // check and is caught by AiAssistantService's existing refusal-message fallback.
      provide: AI_ASSISTANT_ANTHROPIC_CLIENT,
      useFactory: () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'test-key-placeholder' }),
    },
  ],
  exports: [DangerSignMatcherService, ProfileContextService, AiAssistantService, EscalationService],
})
export class AiAssistantModule {}
