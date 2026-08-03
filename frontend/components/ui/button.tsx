'use client';

import { ButtonHTMLAttributes, ReactNode } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  /** `lg` is the full-width shift-start affordance on the login screen. */
  size?: 'md' | 'lg';
  children: ReactNode;
}

// Deliberately matches the landing page's CTA shape (`rounded-md ... text-sm font-medium`)
// so a signed-out visitor and a signed-in health worker are pressing the same button.
const BASE =
  'inline-flex items-center justify-center rounded-md font-ui font-medium transition-colors ' +
  'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 ' +
  'disabled:cursor-not-allowed';

const SIZE_CLASSES: Record<NonNullable<ButtonProps['size']>, string> = {
  // 38px tall — a comfortable thumb target on the low-end Android phones these run on
  // without making a row of table actions feel bloated.
  md: 'px-4 py-2 text-sm leading-[1.375rem]',
  lg: 'px-5 py-3 text-base leading-6',
};

// Disabled states are explicit colour swaps rather than `opacity-50`. Group opacity composites
// the label *and* the fill against the page, and on `paper` a 50%-opacity paper-coloured label
// over a paper backdrop resolves to the backdrop — the label disappears exactly when it is
// carrying the "Signing in..." status. The swaps below all clear 4.5:1 on their own fills.
const VARIANT_CLASSES: Record<NonNullable<ButtonProps['variant']>, string> = {
  primary:
    'bg-ink text-paper hover:bg-ink-line focus-visible:outline-ink ' +
    'disabled:bg-ink-muted disabled:text-white',
  // `bg-white` is load-bearing: on `paper` surfaces a secondary button has to lift off the
  // page, and the button's own test pins this class.
  secondary:
    'border border-ink/25 bg-white text-ink hover:border-ink/60 hover:bg-paper ' +
    'focus-visible:outline-ink disabled:border-ink/15 disabled:bg-white disabled:text-ink-muted',
  // The one place outside a risk band where saturation is allowed, and only as an outline:
  // a destructive action against a clinical record earns the warning hue, but not a solid
  // fill that would out-shout an actual high-risk badge.
  danger:
    'border border-band-high/40 bg-white text-band-high hover:border-band-high hover:bg-band-high/[0.06] ' +
    'focus-visible:outline-band-high disabled:border-ink/15 disabled:bg-white disabled:text-ink-muted',
  // For the ink nav bar, where a white button would be the loudest thing on the screen.
  ghost:
    'border border-paper/30 text-paper hover:border-paper/70 hover:bg-paper/10 ' +
    'focus-visible:outline-paper disabled:border-paper/15 disabled:text-ink-pale',
};

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={`${BASE} ${SIZE_CLASSES[size]} ${VARIANT_CLASSES[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
