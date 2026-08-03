import Link from 'next/link';
import { PageHeader } from '@/components/ui/page-header';

// Admin's three areas, written out as a described index rather than three bare links in three
// boxes: an administrator lands here rarely and needs to know which area holds the thing they
// came for before clicking. The description sits outside the anchor deliberately — a link
// whose accessible name is a whole sentence is worse to navigate by screen reader, and the
// name is what this page's test pins.
const AREAS: { href: string; label: string; detail: string }[] = [
  {
    href: '/admin/facilities',
    label: 'Facilities',
    detail: 'Add facilities and control which ones are currently accepting referrals.',
  },
  {
    href: '/admin/staff',
    label: 'Staff',
    detail: 'Create staff accounts and set the role and facility each one works under.',
  },
  {
    href: '/admin/audit',
    label: 'Audit Log',
    detail: 'Every recorded change, by actor and entity, filterable by entity type.',
  },
];

export default function AdminHomePage() {
  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Tenant administration"
        title="Admin"
        description="Configuration for your whole tenant. Changes here affect every facility and every user in it."
      />

      <ul className="border-t border-ink/15">
        {AREAS.map((area) => (
          <li
            key={area.href}
            className="border-b border-ink/15 py-5 md:grid md:grid-cols-[14rem_1fr] md:items-baseline md:gap-8"
          >
            <Link
              href={area.href}
              className="font-display text-xl text-ink underline decoration-ink/25 decoration-1 underline-offset-[5px] transition-colors hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
            >
              {area.label}
            </Link>
            <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-ink-soft md:mt-0">
              {area.detail}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}
