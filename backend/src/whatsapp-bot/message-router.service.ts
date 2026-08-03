import { Injectable } from '@nestjs/common';
import { PersonResponseDto } from '../identity/dto/person-response.dto';

export interface MessageRouterContext {
  person: PersonResponseDto;
}

// STUB — replaced entirely by
// docs/superpowers/plans/2026-08-01-whatsapp-ai-assistant-escalation.md's Task 8, which
// swaps this method's body for real danger-sign detection + AI Q&A routing. The signature
// (route(context, inboundText): Promise<string | null>) never changes, so the webhook
// controller that calls this needs no changes when that happens.
//
// The `null` return is the consent seam (docs/DECISIONS.md #27). The controller no longer
// short-circuits on the consent gate: it hands EVERY message from a known person here,
// consented or not, and this method decides whether it has anything to say. Plan 1 has no
// danger-sign detection, so there is nothing safe to say to a person who has not opted in —
// return null and the controller sends the opt-in prompt on its own, which is byte-for-byte
// the behaviour this plan had before the delegation was introduced. Plan 2's replacement runs
// the danger-sign check ahead of this consent check, and returns the urgent-care text on a
// match; general AI Q&A stays behind the check either way.
@Injectable()
export class MessageRouterService {
  async route(context: MessageRouterContext, _inboundText: string): Promise<string | null> {
    if (!context.person.whatsappConsent) {
      return null;
    }
    return (
      "Thanks for your message. This assistant is still being set up — please contact your " +
      'community health worker or clinic for help in the meantime.'
    );
  }
}
