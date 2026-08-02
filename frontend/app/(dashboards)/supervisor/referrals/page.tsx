'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Referral SLA Breaches</h1>
      <p className="text-sm text-gray-500">
        Referrals open more than 24 hours since creation without reaching a final status.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading SLA breaches...</p>
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
                  <td colSpan={4}>No SLA breaches right now.</td>
                </tr>
              )}
              {referrals.map((referral) => (
                <tr key={referral.id}>
                  <td>#{referral.pregnancyEpisodeId.slice(-8)}</td>
                  <td>{referral.urgency}</td>
                  <td>{referral.status}</td>
                  <td>{hoursOpen(referral.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
