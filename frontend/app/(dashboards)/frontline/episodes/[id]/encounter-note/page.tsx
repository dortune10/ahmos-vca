'use client';

import { FormEvent, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

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
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Encounter Note</h1>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          {isNurse && (
            <>
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
            </>
          )}
          {error && (
            <p role="alert" className="text-sm text-red-600">
              {error}
            </p>
          )}
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
