import { Injectable } from '@nestjs/common';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';
import { RiskService } from '../risk/risk.service';
import { TasksService } from '../tasks/tasks.service';
import { ReferralService } from '../referral/referral.service';

export interface ProfileContext {
  firstName: string;
  episodeStatus: string;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: string | null;
  upcomingTasks: Array<{ taskType: string; dueAt: string; status: string }>;
  latestReferralStatus: string | null;
}

@Injectable()
export class ProfileContextService {
  constructor(
    private readonly riskService: RiskService,
    private readonly tasksService: TasksService,
    private readonly referralService: ReferralService,
  ) {}

  async assemble(person: PersonResponseDto, episode: EpisodeResponseDto): Promise<ProfileContext> {
    const [riskAssessment, upcomingTasks, latestReferral] = await Promise.all([
      this.riskService.getLatestForEpisodeAsSystem(episode.id),
      this.tasksService.listUpcomingForEpisodeAsSystem(episode.id),
      this.referralService.getLatestForEpisodeAsSystem(episode.id),
    ]);

    return {
      firstName: person.firstName,
      episodeStatus: episode.status,
      estimatedDeliveryDate: episode.estimatedDeliveryDate,
      gestationalAgeWeeks: episode.gestationalAgeWeeks,
      riskBand: riskAssessment?.finalRiskBand ?? episode.riskBand ?? null,
      upcomingTasks: upcomingTasks.map((task) => ({
        taskType: task.taskType,
        dueAt: task.dueAt,
        status: task.status,
      })),
      latestReferralStatus: latestReferral?.status ?? null,
    };
  }
}
