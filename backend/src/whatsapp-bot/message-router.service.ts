import { Injectable, Logger } from '@nestjs/common';
import { EpisodeService } from '../episode/episode.service';
import { DangerSignMatcherService } from '../ai-assistant/danger-sign-matcher.service';
import { EscalationService } from '../ai-assistant/escalation.service';
import { ProfileContextService } from '../ai-assistant/profile-context.service';
import { AiAssistantService } from '../ai-assistant/ai-assistant.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';
import { EpisodeResponseDto } from '../episode/dto/episode-response.dto';

export interface MessageRouterContext {
  person: PersonResponseDto;
  // docs/DECISIONS.md #28: whether the handset this message came from has actually been proven
  // to belong to this person with a staff-issued enrolment code, as opposed to merely matching
  // her stored phone_primary. Computed and passed in by the webhook controller, so the router
  // never has to know about wa_id formats.
  channelVerified: boolean;
}

const NO_ACTIVE_EPISODE_MESSAGE =
  "We couldn't find an active pregnancy record linked to your number. Please contact your " +
  'community health worker or clinic if you believe this is a mistake.';

@Injectable()
export class MessageRouterService {
  private readonly logger = new Logger(MessageRouterService.name);

  constructor(
    private readonly episodeService: EpisodeService,
    private readonly dangerSignMatcher: DangerSignMatcherService,
    private readonly escalationService: EscalationService,
    private readonly profileContextService: ProfileContextService,
    private readonly aiAssistantService: AiAssistantService,
  ) {}

  async route(context: MessageRouterContext, inboundText: string): Promise<string | null> {
    const { person } = context;

    // The danger-sign check runs FIRST, before any I/O AND before BOTH gates below.
    // Four reasons: docs/DECISIONS.md #8 requires that danger-sign language never reaches the
    // LLM; docs/DECISIONS.md #27 requires that a known person's danger-sign message escalates
    // whether or not she has opted in yet (under the design spec's literal Section 5 ordering,
    // a registered woman whose first ever message is "I have heavy bleeding" would have
    // received nothing but an opt-in prompt); docs/DECISIONS.md #28 requires the same
    // regardless of whether her handset has been verified (at rollout nobody is verified, so a
    // verification check here would disable the #27 safety net for everyone at once); and
    // nothing that can fail should stand between a
    // woman describing an emergency and the system recognising it. The episode read below is
    // best-effort for exactly that reason. Do not move either gate above this block.
    const danger = this.dangerSignMatcher.match(inboundText);

    if (danger.matched) {
      let episode: EpisodeResponseDto | null = null;
      try {
        episode = await this.episodeService.getActiveForPersonAsSystem(person.id);
      } catch (err) {
        // escalate() already handles a null episode by returning the "go to your nearest
        // health facility now" text. A failed episode lookup must degrade the escalation,
        // never cancel it.
        this.logger.error(
          `Episode lookup failed during danger-sign escalation for person ${person.id}; ` +
            'escalating without an episode.',
          err instanceof Error ? err.stack : String(err),
        );
      }
      return this.escalationService.escalate(person, episode, danger.matchedKeywords, inboundText);
    }

    // Everything below is general Q&A, which stays STRICTLY behind BOTH gates — decisions #27
    // and #28 moved the danger-sign path ahead of them and nothing else. Returning null tells
    // the webhook controller to send the outstanding prompt on its own and nothing more:
    // no episode read, no profile context, no Claude call, nothing about her record touched or
    // disclosed.
    //
    // Verification is checked before consent, matching the order the controller prompts in: a
    // "YES" typed on a handset nobody has proved belongs to her records consent against the
    // wrong human, so there is no point treating her as consented until the handset is proved.
    if (!context.channelVerified) {
      return null;
    }
    if (!person.whatsappConsent) {
      return null;
    }

    const episode = await this.episodeService.getActiveForPersonAsSystem(person.id);
    if (!episode) {
      return NO_ACTIVE_EPISODE_MESSAGE;
    }

    const profileContext = await this.profileContextService.assemble(person, episode);
    return this.aiAssistantService.answer(profileContext, inboundText, {
      tenantId: person.tenantId,
      personId: person.id,
    });
  }
}
