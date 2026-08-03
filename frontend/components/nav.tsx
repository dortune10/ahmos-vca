'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/lib/current-user';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  chw: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/register', label: 'Register' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  nurse: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/register', label: 'Register' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  clinician: [
    { href: '/clinician', label: 'Triage Board' },
    { href: '/clinician/referrals', label: 'Referrals' },
  ],
  supervisor: [
    { href: '/supervisor', label: 'KPIs' },
    { href: '/supervisor/referrals', label: 'Referral SLA' },
  ],
  admin: [{ href: '/admin', label: 'Admin' }],
};

export function Nav({ user }: { user: AppUser }) {
  const router = useRouter();
  const links = NAV_LINKS_BY_ROLE[user.role] ?? [];

  async function handleSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    // Same router.push + router.refresh pairing the login page uses to sign in — needed
    // here too so the root layout's Server Component re-reads the now-cleared session
    // cookie instead of serving a cached RSC payload from while still signed in.
    router.push('/login');
    router.refresh();
  }

  // Ink bar, the same slab the login masthead and the landing page's risk section use, so the
  // app has one horizon across every screen. Chrome gets no colour at all: an active-state
  // highlight or a branded accent here would be exactly the "spend saturation on decoration"
  // the system forbids, and would put a coloured element in a health worker's peripheral
  // vision permanently — competing with the risk badges that are supposed to be the only
  // thing that catches the eye.
  return (
    <nav className="border-b border-ink-line bg-ink">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2.5 px-4 py-3 sm:px-6">
        {/* Deliberately not a link. Every role already has a home link in its own list, and
            this pass is not allowed to add navigation — the wordmark is here to identify the
            system, not to route. */}
        <span className="font-display text-lg leading-none tracking-[0.02em] text-paper">
          AMHOS
        </span>

        {/* On anything narrower than a laptop the links drop to their own full-width row
            beneath the wordmark rather than shrinking; a nav label a health worker cannot
            read is worse than a second row 30px tall. */}
        <div className="order-last flex w-full flex-wrap items-center gap-x-5 gap-y-1.5 lg:order-none lg:w-auto">
          {links.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="font-data text-xs uppercase tracking-[0.12em] text-paper underline-offset-[6px] transition-colors hover:text-white hover:underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-paper"
            >
              {link.label}
            </Link>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3 sm:gap-4">
          <span className="font-data text-[0.6875rem] leading-4 tracking-tight text-ink-pale">
            {user.fullName} ({user.role})
          </span>
          <Button type="button" variant="ghost" onClick={handleSignOut}>
            Sign out
          </Button>
        </div>
      </div>
    </nav>
  );
}
