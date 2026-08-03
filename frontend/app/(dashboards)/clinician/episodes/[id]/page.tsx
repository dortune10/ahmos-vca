'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { RiskBadge } from '@/components/ui/risk-badge';
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
    return (
      <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
        Loading episode...
      </p>
    );
  }

  if (error || !episode) {
    return <Notice tone="error">{error ?? 'Episode not found.'}</Notice>;
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Pregnancy episode"
        title={
          <>
            Episode{' '}
            <span className="font-data text-base tracking-tight text-ink-soft sm:text-lg">
              {episode.id}
            </span>
          </>
        }
      />

      <Card>
        <CardTitle>Overview</CardTitle>

        {/* Gestational age gets the treatment the landing page's example record gives it: it
            frames every other reading on the page, so it is set large in the `data` face
            rather than buried as one row of a two-column list. */}
        <div className="mt-4 flex flex-wrap items-end gap-x-8 gap-y-3">
          <div>
            <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
              Gestational age
            </p>
            <p className="mt-1.5 font-data text-3xl leading-none tracking-tight text-ink">
              {episode.gestationalAgeWeeks ?? '—'}
              <span className="ml-1.5 text-sm text-ink-muted">weeks</span>
            </p>
          </div>
          <div className="pb-1">
            <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
              Estimated delivery date
            </p>
            <p className="mt-1.5 font-data text-sm text-ink-soft">
              {episode.estimatedDeliveryDate ?? '—'}
            </p>
          </div>
        </div>

        <dl className="mt-5 divide-y divide-paper-rule border-t border-paper-rule">
          <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4">
            <dt className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted sm:w-32 sm:shrink-0">
              Status
            </dt>
            <dd>
              <span className="font-data text-xs uppercase tracking-[0.08em] text-ink-soft">
                {episode.status}
              </span>
            </dd>
          </div>
          <div className="flex flex-col gap-1.5 py-3 sm:flex-row sm:items-center sm:gap-4">
            <dt className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted sm:w-32 sm:shrink-0">
              Risk band
            </dt>
            <dd>
              <RiskBadge band={episode.riskBand} fallback="unassessed" />
            </dd>
          </div>
        </dl>
      </Card>

      <Card>
        <CardTitle>Latest Risk Assessment</CardTitle>
        {riskAssessment === null ? (
          <p className="mt-3 text-sm text-ink-muted">No risk assessment yet for this episode.</p>
        ) : (
          <div className="mt-4 space-y-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <RiskBadge band={riskAssessment.finalRiskBand} fallback="unassessed" />
              <span className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
                {riskAssessment.status}
              </span>
            </div>

            {/* The clinical caveat outranks everything else on this card, so it takes the ink
                slab — the weight the landing page gives the same disclaimer. */}
            <Notice tone="caution" label="Not clinically validated">
              These rule thresholds are provisional and have not received clinical sign-off.
              Use clinical judgment — do not treat this band as a final diagnosis.
            </Notice>

            <div>
              <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
                Contributing factors
              </p>
              <dl className="mt-2 divide-y divide-paper-rule border-t border-paper-rule">
                {riskAssessment.explanation.ruleFactors.map((factor) => (
                  <div
                    key={factor.factor}
                    className="flex flex-col gap-1.5 py-3 sm:flex-row sm:gap-4"
                  >
                    <dt className="font-data text-xs leading-5 text-ink-muted sm:w-40 sm:shrink-0">
                      {factor.factor}
                    </dt>
                    <dd className="flex flex-wrap items-center gap-x-2.5 gap-y-1.5">
                      <RiskBadge band={factor.band} fallback="insufficient data" />
                      <span className="text-sm leading-relaxed text-ink-soft">
                        {factor.detail}
                      </span>
                    </dd>
                  </div>
                ))}
              </dl>
            </div>

            {riskAssessment.explanation.mlReasoning && (
              <p className="text-sm leading-relaxed text-ink-soft">
                ML reasoning: {riskAssessment.explanation.mlReasoning}
              </p>
            )}
            {riskAssessment.explanation.mlDisagreement && (
              <p className="text-sm leading-relaxed text-ink-soft">
                Model suggested {riskAssessment.explanation.mlDisagreement.mlBand}; rules band
                retained ({riskAssessment.explanation.mlDisagreement.resolution}).
              </p>
            )}
            {riskAssessment.explanation.mlError && (
              <p className="text-sm leading-relaxed text-ink-muted">
                ML enrichment did not run: {riskAssessment.explanation.mlError}. This is a
                rule-only score, not a model-reviewed one.
              </p>
            )}
            {riskAssessment.overriddenBy && (
              <p className="text-sm leading-relaxed text-ink">
                Overridden. Reason: {riskAssessment.overrideReason}
              </p>
            )}

            {!overrideOpen ? (
              <Button variant="secondary" onClick={openOverrideForm}>
                Override risk band
              </Button>
            ) : (
              <form
                onSubmit={handleOverrideSubmit}
                className="space-y-3.5 rounded-md border border-paper-rule bg-paper p-4"
              >
                <Select
                  id="override-band"
                  label="New risk band"
                  value={overrideBand}
                  onChange={(e) => setOverrideBand(e.target.value as 'low' | 'medium' | 'high')}
                >
                  <option value="low">low</option>
                  <option value="medium">medium</option>
                  <option value="high">high</option>
                </Select>
                <Input
                  label="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                {overrideError && (
                  <Notice tone="error" label="Override not saved">
                    {overrideError}
                  </Notice>
                )}
                <div className="flex flex-wrap gap-2">
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
        <CardTitle>Record Encounter Note</CardTitle>
        <form onSubmit={handleNoteSubmit} className="mt-4 space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          {/* Vitals pair up two-across from `sm` — they are read off one instrument at a time
              and entered in pairs, and a single column of four made the save button fall
              below the fold on a phone. */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Input
              label="BP systolic"
              type="number"
              inputMode="numeric"
              value={bpSystolic}
              onChange={(e) => setBpSystolic(e.target.value)}
            />
            <Input
              label="BP diastolic"
              type="number"
              inputMode="numeric"
              value={bpDiastolic}
              onChange={(e) => setBpDiastolic(e.target.value)}
            />
            <Input
              label="Temperature (C)"
              type="number"
              inputMode="decimal"
              value={temperatureC}
              onChange={(e) => setTemperatureC(e.target.value)}
            />
            <Input
              label="Hemoglobin (g/dL)"
              type="number"
              inputMode="decimal"
              value={hemoglobinGdl}
              onChange={(e) => setHemoglobinGdl(e.target.value)}
            />
          </div>
          {noteError && (
            <Notice tone="error" label="Note not saved">
              {noteError}
            </Notice>
          )}
          {noteSaved && <Notice tone="success">Encounter note saved.</Notice>}
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
