import { createClient } from '@supabase/supabase-js';
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

describe('pregnancy_episode / encounter_note / care_task RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let nurseAId: string;
  let facilityAId: string;
  let facilityBId: string;
  let episodeAId: string;
  let episodeBId: string;

  beforeAll(async () => {
    const { data: facilityA } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'A Clinic', type: 'clinic' })
      .select()
      .single();
    facilityAId = facilityA!.id;

    const { data: facilityB } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'B Clinic', type: 'clinic' })
      .select()
      .single();
    facilityBId = facilityB!.id;

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Amina', phone_primary: '+254700000010' })
      .select()
      .single();

    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Beatrice', phone_primary: '+254700000020' })
      .select()
      .single();

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `nurse-a-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    nurseAId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: nurseAId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'nurse',
      facility_id: facilityAId,
      full_name: 'Nurse A',
    });

    const { data: episodeA } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personA!.id, facility_id: facilityAId, status: 'Active' })
      .select()
      .single();
    episodeAId = episodeA!.id;

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: facilityBId, status: 'Active' })
      .select()
      .single();
    episodeBId = episodeB!.id;
  });

  it('a nurse in tenant A only sees tenant A pregnancy_episode rows (fails before policies exist: deny-all hides tenant A too)', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(nurseAId)}` } },
    });

    const { data } = await userClient.from('pregnancy_episode').select('id');
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(episodeAId);
    expect(ids).not.toContain(episodeBId);
  });

  it("a nurse in tenant A cannot insert a care_task against tenant B's episode", async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(nurseAId)}` } },
    });

    const { error } = await userClient.from('care_task').insert({
      pregnancy_episode_id: episodeBId,
      task_type: 'anc_visit',
      due_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
