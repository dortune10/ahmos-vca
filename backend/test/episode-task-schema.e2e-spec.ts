import { createClient } from '@supabase/supabase-js';

describe('episode & task schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let facilityId: string;
  let personId: string;

  beforeAll(async () => {
    const { data: facility, error: facilityError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Schema Test Clinic', type: 'clinic' })
      .select()
      .single();
    expect(facilityError).toBeNull();
    facilityId = facility!.id;

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Schema', phone_primary: '+254700000099' })
      .select()
      .single();
    expect(personError).toBeNull();
    personId = person!.id;
  });

  it('pregnancy_episode accepts a valid status and rejects an invalid one', async () => {
    const { error: goodError } = await admin.from('pregnancy_episode').insert({
      person_id: personId,
      facility_id: facilityId,
      status: 'Active',
    });
    expect(goodError).toBeNull();

    const { error: badError } = await admin.from('pregnancy_episode').insert({
      person_id: personId,
      facility_id: facilityId,
      status: 'NotARealStatus',
    });
    expect(badError).not.toBeNull();
  });

  it('care_task accepts a valid task_type/status/priority and rejects an invalid task_type', async () => {
    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();

    const { error: goodError } = await admin.from('care_task').insert({
      pregnancy_episode_id: episode!.id,
      task_type: 'anc_visit',
      due_at: new Date().toISOString(),
      status: 'Scheduled',
      priority: 'routine',
    });
    expect(goodError).toBeNull();

    const { error: badError } = await admin.from('care_task').insert({
      pregnancy_episode_id: episode!.id,
      task_type: 'not-a-real-type',
      due_at: new Date().toISOString(),
    });
    expect(badError).not.toBeNull();
  });

  it('encounter_note accepts note_text and vitals_json', async () => {
    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `nurse-schema-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });

    const { error: appUserError } = await admin.from('app_user').insert({
      id: authUser.user!.id,
      tenant_id: tenantId,
      email: authUser.user!.email,
      role: 'nurse',
      facility_id: facilityId,
      full_name: 'Schema Nurse',
    });
    expect(appUserError).toBeNull();

    const { error: noteError } = await admin.from('encounter_note').insert({
      pregnancy_episode_id: episode!.id,
      recorded_by: authUser.user!.id,
      note_text: 'Patient reports mild headache.',
      vitals_json: { bpSystolic: 120, bpDiastolic: 80, temperatureC: 37.1, hemoglobinGdl: 11.5 },
    });
    expect(noteError).toBeNull();
  });
});
