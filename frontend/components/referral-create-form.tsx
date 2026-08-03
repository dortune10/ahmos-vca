'use client';

import { FormEvent, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { isEpisodeEligibleForReferral } from '@/lib/referral-state-machine';

interface Facility {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  contactPhone: string | null;
  acceptingReferrals: boolean;
}

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: string;
  status: string;
  createdAt: string;
}

/**
 * Referral creation, shared by the clinician episode page and the frontline (nurse) episode
 * page. Referral creation is a clinician/nurse action, so it necessarily renders under two
 * different dashboards; keeping one implementation means the eligibility rule, the
 * accepting-facilities filter and the request body cannot drift apart between them.
 *
 * Callers own the role gate — this component renders for whoever is given it.
 */
export function ReferralCreateForm({
  episodeId,
  episodeStatus,
}: {
  episodeId: string;
  episodeStatus: string;
}) {
  const user = useCurrentUser();
  const eligible = isEpisodeEligibleForReferral(episodeStatus);

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [toFacilityId, setToFacilityId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent'>('routine');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<Referral | null>(null);

  useEffect(() => {
    if (!eligible) {
      return;
    }
    let cancelled = false;
    apiFetch<Facility[]>('/facilities?acceptingReferrals=true')
      .then((data) => {
        if (!cancelled) setFacilities(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load receiving facilities.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [eligible]);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setCreated(null);

    if (!toFacilityId) {
      setError('Select a receiving facility.');
      return;
    }
    if (!reasonCode.trim()) {
      setError('A reason is required.');
      return;
    }

    setSubmitting(true);
    try {
      const referral = await apiFetch<Referral>('/referrals', {
        method: 'POST',
        body: {
          pregnancyEpisodeId: episodeId,
          toFacilityId,
          fromFacilityId: user.facilityId ?? undefined,
          reasonCode,
          urgency,
        },
      });
      setCreated(referral);
      setToFacilityId('');
      setReasonCode('');
      setUrgency('routine');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create referral.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <h2 className="text-lg font-medium">Create Referral</h2>
      {!eligible ? (
        <p className="text-sm text-gray-500">
          Referral creation is not available while this episode is {episodeStatus}.
        </p>
      ) : (
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="to-facility" className="text-sm font-medium text-gray-700">
              Receiving facility
            </label>
            <select
              id="to-facility"
              value={toFacilityId}
              onChange={(e) => setToFacilityId(e.target.value)}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="">Select a facility</option>
              {facilities.map((facility) => (
                <option key={facility.id} value={facility.id}>
                  {facility.name}
                </option>
              ))}
            </select>
          </div>
          <Input label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
          <div className="flex flex-col gap-1">
            <label htmlFor="urgency" className="text-sm font-medium text-gray-700">
              Urgency
            </label>
            <select
              id="urgency"
              value={urgency}
              onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent')}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm"
            >
              <option value="routine">routine</option>
              <option value="urgent">urgent</option>
            </select>
          </div>
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          {created && (
            <p className="text-sm text-green-700">Referral created (status: {created.status}).</p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create referral'}
          </Button>
        </form>
      )}
    </Card>
  );
}
