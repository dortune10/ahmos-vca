import { ReactNode } from 'react';

export type NoticeTone = 'error' | 'success' | 'caution';

export interface NoticeProps {
  tone: NoticeTone;
  /** Short mono eyebrow naming what happened. Say the specific thing, not "Something went wrong". */
  label?: string;
  children: ReactNode;
  className?: string;
}

const DEFAULT_LABEL: Record<NoticeTone, string> = {
  error: 'Error',
  success: 'Done',
  caution: 'Caution',
};

/**
 * Every non-clinical status message in the app: failures, confirmations, and the clinical
 * safety caution on a risk assessment.
 *
 * All three tones are ink on paper, with no red and no green anywhere. That is the point.
 * The system reserves saturation for `band.low/medium/high`, and a wrong password or a saved
 * note is not a clinical risk band — if red also means "typo" then red stops meaning "high
 * risk" on the one screen where that has to be unmissable. What a colour would have done is
 * done instead by weight and by the mono eyebrow that names the outcome, so the meaning
 * survives for colour-blind readers and on the washed-out screens these are read on.
 *
 * `role="alert"` is set for `error` only, matching what each call site did before; adding it
 * to confirmations would put two alerts on pages whose tests resolve a single one.
 */
export function Notice({ tone, label, children, className = '' }: NoticeProps) {
  const heading = label ?? DEFAULT_LABEL[tone];

  // The caution is the loudest thing the product says, so it gets the ink slab the landing
  // page spends on the same disclaimer. An error is a recessed panel with a solid ink rule; a
  // confirmation is the same shape at a lower weight so it never competes with a failure.
  const shell =
    tone === 'caution'
      ? 'bg-ink px-3.5 py-3'
      : tone === 'error'
        ? 'border-l-[3px] border-ink bg-paper-deep px-3.5 py-2.5'
        : 'border-l-[3px] border-ink/40 bg-paper px-3.5 py-2.5';

  const labelClass =
    tone === 'caution'
      ? 'text-ink-pale'
      : tone === 'error'
        ? 'text-ink-soft'
        : 'text-ink-muted';

  const bodyClass =
    tone === 'caution' ? 'text-paper' : tone === 'error' ? 'text-ink' : 'text-ink-soft';

  return (
    <div
      {...(tone === 'error' ? { role: 'alert' } : {})}
      className={`rounded-r-md ${tone === 'caution' ? 'rounded-md' : ''} ${shell} ${className}`}
    >
      <p
        className={`font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] ${labelClass}`}
      >
        {heading}
      </p>
      <div className={`mt-1 text-sm leading-relaxed ${bodyClass}`}>{children}</div>
    </div>
  );
}
