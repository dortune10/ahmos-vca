'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';

export interface EncounterNoteVitals {
  bpSystolic?: number | null;
  bpDiastolic?: number | null;
  temperatureC?: number | null;
  hemoglobinGdl?: number | null;
}

export interface EncounterNote {
  id: string;
  pregnancyEpisodeId: string;
  recordedBy: string;
  recordedAt: string;
  noteText: string | null;
  vitals: EncounterNoteVitals | null;
  createdAt: string;
}

// Only the vitals the encounter-note forms can actually record are labelled here, in the
// same order both forms present them, so a note reads back in the order it was entered.
const VITAL_LABELS: { key: keyof EncounterNoteVitals; label: string; unit: string }[] = [
  { key: 'bpSystolic', label: 'BP systolic', unit: 'mmHg' },
  { key: 'bpDiastolic', label: 'BP diastolic', unit: 'mmHg' },
  { key: 'temperatureC', label: 'Temperature', unit: '°C' },
  { key: 'hemoglobinGdl', label: 'Hemoglobin', unit: 'g/dL' },
];

export function formatVitals(vitals: EncounterNoteVitals | null): string | null {
  if (!vitals) {
    return null;
  }
  const parts = VITAL_LABELS.filter(({ key }) => vitals[key] !== null && vitals[key] !== undefined).map(
    ({ key, label, unit }) => `${label} ${vitals[key]} ${unit}`,
  );
  return parts.length > 0 ? parts.join(' · ') : null;
}

/**
 * Read surface for `encounter_note`. Until this existed the table was write-only from the
 * application's perspective — notes went in via the encounter-note forms and the only
 * reader was the risk engine, which consumes `vitals_json` and never shows `note_text` to
 * anyone. Rendered on both the clinician and the frontline episode pages so every role that
 * can write a note can also read the resulting record back.
 *
 * `refreshToken` lets a parent that just saved a note force a re-fetch without remounting.
 */
export function EncounterNoteList({
  episodeId,
  refreshToken = 0,
}: {
  episodeId: string;
  refreshToken?: number;
}) {
  const [notes, setNotes] = useState<EncounterNote[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    apiFetch<EncounterNote[]>(`/pregnancy-episodes/${episodeId}/encounter-notes`)
      .then((data) => {
        if (cancelled) return;
        setNotes(data);
        setError(null);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof ApiError ? err.message : 'Failed to load encounter notes.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [episodeId, refreshToken]);

  return (
    <Card>
      <h2 className="text-lg font-medium">Encounter Notes</h2>
      {loading && <p className="text-sm text-gray-500">Loading encounter notes...</p>}
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {!loading && !error && notes.length === 0 && (
        <p className="text-sm text-gray-500">No encounter notes recorded yet.</p>
      )}
      {!loading && !error && notes.length > 0 && (
        <ol className="divide-y divide-gray-200">
          {notes.map((note) => {
            const vitalsSummary = formatVitals(note.vitals);
            return (
              <li key={note.id} className="space-y-1 py-3 first:pt-0 last:pb-0">
                <p className="text-xs text-gray-500">{new Date(note.recordedAt).toLocaleString()}</p>
                {note.noteText ? (
                  <p className="whitespace-pre-wrap text-sm text-gray-900">{note.noteText}</p>
                ) : (
                  <p className="text-sm italic text-gray-500">No narrative recorded.</p>
                )}
                {vitalsSummary && <p className="text-sm text-gray-700">{vitalsSummary}</p>}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
