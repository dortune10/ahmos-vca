import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { RiskAssessmentController } from './risk-assessment.controller';
import { RiskOverrideController } from './risk-override.controller';
import { RiskService } from './risk.service';
import { RiskRulesEngineService } from './risk-rules-engine.service';
import { RiskMlService, ANTHROPIC_CLIENT } from './risk-ml.service';

@Module({
  controllers: [RiskAssessmentController, RiskOverrideController],
  providers: [
    RiskService,
    RiskRulesEngineService,
    RiskMlService,
    {
      provide: ANTHROPIC_CLIENT,
      // Falls back to a placeholder key when ANTHROPIC_API_KEY isn't set (local dev/CI
      // without a real key) so the app can still boot and every other endpoint keeps
      // working. Any real call attempted with a placeholder key simply fails Anthropic's
      // own auth check and is caught by RiskMlService's existing api_error fallback path —
      // this is intentional, not a bug: risk assessment must never be a hard dependency
      // for the app to even start, extending the same principle the design spec (Section
      // 6) applies to a single failed call.
      useFactory: () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'test-key-placeholder' }),
    },
  ],
  exports: [RiskService],
})
export class RiskModule {}
