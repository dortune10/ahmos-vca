import { MessageRouterService } from './message-router.service';
import { EpisodeService } from '../episode/episode.service';
import { DangerSignMatcherService } from '../ai-assistant/danger-sign-matcher.service';
import { EscalationService } from '../ai-assistant/escalation.service';
import { ProfileContextService } from '../ai-assistant/profile-context.service';
import { AiAssistantService } from '../ai-assistant/ai-assistant.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';
import { ProfileContext } from '../ai-assistant/profile-context.service';

function buildPerson(whatsappConsent = true): PersonResponseDto {
  const person = new PersonResponseDto();
  person.id = 'p1';
  person.tenantId = 't1';
  person.firstName = 'Amina';
  person.lastName = null;
  person.phonePrimary = '+254700000001';
  person.dateOfBirth = null;
  person.whatsappConsent = whatsappConsent;
  person.whatsappConsentAt = whatsappConsent ? '2026-08-01T00:00:00.000Z' : null;
  person.whatsappVerifiedPhone = '254700000001';
  person.whatsappVerifiedAt = '2026-08-01T00:00:00.000Z';
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

const emptyContext: ProfileContext = {
  firstName: 'Amina',
  episodeStatus: 'Active',
  estimatedDeliveryDate: '2026-10-08',
  gestationalAgeWeeks: 20,
  riskBand: 'low',
  upcomingTasks: [],
  latestReferralStatus: null,
};

describe('MessageRouterService', () => {
  function buildRouter(episode: EpisodeResponseDto | null, matched: boolean) {
    const episodeService = {
      getActiveForPersonAsSystem: jest.fn().mockResolvedValue(episode),
    } as unknown as EpisodeService;
    const dangerSignMatcher = {
      match: jest.fn().mockReturnValue({ matched, matchedKeywords: matched ? ['bleeding'] : [] }),
    } as unknown as DangerSignMatcherService;
    const escalationService = {
      escalate: jest.fn().mockResolvedValue('urgent care reply'),
    } as unknown as EscalationService;
    const profileContextService = {
      assemble: jest.fn().mockResolvedValue(emptyContext),
    } as unknown as ProfileContextService;
    const aiAssistantService = {
      answer: jest.fn().mockResolvedValue('AI reply'),
    } as unknown as AiAssistantService;

    const router = new MessageRouterService(
      episodeService,
      dangerSignMatcher,
      escalationService,
      profileContextService,
      aiAssistantService,
    );
    return { router, episodeService, dangerSignMatcher, escalationService, profileContextService, aiAssistantService };
  }

  it('bypasses profile context assembly and the AI entirely when a danger sign is matched', async () => {
    const { router, escalationService, profileContextService, aiAssistantService } = buildRouter(buildEpisode(), true);

    const reply = await router.route(
      { person: buildPerson(), channelVerified: true },
      'I have heavy bleeding',
    );

    expect(reply).toBe('urgent care reply');
    expect(escalationService.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'ep1' }),
      ['bleeding'],
      'I have heavy bleeding',
    );
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });

  it('escalates even when there is no active episode (episode may be null)', async () => {
    const { router, escalationService } = buildRouter(null, true);

    await router.route({ person: buildPerson(), channelVerified: true }, 'seizure just now');

    expect(escalationService.escalate).toHaveBeenCalledWith(expect.objectContaining({ id: 'p1' }), null, ['bleeding'], 'seizure just now');
  });

  it('returns a fixed message when there is no active episode and no danger sign matched', async () => {
    const { router, profileContextService, aiAssistantService } = buildRouter(null, false);

    const reply = await router.route(
      { person: buildPerson(), channelVerified: true },
      'When is my next appointment?',
    );

    expect(reply).toContain("couldn't find an active pregnancy record");
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });

  it('assembles profile context and calls the AI assistant for a normal question with an active episode', async () => {
    const { router, profileContextService, aiAssistantService } = buildRouter(buildEpisode(), false);

    const reply = await router.route(
      { person: buildPerson(), channelVerified: true },
      'When is my next appointment?',
    );

    expect(reply).toBe('AI reply');
    expect(profileContextService.assemble).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'ep1' }),
    );
    expect(aiAssistantService.answer).toHaveBeenCalledWith(emptyContext, 'When is my next appointment?', {
      tenantId: 't1',
      personId: 'p1',
    });
  });

  // A failing episode read must degrade the escalation, never cancel it.
  it('still escalates when the episode lookup throws', async () => {
    const { router, escalationService, episodeService } = buildRouter(buildEpisode(), true);
    (episodeService.getActiveForPersonAsSystem as jest.Mock).mockRejectedValue(new Error('db down'));

    const reply = await router.route(
      { person: buildPerson(), channelVerified: true },
      'I have heavy bleeding',
    );

    expect(reply).toBe('urgent care reply');
    expect(escalationService.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      null,
      ['bleeding'],
      'I have heavy bleeding',
    );
  });

  // docs/DECISIONS.md #27, the headline case: a registered woman whose FIRST EVER message is a
  // danger sign must get the emergency instruction and a real urgent care_task, not just an
  // opt-in prompt. The consent gate below must not stand in front of this branch.
  it('escalates a danger-sign message from a person who has not consented yet', async () => {
    const { router, escalationService, profileContextService, aiAssistantService } = buildRouter(
      buildEpisode(),
      true,
    );

    const reply = await router.route(
      { person: buildPerson(false), channelVerified: true },
      'I have heavy bleeding',
    );

    expect(reply).toBe('urgent care reply');
    expect(escalationService.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1', whatsappConsent: false }),
      expect.objectContaining({ id: 'ep1' }),
      ['bleeding'],
      'I have heavy bleeding',
    );
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });

  // docs/DECISIONS.md #28, the same headline case one notch harder: her handset has never been
  // verified either, which at rollout is true of literally everyone. The emergency path must
  // still be wide open — a gate that suppressed this would silently disable the #27 safety net
  // for the entire population on day one.
  it('escalates a danger-sign message from an unverified handset', async () => {
    const { router, escalationService, profileContextService, aiAssistantService } = buildRouter(
      buildEpisode(),
      true,
    );

    const reply = await router.route(
      { person: buildPerson(false), channelVerified: false },
      'I have heavy bleeding',
    );

    expect(reply).toBe('urgent care reply');
    expect(escalationService.escalate).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'p1' }),
      expect.objectContaining({ id: 'ep1' }),
      ['bleeding'],
      'I have heavy bleeding',
    );
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });

  // The other half of decision #27: ONLY the danger-sign path moved ahead of the gate. General
  // Q&A stays strictly consent-gated, and nothing about her record is even read before she
  // opts in. Returning null is what tells Plan 1's controller to send the opt-in prompt alone.
  it('returns null for an ordinary question from a person who has not consented, touching no record and no AI', async () => {
    const { router, episodeService, escalationService, profileContextService, aiAssistantService } =
      buildRouter(buildEpisode(), false);

    const reply = await router.route(
      { person: buildPerson(false), channelVerified: true },
      'When is my next appointment?',
    );

    expect(reply).toBeNull();
    expect(escalationService.escalate).not.toHaveBeenCalled();
    expect(episodeService.getActiveForPersonAsSystem).not.toHaveBeenCalled();
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });

  // The other half of decision #28. Consent alone does not open the record: an ordinary
  // question from a handset nobody has proved belongs to her reads nothing and answers
  // nothing. Returning null is what tells Plan 1's controller to send the enrolment prompt
  // alone.
  it('returns null for an ordinary question from an unverified handset, touching no record and no AI', async () => {
    const { router, episodeService, escalationService, profileContextService, aiAssistantService } =
      buildRouter(buildEpisode(), false);

    const reply = await router.route(
      { person: buildPerson(true), channelVerified: false },
      'When is my next appointment?',
    );

    expect(reply).toBeNull();
    expect(escalationService.escalate).not.toHaveBeenCalled();
    expect(episodeService.getActiveForPersonAsSystem).not.toHaveBeenCalled();
    expect(profileContextService.assemble).not.toHaveBeenCalled();
    expect(aiAssistantService.answer).not.toHaveBeenCalled();
  });
});
