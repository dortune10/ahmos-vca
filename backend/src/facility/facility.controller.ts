import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { FacilityService } from './facility.service';
import { CreateFacilityDto } from './dto/create-facility.dto';

@Controller('facilities')
@UseGuards(AuthGuard, RolesGuard)
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFacilityDto) {
    return this.facilityService.create(user.jwt, user.id, user.tenantId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('acceptingReferrals') acceptingReferrals?: string,
  ) {
    return this.facilityService.list(user.jwt, acceptingReferrals === 'true');
  }
}
