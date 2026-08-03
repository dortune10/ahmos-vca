import { ConversationService } from './conversation.service';
import { SupabaseService } from '../common/supabase/supabase.service';

describe('ConversationService', () => {
  it('reuses an existing conversation for the person if one exists', async () => {
    const maybeSingleMock = jest.fn().mockResolvedValue({
      data: { id: 'conv-1', person_id: 'p1' },
      error: null,
    });
    const serviceClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: maybeSingleMock,
              }),
            }),
          }),
        }),
      }),
    };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    const service = new ConversationService(supabaseService);

    const result = await service.getOrCreateConversation('p1');

    expect(result).toEqual({ id: 'conv-1', personId: 'p1' });
  });

  it('creates a new conversation when none exists for the person', async () => {
    const serviceClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            order: () => ({
              limit: () => ({
                maybeSingle: jest.fn().mockResolvedValue({ data: null, error: null }),
              }),
            }),
          }),
        }),
        insert: () => ({
          select: () => ({
            single: jest.fn().mockResolvedValue({
              data: { id: 'conv-2', person_id: 'p1' },
              error: null,
            }),
          }),
        }),
      }),
    };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    const service = new ConversationService(supabaseService);

    const result = await service.getOrCreateConversation('p1');

    expect(result).toEqual({ id: 'conv-2', personId: 'p1' });
  });

  it('appends a message with the given direction, body, and whatsapp message id', async () => {
    const insertMock = jest.fn().mockResolvedValue({ error: null });
    const serviceClient = { from: () => ({ insert: insertMock }) };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    const service = new ConversationService(supabaseService);

    await service.appendMessage('conv-1', 'inbound', 'hello', 'wamid.123');

    expect(insertMock).toHaveBeenCalledWith({
      conversation_id: 'conv-1',
      direction: 'inbound',
      body: 'hello',
      whatsapp_message_id: 'wamid.123',
    });
  });

  function buildServiceForWhatsAppIdLookup(row: { id: string } | null) {
    const serviceClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            limit: () => ({
              maybeSingle: jest.fn().mockResolvedValue({ data: row, error: null }),
            }),
          }),
        }),
      }),
    };
    const supabaseService = { getServiceClient: () => serviceClient } as unknown as SupabaseService;
    return new ConversationService(supabaseService);
  }

  it('reports true when a message with that whatsapp message id already exists', async () => {
    const service = buildServiceForWhatsAppIdLookup({ id: 'msg-1' });
    await expect(service.hasMessageWithWhatsAppId('wamid.123')).resolves.toBe(true);
  });

  it('reports false when no message with that whatsapp message id exists', async () => {
    const service = buildServiceForWhatsAppIdLookup(null);
    await expect(service.hasMessageWithWhatsAppId('wamid.999')).resolves.toBe(false);
  });
});
