/**
 * The one place clinical risk banding is turned into colour.
 *
 * The design system's governing rule is that saturation is reserved *exclusively* for
 * clinical risk bands — nav, chrome, buttons, form errors and success confirmations are all
 * ink on paper. Centralising the mapping here is what makes that rule enforceable: if a
 * screen wants a coloured thing, it has to come through this module, and this module only
 * knows about `low | medium | high`.
 *
 * Every value below is a `band.*` token from tailwind.config.ts, verified against its
 * intended backgrounds for WCAG AA body text (>= 4.5:1):
 *   band-low  #2F6B4F  6.29:1 on white, 5.52:1 on paper, 5.61:1 on its own 8% tint
 *   band-med  #8A5D0A  5.75:1 on white, 5.04:1 on paper, 5.15:1 on its own 8% tint
 *   band-high #A3301C  7.01:1 on white, 6.14:1 on paper, 6.15:1 on its own 8% tint
 */

export type RiskBand = 'low' | 'medium' | 'high';

export const RISK_BANDS: readonly RiskBand[] = ['low', 'medium', 'high'] as const;

export function isRiskBand(value: unknown): value is RiskBand {
  return value === 'low' || value === 'medium' || value === 'high';
}

interface RiskBandTokens {
  /** Text colour for the band's own label. */
  text: string;
  /** Solid fill, for the swatch tick and the distribution bars. */
  fill: string;
  /** Faint wash behind the badge. */
  tint: string;
  /** Hairline around the badge. */
  border: string;
  /** Row wash for a table row carrying this band. Empty for bands that get no row emphasis. */
  row: string;
}

const TOKENS: Record<RiskBand, RiskBandTokens> = {
  low: {
    text: 'text-band-low',
    fill: 'bg-band-low',
    tint: 'bg-band-low/[0.08]',
    border: 'border-band-low/30',
    // Low risk is the resting state of the caseload. Washing those rows too would turn the
    // whole table into a colour field and cost the high-risk rows their only advantage.
    row: '',
  },
  medium: {
    text: 'text-band-medium',
    fill: 'bg-band-medium',
    tint: 'bg-band-medium/[0.08]',
    border: 'border-band-medium/30',
    row: '',
  },
  high: {
    text: 'text-band-high',
    fill: 'bg-band-high',
    tint: 'bg-band-high/[0.08]',
    border: 'border-band-high/30',
    // 5% is deliberately faint: it has to group the high-risk block at a glance without
    // dropping `ink` text below AA. Measured 15.18:1 for ink and 8.11:1 for ink-soft on it.
    row: 'bg-band-high/[0.05]',
  },
};

export function riskBandTokens(band: RiskBand): RiskBandTokens {
  return TOKENS[band];
}

/**
 * Row emphasis for a table row. Takes the raw, possibly-null value straight off an episode
 * so callers do not each have to re-implement the "not yet assessed" case.
 */
export function riskRowClass(band: string | null | undefined): string {
  return isRiskBand(band) ? TOKENS[band].row : '';
}
