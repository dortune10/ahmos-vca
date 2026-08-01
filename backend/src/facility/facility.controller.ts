import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { FacilityService } from './facility.service';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { UpdateFacilityDto } from './dto/update-facility.dto';

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

  @Patch(':id')
  @Roles('admin')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFacilityDto,
  ) {
    return this.facilityService.update(user.jwt, user.id, user.tenantId, id, dto);
  }
}
