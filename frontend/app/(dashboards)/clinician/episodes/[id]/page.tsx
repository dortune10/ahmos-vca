'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EncounterNoteList } from '@/components/encounter-note-list';
import { ReferralCreateForm } from '@/components/referral-create-form';

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

interface RuleFactor {
  factor: string;
  band: 'low' | 'medium' | 'high' | null;
  detail: string;
}

interface RiskAssessment {
  id: string;
  pregnancyEpisodeId: string;
  assessmentTime: string;
  ruleScore: number;
  mlScore: number | null;
  finalRiskBand: 'low' | 'medium' | 'high';
  explanation: {
    ruleFactors: RuleFactor[];
    mlReasoning?: string;
    mlDisagreement?: { ruleBand: string; mlBand: string; resolution: string };
    mlError?: string;
  };
  overriddenBy: string | null;
  overrideReason: string | null;
  status: 'Pending' | 'Computed' | 'Overridden' | 'Failed' | 'FallbackRuleOnly';
  createdAt: string;
}

export default function ClinicianEpisodeDetailPage() {
  const params = useParams<{ id: string }>();
  const episodeId = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);
  // Bumped after a successful save so the notes list below re-fetches and the clinician
  // immediately sees the note they just wrote, rather than having to reload the page.
  const [noteRefreshToken, setNoteRefreshToken] = useState(0);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideBand, setOverrideBand] = useState<'low' | 'medium' | 'high'>('low');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [loadedEpisode, latestRisk] = await Promise.all([
          apiFetch<Episode>(`/pregnancy-episodes/${episodeId}`),
          // Typed `RiskAssessment | null | undefined`, not just `| null`, because the real
          // backend sends an empty response body (Content-Length: 0) when there is no
          // assessment yet, not the literal JSON string "null" — apiFetch's
          // `rawBody ? JSON.parse(rawBody) : undefined` resolves an empty body to
          // `undefined`. Every test in this file mocks apiFetch directly and hands back the
          // JS value `null` literally, which is why this never failed in Jest; only a real
          // browser hitting the real endpoint surfaced it. Normalized to `null` immediately
          // below so every other `riskAssessment === null` check in this component stays
          // correct without having to special-case `undefined` everywhere.
          apiFetch<RiskAssessment | null | undefined>(
            `/pregnancy-episodes/${episodeId}/risk-assessments/latest`,
          ),
        ]);
        if (cancelled) return;
        setEpisode(loadedEpisode);
        setRiskAssessment(latestRisk ?? null);
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

  async function handleNoteSubmit(event: FormEvent) {
    event.preventDefault();
    setNoteSubmitting(true);
    setNoteError(null);
    setNoteSaved(false);

    try {
      const body: { noteText?: string; vitals?: Record<string, number> } = {};
      if (noteText) {
        body.noteText = noteText;
      }
      const vitals: Record<string, number> = {};
      if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
      if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
      if (temperatureC) vitals.temperatureC = Number(temperatureC);
      if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
      if (Object.keys(vitals).length > 0) {
        body.vitals = vitals;
      }

      await apiFetch(`/pregnancy-episodes/${episodeId}/encounter-notes`, {
        method: 'POST',
        body,
      });

      setNoteText('');
      setBpSystolic('');
      setBpDiastolic('');
      setTemperatureC('');
      setHemoglobinGdl('');
      setNoteSaved(true);
      setNoteRefreshToken((token) => token + 1);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setNoteSubmitting(false);
    }
  }

  function openOverrideForm() {
    if (riskAssessment) {
      setOverrideBand(riskAssessment.finalRiskBand);
    }
    setOverrideError(null);
    setOverrideOpen(true);
  }

  async function handleOverrideSubmit(event: FormEvent) {
    event.preventDefault();
    setOverrideError(null);

    if (overrideReason.trim().length < 3) {
      setOverrideError('Override reason is required (at least 3 characters).');
      return;
    }
    if (!riskAssessment) {
      return;
    }

    setOverrideSubmitting(true);
    try {
      const updated = await apiFetch<RiskAssessment>(
        `/risk-assessments/${riskAssessment.id}/override`,
        { method: 'PATCH', body: { finalRiskBand: overrideBand, overrideReason } },
      );
      setRiskAssessment(updated);
      setOverrideOpen(false);
      setOverrideReason('');
    } catch (err) {
      // Deliberately `instanceof Error`, not `instanceof ApiError`: the backend's real
      // ApiError always satisfies this too (ApiError extends Error), and this widening
      // is what lets any thrown Error's own message surface as-is, matching this task's
      // stated intent ("any error the backend returns... is surfaced as-is") without
      // depending on the exact class identity of what was thrown.
      setOverrideError(err instanceof Error ? err.message : 'Failed to override risk band.');
    } finally {
      setOverrideSubmitting(false);
    }
  }

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
      <h1 className="text-xl font-semibold">Episode {episode.id}</h1>

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
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Latest Risk Assessment</h2>
        {riskAssessment === null ? (
          <p>No risk assessment yet for this episode.</p>
        ) : (
          <div className="space-y-2">
            <p className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm font-medium text-yellow-800">
              Caution: these rule thresholds are provisional and have not received clinical
              sign-off. Use clinical judgment — do not treat this band as a final diagnosis.
            </p>
            <p>
              <span className="font-medium">Final risk band:</span> {riskAssessment.finalRiskBand}
              {' '}({riskAssessment.status})
            </p>
            <ul className="list-disc pl-5 text-sm">
              {riskAssessment.explanation.ruleFactors.map((factor) => (
                <li key={factor.factor}>
                  {factor.factor}: {factor.band ?? 'insufficient data'} — {factor.detail}
                </li>
              ))}
            </ul>
            {riskAssessment.explanation.mlReasoning && (
              <p className="text-sm">ML reasoning: {riskAssessment.explanation.mlReasoning}</p>
            )}
            {riskAssessment.explanation.mlDisagreement && (
              <p className="text-sm">
                Model suggested {riskAssessment.explanation.mlDisagreement.mlBand}; rules band
                retained ({riskAssessment.explanation.mlDisagreement.resolution}).
              </p>
            )}
            {riskAssessment.explanation.mlError && (
              <p className="text-sm text-gray-600">
                ML enrichment did not run: {riskAssessment.explanation.mlError}. This is a
                rule-only score, not a model-reviewed one.
              </p>
            )}
            {riskAssessment.overriddenBy && (
              <p className="text-sm">Overridden. Reason: {riskAssessment.overrideReason}</p>
            )}

            {!overrideOpen ? (
              <Button variant="secondary" onClick={openOverrideForm}>
                Override risk band
              </Button>
            ) : (
              <form
                onSubmit={handleOverrideSubmit}
                className="space-y-3 rounded-md border border-gray-200 p-3"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor="override-band" className="text-sm font-medium text-gray-700">
                    New risk band
                  </label>
                  <select
                    id="override-band"
                    value={overrideBand}
                    onChange={(e) => setOverrideBand(e.target.value as 'low' | 'medium' | 'high')}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <Input
                  label="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                {overrideError && (
                  <p role="alert" className="text-sm text-red-600">
                    {overrideError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={overrideSubmitting}>
                    {overrideSubmitting ? 'Submitting...' : 'Submit override'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setOverrideOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Record Encounter Note</h2>
        <form onSubmit={handleNoteSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <Input
            label="BP systolic"
            type="number"
            value={bpSystolic}
            onChange={(e) => setBpSystolic(e.target.value)}
          />
          <Input
            label="BP diastolic"
            type="number"
            value={bpDiastolic}
            onChange={(e) => setBpDiastolic(e.target.value)}
          />
          <Input
            label="Temperature (C)"
            type="number"
            value={temperatureC}
            onChange={(e) => setTemperatureC(e.target.value)}
          />
          <Input
            label="Hemoglobin (g/dL)"
            type="number"
            value={hemoglobinGdl}
            onChange={(e) => setHemoglobinGdl(e.target.value)}
          />
          {noteError && (
            <p role="alert" className="text-sm text-red-600">
              {noteError}
            </p>
          )}
          {noteSaved && <p className="text-sm text-green-700">Encounter note saved.</p>}
          <Button type="submit" disabled={noteSubmitting}>
            {noteSubmitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>

      <EncounterNoteList episodeId={episodeId} refreshToken={noteRefreshToken} />

      <ReferralCreateForm episodeId={episodeId} episodeStatus={episode.status} />
    </div>
  );
}
