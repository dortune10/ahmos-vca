'use client';

import { SelectHTMLAttributes, useId } from 'react';

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label: string;
}

/**
 * The `<select>` counterpart to `Input`, added because five screens were each hand-rolling a
 * bare `<select>` — three of them inside a wrapping `<label>` with no `htmlFor`, one with a
 * border and two with none at all. Same field shape, same explicit foreground/background
 * pairing, same reason: a control showing what a health worker chose must never inherit its
 * colours.
 *
 * `appearance-none` plus an inline SVG chevron, so the control looks the same on the Android
 * WebView these run in as it does on a desktop browser — and so the arrow costs no request.
 */
export function Select({ label, id, className = '', children, ...rest }: SelectProps) {
  const generatedId = useId();
  const selectId = id ?? generatedId;

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={selectId} className="text-sm font-medium text-ink-soft">
        {label}
      </label>
      <div className="relative">
        <select
          id={selectId}
          className={`w-full appearance-none rounded-md border border-ink/25 bg-white py-2.5 pl-3 pr-9 text-sm text-ink transition-colors focus:border-ink focus:outline-none focus:ring-1 focus:ring-ink ${className}`}
          {...rest}
        >
          {children}
        </select>
        <svg
          aria-hidden
          viewBox="0 0 12 12"
          className="pointer-events-none absolute right-3 top-1/2 h-3 w-3 -translate-y-1/2 text-ink-muted"
        >
          <path
            d="M2.5 4.5L6 8l3.5-3.5"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </div>
    </div>
  );
}
