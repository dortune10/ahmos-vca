'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { AppUser } from '@/lib/current-user';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';

const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  chw: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  nurse: [
    { href: '/frontline', label: 'Caseload' },
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

  return (
    <nav className="flex items-center justify-between border-b bg-white px-4 py-3">
      <div className="flex gap-4">
        {links.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            {link.label}
          </Link>
        ))}
      </div>
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-500">
          {user.fullName} ({user.role})
        </span>
        <Button type="button" variant="secondary" onClick={handleSignOut}>
          Sign out
        </Button>
      </div>
    </nav>
  );
}
