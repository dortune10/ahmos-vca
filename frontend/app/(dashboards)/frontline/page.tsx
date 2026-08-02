'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">My Caseload</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading caseload...</p>
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
                  <td colSpan={4}>No episodes yet.</td>
                </tr>
              )}
              {episodes.map((episode) => (
                <tr key={episode.id}>
                  <td>{personNames[episode.personId] ?? `#${episode.personId.slice(-8)}`}</td>
                  <td>{episode.status}</td>
                  <td>{episode.riskBand ?? '—'}</td>
                  <td>{episode.estimatedDeliveryDate ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
