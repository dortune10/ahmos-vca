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
  it('maps chw, nurse, clinician, and supervisor to their dashboard prefixes', () => {
    expect(ROLE_HOME_ROUTE).toEqual({
      chw: '/frontline',
      nurse: '/frontline',
      clinician: '/clinician',
      supervisor: '/supervisor',
    });
  });
});

describe('resolveRedirectForRole', () => {
  it('redirects a chw hitting a route outside /frontline back to /frontline', () => {
    expect(resolveRedirectForRole('/admin', 'chw')).toBe('/frontline');
  });

  it('redirects a nurse hitting the clinician dashboard back to /frontline', () => {
    expect(resolveRedirectForRole('/clinician', 'nurse')).toBe('/frontline');
  });

  it('does not redirect when the pathname is already inside the role home route', () => {
    expect(resolveRedirectForRole('/frontline/register', 'nurse')).toBeNull();
  });

  it('does not enforce a redirect for a role with no configured home route yet (e.g. admin, until Plan 8 adds one)', () => {
    expect(resolveRedirectForRole('/anything', 'admin')).toBeNull();
  });
});
