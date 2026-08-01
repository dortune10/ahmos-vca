import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { UsersService } from './users.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateStaffUserDto) {
    return this.usersService.createStaffUser(user.id, user.tenantId, dto);
  }

  @Get()
  @Roles('admin')
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.list(user.jwt);
  }
}
