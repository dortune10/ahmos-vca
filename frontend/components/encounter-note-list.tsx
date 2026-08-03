'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';

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
      <CardTitle>Encounter Notes</CardTitle>
      {loading && (
        <p className="mt-3 font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
          Loading encounter notes...
        </p>
      )}
      {error && (
        <Notice tone="error" className="mt-3">
          {error}
        </Notice>
      )}
      {!loading && !error && notes.length === 0 && (
        <p className="mt-3 text-sm text-ink-muted">No encounter notes recorded yet.</p>
      )}
      {!loading && !error && notes.length > 0 && (
        // A visit history is a ledger, so it reads as ruled entries rather than as cards:
        // the timestamp is the index, the narrative is the entry, the vitals are the figures.
        <ol className="mt-4 divide-y divide-paper-rule border-t border-paper-rule">
          {notes.map((note) => {
            const vitalsSummary = formatVitals(note.vitals);
            return (
              <li key={note.id} className="py-3.5 first:pt-3 last:pb-0">
                <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.14em] text-ink-muted">
                  {new Date(note.recordedAt).toLocaleString()}
                </p>
                {note.noteText ? (
                  <p className="mt-1.5 whitespace-pre-wrap text-sm leading-relaxed text-ink">
                    {note.noteText}
                  </p>
                ) : (
                  <p className="mt-1.5 text-sm italic text-ink-muted">No narrative recorded.</p>
                )}
                {/* Vitals stay one string in one element — `formatVitals` is what the tests
                    assert against, and a reading split across chips would break the record
                    into fragments a clinician has to reassemble. */}
                {vitalsSummary && (
                  <p className="mt-2 font-data text-xs leading-relaxed text-ink-soft">
                    {vitalsSummary}
                  </p>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </Card>
  );
}
