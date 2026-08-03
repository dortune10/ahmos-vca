import { createClient } from '@supabase/supabase-js';
// Namespace import, matching all five existing RLS e2e specs in backend/test/ (rls,
// referral-rls, risk-assessment-rls, episode-task-rls, reporting). The default-import rule
// in Global Constraints applies to `supertest` only, not to `jsonwebtoken`.
import * as jwt from 'jsonwebtoken';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;

function tokenFor(userId: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('conversation/message RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let facilityAId: string;
  let clinicianAId: string;
  let personATenantId: string;
  let personBTenantId: string;
  let conversationAId: string;
  let conversationBId: string;

  beforeAll(async () => {
    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Whatsapp RLS Test Clinic', type: 'clinic' })
      .select()
      .single();
    facilityAId = facility!.id;

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `whatsapp-rls-clinician-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    clinicianAId = authUser.user!.id;
    await admin.from('app_user').insert({
      id: clinicianAId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'clinician',
      facility_id: facilityAId,
      full_name: 'Test Clinician A',
    });

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Person A', phone_primary: '+254700009002' })
      .select()
      .single();
    personATenantId = personA!.id;
    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Person B', phone_primary: '+254700009003' })
      .select()
      .single();
    personBTenantId = personB!.id;

    const { data: convA } = await admin
      .from('conversation')
      .insert({ person_id: personATenantId })
      .select()
      .single();
    conversationAId = convA!.id;
    const { data: convB } = await admin
      .from('conversation')
      .insert({ person_id: personBTenantId })
      .select()
      .single();
    conversationBId = convB!.id;

    await admin.from('message').insert([
      { conversation_id: conversationAId, direction: 'inbound', body: 'tenant A message' },
      { conversation_id: conversationBId, direction: 'inbound', body: 'tenant B message' },
    ]);
  });

  afterAll(async () => {
    await admin.from('message').delete().in('conversation_id', [conversationAId, conversationBId]);
    await admin.from('conversation').delete().in('id', [conversationAId, conversationBId]);
    await admin.from('person').delete().in('id', [personATenantId, personBTenantId]);
    await admin.from('app_user').delete().eq('id', clinicianAId);
    await admin.auth.admin.deleteUser(clinicianAId);
    await admin.from('facility').delete().eq('id', facilityAId);
  });

  it('a tenant A clinician sees tenant A conversations but not tenant B conversations', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });
    const { data } = await userClient.from('conversation').select('id');
    const ids = (data ?? []).map((c) => c.id);
    expect(ids).toContain(conversationAId);
    expect(ids).not.toContain(conversationBId);
  });

  it('a tenant A clinician sees tenant A messages but not tenant B messages', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });
    const { data } = await userClient.from('message').select('conversation_id, body');
    const bodies = (data ?? []).map((m) => m.body);
    expect(bodies).toContain('tenant A message');
    expect(bodies).not.toContain('tenant B message');
  });

  it('an authenticated client cannot insert a message directly (service-role only)', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });
    const { error } = await userClient
      .from('message')
      .insert({ conversation_id: conversationAId, direction: 'outbound', body: 'should not be allowed' });
    expect(error).not.toBeNull();
  });
});
