import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { ReportingService } from './reporting.service';

@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('supervisor', 'admin')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('kpi-summary')
  getKpiSummary(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.reportingService.getKpiSummary(user.jwt, facilityId);
  }

  @Get('sla-breaches')
  getSlaBreaches(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.reportingService.getSlaBreachDetail(user.jwt, facilityId);
  }
}
