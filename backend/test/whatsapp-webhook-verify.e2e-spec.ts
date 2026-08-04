import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { WhatsAppWebhookController } from '../src/whatsapp-bot/whatsapp-webhook.controller';
import { IdentityService } from '../src/identity/identity.service';
import { ConversationService } from '../src/whatsapp-bot/conversation.service';
import { WhatsAppClientService } from '../src/whatsapp-bot/whatsapp-client.service';
import { AuditService } from '../src/audit/audit.service';
import { MessageRouterService } from '../src/whatsapp-bot/message-router.service';
import { ThrottlerModule } from '@nestjs/throttler';

describe('WhatsAppWebhookController verify (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    process.env.WHATSAPP_VERIFY_TOKEN = 'test-verify-token';
    const moduleFixture: TestingModule = await Test.createTestingModule({
      // The GET handshake needs none of these, but the POST handler on the same controller
      // carries @UseGuards(WhatsAppSignatureGuard, WhatsAppSenderThrottlerGuard), and Nest
      // instantiates every route's guards at module-init time. WhatsAppSenderThrottlerGuard
      // extends ThrottlerGuard, whose constructor needs THROTTLER:MODULE_OPTIONS and
      // ThrottlerStorage — so without this import .compile() throws before a single test runs.
      // Same class of DI-only failure as the stub providers below: invisible to tsc, and
      // invisible to `npm test` (jest rootDir is src), so it only surfaces here.
      imports: [ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10 }])],
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
