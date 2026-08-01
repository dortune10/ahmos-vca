import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import {
  ReferralService,
  ReferralNotFoundError,
  TargetFacilityNotAcceptingReferralsError,
} from './referral.service';
import { InvalidReferralStateError } from './referral-state-machine';
import { CreateReferralDto } from './dto/create-referral.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';

@Controller('referrals')
@UseGuards(AuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateReferralDto) {
    try {
      return await this.referralService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof TargetFacilityNotAcceptingReferralsError) {
        throw new HttpException(
          {
            error: {
              code: 'REFERRAL_TARGET_FACILITY_NOT_ACCEPTING',
              message: err.message,
              details: [],
              correlationId: randomUUID(),
            },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateReferralStatusDto,
  ) {
    try {
      return await this.referralService.updateStatus(user.jwt, user.id, id, dto.status);
    } catch (err) {
      if (err instanceof InvalidReferralStateError) {
        throw new HttpException(
          {
            error: {
              code: 'REFERRAL_INVALID_STATE',
              message: err.message,
              details: [],
              correlationId: randomUUID(),
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      if (err instanceof ReferralNotFoundError) {
        throw new NotFoundException({
          error: {
            code: 'REFERRAL_NOT_FOUND',
            message: err.message,
            details: [],
            correlationId: randomUUID(),
          },
        });
      }
      throw err;
    }
  }

  @Get(':id')
  async getById(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.referralService.getById(user.jwt, id);
    } catch (err) {
      if (err instanceof ReferralNotFoundError) {
        throw new NotFoundException({
          error: {
            code: 'REFERRAL_NOT_FOUND',
            message: err.message,
            details: [],
            correlationId: randomUUID(),
          },
        });
      }
      throw err;
    }
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('facilityId') facilityId: string,
    @Query('direction') direction: string,
  ) {
    if (direction !== 'incoming' && direction !== 'outgoing') {
      throw new BadRequestException({
        error: {
          code: 'INVALID_REFERRAL_DIRECTION',
          message: `direction must be 'incoming' or 'outgoing', got '${direction}'`,
          details: [],
          correlationId: randomUUID(),
        },
      });
    }
    return this.referralService.listForFacility(user.jwt, facilityId, direction);
  }
}
