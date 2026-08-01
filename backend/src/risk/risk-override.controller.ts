import { Body, Controller, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { RiskService, RiskAssessmentNotFoundError } from './risk.service';
import { OverrideRiskAssessmentDto } from './dto/override-risk-assessment.dto';

@Controller('risk-assessments')
@UseGuards(AuthGuard, RolesGuard)
export class RiskOverrideController {
  constructor(private readonly riskService: RiskService) {}

  @Patch(':id/override')
  @Roles('clinician', 'admin')
  async override(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: OverrideRiskAssessmentDto,
  ) {
    try {
      return await this.riskService.override(user.jwt, user.id, id, dto);
    } catch (err) {
      if (err instanceof RiskAssessmentNotFoundError) {
        throw new NotFoundException({
          error: { code: 'RISK_ASSESSMENT_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
