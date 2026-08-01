import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import type { CurrentUserPayload } from '../common/auth/auth.guard';
import { TasksService, CareTaskNotFoundError } from './tasks.service';

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload, @Query('assignedUserId') assignedUserId?: string) {
    return this.tasksService.listForUser(user.jwt, assignedUserId ?? user.id);
  }

  @Get('overdue')
  listOverdue(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.tasksService.listOverdue(user.jwt, facilityId);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.tasksService.complete(user.jwt, user.id, id);
    } catch (err) {
      if (err instanceof CareTaskNotFoundError) {
        throw new NotFoundException({
          error: { code: 'CARE_TASK_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
