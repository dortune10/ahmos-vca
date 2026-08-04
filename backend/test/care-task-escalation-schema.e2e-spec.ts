import { createClient } from '@supabase/supabase-js';

describe('care_task danger_sign_escalation task_type', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let facilityId: string;
  let personId: string;
  let episodeId: string;

  beforeAll(async () => {
    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Escalation Schema Test Clinic', type: 'clinic' })
      .select()
      .single();
    facilityId = facility!.id;
    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Escalation Schema Test Person' })
      .select()
      .single();
    personId = person!.id;
    const { data: episode } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    episodeId = episode!.id;
  });

  afterAll(async () => {
    await admin.from('care_task').delete().eq('pregnancy_episode_id', episodeId);
    await admin.from('pregnancy_episode').delete().eq('id', episodeId);
    await admin.from('person').delete().eq('id', personId);
    await admin.from('facility').delete().eq('id', facilityId);
  });

  it('accepts a danger_sign_escalation task_type', async () => {
    const { error } = await admin.from('care_task').insert({
      pregnancy_episode_id: episodeId,
      task_type: 'danger_sign_escalation',
      due_at: new Date().toISOString(),
      status: 'Due',
      priority: 'urgent',
    });
    expect(error).toBeNull();
  });

  it('still rejects an unrecognized task_type', async () => {
    const { error } = await admin.from('care_task').insert({
      pregnancy_episode_id: episodeId,
      task_type: 'not_a_real_type',
      due_at: new Date().toISOString(),
      status: 'Due',
      priority: 'urgent',
    });
    expect(error).not.toBeNull();
  });

  it('still accepts the original anc_visit task_type', async () => {
    const { error } = await admin.from('care_task').insert({
      pregnancy_episode_id: episodeId,
      task_type: 'anc_visit',
      due_at: new Date().toISOString(),
      status: 'Scheduled',
      priority: 'routine',
    });
    expect(error).toBeNull();
  });
});
