import { createClient } from '@supabase/supabase-js';

describe('whatsapp-bot schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let personId: string;

  beforeAll(async () => {
    const { data, error } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Whatsapp Schema Test', phone_primary: '+254700009001' })
      .select()
      .single();
    expect(error).toBeNull();
    personId = data!.id;
  });

  afterAll(async () => {
    await admin.from('person').delete().eq('id', personId);
  });

  it('person defaults whatsapp_consent to false and allows a nullable consent timestamp', async () => {
    const { data, error } = await admin
      .from('person')
      .select('whatsapp_consent, whatsapp_consent_at')
      .eq('id', personId)
      .single();
    expect(error).toBeNull();
    expect(data?.whatsapp_consent).toBe(false);
    expect(data?.whatsapp_consent_at).toBeNull();
  });

  it('creates a conversation and appends an inbound and outbound message', async () => {
    const { data: conversation, error: convError } = await admin
      .from('conversation')
      .insert({ person_id: personId })
      .select()
      .single();
    expect(convError).toBeNull();
    expect(conversation?.channel).toBe('whatsapp');

    const { error: msgError } = await admin.from('message').insert([
      { conversation_id: conversation!.id, direction: 'inbound', body: 'When is my next appointment?' },
      { conversation_id: conversation!.id, direction: 'outbound', body: 'Your next visit is in 5 days.' },
    ]);
    expect(msgError).toBeNull();

    const { data: messages, error: fetchError } = await admin
      .from('message')
      .select('*')
      .eq('conversation_id', conversation!.id)
      .order('created_at', { ascending: true });
    expect(fetchError).toBeNull();
    expect(messages).toHaveLength(2);
    expect(messages?.[0].direction).toBe('inbound');

    await admin.from('message').delete().eq('conversation_id', conversation!.id);
    await admin.from('conversation').delete().eq('id', conversation!.id);
  });

  it('rejects a message with an invalid direction', async () => {
    const { data: conversation } = await admin
      .from('conversation')
      .insert({ person_id: personId })
      .select()
      .single();

    const { error } = await admin
      .from('message')
      .insert({ conversation_id: conversation!.id, direction: 'sideways', body: 'bad row' });
    expect(error).not.toBeNull();

    await admin.from('conversation').delete().eq('id', conversation!.id);
  });
});
