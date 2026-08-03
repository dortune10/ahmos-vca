import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';

export interface ConversationRecord {
  id: string;
  personId: string;
}

@Injectable()
export class ConversationService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getOrCreateConversation(personId: string): Promise<ConversationRecord> {
    const client = this.supabaseService.getServiceClient();

    const { data: existing, error: findError } = await client
      .from('conversation')
      .select('id, person_id')
      .eq('person_id', personId)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (findError) {
      throw findError;
    }
    if (existing) {
      return { id: existing.id, personId: existing.person_id };
    }

    const { data, error } = await client
      .from('conversation')
      .insert({ person_id: personId })
      .select('id, person_id')
      .single();
    if (error) {
      throw error;
    }
    return { id: data.id, personId: data.person_id };
  }

  async appendMessage(
    conversationId: string,
    direction: 'inbound' | 'outbound',
    body: string,
    whatsappMessageId: string | null,
  ): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    const { error } = await client.from('message').insert({
      conversation_id: conversationId,
      direction,
      body,
      whatsapp_message_id: whatsappMessageId,
    });
    if (error) {
      throw error;
    }
  }

  // Idempotency probe for Meta's webhook retries. Meta re-delivers any webhook that does not
  // return 2xx, and its signature header carries no timestamp or nonce, so the same payload
  // can legitimately arrive many times. Without this check, one retried danger-sign message
  // becomes N duplicate urgent care_tasks (Plan 2 Task 7) and N Claude calls.
  async hasMessageWithWhatsAppId(whatsappMessageId: string): Promise<boolean> {
    const client = this.supabaseService.getServiceClient();
    const { data, error } = await client
      .from('message')
      .select('id')
      .eq('whatsapp_message_id', whatsappMessageId)
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data !== null;
  }
}
