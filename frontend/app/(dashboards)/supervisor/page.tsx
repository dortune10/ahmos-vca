'use client';

import { ReactNode, useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card, CardTitle } from '@/components/ui/card';
import { Notice } from '@/components/ui/notice';
import { PageHeader } from '@/components/ui/page-header';
import { RISK_BANDS, RiskBand, riskBandTokens } from '@/lib/risk-band';

interface RiskBandDistribution {
  low: number;
  medium: number;
  high: number;
}

interface ReferralOutcomeBreakdown {
  completed: number;
  failed: number;
  cancelled: number;
}

interface KpiSummary {
  registeredPregnancies: number;
  ancTaskCompletionRate: number;
  highRiskCaseCount: number;
  riskBandDistribution: RiskBandDistribution;
  referralSlaBreaches: number;
  referralOutcomeBreakdown: ReferralOutcomeBreakdown;
}

/**
 * A single headline number. `accent` is the whole colour argument of this screen: the
 * high-risk case count is a clinical risk quantity, so it is allowed the band-high hue and a
 * rule to match. The SLA-breach count sitting next to it is an *operational* failure, not a
 * clinical band, so it stays ink — which is what keeps the red on this page meaning
 * "high-risk pregnancies" rather than "bad number".
 */
function StatCard({
  label,
  value,
  footnote,
  accentBand,
}: {
  label: string;
  value: string;
  footnote?: ReactNode;
  accentBand?: RiskBand;
}) {
  const tokens = accentBand ? riskBandTokens(accentBand) : null;
  return (
    <Card className="flex flex-col">
      {/* Every stat carries the same rule, so the row aligns and so the one coloured rule on
          the page is a deliberate exception rather than a card that happens to look different. */}
      <span
        aria-hidden
        className={`mb-3 block h-[3px] w-9 ${tokens ? tokens.fill : 'bg-ink/20'}`}
      />
      <p className="font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
        {label}
      </p>
      <p
        className={`mt-2 font-data text-[2rem] leading-none tracking-tight ${
          tokens ? tokens.text : 'text-ink'
        }`}
      >
        {value}
      </p>
      {footnote && (
        <p className="mt-2.5 text-xs leading-relaxed text-ink-muted">{footnote}</p>
      )}
    </Card>
  );
}

function RiskBandBar({
  label,
  count,
  total,
}: {
  label: RiskBand;
  count: number;
  total: number;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  const tokens = riskBandTokens(label);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-4">
        <span
          className={`font-data text-[0.6875rem] uppercase leading-4 tracking-[0.14em] ${tokens.text}`}
        >
          {label}
        </span>
        {/* Count and percentage stay in one element on purpose — they read as one value. */}
        <span className="font-data text-xs tabular-nums text-ink-soft">
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-1.5 w-full overflow-hidden rounded-sm bg-paper-deep">
        <div className={`h-1.5 ${tokens.fill}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function OutcomeFigure({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-t border-paper-rule pt-3">
      <p className="font-data text-2xl leading-none tabular-nums text-ink">{value}</p>
      <p className="mt-1.5 font-data text-[0.625rem] uppercase leading-4 tracking-[0.16em] text-ink-muted">
        {label}
      </p>
    </div>
  );
}

export default function SupervisorPage() {
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<KpiSummary>('/reports/kpi-summary')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load KPI summary.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return (
      <p className="font-data text-xs uppercase tracking-[0.14em] text-ink-muted">
        Loading KPI summary...
      </p>
    );
  }

  if (error || !summary) {
    return <Notice tone="error">{error ?? 'No KPI data available.'}</Notice>;
  }

  const riskTotal =
    summary.riskBandDistribution.low +
    summary.riskBandDistribution.medium +
    summary.riskBandDistribution.high;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="All facilities"
        title="Supervisor KPI Dashboard"
        description="Programme-level counts across every facility in your tenant."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Registered Pregnancies"
          value={String(summary.registeredPregnancies)}
        />
        <StatCard
          label="ANC Task Completion"
          value={`${Math.round(summary.ancTaskCompletionRate * 100)}%`}
          footnote="Overall anc_visit task completion rate — a coverage proxy, not a 1st/4th/8th visit metric."
        />
        <StatCard
          label="High-Risk Cases"
          value={String(summary.highRiskCaseCount)}
          accentBand="high"
        />
        <StatCard
          label="Referral SLA Breaches"
          value={String(summary.referralSlaBreaches)}
          footnote="Open more than 24 hours since creation."
        />
      </div>

      <Card>
        <CardTitle>Risk Band Distribution</CardTitle>
        <div className="mt-4 space-y-3.5">
          {RISK_BANDS.map((band) => (
            <RiskBandBar
              key={band}
              label={band}
              count={summary.riskBandDistribution[band]}
              total={riskTotal}
            />
          ))}
        </div>
      </Card>

      <Card>
        <CardTitle>Referral Outcomes</CardTitle>
        <div className="mt-4 grid grid-cols-3 gap-4">
          <OutcomeFigure label="Completed" value={summary.referralOutcomeBreakdown.completed} />
          <OutcomeFigure label="Failed" value={summary.referralOutcomeBreakdown.failed} />
          <OutcomeFigure label="Cancelled" value={summary.referralOutcomeBreakdown.cancelled} />
        </div>
      </Card>
    </div>
  );
}
