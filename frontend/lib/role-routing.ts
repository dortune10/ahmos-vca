// Home route for each MVP role, per docs/DECISIONS.md #20 and the design spec's Section 3
// routing table. All five MVP roles (chw, nurse, clinician, supervisor, admin) are mapped
// as of Plan 8 — this map is the single extension point for "where does role X land after
// login."
export const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
  admin: '/admin',
};

export function resolveRedirectForRole(pathname: string, role: string): string | null {
  const homeRoute = ROLE_HOME_ROUTE[role];
  if (!homeRoute) {
    // Role with no configured home route yet (e.g. admin, until Plan 8 adds one): no
    // enforcement here. That role's own plan owns wiring its route in.
    return null;
  }
  return pathname.startsWith(homeRoute) ? null : homeRoute;
}
