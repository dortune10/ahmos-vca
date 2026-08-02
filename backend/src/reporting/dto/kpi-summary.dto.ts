export class RiskBandDistributionDto {
  low!: number;
  medium!: number;
  high!: number;
}

export class ReferralOutcomeBreakdownDto {
  completed!: number;
  failed!: number;
  cancelled!: number;
}

export class KpiSummaryDto {
  registeredPregnancies!: number;
  ancTaskCompletionRate!: number;
  highRiskCaseCount!: number;
  riskBandDistribution!: RiskBandDistributionDto;
  referralSlaBreaches!: number;
  referralOutcomeBreakdown!: ReferralOutcomeBreakdownDto;
}
