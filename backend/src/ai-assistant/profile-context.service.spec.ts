import { ProfileContextService } from './profile-context.service';
import { RiskService } from '../risk/risk.service';
import { TasksService } from '../tasks/tasks.service';
import { ReferralService } from '../referral/referral.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';
import { RiskAssessmentResponseDto } from '../risk/dto/risk-assessment-response.dto';
import { CareTaskResponseDto } from '../tasks/dto/care-task-response.dto';
import { ReferralResponseDto } from '../referral/dto/referral-response.dto';

function buildPerson(): PersonResponseDto {
  const person = new PersonResponseDto();
  person.id = 'p1';
  person.tenantId = 't1';
  person.firstName = 'Amina';
  person.lastName = null;
  person.phonePrimary = '+254700000001';
  person.dateOfBirth = null;
  person.whatsappConsent = true;
  person.whatsappConsentAt = '2026-08-01T00:00:00.000Z';
  return person;
}

function buildEpisode(): EpisodeResponseDto {
  const episode = new EpisodeResponseDto();
  episode.id = 'ep1';
  episode.personId = 'p1';
  episode.facilityId = 'f1';
  episode.lmpDate = '2026-01-01';
  episode.estimatedDeliveryDate = '2026-10-08';
  episode.gestationalAgeWeeks = 20;
  episode.riskBand = 'low';
  episode.status = 'Active';
  episode.createdAt = '2026-08-01T00:00:00.000Z';
  episode.updatedAt = '2026-08-01T00:00:00.000Z';
  return episode;
}

describe('ProfileContextService', () => {
  it('assembles a full context from risk, tasks, and referral reads', async () => {
    const riskAssessment = new RiskAssessmentResponseDto();
    riskAssessment.finalRiskBand = 'medium';

    const task = new CareTaskResponseDto();
    task.taskType = 'anc_visit';
    task.dueAt = '2026-09-01T00:00:00.000Z';
    task.status = 'Scheduled';

    const referral = new ReferralResponseDto();
    referral.status = 'Sent';

    const riskService = {
      getLatestForEpisodeAsSystem: jest.fn().mockResolvedValue(riskAssessment),
    } as unknown as RiskService;
    const tasksService = {
      listUpcomingForEpisodeAsSystem: jest.fn().mockResolvedValue([task]),
    } as unknown as TasksService;
    const referralService = {
      getLatestForEpisodeAsSystem: jest.fn().mockResolvedValue(referral),
    } as unknown as ReferralService;

    const service = new ProfileContextService(riskService, tasksService, referralService);
    const context = await service.assemble(buildPerson(), buildEpisode());

    expect(context).toEqual({
      firstName: 'Amina',
      episodeStatus: 'Active',
      estimatedDeliveryDate: '2026-10-08',
      gestationalAgeWeeks: 20,
      riskBand: 'medium',
      upcomingTasks: [{ taskType: 'anc_visit', dueAt: '2026-09-01T00:00:00.000Z', status: 'Scheduled' }],
      latestReferralStatus: 'Sent',
    });
  });

  it("falls back to the episode's own risk_band when no risk_assessment row exists yet", async () => {
    const riskService = {
      getLatestForEpisodeAsSystem: jest.fn().mockResolvedValue(null),
    } as unknown as RiskService;
    const tasksService = {
      listUpcomingForEpisodeAsSystem: jest.fn().mockResolvedValue([]),
    } as unknown as TasksService;
    const referralService = {
      getLatestForEpisodeAsSystem: jest.fn().mockResolvedValue(null),
    } as unknown as ReferralService;

    const service = new ProfileContextService(riskService, tasksService, referralService);
    const context = await service.assemble(buildPerson(), buildEpisode());

    expect(context.riskBand).toBe('low');
    expect(context.upcomingTasks).toEqual([]);
    expect(context.latestReferralStatus).toBeNull();
  });
});
