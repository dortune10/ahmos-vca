import { createClient } from '@supabase/supabase-js';

describe('risk_assessment schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let episodeId: string;

  beforeAll(async () => {
    const { data: facility, error: facilityError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Risk Schema Test Clinic', type: 'clinic' })
      .select()
      .single();
    expect(facilityError).toBeNull();

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Risk', phone_primary: '+254700000098' })
      .select()
      .single();
    expect(personError).toBeNull();

    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: person!.id, facility_id: facility!.id, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();
    episodeId = episode!.id;
  });

  it('accepts a valid risk_assessment row', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 2,
      ml_score: 2,
      final_risk_band: 'high',
      explanation_json: { ruleFactors: [] },
      status: 'Computed',
    });
    expect(error).toBeNull();
  });

  it('rejects an invalid final_risk_band', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 0,
      final_risk_band: 'catastrophic',
      explanation_json: {},
      status: 'Computed',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid status', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'NotARealStatus',
    });
    expect(error).not.toBeNull();
  });

  it('rejects a missing pregnancy_episode_id foreign key', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: '99999999-9999-9999-9999-999999999999',
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });
    expect(error).not.toBeNull();
  });
});
