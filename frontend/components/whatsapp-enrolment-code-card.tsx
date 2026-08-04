'use client';

import { useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Notice } from '@/components/ui/notice';

interface EnrolmentCodeResponse {
  code: string;
  expiresAt: string;
}

export interface WhatsAppEnrolmentCodeCardProps {
  personId: string;
}

/**
 * The staff half of the WhatsApp channel-verification design (docs/DECISIONS.md #28).
 *
 * The bot will not disclose anything about a woman's record — and will not record consent on
 * her behalf — until the handset messaging it has been proved to be hers. The proof is this
 * 6-digit code: a health worker issues it here and reads it out to her in person, and she sends
 * it once from the phone she wants to use. That is deliberately the only challenge in the
 * design, because most women on this platform are registered through the CHW quick-registration
 * form with nothing on file but a first name and a phone number — there is no date of birth or
 * surname to ask them for, and even where there is, the person most likely to be holding a
 * shared household handset already knows the answer.
 *
 * The code is shown ONCE and cannot be retrieved: the server stores only a salted hash.
 * Re-issuing is always allowed, retires any previous code, and is also how a woman who has
 * changed handsets gets re-bound to the new one.
 *
 * Presentation note: the code is set in the `data` face at display size and widely tracked,
 * because its whole job is to be read aloud accurately across a desk. It carries no colour —
 * saturation in this system is reserved for clinical risk bands, and an enrolment code is
 * administrative, not clinical.
 */
export function WhatsAppEnrolmentCodeCard({ personId }: WhatsAppEnrolmentCodeCardProps) {
  const [code, setCode] = useState<string | null>(null);
  const [issuing, setIssuing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function issue() {
    setIssuing(true);
    setError(null);
    try {
      const result = await apiFetch<EnrolmentCodeResponse>(
        `/persons/${personId}/whatsapp-enrolment-code`,
        { method: 'POST' },
      );
      setCode(result.code);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not issue a code.');
    } finally {
      setIssuing(false);
    }
  }

  return (
    <Card>
      <CardTitle>WhatsApp enrolment code</CardTitle>
      <p className="mt-1 text-sm leading-relaxed text-ink-soft">
        Read this 6-digit code out to the patient. She sends it to the AMHOS WhatsApp number
        from her own phone to confirm the phone is hers. It is shown once — issue a new one if
        she loses it or changes phone.
      </p>
      {code !== null && (
        <p
          aria-label="WhatsApp enrolment code"
          className="mt-4 font-data text-3xl leading-none tracking-[0.3em] text-ink"
        >
          {code}
        </p>
      )}
      {error && (
        <Notice tone="error" label="Code not issued" className="mt-3">
          {error}
        </Notice>
      )}
      <div className="mt-4">
        <Button onClick={issue} disabled={issuing}>
          {issuing ? 'Issuing...' : code !== null ? 'Issue a new code' : 'Issue enrolment code'}
        </Button>
      </div>
    </Card>
  );
}
