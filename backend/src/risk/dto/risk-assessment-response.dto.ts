export class RiskAssessmentResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  assessmentTime!: string;
  ruleScore!: number;
  mlScore!: number | null;
  finalRiskBand!: string;
  explanation!: Record<string, unknown>;
  overriddenBy!: string | null;
  overrideReason!: string | null;
  status!: string;
  createdAt!: string;

  // rule_score / ml_score are Postgres `numeric` columns; PostgREST serializes numeric as a
  // JSON string (not a native number) to avoid floating-point precision loss, so every read
  // path must explicitly coerce with Number(...) rather than assume the driver already did.
  static fromRow(row: any): RiskAssessmentResponseDto {
    const dto = new RiskAssessmentResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.assessmentTime = row.assessment_time;
    dto.ruleScore = Number(row.rule_score);
    dto.mlScore = row.ml_score === null || row.ml_score === undefined ? null : Number(row.ml_score);
    dto.finalRiskBand = row.final_risk_band;
    dto.explanation = row.explanation_json;
    dto.overriddenBy = row.overridden_by;
    dto.overrideReason = row.override_reason;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    return dto;
  }
}
