import { createClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string; // from dashboard: Settings → API → JWT Settings

function tokenFor(userId: string, role: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('facility RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let chwUserId: string;

  beforeAll(async () => {
    // Idempotent cleanup: this suite runs against the persistent shared `amhos` project
    // (no local/branch reset between test runs — see docs/DECISIONS.md #23), so a prior
    // run's fixed-ID facility rows and fixed-email auth user would otherwise collide with
    // this run's inserts. Remove any leftovers before creating fresh fixtures.
    await admin.from('app_user').delete().eq('email', 'chw-a@example.com');
    const { data: existingUsersPage } = await admin.auth.admin.listUsers();
    const existingUser = existingUsersPage?.users.find((u) => u.email === 'chw-a@example.com');
    if (existingUser) {
      await admin.auth.admin.deleteUser(existingUser.id);
    }
    await admin
      .from('facility')
      .delete()
      .in('id', ['aaaaaaaa-0000-0000-0000-000000000001', 'bbbbbbbb-0000-0000-0000-000000000001']);

    await admin.from('facility').insert([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', tenant_id: tenantA, name: 'A Clinic', type: 'clinic' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000001', tenant_id: tenantB, name: 'B Clinic', type: 'clinic' },
    ]);

    const { data: authUser } = await admin.auth.admin.createUser({
      email: 'chw-a@example.com',
      password: 'test-password-123',
      email_confirm: true,
    });
    chwUserId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: chwUserId,
      tenant_id: tenantA,
      email: 'chw-a@example.com',
      role: 'chw',
      facility_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      full_name: 'CHW A',
    });
  });

  it('a CHW in tenant A cannot see tenant B facilities', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(chwUserId, 'chw')}` } },
    });

    const { data } = await userClient.from('facility').select('*');
    const tenantIds = (data ?? []).map((f) => f.tenant_id);
    expect(tenantIds).not.toContain(tenantB);
    expect(tenantIds).toContain(tenantA); // fails now — no policy grants SELECT at all yet
  });
});
