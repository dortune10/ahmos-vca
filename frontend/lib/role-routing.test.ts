import { ROLE_HOME_ROUTE, resolveRedirectForRole } from './role-routing';

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

  // Nurses need referral creation, which used to exist only on the clinician episode page.
  // That was fixed by rendering the shared ReferralCreateForm on the frontline episode page,
  // NOT by punching a hole in this rule — the clinician episode page also carries the
  // risk-band override, which is not a nurse action. This asserts the hole stayed closed.
  it('keeps a nurse out of the clinician episode page even though nurses may create referrals', () => {
    expect(resolveRedirectForRole('/clinician/episodes/e1', 'nurse')).toBe('/frontline');
  });

  it('lets a nurse reach the frontline episode page that hosts referral creation', () => {
    expect(resolveRedirectForRole('/frontline/episodes/e1', 'nurse')).toBeNull();
  });

  it('lets a chw reach the frontline episode page (referral creation is gated in the page, not the router)', () => {
    expect(resolveRedirectForRole('/frontline/episodes/e1', 'chw')).toBeNull();
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
