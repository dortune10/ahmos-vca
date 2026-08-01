import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { ReactNode } from 'react';
import { getCurrentAppUser } from '@/lib/current-user';
import { CurrentUserProvider } from '@/components/current-user-provider';
import { Nav } from '@/components/nav';

// Home route for each MVP role, per docs/DECISIONS.md #20 and the design spec's Section 3
// routing table. Plan 6 (Clinician), Plan 7 (Supervisor), and Plan 8 (Admin) each add their
// own one-line entry here when they build their dashboard — this map is the single
// extension point for "where does role X land after login." No `admin` entry yet by
// design; Plan 8 adds it.
export const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
};

// Pure, framework-free, and unit-tested directly (see layout.test.ts) — this is the actual
// decision logic; everything else in this file is Next.js plumbing around it.
export function resolveRedirectForRole(pathname: string, role: string): string | null {
  const homeRoute = ROLE_HOME_ROUTE[role];
  if (!homeRoute) {
    // Role with no configured home route yet (e.g. admin, until Plan 8 adds one): no
    // enforcement here. That role's own plan owns wiring its route in.
    return null;
  }
  return pathname.startsWith(homeRoute) ? null : homeRoute;
}

export default async function DashboardsLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentAppUser();
  if (!user) {
    redirect('/login');
  }

  const pathname = headers().get('x-pathname') ?? '';
  const redirectTo = resolveRedirectForRole(pathname, user.role);
  if (redirectTo) {
    redirect(redirectTo);
  }

  return (
    <CurrentUserProvider user={user}>
      <div className="min-h-screen bg-gray-50">
        <Nav user={user} />
        <main className="mx-auto max-w-5xl p-4">{children}</main>
      </div>
    </CurrentUserProvider>
  );
}
