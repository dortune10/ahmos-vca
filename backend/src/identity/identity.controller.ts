import {
  Body,
  ConflictException,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { IdentityService, DuplicatePersonError, PersonNotFoundError } from './identity.service';
import { CreatePersonDto } from './dto/create-person.dto';

// RolesGuard is added to the class alongside the existing AuthGuard, exactly as
// FacilityController/UsersController already do. Nest runs controller-level guards in order and
// before route-level ones, so AuthGuard has already populated request.currentUser by the time
// RolesGuard reads its role. Adding it here changes nothing for the two existing routes:
// RolesGuard returns true whenever a handler carries no @Roles metadata, and neither `create`
// nor `search` does.
@Controller('persons')
@UseGuards(AuthGuard, RolesGuard)
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

  // The staff half of the channel-verification design (docs/DECISIONS.md #28). The response
  // body is the ONLY place the plaintext code ever appears — it is not stored, not logged, and
  // not retrievable again. Issuing a replacement is always allowed and retires the previous
  // one.
  //
  // Roles: the four that actually stand in front of patients. `supervisor` is excluded
  // deliberately — a district supervisor has no patient-contact workflow in this product and no
  // reason to mint a credential for someone else's patient.
  @Post(':id/whatsapp-enrolment-code')
  @Roles('chw', 'nurse', 'clinician', 'admin')
  async issueWhatsAppEnrolmentCode(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
  ) {
    try {
      return await this.identityService.issueWhatsAppEnrolmentCode(user.jwt, user.id, id);
    } catch (err) {
      if (err instanceof PersonNotFoundError) {
        throw new NotFoundException({
          error: { code: 'PERSON_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
