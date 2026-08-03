'use client';

import { InputHTMLAttributes, useId } from 'react';

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label: string;
  error?: string;
  /** Supporting line under the field. Use it to say what a value is for, not to repeat the label. */
  hint?: string;
}

export function Input({ label, error, hint, id, className = '', ...rest }: InputProps) {
  const generatedId = useId();
  const inputId = id ?? generatedId;
  const hintId = hint ? `${inputId}-hint` : undefined;
  const errorId = error ? `${inputId}-error` : undefined;

  return (
    <div className="flex flex-col gap-1.5">
      {/* Field labels are set in `ui`, not the mono `data` face used for column headers and
          eyebrows. A form label is something you read while typing on a cheap screen in bad
          light; tracked-out uppercase mono is the wrong tool for that job even though it is
          the right one for a table header. */}
      <label htmlFor={inputId} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      <input
        id={inputId}
        aria-describedby={[hintId, errorId].filter(Boolean).join(' ') || undefined}
        aria-invalid={error ? true : undefined}
        // The explicit `bg-white` + `text-ink` pair is deliberate and must stay explicit.
        // Inheriting either one previously produced unreadable fields; a control that renders
        // what a health worker typed is not a place to rely on cascade.
        // Measured: ink #0E2320 on white = 16.4:1; the ink-muted placeholder = 5.6:1.
        className={`rounded-md border border-ink/25 bg-white px-3 py-2.5 text-sm text-ink placeholder:text-ink-muted transition-colors focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink ${className}`}
        {...rest}
      />
      {hint && (
        <p id={hintId} className="text-xs leading-relaxed text-ink-muted">
          {hint}
        </p>
      )}
      {/* Field errors stay ink, like every other non-clinical message in the app — see
          components/ui/notice.tsx. The mono rule-and-label carries the signal instead. */}
      {error && (
        <p
          id={errorId}
          className="border-l-2 border-ink pl-2 font-data text-xs leading-relaxed text-ink"
        >
          {error}
        </p>
      )}
    </div>
  );
}
