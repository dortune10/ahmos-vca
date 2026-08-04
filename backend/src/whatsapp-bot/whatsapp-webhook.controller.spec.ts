import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { IdentityService, AmbiguousPersonMatchError } from '../identity/identity.service';
import { ConversationService } from './conversation.service';
import { WhatsAppClientService } from './whatsapp-client.service';
import { AuditService } from '../audit/audit.service';
import { MessageRouterService } from './message-router.service';
import { PersonResponseDto } from '../identity/dto/person-response.dto';

function buildPayloadWithText(from: string, text: string) {
  return {
    entry: [{ changes: [{ value: { messages: [{ from, id: 'wamid.1', type: 'text', text: { body: text } }] } }] }],
  };
}

function buildPerson(overrides: Partial<PersonResponseDto>): PersonResponseDto {
  const person = new PersonResponseDto();
  person.id = 'p1';
  person.tenantId = 't1';
  person.firstName = 'Amina';
  person.lastName = null;
  person.phonePrimary = '+254700000001';
  person.dateOfBirth = null;
  person.whatsappConsent = false;
  person.whatsappConsentAt = null;
  // Verified against the same wa_id every test in this file sends from, so all twelve tests
  // written in Task 7 keep exercising the branch they were written for. The
  // channel-verification tests below override it explicitly.
  person.whatsappVerifiedPhone = '254700000001';
  person.whatsappVerifiedAt = '2026-08-01T00:00:00.000Z';
  return Object.assign(person, overrides);
}

describe('WhatsAppWebhookController.receive', () => {
  function buildController(person: PersonResponseDto | null, lookupError?: Error) {
    const identityService = {
      findByPhoneAsSystem: lookupError
        ? jest.fn().mockRejectedValue(lookupError)
        : jest.fn().mockResolvedValue(person),
      markWhatsAppConsentAsSystem: jest.fn().mockResolvedValue(undefined),
      revokeWhatsAppConsentAsSystem: jest.fn().mockResolvedValue(undefined),
      redeemWhatsAppEnrolmentCodeAsSystem: jest
        .fn()
        .mockResolvedValue({ outcome: 'verified', attemptsRemaining: 5 }),
    } as unknown as IdentityService;
    const conversationService = {
      getOrCreateConversation: jest.fn().mockResolvedValue({ id: 'conv-1', personId: person?.id }),
      appendMessage: jest.fn().mockResolvedValue(undefined),
      hasMessageWithWhatsAppId: jest.fn().mockResolvedValue(false),
    } as unknown as ConversationService;
    const whatsAppClient = {
      sendTextMessage: jest.fn().mockResolvedValue({ whatsappMessageId: 'wamid.reply' }),
    } as unknown as WhatsAppClientService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const messageRouter = {
      route: jest.fn().mockResolvedValue('routed reply'),
    } as unknown as MessageRouterService;

    const controller = new WhatsAppWebhookController(
      identityService,
      conversationService,
      whatsAppClient,
      auditService,
      messageRouter,
    );
    return { controller, identityService, conversationService, whatsAppClient, auditService, messageRouter };
  }

  it('declines and does not persist anything for an unregistered number', async () => {
    const { controller, whatsAppClient, conversationService } = buildController(null);

    const result = await controller.receive(buildPayloadWithText('254799999999', 'hello'));

    expect(result).toEqual({ status: 'declined_unregistered' });
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254799999999',
      expect.stringContaining('contact your community health worker'),
    );
    expect(conversationService.getOrCreateConversation).not.toHaveBeenCalled();
  });

  // Decision #27's "no danger sign, no consent yet" case: the router IS consulted (it is the
  // thing that would have escalated), it declines with null, and the ONLY message she receives
  // is the opt-in prompt — no AI, no profile data, exactly the pre-#27 behaviour.
  it('sends only the opt-in prompt when the router declines for a known, not-yet-consented person', async () => {
    const person = buildPerson({ whatsappConsent: false });
    const { controller, whatsAppClient, identityService, messageRouter } = buildController(person);
    (messageRouter.route as jest.Mock).mockResolvedValue(null);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'hello there'));

    expect(result).toEqual({ status: 'consent_pending' });
    expect(messageRouter.route).toHaveBeenCalledWith({ person, channelVerified: true }, 'hello there');
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining('Reply YES'),
    );
    expect(identityService.markWhatsAppConsentAsSystem).not.toHaveBeenCalled();
  });

  // Decision #27's headline case, expressed at this plan's level of knowledge: when the router
  // DOES return a reply for someone who has not consented — which in Plan 2 means a danger sign
  // was matched, escalated, and an urgent care_task created — the controller must send that
  // reply FIRST and then still send the opt-in prompt. Plan 1's own stub never takes this
  // branch (it always returns null for a non-consented person), so the router is mocked here;
  // Plan 2's e2e proves the same path against the real matcher and a real care_task row.
  it('sends the router reply first and then still prompts for opt-in when the person has not consented', async () => {
    const person = buildPerson({ whatsappConsent: false });
    const { controller, whatsAppClient, conversationService, identityService, auditService } =
      buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'I have heavy bleeding'));

    expect(result).toEqual({ status: 'escalated_consent_pending' });
    expect((whatsAppClient.sendTextMessage as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      'routed reply',
      expect.stringContaining('Reply YES'),
    ]);
    expect(conversationService.appendMessage).toHaveBeenCalledWith('conv-1', 'outbound', 'routed reply', 'wamid.reply');
    // An escalation is not consent. She still has to opt in for ongoing messaging.
    expect(identityService.markWhatsAppConsentAsSystem).not.toHaveBeenCalled();
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_consent_prompted' }),
    );
  });

  it('records consent and sends a thank-you when a not-yet-consented person replies YES', async () => {
    const person = buildPerson({ whatsappConsent: false });
    const { controller, identityService, whatsAppClient, auditService, messageRouter } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'YES'));

    expect(result).toEqual({ status: 'consent_granted' });
    expect(identityService.markWhatsAppConsentAsSystem).toHaveBeenCalledWith('p1', expect.any(String));
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining("you're now opted in"),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_consent_granted', entityId: 'p1' }),
    );
    // A bare YES is the answer to the consent prompt, not a question — it is terminal and
    // never reaches the router.
    expect(messageRouter.route).not.toHaveBeenCalled();
  });

  it('routes to MessageRouterService and sends its reply for an already-consented person', async () => {
    const person = buildPerson({ whatsappConsent: true, whatsappConsentAt: '2026-08-01T00:00:00.000Z' });
    const { controller, messageRouter, whatsAppClient, conversationService } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'When is my next appointment?'));

    expect(result).toEqual({ status: 'answered' });
    expect(messageRouter.route).toHaveBeenCalledWith(
      { person, channelVerified: true },
      'When is my next appointment?',
    );
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith('254700000001', 'routed reply');
    expect(conversationService.appendMessage).toHaveBeenCalledWith('conv-1', 'outbound', 'routed reply', 'wamid.reply');
  });

  it('ignores a payload with no extractable message (e.g. a status callback)', async () => {
    const { controller, conversationService } = buildController(null);
    const result = await controller.receive({ entry: [{ changes: [{ value: { statuses: [] } }] }] });
    expect(result).toEqual({ status: 'ignored' });
    expect(conversationService.getOrCreateConversation).not.toHaveBeenCalled();
  });

  // Pins the phone-format contract at the seam: the controller passes Meta's bare wa_id
  // straight through, and IdentityService.findByPhoneAsSystem is what normalizes it.
  it('passes the raw wa_id through to the identity lookup and replies to that same address', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, identityService, whatsAppClient } = buildController(person);

    await controller.receive(buildPayloadWithText('254700000001', 'hello'));

    expect(identityService.findByPhoneAsSystem).toHaveBeenCalledWith('254700000001');
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith('254700000001', expect.any(String));
  });

  it('drops a redelivered message with a whatsapp id already stored, doing no further work', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, conversationService, messageRouter, whatsAppClient } = buildController(person);
    (conversationService.hasMessageWithWhatsAppId as jest.Mock).mockResolvedValue(true);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'hello again'));

    expect(result).toEqual({ status: 'duplicate_ignored' });
    expect(messageRouter.route).not.toHaveBeenCalled();
    expect(whatsAppClient.sendTextMessage).not.toHaveBeenCalled();
    expect(conversationService.appendMessage).not.toHaveBeenCalled();
  });

  it('declines gracefully (no throw) when the phone number matches more than one person', async () => {
    const { controller, whatsAppClient, messageRouter } = buildController(
      null,
      new AmbiguousPersonMatchError('254700000001', 2),
    );

    const result = await controller.receive(buildPayloadWithText('254700000001', 'hello'));

    expect(result).toEqual({ status: 'declined_ambiguous' });
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining('nearest health facility'),
    );
    expect(messageRouter.route).not.toHaveBeenCalled();
  });

  it('revokes consent and confirms when a consented person replies STOP', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, identityService, whatsAppClient, messageRouter } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'STOP'));

    expect(result).toEqual({ status: 'consent_revoked' });
    expect(identityService.revokeWhatsAppConsentAsSystem).toHaveBeenCalledWith('p1');
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining('opted out'),
    );
    expect(messageRouter.route).not.toHaveBeenCalled();
  });

  it('still replies and returns 2xx when the router throws unexpectedly', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, messageRouter, whatsAppClient } = buildController(person);
    (messageRouter.route as jest.Mock).mockRejectedValue(new Error('router exploded'));

    const result = await controller.receive(buildPayloadWithText('254700000001', 'hello'));

    expect(result).toEqual({ status: 'error_handled' });
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining('nearest health facility'),
    );
  });

  it('does not log verbatim patient text into the audit trail', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, auditService } = buildController(person);

    await controller.receive(buildPayloadWithText('254700000001', 'I am bleeding heavily'));

    const answeredCall = (auditService.log as jest.Mock).mock.calls
      .map((c) => c[0])
      .find((entry) => entry.action === 'message_answered');
    expect(answeredCall).toBeDefined();
    expect(JSON.stringify(answeredCall.metadata)).not.toContain('bleeding');
  });

  // docs/DECISIONS.md #28. An unverified handset is one whose owner has never proved the phone
  // is theirs — the normal state for a shared or borrowed household phone. She still gets the
  // router's verdict (that is what would escalate a danger sign), but nothing about her record.
  it('sends only the enrolment prompt for a known person whose handset is not verified', async () => {
    const person = buildPerson({ whatsappConsent: true, whatsappVerifiedPhone: null, whatsappVerifiedAt: null });
    const { controller, whatsAppClient, messageRouter, identityService } = buildController(person);
    (messageRouter.route as jest.Mock).mockResolvedValue(null);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'When is my next appointment?'));

    expect(result).toEqual({ status: 'verification_pending' });
    expect(messageRouter.route).toHaveBeenCalledWith(
      { person, channelVerified: false },
      'When is my next appointment?',
    );
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining('6-digit AMHOS code'),
    );
    expect(identityService.markWhatsAppConsentAsSystem).not.toHaveBeenCalled();
  });

  // A handset bound to a DIFFERENT number is treated exactly like no binding at all: this is
  // her record, reached from a phone she never enrolled.
  it('treats a message from a handset other than the verified one as unverified', async () => {
    const person = buildPerson({ whatsappConsent: true, whatsappVerifiedPhone: '254700000009' });
    const { controller, messageRouter } = buildController(person);
    (messageRouter.route as jest.Mock).mockResolvedValue(null);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'hello'));

    expect(result).toEqual({ status: 'verification_pending' });
    expect(messageRouter.route).toHaveBeenCalledWith({ person, channelVerified: false }, 'hello');
  });

  // The decision #27 emergency path, at its very hardest: not verified, not consented, first
  // ever message. The router reply (in Plan 2, the escalation text) still goes out FIRST.
  it('sends the router reply first and then the enrolment prompt for an unverified person', async () => {
    const person = buildPerson({ whatsappConsent: false, whatsappVerifiedPhone: null });
    const { controller, whatsAppClient, auditService } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'I have heavy bleeding'));

    expect(result).toEqual({ status: 'escalated_verification_pending' });
    expect((whatsAppClient.sendTextMessage as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      'routed reply',
      expect.stringContaining('6-digit AMHOS code'),
    ]);
    // A clinician reviewing this escalation needs to know it came from a handset nobody has
    // proved belongs to the patient. care_task has no metadata column, so the audit trail is
    // where that signal lives.
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'whatsapp_escalation_from_unverified_channel' }),
    );
  });

  // Consent recorded on an unverified handset would attribute "yes, message me" to whoever
  // happens to be holding the phone. It must not be accepted.
  it('does not record consent for a bare YES from an unverified handset', async () => {
    const person = buildPerson({ whatsappConsent: false, whatsappVerifiedPhone: null });
    const { controller, identityService, messageRouter } = buildController(person);
    (messageRouter.route as jest.Mock).mockResolvedValue(null);

    const result = await controller.receive(buildPayloadWithText('254700000001', 'YES'));

    expect(result).toEqual({ status: 'verification_pending' });
    expect(identityService.markWhatsAppConsentAsSystem).not.toHaveBeenCalled();
    expect(messageRouter.route).toHaveBeenCalled();
  });

  it('verifies the handset and then asks for consent when a six-digit code is correct', async () => {
    const person = buildPerson({ whatsappConsent: false, whatsappVerifiedPhone: null });
    const { controller, identityService, whatsAppClient, messageRouter } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', '482915'));

    expect(result).toEqual({ status: 'channel_verified_consent_pending' });
    expect(identityService.redeemWhatsAppEnrolmentCodeAsSystem).toHaveBeenCalledWith(
      'p1',
      't1',
      '254700000001',
      '482915',
    );
    expect((whatsAppClient.sendTextMessage as jest.Mock).mock.calls.map((c) => c[1])).toEqual([
      expect.stringContaining('now confirmed'),
      expect.stringContaining('Reply YES'),
    ]);
    // A six-digit message is terminal: it cannot contain a danger sign, so nothing is lost.
    expect(messageRouter.route).not.toHaveBeenCalled();
  });

  it('does not re-ask for consent when a correct code arrives from someone already consented', async () => {
    const person = buildPerson({ whatsappConsent: true, whatsappVerifiedPhone: null });
    const { controller, whatsAppClient } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', '482915'));

    expect(result).toEqual({ status: 'channel_verified' });
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledTimes(1);
  });

  // One reply text for every failure mode, so whoever holds the handset gets no oracle telling
  // them whether a code exists, has expired, or has run out of attempts.
  it('gives one uninformative failure reply when the code is wrong', async () => {
    const person = buildPerson({ whatsappConsent: false, whatsappVerifiedPhone: null });
    const { controller, identityService, whatsAppClient, auditService, messageRouter } =
      buildController(person);
    (identityService.redeemWhatsAppEnrolmentCodeAsSystem as jest.Mock).mockResolvedValue({
      outcome: 'invalid_code',
      attemptsRemaining: 4,
    });

    const result = await controller.receive(buildPayloadWithText('254700000001', '000000'));

    expect(result).toEqual({ status: 'verification_failed' });
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledTimes(1);
    expect(whatsAppClient.sendTextMessage).toHaveBeenCalledWith(
      '254700000001',
      expect.stringContaining("didn't work"),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'whatsapp_verification_failed',
        metadata: expect.objectContaining({ outcome: 'invalid_code' }),
      }),
    );
    expect(messageRouter.route).not.toHaveBeenCalled();
  });

  // Once verified, a six-digit message is just a message again — she is not stuck in a
  // redemption loop for the rest of the conversation.
  it('routes a six-digit message normally once the handset is already verified', async () => {
    const person = buildPerson({ whatsappConsent: true });
    const { controller, identityService, messageRouter } = buildController(person);

    const result = await controller.receive(buildPayloadWithText('254700000001', '482915'));

    expect(result).toEqual({ status: 'answered' });
    expect(identityService.redeemWhatsAppEnrolmentCodeAsSystem).not.toHaveBeenCalled();
    expect(messageRouter.route).toHaveBeenCalledWith({ person, channelVerified: true }, '482915');
  });
});
