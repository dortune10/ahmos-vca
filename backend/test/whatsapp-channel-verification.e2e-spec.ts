import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac, randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';
import { hashEnrolmentCode } from '../src/identity/identity.service';

const APP_SECRET = 'e2e-channel-verification-app-secret';

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
// whatsapp_message_id it has already stored, and two sequential requests can land in the same
// millisecond, which would silently turn the second one into { status: 'duplicate_ignored' }.
let messageCounter = 0;
function textMessagePayload(from: string, text: string) {
  messageCounter += 1;
  return {
    entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.e2e.${Date.now()}.${messageCounter}`, type: 'text', text: { body: text } }] } }] }],
  };
}

describe('WhatsApp channel verification (e2e)', () => {
  let app: INestApplication;
  let sendTextMessageMock: jest.Mock;
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const personPhone = '+254700009600';
  const phoneDigits = '254700009600';
  let personId: string;

  // Seeded directly rather than through the staff HTTP endpoint: this spec is about what the
  // WEBHOOK does with a code, and hashEnrolmentCode is the same function the issuing path uses,
  // so the row is byte-identical to a real one.
  async function seedCode(code: string, expiresInMs = 60_000) {
    await admin.from('whatsapp_enrolment_code').delete().eq('person_id', personId);
    const codeId = randomUUID();
    await admin.from('whatsapp_enrolment_code').insert({
      id: codeId,
      person_id: personId,
      code_hash: hashEnrolmentCode(codeId, code),
      expires_at: new Date(Date.now() + expiresInMs).toISOString(),
    });
  }

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Channel Verification E2E Person', phone_primary: personPhone })
      .select()
      .single();
    personId = person!.id;

    // A UNIQUE id per send: message.whatsapp_message_id is UNIQUE (Task 1) and this suite
    // provokes several replies, including two within one request.
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
    // Explicit timeout, matching reporting.e2e-spec.ts's own beforeAll: this compiles the whole
    // AppModule and inserts fixtures into the shared hosted `amhos` project (docs/DECISIONS.md
    // #23), which is comfortably slower than Jest's 5s default when the full suite is running.
  }, 30000);

  afterAll(async () => {
    await admin.from('message').delete().in(
      'conversation_id',
      (await admin.from('conversation').select('id').eq('person_id', personId)).data?.map((c) => c.id) ?? [],
    );
    await admin.from('conversation').delete().eq('person_id', personId);
    await admin.from('whatsapp_enrolment_code').delete().eq('person_id', personId);
    await admin.from('person').delete().eq('id', personId);
    await app.close();
  });

  it('asks an unverified but registered number to enrol, and discloses nothing', async () => {
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'When is my next appointment?'));

    expect(response.body).toEqual({ status: 'verification_pending' });
    const lastBody = sendTextMessageMock.mock.calls.at(-1)?.[1] as string;
    expect(lastBody).toContain('6-digit AMHOS code');
    expect(lastBody).not.toContain('appointment');
  });

  it('does not accept consent from an unverified handset', async () => {
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'YES'));

    expect(response.body).toEqual({ status: 'verification_pending' });
    const { data: person } = await admin
      .from('person')
      .select('whatsapp_consent')
      .eq('id', personId)
      .single();
    expect(person?.whatsapp_consent).toBe(false);
  });

  it('spends an attempt and gives an uninformative reply for a wrong code', async () => {
    await seedCode('482915');

    const response = await signedPost(app, textMessagePayload(phoneDigits, '000000'));

    expect(response.body).toEqual({ status: 'verification_failed' });
    expect(sendTextMessageMock.mock.calls.at(-1)?.[1]).toContain("didn't work");

    const { data: codes } = await admin
      .from('whatsapp_enrolment_code')
      .select('attempts_remaining, consumed_at')
      .eq('person_id', personId);
    expect(codes?.[0].attempts_remaining).toBe(4);
    expect(codes?.[0].consumed_at).toBeNull();

    const { data: person } = await admin
      .from('person')
      .select('whatsapp_verified_phone')
      .eq('id', personId)
      .single();
    expect(person?.whatsapp_verified_phone).toBeNull();
  });

  it('binds the handset on a correct code, consumes it, and then opens the consent gate', async () => {
    await seedCode('482915');

    const verifyResponse = await signedPost(app, textMessagePayload(phoneDigits, '482915'));
    expect(verifyResponse.body).toEqual({ status: 'channel_verified_consent_pending' });

    const { data: person } = await admin
      .from('person')
      .select('whatsapp_verified_phone, whatsapp_verified_at')
      .eq('id', personId)
      .single();
    expect(person?.whatsapp_verified_phone).toBe(phoneDigits);
    expect(person?.whatsapp_verified_at).not.toBeNull();

    const { data: codes } = await admin
      .from('whatsapp_enrolment_code')
      .select('consumed_at')
      .eq('person_id', personId);
    expect(codes?.[0].consumed_at).not.toBeNull();

    const { data: auditEvents } = await admin
      .from('audit_event')
      .select('action')
      .eq('entity_id', personId)
      .eq('action', 'whatsapp_channel_verified');
    expect(auditEvents).toHaveLength(1);

    // Verification is not consent: the gate she just passed is the identity one.
    const consentResponse = await signedPost(app, textMessagePayload(phoneDigits, 'YES'));
    expect(consentResponse.body).toEqual({ status: 'consent_granted' });

    const answerResponse = await signedPost(app, textMessagePayload(phoneDigits, 'When is my next appointment?'));
    expect(answerResponse.body).toEqual({ status: 'answered' });
    // The heaviest test in this file: a code seed, three signed webhook round-trips (each of
    // which makes several calls to the shared remote database) and four direct admin reads.
    // Passes well inside 5s in isolation, but not reliably once the whole e2e suite is
    // contending for the same hosted project — same reason reporting.e2e-spec.ts sets one.
  }, 30000);

  // Verifying one handset must not turn into a blanket "this person is now trusted" flag. Here
  // phone_primary does not match the sending number either, so she is not identified at all --
  // the strongest possible form of "no disclosure", and the case that would regress first if
  // someone replaced the binding with a boolean. The narrower case (her own phone_primary
  // resolves, but the message arrives from a handset other than the verified one) needs two
  // person rows to reproduce over HTTP and is pinned instead by
  // channel-verification.spec.ts's "is false when the message arrives from a different
  // handset" and the controller's own "treats a message from a handset other than the verified
  // one as unverified".
  it('discloses nothing to a handset that is verified for nobody and registered to nobody', async () => {
    const otherHandset = '254700009699';
    const response = await signedPost(app, textMessagePayload(otherHandset, 'When is my next appointment?'));

    expect(response.body).toEqual({ status: 'declined_unregistered' });
    expect(sendTextMessageMock.mock.calls.at(-1)?.[1]).toContain('community health worker');
  });
});
