'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { RiskBadge } from '@/components/ui/risk-badge';
import { riskRowClass } from '@/lib/risk-band';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Person {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string | null;
  phonePrimary: string | null;
  dateOfBirth: string | null;
}

// Highest urgency first. An episode with no risk band yet (assessment still pending) sorts
// after every scored band, not before it — "not yet triaged" is not the same as "known
// low risk," and treating it that way would bury it under low-risk cases.
const RISK_BAND_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
function riskBandRank(riskBand: string | null): number {
  return riskBand !== null && riskBand in RISK_BAND_ORDER ? RISK_BAND_ORDER[riskBand] : 3;
}

// Secondary sort key: soonest estimated delivery date first. Decided here because
// pregnancy_episode carries no standalone "urgency" field of its own (that lives on
// referral.urgency and care_task.priority, neither fetched by this list) — see this task's
// write-up.
function sortEpisodes(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    const rankDiff = riskBandRank(a.riskBand) - riskBandRank(b.riskBand);
    if (rankDiff !== 0) return rankDiff;
    if (!a.estimatedDeliveryDate && !b.estimatedDeliveryDate) return 0;
    if (!a.estimatedDeliveryDate) return 1;
    if (!b.estimatedDeliveryDate) return -1;
    return a.estimatedDeliveryDate.localeCompare(b.estimatedDeliveryDate);
  });
}

export default function ClinicianTriageBoardPage() {
  const user = useCurrentUser();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [personNames, setPersonNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.facilityId) {
      setLoading(false);
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const loadedEpisodes = await apiFetch<Episode[]>(
          `/pregnancy-episodes?facilityId=${user.facilityId}`,
        );
        if (cancelled) return;
        setEpisodes(sortEpisodes(loadedEpisodes));

        const uniquePersonIds = Array.from(new Set(loadedEpisodes.map((e) => e.personId)));
        if (uniquePersonIds.length === 0) {
          return;
        }
        const persons = await apiFetch<Person[]>(`/persons?ids=${uniquePersonIds.join(',')}`);
        if (cancelled) return;
        const nameById: Record<string, string> = {};
        for (const person of persons) {
          nameById[person.id] = [person.firstName, person.lastName].filter(Boolean).join(' ');
        }
        setPersonNames(nameById);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load triage board.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user.facilityId]);

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Your facility · highest risk first"
        title="Facility Triage Board"
        description="Ordered by risk band, then by soonest estimated delivery. Episodes with no assessment yet sort last — not triaged is not the same as low risk."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading triage board...
        </p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Risk band</th>
                <th>Status</th>
                <th>EDD</th>
                <th>
                  <span className="sr-only">Episode</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {episodes.length === 0 && (
                <tr>
                  <td colSpan={5}>
                    <span className="block py-4 text-ink-muted">
                      No active episodes at this facility.
                    </span>
                  </td>
                </tr>
              )}
              {episodes.map((episode) => (
                // The high-risk block at the top of the queue carries a 5% band-high wash, so
                // the rows that need a clinician first are findable by shape before any text
                // is read. Measured 15.2:1 for ink on that wash — the tint is a locator, never
                // a substitute for the badge.
                <tr key={episode.id} className={riskRowClass(episode.riskBand)}>
                  <td>
                    <span className="font-medium text-ink">
                      {personNames[episode.personId] ?? `#${episode.personId.slice(-8)}`}
                    </span>
                  </td>
                  <td>
                    <RiskBadge band={episode.riskBand} fallback="unassessed" />
                  </td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em]">
                      {episode.status}
                    </span>
                  </td>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs">
                      {episode.estimatedDeliveryDate ?? '—'}
                    </span>
                  </td>
                  <td>
                    <Link
                      href={`/clinician/episodes/${episode.id}`}
                      className="whitespace-nowrap font-data text-xs uppercase tracking-[0.1em] text-ink underline decoration-ink/30 underline-offset-[3px] transition-colors hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      View
                    </Link>
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
