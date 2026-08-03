import { isRiskBand, riskBandTokens } from '@/lib/risk-band';

export interface RiskBadgeProps {
  /** Raw value straight off the record — may be null when nothing has been assessed yet. */
  band: string | null | undefined;
  /**
   * What to show when there is no band. Passed in rather than fixed because the screens
   * already disagree deliberately: the caseload shows an em dash, the triage board spells
   * out "unassessed". Both are correct for their context and both are asserted by tests.
   */
  fallback: string;
  className?: string;
}

const SHELL =
  'inline-flex items-center gap-1.5 rounded-[3px] border px-1.5 py-0.5 ' +
  'font-data text-[0.6875rem] uppercase leading-4 tracking-[0.1em]';

/**
 * The only saturated element in a table row, and the whole point of the colour rule.
 *
 * The swatch is a vertical tick rather than the usual dot: down a queue sorted by risk the
 * ticks line up into a gauge in the risk column, so a clinician finds the high-risk block by
 * shape before reading a single word. An unbanded episode gets no colour and no solid tick —
 * "not yet assessed" is an absence, not a fourth band, and must not read as a mild one.
 *
 * The label keeps the record's own casing in the DOM (`high`, not `High`); the uppercasing is
 * CSS only, so the rendered text still matches what the record actually says.
 */
export function RiskBadge({ band, fallback, className = '' }: RiskBadgeProps) {
  if (!isRiskBand(band)) {
    return (
      <span
        className={`${SHELL} border-dashed border-ink/25 text-ink-muted ${className}`}
      >
        <span aria-hidden className="h-3.5 w-[3px] rounded-[1px] bg-ink/20" />
        {fallback}
      </span>
    );
  }

  const tokens = riskBandTokens(band);

  return (
    <span
      className={`${SHELL} ${tokens.border} ${tokens.tint} ${tokens.text} ${className}`}
    >
      <span aria-hidden className={`h-3.5 w-[3px] rounded-[1px] ${tokens.fill}`} />
      {band}
    </span>
  );
}
