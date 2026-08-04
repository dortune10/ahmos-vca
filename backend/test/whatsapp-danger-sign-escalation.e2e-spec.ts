import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';

const APP_SECRET = 'e2e-danger-sign-app-secret';

function signedPost(app: INestApplication, payload: unknown) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return request(app.getHttpServer())
    .post('/api/v1/whatsapp/webhook')
    .set('x-hub-signature-256', `sha256=${signature}`)
    .set('Content-Type', 'application/json')
    .send(payload);
}

// Monotonic counter, NOT Date.now() alone: the webhook drops any message whose
// whatsapp_message_id it has already stored (idempotency against Meta's retries), and two
// sequential requests can land in the same millisecond.
let messageCounter = 0;
function textMessagePayload(from: string, text: string) {
  messageCounter += 1;
  return {
    entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.e2e.${Date.now()}.${messageCounter}`, type: 'text', text: { body: text } }] } }] }],
  };
}

describe('WhatsApp danger-sign escalation (e2e)', () => {
  let app: INestApplication;
  let sendTextMessageMock: jest.Mock;
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const phone = '+254700009200';
  // A second, deliberately NOT-yet-consented woman at the same facility — the docs/DECISIONS.md
  // #27 case: her first ever message is a danger sign. Her handset IS verified, so this fixture
  // isolates the consent gate.
  const unconsentedPhone = '+254700009201';
  // A third woman who has passed NEITHER gate — no consent, no verified handset. This is the
  // hardest form of the #27 case and, at rollout, the state every single patient is in.
  const unverifiedPhone = '+254700009202';
  let facilityId: string;
  let chwId: string;
  let personId: string;
  let episodeId: string;
  let unconsentedPersonId: string;
  let unconsentedEpisodeId: string;
  let unverifiedPersonId: string;
  let unverifiedEpisodeId: string;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Danger Sign E2E Clinic', type: 'clinic' })
      .select()
      .single();
    facilityId = facility!.id;

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `danger-sign-chw-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    chwId = authUser.user!.id;
    await admin.from('app_user').insert({
      id: chwId,
      tenant_id: tenantId,
      email: authUser.user!.email,
      role: 'chw',
      facility_id: facilityId,
      full_name: 'Danger Sign E2E CHW',
    });

    // whatsapp_verified_phone is digits-only with no leading '+', exactly what
    // IdentityService.redeemWhatsAppEnrolmentCodeAsSystem writes.
    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Danger Sign E2E Person', phone_primary: phone, whatsapp_consent: true, whatsapp_consent_at: new Date().toISOString(), whatsapp_verified_phone: phone.replace('+', ''), whatsapp_verified_at: new Date().toISOString() })
      .select()
      .single();
    personId = person!.id;

    const { data: episode } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    episodeId = episode!.id;

    // Same tenant and facility, handset verified, but whatsapp_consent left at its default
    // false — isolates the consent gate from the verification gate.
    const { data: unconsentedPerson } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Danger Sign E2E Unconsented Person', phone_primary: unconsentedPhone, whatsapp_verified_phone: unconsentedPhone.replace('+', ''), whatsapp_verified_at: new Date().toISOString() })
      .select()
      .single();
    unconsentedPersonId = unconsentedPerson!.id;

    const { data: unconsentedEpisode } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: unconsentedPersonId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    unconsentedEpisodeId = unconsentedEpisode!.id;

    // Neither gate passed: no consent, no verified handset. Both columns left at their
    // defaults on purpose — this is a brand-new patient the day the channel goes live.
    const { data: unverifiedPerson } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Danger Sign E2E Unverified Person', phone_primary: unverifiedPhone })
      .select()
      .single();
    unverifiedPersonId = unverifiedPerson!.id;

    const { data: unverifiedEpisode } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: unverifiedPersonId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    unverifiedEpisodeId = unverifiedEpisode!.id;

    // A UNIQUE id per send, not a constant: the decision #27 path sends TWO outbound messages
    // in a single request (the urgent-care text, then the opt-in prompt) and each is persisted
    // with the id this mock returns against message.whatsapp_message_id, which is UNIQUE.
    let replyCounter = 0;
    sendTextMessageMock = jest.fn().mockImplementation(async () => {
      replyCounter += 1;
      return { whatsappMessageId: `wamid.reply.${Date.now()}.${replyCounter}` };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WhatsAppClientService)
      .useValue({ sendTextMessage: sendTextMessageMock })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true } as any);
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    const personIds = [personId, unconsentedPersonId, unverifiedPersonId];
    const episodeIds = [episodeId, unconsentedEpisodeId, unverifiedEpisodeId];
    await admin.from('care_task').delete().in('pregnancy_episode_id', episodeIds);
    await admin.from('message').delete().in(
      'conversation_id',
      (await admin.from('conversation').select('id').in('person_id', personIds)).data?.map((c) => c.id) ?? [],
    );
    await admin.from('conversation').delete().in('person_id', personIds);
    await admin.from('pregnancy_episode').delete().in('id', episodeIds);
    await admin.from('person').delete().in('id', personIds);
    await admin.from('app_user').delete().eq('id', chwId);
    await admin.auth.admin.deleteUser(chwId);
    await admin.from('facility').delete().eq('id', facilityId);
    await app.close();
  });

  it('creates an urgent, CHW-assigned escalation task and never creates a referral', async () => {
    const phoneDigits = phone.replace('+', '');
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'I have heavy bleeding and I am scared'));

    expect(response.body).toEqual({ status: 'answered' });

    const { data: tasks } = await admin
      .from('care_task')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .eq('task_type', 'danger_sign_escalation');
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].assigned_user_id).toBe(chwId);
    expect(tasks?.[0].priority).toBe('urgent');
    expect(tasks?.[0].status).toBe('Due');

    const { data: referrals } = await admin.from('referral').select('*').eq('pregnancy_episode_id', episodeId);
    expect(referrals).toEqual([]);

    const { data: auditEvents } = await admin
      .from('audit_event')
      .select('action')
      .eq('entity_id', personId)
      .eq('action', 'whatsapp_danger_sign_detected');
    expect(auditEvents).toHaveLength(1);
  });

  // docs/DECISIONS.md #27, proven end-to-end against the real database: a registered woman who
  // has NOT opted in yet, whose first ever message is a danger sign, gets the emergency
  // instruction AND a real urgent care_task AND the audit record — and is then still asked to
  // opt in. Under the design spec's literal Section 5 ordering she would have received the
  // opt-in prompt and nothing else. This test is the guard against anyone restoring that order.
  it('escalates a danger-sign message from a known person who has not consented, then still prompts for opt-in', async () => {
    const phoneDigits = unconsentedPhone.replace('+', '');
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'I have heavy bleeding and I am scared'));

    expect(response.body).toEqual({ status: 'escalated_consent_pending' });

    const { data: tasks } = await admin
      .from('care_task')
      .select('*')
      .eq('pregnancy_episode_id', unconsentedEpisodeId)
      .eq('task_type', 'danger_sign_escalation');
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].assigned_user_id).toBe(chwId);
    expect(tasks?.[0].priority).toBe('urgent');
    expect(tasks?.[0].status).toBe('Due');

    // Emergency instruction first, consent housekeeping second.
    const sentBodies = sendTextMessageMock.mock.calls
      .filter((call) => call[0] === phoneDigits)
      .map((call) => call[1]);
    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0]).toContain('nearest health facility');
    expect(sentBodies[1]).toContain('Reply YES');

    const { data: auditEvents } = await admin
      .from('audit_event')
      .select('action')
      .eq('entity_id', unconsentedPersonId)
      .eq('action', 'whatsapp_danger_sign_detected');
    expect(auditEvents).toHaveLength(1);

    // An escalation must not silently grant consent.
    const { data: updatedPerson } = await admin
      .from('person')
      .select('whatsapp_consent')
      .eq('id', unconsentedPersonId)
      .single();
    expect(updatedPerson?.whatsapp_consent).toBe(false);
  });

  // docs/DECISIONS.md #27 AND #28 together, in the state every patient is in on day one:
  // neither gate passed. The verification gate added by Plan 1's Tasks 9-13 must not stand in
  // front of the emergency path — if this test ever starts returning 'verification_pending'
  // with no care_task, someone has moved a gate above the danger-sign matcher.
  it('escalates a danger-sign message from a person who is neither verified nor consented, then asks her to enrol', async () => {
    const phoneDigits = unverifiedPhone.replace('+', '');
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'I have heavy bleeding and I am scared'));

    expect(response.body).toEqual({ status: 'escalated_verification_pending' });

    const { data: tasks } = await admin
      .from('care_task')
      .select('*')
      .eq('pregnancy_episode_id', unverifiedEpisodeId)
      .eq('task_type', 'danger_sign_escalation');
    expect(tasks).toHaveLength(1);
    expect(tasks?.[0].assigned_user_id).toBe(chwId);
    expect(tasks?.[0].priority).toBe('urgent');
    expect(tasks?.[0].status).toBe('Due');

    // Emergency instruction first, identity housekeeping second.
    const sentBodies = sendTextMessageMock.mock.calls
      .filter((call) => call[0] === phoneDigits)
      .map((call) => call[1]);
    expect(sentBodies).toHaveLength(2);
    expect(sentBodies[0]).toContain('nearest health facility');
    expect(sentBodies[1]).toContain('6-digit AMHOS code');

    const { data: dangerSignEvents } = await admin
      .from('audit_event')
      .select('action')
      .eq('entity_id', unverifiedPersonId)
      .eq('action', 'whatsapp_danger_sign_detected');
    expect(dangerSignEvents).toHaveLength(1);

    // The reviewing clinician can tell this escalation came from a handset nobody has proved
    // belongs to the patient — care_task itself has no metadata column to carry that.
    const { data: unverifiedEvents } = await admin
      .from('audit_event')
      .select('action')
      .eq('entity_id', unverifiedPersonId)
      .eq('action', 'whatsapp_escalation_from_unverified_channel');
    expect(unverifiedEvents).toHaveLength(1);

    // An escalation grants neither consent nor verification.
    const { data: updatedPerson } = await admin
      .from('person')
      .select('whatsapp_consent, whatsapp_verified_phone')
      .eq('id', unverifiedPersonId)
      .single();
    expect(updatedPerson?.whatsapp_consent).toBe(false);
    expect(updatedPerson?.whatsapp_verified_phone).toBeNull();
  });
});
