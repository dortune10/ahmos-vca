'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card, CardTitle } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { nextValidReferralStatuses } from '@/lib/referral-state-machine';

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
}

export default function ClinicianReferralsPage() {
  const user = useCurrentUser();
  const [incoming, setIncoming] = useState<Referral[]>([]);
  const [outgoing, setOutgoing] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  useEffect(() => {
    if (!user.facilityId) {
      setLoading(false);
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    let cancelled = false;

    Promise.all([
      apiFetch<Referral[]>(`/referrals?facilityId=${user.facilityId}&direction=incoming`),
      apiFetch<Referral[]>(`/referrals?facilityId=${user.facilityId}&direction=outgoing`),
    ])
      .then(([incomingData, outgoingData]) => {
        if (cancelled) return;
        setIncoming(incomingData);
        setOutgoing(outgoingData);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load referrals.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user.facilityId]);

  async function handleTransition(referralId: string, nextStatus: string) {
    setTransitionError(null);
    setTransitioningId(referralId);
    try {
      const updated = await apiFetch<Referral>(`/referrals/${referralId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setIncoming((current) =>
        current.map((referral) => (referral.id === referralId ? updated : referral)),
      );
    } catch (err) {
      // Deliberately `instanceof Error`, not `instanceof ApiError` — see the identical note
      // in the clinician episode detail page's override handler. Any thrown Error's own
      // message should surface as-is; gating on the specific ApiError class identity would
      // silently swallow real 409 REFERRAL_INVALID_STATE messages in some test/mocking
      // setups even though production always throws a real ApiError here.
      setTransitionError(err instanceof Error ? err.message : 'Failed to update referral status.');
    } finally {
      setTransitioningId(null);
    }
  }

  if (loading) {
    return (
      <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
        Loading referrals...
      </p>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Your facility"
        title="Referrals"
        description="Referrals arriving at and leaving your facility. Move an incoming referral to its next state as it happens — the trail is what the SLA report reads."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {transitionError && (
        <Notice tone="error" label="Status not changed">
          {transitionError}
        </Notice>
      )}
      {!error && (
        <>
          <Card>
            <CardTitle>Incoming (to your facility)</CardTitle>
            <div className="mt-4">
              <Table>
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Urgency</th>
                    <th>Status</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {incoming.length === 0 && (
                    <tr>
                      <td colSpan={4}>
                        <span className="block py-4 text-ink-muted">No incoming referrals.</span>
                      </td>
                    </tr>
                  )}
                  {incoming.map((referral) => (
                    <tr key={referral.id}>
                      <td>
                        <span className="text-ink">{referral.reasonCode}</span>
                      </td>
                      <td>
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
                      <td className="whitespace-nowrap">
                        <span className="inline-flex flex-wrap gap-2">
                          {nextValidReferralStatuses(referral.status).map((nextStatus) => (
                            <Button
                              key={nextStatus}
                              variant="secondary"
                              disabled={transitioningId === referral.id}
                              onClick={() => handleTransition(referral.id, nextStatus)}
                            >
                              {nextStatus}
                            </Button>
                          ))}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>

          <Card>
            <CardTitle>Outgoing (from your facility)</CardTitle>
            <div className="mt-4">
              <Table>
                <thead>
                  <tr>
                    <th>Reason</th>
                    <th>Urgency</th>
                    <th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {outgoing.length === 0 && (
                    <tr>
                      <td colSpan={3}>
                        <span className="block py-4 text-ink-muted">No outgoing referrals.</span>
                      </td>
                    </tr>
                  )}
                  {outgoing.map((referral) => (
                    <tr key={referral.id}>
                      <td>
                        <span className="text-ink">{referral.reasonCode}</span>
                      </td>
                      <td>
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
                    </tr>
                  ))}
                </tbody>
              </Table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}
