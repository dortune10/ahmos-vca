import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WhatsAppWebhookController } from '../src/whatsapp-bot/whatsapp-webhook.controller';
import { IdentityService } from '../src/identity/identity.service';
import { ConversationService } from '../src/whatsapp-bot/conversation.service';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';
import { AuditService } from '../src/audit/audit.service';
import { MessageRouterService } from '../src/whatsapp-bot/message-router.service';

describe('WhatsAppWebhookController verify (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [WhatsAppWebhookController],
      providers: [
        { provide: IdentityService, useValue: {} },
        { provide: ConversationService, useValue: {} },
        { provide: WhatsAppClientService, useValue: {} },
        { provide: AuditService, useValue: {} },
        { provide: MessageRouterService, useValue: {} },
      ],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('echoes the challenge when mode and verify_token are correct', () => {
    return request(app.getHttpServer())
      .get('/api/v1/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'test-verify-token', 'hub.challenge': '12345' })
      .expect(200)
      .expect('12345');
  });

  it('rejects a request with the wrong verify_token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/whatsapp/webhook')
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong-token', 'hub.challenge': '12345' })
      .expect(403);
  });
});
