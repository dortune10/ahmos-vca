import { createClient } from '@supabase/supabase-js';

describe('referral schema + pregnancy_episode status extension', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let originFacilityId: string;
  let receivingFacilityId: string;
  let personId: string;
  let episodeId: string;

  beforeAll(async () => {
    const { data: originFacility, error: originError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Origin Clinic', type: 'clinic' })
      .select()
      .single();
    expect(originError).toBeNull();
    originFacilityId = originFacility!.id;

    const { data: receivingFacility, error: receivingError } = await admin
      .from('facility')
      .insert({
        tenant_id: tenantId,
        name: 'Receiving Hospital',
        type: 'hospital',
        accepting_referrals: true,
      })
      .select()
      .single();
    expect(receivingError).toBeNull();
    receivingFacilityId = receivingFacility!.id;

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Referral', phone_primary: '+254700000100' })
      .select()
      .single();
    expect(personError).toBeNull();
    personId = person!.id;

    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: originFacilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();
    episodeId = episode!.id;
  });

  it('pregnancy_episode now accepts Admitted and Cancelled', async () => {
    const { error: admittedError } = await admin
      .from('pregnancy_episode')
      .update({ status: 'Admitted' })
      .eq('id', episodeId);
    expect(admittedError).toBeNull();

    const { error: cancelledError } = await admin
      .from('pregnancy_episode')
      .update({ status: 'Cancelled' })
      .eq('id', episodeId);
    expect(cancelledError).toBeNull();

    await admin.from('pregnancy_episode').update({ status: 'Active' }).eq('id', episodeId);
  });

  it('pregnancy_episode still rejects an invalid status after the extension', async () => {
    const { error } = await admin
      .from('pregnancy_episode')
      .update({ status: 'NotARealStatus' })
      .eq('id', episodeId);
    expect(error).not.toBeNull();
  });

  it('referral accepts a valid row and rejects an invalid urgency/status', async () => {
    const { error: goodError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      from_facility_id: originFacilityId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'urgent',
    });
    expect(goodError).toBeNull();

    const { error: badUrgencyError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'not-a-real-urgency',
    });
    expect(badUrgencyError).not.toBeNull();

    const { error: badStatusError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'urgent',
      status: 'NotARealStatus',
    });
    expect(badStatusError).not.toBeNull();
  });

  it('referral requires to_facility_id but allows a null from_facility_id', async () => {
    const { error } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      from_facility_id: null,
      to_facility_id: receivingFacilityId,
      reason_code: 'community_escalation',
      urgency: 'routine',
    });
    expect(error).toBeNull();

    const { error: missingToFacilityError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      reason_code: 'community_escalation',
      urgency: 'routine',
    });
    expect(missingToFacilityError).not.toBeNull();
  });
});
