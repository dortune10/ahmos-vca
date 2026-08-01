import { createClient } from '@/lib/supabase/server';
import { getCurrentAppUser } from './current-user';

jest.mock('@/lib/supabase/server');

const mockedCreateClient = createClient as jest.MockedFunction<typeof createClient>;

function buildSupabaseMock(options: { hasSession: boolean; appUserRow?: Record<string, unknown> }) {
  return {
    auth: {
      getSession: jest.fn().mockResolvedValue({
        data: { session: options.hasSession ? { user: { id: 'u1' } } : null },
      }),
    },
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            options.appUserRow
              ? { data: options.appUserRow, error: null }
              : { data: null, error: { message: 'not found' } },
        }),
      }),
    }),
  } as any;
}

describe('getCurrentAppUser', () => {
  it('returns null when there is no active session', async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ hasSession: false }));

    const result = await getCurrentAppUser();

    expect(result).toBeNull();
  });

  it('returns the mapped AppUser when a session and app_user row both exist', async () => {
    mockedCreateClient.mockResolvedValue(
      buildSupabaseMock({
        hasSession: true,
        appUserRow: {
          id: 'u1',
          tenant_id: 't1',
          role: 'chw',
          facility_id: 'f1',
          full_name: 'Amina CHW',
          email: 'amina@example.com',
        },
      }),
    );

    const result = await getCurrentAppUser();

    expect(result).toEqual({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      fullName: 'Amina CHW',
      email: 'amina@example.com',
    });
  });

  it('returns null when the session exists but no app_user row is found', async () => {
    mockedCreateClient.mockResolvedValue(buildSupabaseMock({ hasSession: true, appUserRow: undefined }));

    const result = await getCurrentAppUser();

    expect(result).toBeNull();
  });
});
