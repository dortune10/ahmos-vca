import { createClient } from '@supabase/supabase-js';

describe('core schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  it('facility table accepts a valid row and rejects an invalid type', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';

    const { error: goodError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Test Clinic', type: 'clinic' });
    expect(goodError).toBeNull();

    const { error: badError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Bad Type', type: 'not-a-real-type' });
    expect(badError).not.toBeNull();
  });

  it('person table indexes phone_primary for lookup', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    // Idempotent cleanup: this suite runs against the persistent shared `amhos` project (no
    // local/branch reset between test runs — see docs/DECISIONS.md #23), so a prior run's
    // row with this same phone_primary would otherwise duplicate and break the `.single()`
    // lookup below.
    await admin.from('person').delete().eq('phone_primary', '+254700000001');

    const { error } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Amina', phone_primary: '+254700000001' });
    expect(error).toBeNull();

    const { data, error: fetchError } = await admin
      .from('person')
      .select('*')
      .eq('phone_primary', '+254700000001')
      .single();
    expect(fetchError).toBeNull();
    expect(data?.first_name).toBe('Amina');
  });
});
