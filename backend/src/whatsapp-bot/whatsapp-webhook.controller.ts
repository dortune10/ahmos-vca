import { Body, Controller, Get, Logger, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { timingSafeEqual } from 'crypto';
import { IdentityService, AmbiguousPersonMatchError } from '../identity/identity.service';
import { ConversationService } from './conversation.service';
import { WhatsAppClientService } from './whatsapp-client.service';
import { WhatsAppSignatureGuard } from './whatsapp-signature.guard';
import { WhatsAppSenderThrottlerGuard } from './whatsapp-sender-throttler.guard';
import { MessageRouterService } from './message-router.service';
import { AuditService } from '../audit/audit.service';
import { extractInboundMessage } from './extract-inbound-message';
import { PersonResponseDto } from '../identity/dto/person-response.dto';

const UNREGISTERED_DECLINE_MESSAGE =
  "We couldn't find your details in our system yet. Please contact your community health " +
  'worker or nearest clinic to get registered, then message us again.';

// Deliberately does NOT mention pregnancy. This is sent to whoever holds the handset before
// any consent exists, on the strength of a phone-number match alone — on a recycled or shared
// SIM that would otherwise disclose the previous owner's pregnancy status to a stranger.
const CONSENT_OPT_IN_MESSAGE =
  'Welcome! Reply YES to receive messages from your health clinic through this assistant, ' +
  'or STOP to opt out at any time. Standard message rates may apply.';

const CONSENT_THANK_YOU_MESSAGE =
  "Thanks — you're now opted in. Ask me about your next appointment, care tasks, risk " +
  'level, or referral status any time. Reply STOP at any time to opt out.';

const OPT_OUT_CONFIRMATION_MESSAGE =
  "You've been opted out and won't receive further automated messages. Reply YES at any " +
  'time to opt back in. For urgent concerns, contact your health worker or nearest clinic.';

// Sent when we cannot safely identify or serve the sender. Never leaves someone with silence.
const SAFE_FALLBACK_MESSAGE =
  "Sorry — we couldn't process your message. If this is urgent, please contact your health " +
  'worker or go to your nearest health facility now.';

function isConsentYes(text: string): boolean {
  return text.trim().toUpperCase() === 'YES';
}

// WhatsApp Business Policy requires an honoured opt-out; ignoring STOP is grounds for the
// business number being restricted, which takes the whole channel down.
const OPT_OUT_KEYWORDS = ['STOP', 'UNSUBSCRIBE', 'CANCEL', 'END', 'QUIT'];
function isOptOut(text: string): boolean {
  return OPT_OUT_KEYWORDS.includes(text.trim().toUpperCase());
}

// Constant-time string compare, so the verify token can't be recovered a byte at a time.
function safeEqual(a: string | undefined, b: string | undefined): boolean {
  if (!a || !b) {
    return false;
  }
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  return aBuf.length === bBuf.length && timingSafeEqual(aBuf, bBuf);
}

@Controller('whatsapp/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly identityService: IdentityService,
    private readonly conversationService: ConversationService,
    private readonly whatsAppClient: WhatsAppClientService,
    private readonly auditService: AuditService,
    private readonly messageRouter: MessageRouterService,
  ) {}

  @Get()
  verify(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
    @Res() res: Response,
  ): void {
    if (mode === 'subscribe' && safeEqual(token, process.env.WHATSAPP_VERIFY_TOKEN)) {
      // .type('text/plain') is required, not cosmetic: hub.challenge is attacker-controlled
      // and Express defaults res.send(string) to text/html, which would make this a reflected
      // XSS on the API origin for anyone who guesses the verify token.
      res.status(200).type('text/plain').send(String(challenge));
      return;
    }
    res.status(403).type('text/plain').send('Webhook verification failed');
  }

  @Post()
  // Guard order matters: the signature guard runs first, so an unsigned request is rejected
  // before it can consume any sender's rate-limit budget.
  @UseGuards(WhatsAppSignatureGuard, WhatsAppSenderThrottlerGuard)
  async receive(@Body() payload: unknown): Promise<{ status: string }> {
    const inbound = extractInboundMessage(payload);
    if (!inbound) {
      return { status: 'ignored' };
    }

    // Outermost safety net. Any unexpected throw below must still leave the sender with a
    // reply and must still return 2xx — a non-2xx makes Meta retry the whole delivery, and
    // silence is the worst possible outcome on a maternal-health channel.
    try {
      return await this.handleInbound(inbound);
    } catch (err) {
      this.logger.error(
        `Unhandled error processing inbound WhatsApp message ${inbound.whatsappMessageId}`,
        err instanceof Error ? err.stack : String(err),
      );
      await this.trySendFallback(inbound.from);
      return { status: 'error_handled' };
    }
  }

  private async trySendFallback(to: string): Promise<void> {
    try {
      await this.whatsAppClient.sendTextMessage(to, SAFE_FALLBACK_MESSAGE);
    } catch (sendErr) {
      this.logger.error(
        'Failed to send fallback message',
        sendErr instanceof Error ? sendErr.stack : String(sendErr),
      );
    }
  }

  private async handleInbound(
    inbound: { from: string; text: string; whatsappMessageId: string },
  ): Promise<{ status: string }> {
    // Idempotency: Meta re-delivers any webhook that does not return 2xx, and its signature
    // carries no timestamp or nonce, so the same payload can arrive repeatedly. Dropping the
    // duplicate here is what stops one retried danger-sign message from becoming N urgent
    // care_tasks and N Claude calls downstream (Plan 2).
    if (
      inbound.whatsappMessageId &&
      (await this.conversationService.hasMessageWithWhatsAppId(inbound.whatsappMessageId))
    ) {
      return { status: 'duplicate_ignored' };
    }

    // No tenantId exists yet for an unregistered number — audit_event.tenant_id is NOT NULL,
    // so a genuinely unmatched inbound message cannot be written to the tenant audit trail.
    // Logged via the operational logger only; see this plan's "Adaptations to Existing
    // Modules" section.
    let person: PersonResponseDto | null;
    try {
      person = await this.identityService.findByPhoneAsSystem(inbound.from);
    } catch (err) {
      if (err instanceof AmbiguousPersonMatchError) {
        // Two tenants hold the same phone_primary. There is no UNIQUE constraint on that
        // column (see "Adaptations to Existing Modules"), and IdentityService.create's
        // duplicate check is RLS-scoped to one tenant, so this is reachable in practice.
        // Failing closed on the data is right; failing closed with a silent 500 on a
        // maternal-emergency channel is not — reply, log loudly, and return 2xx so Meta
        // stops retrying. Never auto-pick a row.
        this.logger.error(
          `Ambiguous person match for inbound WhatsApp message ${inbound.whatsappMessageId}: ` +
            `${err.matchCount} person rows share this phone number. Manual data fix required.`,
        );
        await this.trySendFallback(inbound.from);
        return { status: 'declined_ambiguous' };
      }
      throw err;
    }

    if (!person) {
      await this.whatsAppClient.sendTextMessage(inbound.from, UNREGISTERED_DECLINE_MESSAGE);
      return { status: 'declined_unregistered' };
    }

    const conversation = await this.conversationService.getOrCreateConversation(person.id);
    await this.conversationService.appendMessage(conversation.id, 'inbound', inbound.text, inbound.whatsappMessageId);

    // Opt-out is checked ahead of everything else so STOP is honoured in every state, and it
    // is TERMINAL for this message: no router call, no danger-sign check, no opt-in re-prompt.
    // isOptOut matches a whole-message keyword only, so "STOP I am bleeding" is not an opt-out
    // and falls through to the router below — see this plan's "STOP/opt-out vs. danger signs"
    // note in "Adaptations to Existing Modules" for the full reasoning, including why a *later*
    // message from a revoked person is treated exactly like one from a never-consented person.
    if (isOptOut(inbound.text)) {
      await this.identityService.revokeWhatsAppConsentAsSystem(person.id);
      await this.auditService.log({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'person',
        entityId: person.id,
        action: 'whatsapp_consent_revoked',
        metadata: { conversationId: conversation.id },
      });
      const sendResult = await this.whatsAppClient.sendTextMessage(inbound.from, OPT_OUT_CONFIRMATION_MESSAGE);
      await this.conversationService.appendMessage(conversation.id, 'outbound', OPT_OUT_CONFIRMATION_MESSAGE, sendResult.whatsappMessageId);
      return { status: 'consent_revoked' };
    }

    // A bare YES is the answer to the consent prompt, not a question — also terminal, and it
    // cannot contain a danger sign, so nothing is lost by not routing it.
    if (!person.whatsappConsent && isConsentYes(inbound.text)) {
      const consentedAt = new Date().toISOString();
      await this.identityService.markWhatsAppConsentAsSystem(person.id, consentedAt);
      await this.auditService.log({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'person',
        entityId: person.id,
        action: 'whatsapp_consent_granted',
        metadata: { consentedAt },
      });
      const sendResult = await this.whatsAppClient.sendTextMessage(inbound.from, CONSENT_THANK_YOU_MESSAGE);
      await this.conversationService.appendMessage(conversation.id, 'outbound', CONSENT_THANK_YOU_MESSAGE, sendResult.whatsappMessageId);
      return { status: 'consent_granted' };
    }

    // Everything else goes to the router, CONSENTED OR NOT. This is the decision #27 seam and
    // a deliberate deviation from the approved design spec's Section 5 step order (consent
    // step 3 -> danger sign step 4): under the spec order, a registered woman whose first ever
    // message is "I have heavy bleeding" would get only an opt-in prompt. The router owns the
    // rule, not this controller:
    //   * consented     -> always returns reply text
    //   * not consented -> returns text ONLY if it escalated a danger sign, otherwise null
    // General AI Q&A stays strictly behind the consent gate inside the router. Because the
    // router owns it, this controller needs ZERO changes when Plan 2 replaces the stub body.
    const replyText = await this.messageRouter.route({ person }, inbound.text);

    if (replyText !== null) {
      const sendResult = await this.whatsAppClient.sendTextMessage(inbound.from, replyText);
      await this.conversationService.appendMessage(conversation.id, 'outbound', replyText, sendResult.whatsappMessageId);
      // Audit metadata carries FOREIGN KEYS, never the message text. audit_event is append-only
      // by design (no delete policy, 00000000000003_audit_event.sql) and readable tenant-wide by
      // every authenticated user, so verbatim patient free text written here would be
      // permanently un-erasable and exposed to a wider audience than the clinical tables. The
      // text already lives in `message`, which is correctable and deletable — reviewers read it
      // from there via conversationId.
      await this.auditService.log({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'conversation',
        entityId: conversation.id,
        action: 'message_answered',
        metadata: {
          conversationId: conversation.id,
          whatsappMessageId: inbound.whatsappMessageId,
        },
      });
    }

    if (!person.whatsappConsent) {
      // Sent AFTER any router reply, so an emergency instruction is the first thing she reads
      // and the consent housekeeping follows it. An escalation does not grant consent — she
      // still has to opt in before this channel will answer anything about her record.
      const sendResult = await this.whatsAppClient.sendTextMessage(inbound.from, CONSENT_OPT_IN_MESSAGE);
      await this.conversationService.appendMessage(conversation.id, 'outbound', CONSENT_OPT_IN_MESSAGE, sendResult.whatsappMessageId);
      await this.auditService.log({
        tenantId: person.tenantId,
        actorUserId: null,
        entityType: 'person',
        entityId: person.id,
        action: 'whatsapp_consent_prompted',
        metadata: {},
      });
      return { status: replyText !== null ? 'escalated_consent_pending' : 'consent_pending' };
    }

    return { status: 'answered' };
  }
}
