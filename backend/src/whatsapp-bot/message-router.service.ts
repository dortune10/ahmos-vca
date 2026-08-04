import { Injectable } from '@nestjs/common';
import { PersonResponseDto } from '../identity/dto/person-response.dto';

export interface MessageRouterContext {
  person: PersonResponseDto;
  // docs/DECISIONS.md #28: whether the handset this message came from has actually been proven
  // to belong to this person, as opposed to merely matching her stored phone_primary. Computed
  // by the webhook controller via isChannelVerified() and passed in, so the router never has to
  // know about wa_id formats.
  channelVerified: boolean;
}

// STUB — replaced entirely by
// docs/superpowers/plans/2026-08-01-whatsapp-ai-assistant-escalation.md's Task 8, which
// swaps this method's body for real danger-sign detection + AI Q&A routing. The signature
// (route(context, inboundText): Promise<string | null>) never changes, so the webhook
// controller that calls this needs no changes when that happens.
//
// The `null` return is the gate seam (docs/DECISIONS.md #27, #28). The controller does not
// short-circuit on either gate: it hands EVERY message from a known person here — verified or
// not, consented or not — and this method decides whether it has anything to say. Plan 1 has no
// danger-sign detection, so there is nothing safe to say to a person whose handset is
// unproven or who has not opted in: return null, and the controller sends the enrolment prompt
// or the opt-in prompt on its own. Plan 2's replacement runs the danger-sign check AHEAD of
// both checks below and returns the urgent-care text on a match; general AI Q&A stays behind
// both either way.
@Injectable()
export class MessageRouterService {
  async route(context: MessageRouterContext, _inboundText: string): Promise<string | null> {
    if (!context.channelVerified) {
      return null;
    }
    if (!context.person.whatsappConsent) {
      return null;
    }
    return (
      "Thanks for your message. This assistant is still being set up — please contact your " +
      'community health worker or clinic for help in the meantime.'
    );
  }
}
