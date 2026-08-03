'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: 'routine' | 'urgent';
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
}

function hoursOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
}

export default function SupervisorReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Referral[]>('/reports/sla-breaches')
      .then((data) => {
        if (!cancelled) setReferrals(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load SLA breaches.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="All facilities · open > 24h"
        title="Referral SLA Breaches"
        description="Referrals open more than 24 hours since creation without reaching a final status."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading SLA breaches...
        </p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Episode</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Hours Open</th>
              </tr>
            </thead>
            <tbody>
              {referrals.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <span className="block py-4 text-ink-muted">
                      No SLA breaches right now.
                    </span>
                  </td>
                </tr>
              )}
              {referrals.map((referral) => (
                <tr key={referral.id}>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs text-ink">
                      #{referral.pregnancyEpisodeId.slice(-8)}
                    </span>
                  </td>
                  <td>
                    {/* An SLA breach is an operational failure, not a clinical risk band, so
                        an urgent referral is marked by weight and rule — never by hue. */}
                    <span
                      className={`font-data text-xs uppercase tracking-[0.08em] ${
                        referral.urgency === 'urgent'
                          ? 'border-l-2 border-ink pl-1.5 font-medium text-ink'
                          : ''
                      }`}
                    >
                      {referral.urgency}
                    </span>
                  </td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em]">
                      {referral.status}
                    </span>
                  </td>
                  <td>
                    <span className="font-data text-sm tabular-nums text-ink">
                      {hoursOpen(referral.createdAt)}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
