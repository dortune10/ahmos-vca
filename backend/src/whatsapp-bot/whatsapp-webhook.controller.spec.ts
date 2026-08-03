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
    expect(messageRouter.route).toHaveBeenCalledWith({ person }, 'hello there');
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
    expect(messageRouter.route).toHaveBeenCalledWith({ person }, 'When is my next appointment?');
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
});
