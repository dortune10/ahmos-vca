import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../common/supabase/supabase.service';
import { TERMINAL_REFERRAL_STATUSES } from '../referral/referral-state-machine';
import {
  KpiSummaryDto,
  ReferralOutcomeBreakdownDto,
  RiskBandDistributionDto,
} from './dto/kpi-summary.dto';

// Placeholder SLA threshold for "referral open too long" — a single flat default applied
// regardless of urgency, pending real targets from clinical/operations stakeholders. See
// this plan's Global Constraints for the full rationale. Exported as a named constant
// specifically so it's a one-line change once real targets exist.
export const REFERRAL_SLA_BREACH_HOURS = 24;

const OUTCOME_FIELD_BY_STATUS: Record<string, keyof ReferralOutcomeBreakdownDto> = {
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
};

@Injectable()
export class ReportingService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getKpiSummary(jwt: string, facilityId?: string): Promise<KpiSummaryDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const [
      registeredPregnancies,
      highRiskCaseCount,
      riskBandDistribution,
      ancTaskCompletionRate,
      referralSlaBreaches,
      referralOutcomeBreakdown,
    ] = await Promise.all([
      this.countRegisteredPregnancies(client, facilityId),
      this.countHighRiskCases(client, facilityId),
      this.computeRiskBandDistribution(client, facilityId),
      this.computeAncTaskCompletionRate(client, facilityId),
      this.countReferralSlaBreaches(client, facilityId),
      this.computeReferralOutcomeBreakdown(client, facilityId),
    ]);

    const dto = new KpiSummaryDto();
    dto.registeredPregnancies = registeredPregnancies;
    dto.highRiskCaseCount = highRiskCaseCount;
    dto.riskBandDistribution = riskBandDistribution;
    dto.ancTaskCompletionRate = ancTaskCompletionRate;
    dto.referralSlaBreaches = referralSlaBreaches;
    dto.referralOutcomeBreakdown = referralOutcomeBreakdown;
    return dto;
  }

  private async countRows(
    client: SupabaseClient,
    table: string,
    selectColumns: string,
    applyFilters: (query: any) => any,
  ): Promise<number> {
    const base = client.from(table).select(selectColumns, { count: 'exact', head: true });
    const { count, error } = await applyFilters(base);
    if (error) {
      throw error;
    }
    return count ?? 0;
  }

  private countRegisteredPregnancies(client: SupabaseClient, facilityId?: string): Promise<number> {
    return this.countRows(client, 'pregnancy_episode', 'id', (query) =>
      facilityId ? query.eq('facility_id', facilityId) : query,
    );
  }

  private countHighRiskCases(client: SupabaseClient, facilityId?: string): Promise<number> {
    return this.countRows(client, 'pregnancy_episode', 'id', (query) => {
      let scoped = query.eq('risk_band', 'high');
      if (facilityId) {
        scoped = scoped.eq('facility_id', facilityId);
      }
      return scoped;
    });
  }

  private async computeRiskBandDistribution(
    client: SupabaseClient,
    facilityId?: string,
  ): Promise<RiskBandDistributionDto> {
    // See this plan's Global Constraints ("Aggregation technique") for why this fetches
    // rows and tallies in-process rather than issuing a group-by count: supabase-js's
    // query builder has no groupBy() equivalent.
    let query = client.from('pregnancy_episode').select('risk_band');
    if (facilityId) {
      query = query.eq('facility_id', facilityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const distribution: RiskBandDistributionDto = { low: 0, medium: 0, high: 0 };
    for (const row of (data ?? []) as { risk_band: string | null }[]) {
      if (row.risk_band === 'low' || row.risk_band === 'medium' || row.risk_band === 'high') {
        distribution[row.risk_band] += 1;
      }
      // Episodes with risk_band === null (no risk assessment has run yet) are excluded
      // from all three buckets on purpose — the DTO has no "unknown" bucket, and silently
      // lumping them into one of the three bands would misrepresent the distribution.
    }
    return distribution;
  }

  private slaBreachCutoffIso(): string {
    return new Date(Date.now() - REFERRAL_SLA_BREACH_HOURS * 60 * 60 * 1000).toISOString();
  }

  private async computeAncTaskCompletionRate(client: SupabaseClient, facilityId?: string): Promise<number> {
    // Known MVP simplification — see this plan's Global Constraints ("ANC coverage proxy,
    // not the PRD's literal metric"). This is completed anc_visit tasks / all anc_visit
    // tasks, not the PRD's 1st/4th/8th-visit coverage figure.
    const totalFilter = (query: any) => {
      let scoped = query.eq('task_type', 'anc_visit');
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    };
    const completedFilter = (query: any) => {
      let scoped = query.eq('task_type', 'anc_visit').eq('status', 'Completed');
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    };

    const [total, completed] = await Promise.all([
      this.countRows(client, 'care_task', 'id, pregnancy_episode!inner(facility_id)', totalFilter),
      this.countRows(client, 'care_task', 'id, pregnancy_episode!inner(facility_id)', completedFilter),
    ]);

    return total > 0 ? completed / total : 0;
  }

  private countReferralSlaBreaches(client: SupabaseClient, facilityId?: string): Promise<number> {
    const cutoffIso = this.slaBreachCutoffIso();
    return this.countRows(client, 'referral', 'id, pregnancy_episode!inner(facility_id)', (query) => {
      let scoped = query
        .not('status', 'in', `(${TERMINAL_REFERRAL_STATUSES.join(',')})`)
        .lt('created_at', cutoffIso);
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    });
  }

  private async computeReferralOutcomeBreakdown(
    client: SupabaseClient,
    facilityId?: string,
  ): Promise<ReferralOutcomeBreakdownDto> {
    const breakdown: ReferralOutcomeBreakdownDto = { completed: 0, failed: 0, cancelled: 0 };

    await Promise.all(
      TERMINAL_REFERRAL_STATUSES.map(async (status) => {
        const count = await this.countRows(
          client,
          'referral',
          'id, pregnancy_episode!inner(facility_id)',
          (query) => {
            let scoped = query.eq('status', status);
            if (facilityId) {
              scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
            }
            return scoped;
          },
        );
        breakdown[OUTCOME_FIELD_BY_STATUS[status]] = count;
      }),
    );

    return breakdown;
  }
}
