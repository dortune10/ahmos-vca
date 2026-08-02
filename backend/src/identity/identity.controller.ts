import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { IdentityService, DuplicatePersonError } from './identity.service';
import { CreatePersonDto } from './dto/create-person.dto';

@Controller('persons')
@UseGuards(AuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePersonDto) {
    try {
      return await this.identityService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof DuplicatePersonError) {
        throw new ConflictException({
          error: {
            code: 'DUPLICATE_PERSON',
            message: err.message,
            details: [{ existingPersonId: err.existingPersonId }],
          },
        });
      }
      throw err;
    }
  }

  @Get()
  search(
    @CurrentUser() user: CurrentUserPayload,
    @Query('phone') phone?: string,
    @Query('ids') ids?: string,
  ) {
    if (ids) {
      const idList = ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return this.identityService.findByIds(user.jwt, idList);
    }
    return this.identityService.search(user.jwt, phone as string);
  }
}
