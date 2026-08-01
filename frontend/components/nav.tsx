import Link from 'next/link';
import type { AppUser } from '@/lib/current-user';

const NAV_LINKS_BY_ROLE: Record<string, { href: string; label: string }[]> = {
  chw: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  nurse: [
    { href: '/frontline', label: 'Caseload' },
    { href: '/frontline/tasks', label: 'Visit Checklist' },
  ],
  clinician: [{ href: '/clinician', label: 'Triage Board' }],
  supervisor: [{ href: '/supervisor', label: 'KPIs' }],
  admin: [{ href: '/admin', label: 'Admin' }],
};

export function Nav({ user }: { user: AppUser }) {
  const links = NAV_LINKS_BY_ROLE[user.role] ?? [];

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
      <span className="text-sm text-gray-500">
        {user.fullName} ({user.role})
      </span>
    </nav>
  );
}
