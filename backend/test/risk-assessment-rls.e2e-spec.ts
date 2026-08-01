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

describe('risk_assessment RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let clinicianAId: string;
  let episodeAId: string;
  let episodeBId: string;
  let assessmentAId: string;

  beforeAll(async () => {
    const { data: facilityA } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Risk RLS A Clinic', type: 'clinic' })
      .select()
      .single();
    const { data: facilityB } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'Risk RLS B Clinic', type: 'clinic' })
      .select()
      .single();

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Amina', phone_primary: '+254700000030' })
      .select()
      .single();
    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Beatrice', phone_primary: '+254700000040' })
      .select()
      .single();

    const { data: episodeA } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personA!.id, facility_id: facilityA!.id, status: 'Active' })
      .select()
      .single();
    episodeAId = episodeA!.id;

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: facilityB!.id, status: 'Active' })
      .select()
      .single();
    episodeBId = episodeB!.id;

    const { data: assessmentA } = await admin
      .from('risk_assessment')
      .insert({
        pregnancy_episode_id: episodeAId,
        rule_score: 1,
        final_risk_band: 'medium',
        explanation_json: {},
        status: 'Computed',
      })
      .select()
      .single();
    assessmentAId = assessmentA!.id;

    await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeBId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `clinician-a-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    clinicianAId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: clinicianAId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'clinician',
      facility_id: facilityA!.id,
      full_name: 'Clinician A',
    });
  });

  it('a clinician in tenant A only sees tenant A risk_assessment rows (fails before policies exist: deny-all hides tenant A too)', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { data } = await userClient.from('risk_assessment').select('id, pregnancy_episode_id');
    const episodeIds = (data ?? []).map((row) => row.pregnancy_episode_id);
    expect(episodeIds).toContain(episodeAId);
    expect(episodeIds).not.toContain(episodeBId);
  });

  it("a clinician in tenant A can update (override) their own tenant's risk_assessment row", async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { data, error } = await userClient
      .from('risk_assessment')
      .update({
        final_risk_band: 'low',
        overridden_by: clinicianAId,
        override_reason: 'reviewed on triage',
        status: 'Overridden',
      })
      .eq('id', assessmentAId)
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.final_risk_band).toBe('low');
  });

  it('no insert policy exists for the authenticated role: a clinician cannot directly insert a risk_assessment row', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { error } = await userClient.from('risk_assessment').insert({
      pregnancy_episode_id: episodeAId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });

    expect(error).not.toBeNull();
  });
});
