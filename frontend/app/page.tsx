import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getCurrentAppUser } from '@/lib/current-user';
import { ROLE_HOME_ROUTE } from '@/lib/role-routing';
import { LandingPage } from '@/components/landing/landing-page';

export const metadata: Metadata = {
  title: 'AMHOS — Maternal and newborn care coordination',
  description:
    'AMHOS is a care-coordination platform for maternal and newborn health in low-resource settings. Community health workers, midwives, clinicians and district supervisors work from one shared record, from pregnancy registration through referral to postnatal follow-up.',
};

export default async function RootPage() {
  const user = await getCurrentAppUser();

  // Unauthenticated visitors get the public landing page. Signed-in staff must never see
  // it: the role redirect below is the load-bearing behaviour of this route and predates
  // the landing page entirely.
  if (!user) {
    return <LandingPage />;
  }

  const homeRoute = ROLE_HOME_ROUTE[user.role];
  if (homeRoute) {
    redirect(homeRoute);
  }

  // Authenticated successfully, but this role has no dashboard built yet (e.g. admin,
  // until Plan 8 is executed — see ROLE_HOME_ROUTE's own comment in lib/role-routing.ts).
  // Falling back to redirect('/login') here (the previous behavior) made a *successful*
  // sign-in for this role look identical to a failed one — real bug, not just a rough edge:
  // it's what made the bootstrap admin account appear unable to log in at all.
  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <div className="max-w-sm text-center text-sm text-gray-600">
        <p className="mb-2 font-medium text-gray-900">Signed in as {user.email}</p>
        <p>
          There&apos;s no dashboard built yet for the &quot;{user.role}&quot; role. Use the
          API directly with this account in the meantime.
        </p>
      </div>
    </div>
  );
}
