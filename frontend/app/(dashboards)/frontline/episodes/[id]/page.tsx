'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { EncounterNoteList } from '@/components/encounter-note-list';
import { ReferralCreateForm } from '@/components/referral-create-form';
import { WhatsAppEnrolmentCodeCard } from '@/components/whatsapp-enrolment-code-card';

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

/**
 * Frontline episode view — the landing point for a caseload row, and the only place a CHW or
 * nurse can read an episode's recorded encounter notes back.
 *
 * It also hosts referral creation for nurses. Referral creation is a clinician/nurse action,
 * but the only form for it used to live under /clinician, which `resolveRedirectForRole`
 * bounces every nurse away from. Surfacing the shared form here rather than widening that
 * routing rule keeps nurses out of the clinician dashboard's other tools (notably the risk-band
 * override) and gives a CHW nothing new — the gate below is `role === 'nurse'`, not "not a CHW".
 */
export default function FrontlineEpisodeDetailPage() {
  const user = useCurrentUser();
  const params = useParams<{ id: string }>();
  const episodeId = params.id;
  const canCreateReferral = user.role === 'nurse';

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [personName, setPersonName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const loadedEpisode = await apiFetch<Episode>(`/pregnancy-episodes/${episodeId}`);
        if (cancelled) return;
        setEpisode(loadedEpisode);

        // Same batch endpoint the caseload uses, for the single person on this episode. A
        // failure here must not blank the whole page — the episode itself already loaded,
        // and the header falls back to the short reference the caseload also shows.
        try {
          const persons = await apiFetch<Person[]>(`/persons?ids=${loadedEpisode.personId}`);
          if (cancelled) return;
          const person = persons[0];
          if (person) {
            setPersonName([person.firstName, person.lastName].filter(Boolean).join(' '));
          }
        } catch {
          // Name stays null; the short person reference is shown instead.
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load episode.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  if (loading) {
    return <p>Loading episode...</p>;
  }

  if (error || !episode) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'Episode not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-xl font-semibold">
          {personName ?? `#${episode.personId.slice(-8)}`}
        </h1>
        <Link
          href="/frontline"
          className="text-sm font-medium text-gray-700 hover:text-gray-900"
        >
          Back to caseload
        </Link>
      </div>

      <Card>
        <h2 className="text-lg font-medium">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Status</dt>
          <dd>{episode.status}</dd>
          <dt className="text-gray-500">Gestational age</dt>
          <dd>{episode.gestationalAgeWeeks ?? '—'} weeks</dd>
          <dt className="text-gray-500">Estimated delivery date</dt>
          <dd>{episode.estimatedDeliveryDate ?? '—'}</dd>
          <dt className="text-gray-500">Risk band</dt>
          <dd>{episode.riskBand ?? 'unassessed'}</dd>
        </dl>
        <Link
          href={`/frontline/episodes/${episode.id}/encounter-note`}
          className="mt-4 inline-flex items-center rounded-md bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-700"
        >
          Record encounter note
        </Link>
      </Card>

      {/* Directly under the overview, above the clinical history: enrolling a patient on
          WhatsApp is something a health worker does while she is standing there, not after
          scrolling past every note. Ungated by role — CHW and nurse both register patients and
          both need to hand the code over. */}
      <WhatsAppEnrolmentCodeCard personId={episode.personId} />

      <EncounterNoteList episodeId={episodeId} />

      {canCreateReferral && (
        <ReferralCreateForm episodeId={episodeId} episodeStatus={episode.status} />
      )}
    </div>
  );
}
