import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createHmac } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import Anthropic from '@anthropic-ai/sdk';
import { AppModule } from '../src/app.module';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';
import { AI_ASSISTANT_ANTHROPIC_CLIENT } from '../src/ai-assistant/ai-assistant.service';

const APP_SECRET = 'e2e-ai-qa-app-secret';

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

describe('WhatsApp AI Q&A (e2e)', () => {
  let app: INestApplication;
  let sendTextMessageMock: jest.Mock;
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  const phone = '+254700009300';
  let facilityId: string;
  let personId: string;
  let episodeId: string;

  beforeAll(async () => {
    process.env.WHATSAPP_APP_SECRET = APP_SECRET;

    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'AI QA E2E Clinic', type: 'clinic' })
      .select()
      .single();
    facilityId = facility!.id;

    // Consented AND verified: the AI Q&A path sits behind both gates (docs/DECISIONS.md #27,
    // #28), so a fixture that sets only whatsapp_consent would take the 'verification_pending'
    // branch and never reach Claude at all.
    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'AI QA E2E Person', phone_primary: phone, whatsapp_consent: true, whatsapp_consent_at: new Date().toISOString(), whatsapp_verified_phone: phone.replace('+', ''), whatsapp_verified_at: new Date().toISOString() })
      .select()
      .single();
    personId = person!.id;

    const { data: episode } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active', risk_band: 'low', estimated_delivery_date: '2026-12-01' })
      .select()
      .single();
    episodeId = episode!.id;

    sendTextMessageMock = jest.fn().mockResolvedValue({ whatsappMessageId: 'wamid.reply' });

    const fakeAnthropicClient = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Your pregnancy is currently classed as low risk, and your due date is around December 1st.' }],
        }),
      },
    } as unknown as Anthropic;

    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(WhatsAppClientService)
      .useValue({ sendTextMessage: sendTextMessageMock })
      .overrideProvider(AI_ASSISTANT_ANTHROPIC_CLIENT)
      .useValue(fakeAnthropicClient)
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
    await admin.from('pregnancy_episode').delete().eq('id', episodeId);
    await admin.from('person').delete().eq('id', personId);
    await admin.from('facility').delete().eq('id', facilityId);
    await app.close();
  });

  it('answers a profile-data question using the (mocked) AI assistant and persists both messages', async () => {
    const phoneDigits = phone.replace('+', '');
    const response = await signedPost(app, textMessagePayload(phoneDigits, 'What is my risk level and when am I due?'));

    expect(response.body).toEqual({ status: 'answered' });
    expect(sendTextMessageMock).toHaveBeenCalledWith(
      phoneDigits,
      'Your pregnancy is currently classed as low risk, and your due date is around December 1st.',
    );

    const { data: conversation } = await admin.from('conversation').select('id').eq('person_id', personId).single();
    const { data: messages } = await admin
      .from('message')
      .select('direction, body')
      .eq('conversation_id', conversation!.id)
      .order('created_at', { ascending: true });
    expect(messages).toHaveLength(2);
    expect(messages?.[0]).toMatchObject({ direction: 'inbound', body: 'What is my risk level and when am I due?' });
    expect(messages?.[1]).toMatchObject({
      direction: 'outbound',
      body: 'Your pregnancy is currently classed as low risk, and your due date is around December 1st.',
    });

    const { data: escalationTasks } = await admin
      .from('care_task')
      .select('id')
      .eq('pregnancy_episode_id', episodeId)
      .eq('task_type', 'danger_sign_escalation');
    expect(escalationTasks).toEqual([]);
  });
});
