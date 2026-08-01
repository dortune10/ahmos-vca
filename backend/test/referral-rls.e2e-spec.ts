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

describe('referral RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let originFacilityId: string; // tenant A
  let receivingFacilityId: string; // tenant A, a DIFFERENT facility than the origin
  let otherTenantFacilityId: string; // tenant B
  let clinicianAtReceivingId: string;
  let referralTenantAId: string;
  let referralTenantBId: string;

  beforeAll(async () => {
    const { data: originFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Origin Clinic', type: 'clinic' })
      .select()
      .single();
    originFacilityId = originFacility!.id;

    const { data: receivingFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Receiving Hospital', type: 'hospital', accepting_referrals: true })
      .select()
      .single();
    receivingFacilityId = receivingFacility!.id;

    const { data: otherTenantFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'Other Tenant Facility', type: 'clinic' })
      .select()
      .single();
    otherTenantFacilityId = otherTenantFacility!.id;

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
      .insert({ person_id: personA!.id, facility_id: originFacilityId, status: 'Active' })
      .select()
      .single();

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: otherTenantFacilityId, status: 'Active' })
      .select()
      .single();

    const { data: referralA } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeA!.id,
        from_facility_id: originFacilityId,
        to_facility_id: receivingFacilityId,
        reason_code: 'suspected_preeclampsia',
        urgency: 'urgent',
      })
      .select()
      .single();
    referralTenantAId = referralA!.id;

    const { data: referralB } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeB!.id,
        to_facility_id: otherTenantFacilityId,
        reason_code: 'suspected_preeclampsia',
        urgency: 'routine',
      })
      .select()
      .single();
    referralTenantBId = referralB!.id;

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `clinician-receiving-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    clinicianAtReceivingId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: clinicianAtReceivingId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'clinician',
      facility_id: receivingFacilityId, // staffs the RECEIVING facility, not the origin
      full_name: 'Clinician Receiving',
    });
  });

  it(
    "a clinician staffed at the receiving facility (not the episode's origin facility, " +
      'same tenant) can still see the referral sent to their facility (fails before ' +
      'policies exist: deny-all hides it too)',
    async () => {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAtReceivingId)}` } },
      });

      const { data } = await userClient.from('referral').select('id').eq('id', referralTenantAId);
      const ids = (data ?? []).map((row) => row.id);
      expect(ids).toContain(referralTenantAId);
    },
  );

  it('the same clinician cannot see a referral belonging to a different tenant', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAtReceivingId)}` } },
    });

    const { data } = await userClient.from('referral').select('id');
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).not.toContain(referralTenantBId);
  });
});
