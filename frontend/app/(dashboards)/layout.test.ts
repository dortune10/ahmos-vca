// These mocks isolate the pure routing logic below from the Next.js/Supabase runtime code
// the same file also contains (the default-exported layout component uses headers(),
// redirect(), and getCurrentAppUser() — none of which this test exercises or needs). Nav
// is mocked too even though it's a real module by this point, to keep this test focused
// purely on the routing logic.
jest.mock('next/headers', () => ({ headers: jest.fn() }));
jest.mock('next/navigation', () => ({ redirect: jest.fn() }));
jest.mock('@/lib/current-user', () => ({ getCurrentAppUser: jest.fn() }));
jest.mock('@/components/current-user-provider', () => ({
  CurrentUserProvider: ({ children }: { children: unknown }) => children,
}));
jest.mock('@/components/nav', () => ({ Nav: () => null }));

import { ROLE_HOME_ROUTE, resolveRedirectForRole } from './layout';

describe('ROLE_HOME_ROUTE', () => {
  it('maps chw, nurse, clinician, supervisor, and admin to their dashboard prefixes', () => {
    expect(ROLE_HOME_ROUTE).toEqual({
      chw: '/frontline',
      nurse: '/frontline',
      clinician: '/clinician',
      supervisor: '/supervisor',
      admin: '/admin',
    });
  });
});

describe('resolveRedirectForRole', () => {
  it('redirects a chw hitting a route outside /frontline back to /frontline', () => {
    expect(resolveRedirectForRole('/reports', 'chw')).toBe('/frontline');
  });

  it('redirects a nurse hitting the clinician dashboard back to /frontline', () => {
    expect(resolveRedirectForRole('/clinician', 'nurse')).toBe('/frontline');
  });

  it('redirects an admin hitting a non-admin route back to /admin', () => {
    expect(resolveRedirectForRole('/frontline', 'admin')).toBe('/admin');
  });

  it('does not redirect when the pathname is already inside the role home route', () => {
    expect(resolveRedirectForRole('/frontline/register', 'nurse')).toBeNull();
  });

  it('does not redirect when the pathname is already inside the admin home route', () => {
    expect(resolveRedirectForRole('/admin/facilities', 'admin')).toBeNull();
  });

  it('does not enforce a redirect for a role with no configured home route (e.g. an unrecognized role value)', () => {
    expect(resolveRedirectForRole('/anything', 'unknown-role')).toBeNull();
  });
});
