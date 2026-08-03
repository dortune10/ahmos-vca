import { Module } from '@nestjs/common';
import { ConversationService } from './conversation.service';
import { WhatsAppClientService } from './whatsapp-client.service';

@Module({
  providers: [ConversationService, WhatsAppClientService],
  exports: [ConversationService, WhatsAppClientService],
})
export class WhatsAppBotModule {}
