import {
  Body,
  Controller,
  Get,
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
import { EpisodeService, PersonNotFoundError, EpisodeNotFoundError } from './episode.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { RecordEncounterNoteDto } from './dto/record-encounter-note.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';

@Controller('pregnancy-episodes')
@UseGuards(AuthGuard)
export class EpisodeController {
  constructor(private readonly episodeService: EpisodeService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateEpisodeDto) {
    try {
      return await this.episodeService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof PersonNotFoundError) {
        throw new NotFoundException({
          error: { code: 'PERSON_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.episodeService.listForCaseload(user.jwt, facilityId);
  }

  @Get(':id')
  async getById(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.episodeService.getById(user.jwt, id);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Get(':id/encounter-notes')
  async listEncounterNotes(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.episodeService.listEncounterNotes(user.jwt, id);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Post(':id/encounter-notes')
  async recordEncounterNote(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RecordEncounterNoteDto,
  ) {
    try {
      return await this.episodeService.recordEncounterNote(user.jwt, user.id, id, dto);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEpisodeStatusDto,
  ) {
    try {
      return await this.episodeService.updateStatus(user.jwt, user.id, id, dto.status);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
