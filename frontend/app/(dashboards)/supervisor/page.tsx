'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';

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

const RISK_BAND_COLOR: Record<keyof RiskBandDistribution, string> = {
  low: 'bg-green-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
};

function RiskBandBar({
  label,
  count,
  total,
  colorClassName,
}: {
  label: string;
  count: number;
  total: number;
  colorClassName: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span>
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full rounded bg-gray-200">
        <div className={`h-2 rounded ${colorClassName}`} style={{ width: `${pct}%` }} />
      </div>
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
    return <p>Loading KPI summary...</p>;
  }

  if (error || !summary) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'No KPI data available.'}
      </p>
    );
  }

  const riskTotal =
    summary.riskBandDistribution.low + summary.riskBandDistribution.medium + summary.riskBandDistribution.high;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Supervisor KPI Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-gray-500">Registered Pregnancies</p>
          <p className="text-2xl font-semibold">{summary.registeredPregnancies}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">ANC Task Completion</p>
          <p className="text-2xl font-semibold">{Math.round(summary.ancTaskCompletionRate * 100)}%</p>
          <p className="text-xs text-gray-400">
            Overall anc_visit task completion rate — a coverage proxy, not a 1st/4th/8th
            visit metric.
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">High-Risk Cases</p>
          <p className="text-2xl font-semibold">{summary.highRiskCaseCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Referral SLA Breaches</p>
          <p className="text-2xl font-semibold">{summary.referralSlaBreaches}</p>
          <p className="text-xs text-gray-400">Open more than 24 hours since creation.</p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Risk Band Distribution</h2>
        <div className="space-y-3">
          <RiskBandBar
            label="low"
            count={summary.riskBandDistribution.low}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.low}
          />
          <RiskBandBar
            label="medium"
            count={summary.riskBandDistribution.medium}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.medium}
          />
          <RiskBandBar
            label="high"
            count={summary.riskBandDistribution.high}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.high}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Referral Outcomes</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.completed}</p>
            <p className="text-xs text-gray-500">Completed</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.failed}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.cancelled}</p>
            <p className="text-xs text-gray-500">Cancelled</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
