import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { RiskService, RiskEpisodeNotFoundError } from './risk.service';

@Controller('pregnancy-episodes/:episodeId/risk-assessments')
@UseGuards(AuthGuard)
export class RiskAssessmentController {
  constructor(private readonly riskService: RiskService) {}

  @Post()
  async trigger(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    try {
      return await this.riskService.assess(user.tenantId, user.id, episodeId);
    } catch (err) {
      if (err instanceof RiskEpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Get()
  history(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    return this.riskService.listHistoryForEpisode(user.jwt, episodeId);
  }

  @Get('latest')
  latest(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    return this.riskService.getLatestForEpisode(user.jwt, episodeId);
  }
}
