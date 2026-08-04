import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';

const APP_SECRET = 'e2e-test-app-secret';

function signedPost(app: INestApplication, payload: unknown) {
  const rawBody = Buffer.from(JSON.stringify(payload));
  const signature = createHmac('sha256', APP_SECRET).update(rawBody).digest('hex');
  return request(app.getHttpServer())
    .post('/api/v1/whatsapp/webhook')
    .set('x-hub-signature-256', `sha256=${signature}`)
    .set('Content-Type', 'application/json')
    .send(payload);
}

// Monotonic counter, NOT Date.now(): the webhook drops any message whose whatsapp_message_id
// it has already stored (idempotency against Meta's retries), and two sequential requests can
// land in the same millisecond, which would silently turn the second one into
// { status: 'duplicate_ignored' } and fail the test for the wrong reason.
let messageCounter = 0;
function textMessagePayload(from: string, text: string) {
  messageCounter += 1;
  return {
    entry: [{ changes: [{ value: { messages: [{ from, id: `wamid.e2e.${Date.now()}.${messageCounter}`, type: 'text', text: { body: text } }] } }] }],
  };
}

describe('WhatsApp webhook (e2e)', () => {
  let app: INestApplication;
  let sendTextMessageMock: jest.Mock;
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let personId: string;
  const personPhone = '+254700009100';

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Webhook E2E Person', phone_primary: personPhone })
      .select()
      .single();
    personId = person!.id;

    // A UNIQUE id per send, not a constant. message.whatsapp_message_id is UNIQUE (Task 1),
    // and every outbound reply is persisted with the id this mock returns — so a constant
    // would blow up on the second reply the suite provokes. Two ways that happens: across
    // requests (the opt-in prompt, then the consent thank-you), and within a single request
    // (a router reply followed by the opt-in prompt on the decision #27 path).
    let replyCounter = 0;
    sendTextMessageMock = jest.fn().mockImplementation(async () => {
      replyCounter += 1;
      return { whatsappMessageId: `wamid.reply.${Date.now()}.${replyCounter}` };
    });

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(WhatsAppClientService)
      .useValue({ sendTextMessage: sendTextMessageMock })
      .compile();

    app = moduleFixture.createNestApplication({ rawBody: true } as any);
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await admin.from('message').delete().in(
      'conversation_id',
      (await admin.from('conversation').select('id').eq('person_id', personId)).data?.map((c) => c.id) ?? [],
    );
    await admin.from('conversation').delete().eq('person_id', personId);
    await admin.from('person').delete().eq('id', personId);
    await app.close();
  });

  it('rejects a request with an invalid signature', () => {
    return request(app.getHttpServer())
      .post('/api/v1/whatsapp/webhook')
      .set('x-hub-signature-256', 'sha256=not-a-real-signature')
      .send(textMessagePayload(personPhone.replace('+', ''), 'hello'))
      .expect(403);
  });

  it('declines an unregistered number without sending an opt-in prompt', async () => {
    const response = await signedPost(app, textMessagePayload('254799999999', 'hello'));
    expect(response.status).toBe(201);
    expect(response.body).toEqual({ status: 'declined_unregistered' });
    expect(sendTextMessageMock).toHaveBeenCalledWith('254799999999', expect.stringContaining('community health worker'));
  });

  it('prompts a known, not-yet-consented number to opt in, then records consent on YES', async () => {
    const phoneDigits = personPhone.replace('+', '');

    const firstResponse = await signedPost(app, textMessagePayload(phoneDigits, 'hi there'));
    expect(firstResponse.body).toEqual({ status: 'consent_pending' });

    const secondResponse = await signedPost(app, textMessagePayload(phoneDigits, 'YES'));
    expect(secondResponse.body).toEqual({ status: 'consent_granted' });

    const { data: updatedPerson } = await admin
      .from('person')
      .select('whatsapp_consent')
      .eq('id', personId)
      .single();
    expect(updatedPerson?.whatsapp_consent).toBe(true);

    const thirdResponse = await signedPost(app, textMessagePayload(phoneDigits, 'When is my next appointment?'));
    expect(thirdResponse.body).toEqual({ status: 'answered' });
  });
});
