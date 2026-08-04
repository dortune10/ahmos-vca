import { Module } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { WhatsAppWebhookController } from './whatsapp-webhook.controller';
import { ConversationService } from './conversation.service';
import { WhatsAppClientService } from './whatsapp-client.service';
import { MessageRouterService } from './message-router.service';
import { IdentityModule } from '../identity/identity.module';

@Module({
  imports: [
    IdentityModule,
    // ThrottlerModule is @Global() in @nestjs/throttler, so registering it here rather than in
    // AppModule is intentional and works — don't "fix" it by moving it. Likewise
    // WhatsAppSignatureGuard and WhatsAppSenderThrottlerGuard are referenced by class in
    // @UseGuards() and resolve without being listed in `providers` (neither has constructor
    // dependencies of its own).
    ThrottlerModule.forRoot([{ name: 'default', ttl: 60000, limit: 10 }]),
  ],
  controllers: [WhatsAppWebhookController],
  providers: [ConversationService, WhatsAppClientService, MessageRouterService],
  exports: [ConversationService, WhatsAppClientService, MessageRouterService],
})
export class WhatsAppBotModule {}
