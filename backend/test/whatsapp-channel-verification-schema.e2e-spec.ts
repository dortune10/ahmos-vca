import { createClient } from '@supabase/supabase-js';
import { randomUUID } from 'crypto';

describe('whatsapp channel-verification schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let personAId: string;
  let personBId: string;

  beforeAll(async () => {
    const { data: personA, error: errorA } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Verification Schema A', phone_primary: '+254700009401' })
      .select()
      .single();
    expect(errorA).toBeNull();
    personAId = personA!.id;

    const { data: personB, error: errorB } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Verification Schema B', phone_primary: '+254700009402' })
      .select()
      .single();
    expect(errorB).toBeNull();
    personBId = personB!.id;
  });

  afterAll(async () => {
    await admin.from('whatsapp_enrolment_code').delete().in('person_id', [personAId, personBId]);
    await admin.from('person').delete().in('id', [personAId, personBId]);
  });

  it('defaults both verification columns to null on an existing person', async () => {
    const { data, error } = await admin
      .from('person')
      .select('whatsapp_verified_phone, whatsapp_verified_at')
      .eq('id', personAId)
      .single();
    expect(error).toBeNull();
    expect(data?.whatsapp_verified_phone).toBeNull();
    expect(data?.whatsapp_verified_at).toBeNull();
  });

  // The single most important assertion in this file: one handset, at most one person.
  it('refuses to verify the same handset digits against two different people', async () => {
    const { error: firstError } = await admin
      .from('person')
      .update({ whatsapp_verified_phone: '254700009401', whatsapp_verified_at: new Date().toISOString() })
      .eq('id', personAId);
    expect(firstError).toBeNull();

    const { error: secondError } = await admin
      .from('person')
      .update({ whatsapp_verified_phone: '254700009401', whatsapp_verified_at: new Date().toISOString() })
      .eq('id', personBId);
    expect(secondError).not.toBeNull();

    // ...but the index is partial, so any number of people can stay unverified.
    const { error: nullError } = await admin
      .from('person')
      .update({ whatsapp_verified_phone: null })
      .in('id', [personAId, personBId]);
    expect(nullError).toBeNull();
  });

  it('stores an enrolment code row with its attempt budget and expiry', async () => {
    const codeId = randomUUID();
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    const { error: insertError } = await admin.from('whatsapp_enrolment_code').insert({
      id: codeId,
      person_id: personAId,
      code_hash: 'a'.repeat(64),
      expires_at: expiresAt,
    });
    expect(insertError).toBeNull();

    const { data, error } = await admin
      .from('whatsapp_enrolment_code')
      .select('attempts_remaining, consumed_at, issued_by')
      .eq('id', codeId)
      .single();
    expect(error).toBeNull();
    expect(data?.attempts_remaining).toBe(5);
    expect(data?.consumed_at).toBeNull();
    expect(data?.issued_by).toBeNull();

    await admin.from('whatsapp_enrolment_code').delete().eq('id', codeId);
  });

  it('rejects a negative attempt count', async () => {
    const { error } = await admin.from('whatsapp_enrolment_code').insert({
      person_id: personAId,
      code_hash: 'b'.repeat(64),
      expires_at: new Date(Date.now() + 60_000).toISOString(),
      attempts_remaining: -1,
    });
    expect(error).not.toBeNull();
  });
});
