import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../common/supabase/supabase.service';
import {
  KpiSummaryDto,
  ReferralOutcomeBreakdownDto,
  RiskBandDistributionDto,
} from './dto/kpi-summary.dto';

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

  // Implemented for real in Task 2 of this plan (needs care_task fixtures this task's
  // tests don't set up) — returns a neutral 0 for now so getKpiSummary() is already fully
  // callable and its DTO shape is complete from this task onward.
  private async computeAncTaskCompletionRate(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<number> {
    return 0;
  }

  // Implemented for real in Task 2.
  private async countReferralSlaBreaches(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<number> {
    return 0;
  }

  // Implemented for real in Task 2.
  private async computeReferralOutcomeBreakdown(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<ReferralOutcomeBreakdownDto> {
    return { completed: 0, failed: 0, cancelled: 0 };
  }
}
