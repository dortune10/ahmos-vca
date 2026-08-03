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

export default function FrontlinePage() {
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
        setEpisodes(loadedEpisodes);

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
          setError(err instanceof ApiError ? err.message : 'Failed to load caseload.');
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
        eyebrow="Your facility"
        title="My Caseload"
        description="Every pregnancy episode registered at your facility. Open a row to read its notes or record a visit."
      />
      {error && <Notice tone="error">{error}</Notice>}
      {loading ? (
        <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading caseload...
        </p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Status</th>
                <th>Risk band</th>
                <th>EDD</th>
              </tr>
            </thead>
            <tbody>
              {episodes.length === 0 && (
                <tr>
                  <td colSpan={4}>
                    <span className="block py-4 text-ink-muted">No episodes yet.</span>
                  </td>
                </tr>
              )}
              {episodes.map((episode) => (
                <tr key={episode.id} className={riskRowClass(episode.riskBand)}>
                  <td>
                    {/* The person's name is the row's link target: opening a caseload row
                        leads to that episode's frontline view, which is where notes are read
                        and from which the encounter-note form is one further click. */}
                    <Link
                      href={`/frontline/episodes/${episode.id}`}
                      className="font-medium text-ink underline decoration-ink/30 underline-offset-[3px] transition-colors hover:decoration-ink focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ink"
                    >
                      {personNames[episode.personId] ?? `#${episode.personId.slice(-8)}`}
                    </Link>
                  </td>
                  <td>
                    <span className="font-data text-xs uppercase tracking-[0.08em]">
                      {episode.status}
                    </span>
                  </td>
                  <td>
                    <RiskBadge band={episode.riskBand} fallback="—" />
                  </td>
                  <td>
                    <span className="whitespace-nowrap font-data text-xs">
                      {episode.estimatedDeliveryDate ?? '—'}
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
