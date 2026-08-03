'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';

interface VitalsInput {
  bpSystolic?: number;
  bpDiastolic?: number;
  temperatureC?: number;
  hemoglobinGdl?: number;
}

export default function EncounterNotePage() {
  const user = useCurrentUser();
  const router = useRouter();
  const params = useParams<{ id: string }>();
  const isNurse = user.role === 'nurse';

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const body: { noteText?: string; vitals?: VitalsInput } = {};
      if (noteText) {
        body.noteText = noteText;
      }

      if (isNurse) {
        const vitals: VitalsInput = {};
        if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
        if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
        if (temperatureC) vitals.temperatureC = Number(temperatureC);
        if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
        if (Object.keys(vitals).length > 0) {
          body.vitals = vitals;
        }
      }

      await apiFetch(`/pregnancy-episodes/${params.id}/encounter-notes`, {
        method: 'POST',
        body,
      });

      router.push('/frontline');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl space-y-5">
      <PageHeader
        eyebrow="New note"
        title="Encounter Note"
        description={
          isNurse
            ? 'What happened at this visit, and any vitals you measured. Vitals feed the risk score.'
            : 'What happened at this visit. Vitals are recorded by a nurse.'
        }
      />
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          {isNurse && (
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
          )}
          {error && (
            <Notice tone="error" label="Note not saved">
              {error}
            </Notice>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
