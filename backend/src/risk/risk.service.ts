import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { RiskRulesEngineService, RISK_BAND_SCORE, RiskBand, RiskVitalsInput } from './risk-rules-engine.service';
import { RiskMlService } from './risk-ml.service';
import { RiskAssessmentResponseDto } from './dto/risk-assessment-response.dto';
import { OverrideRiskAssessmentDto } from './dto/override-risk-assessment.dto';
import type { EpisodeLifecycleEventPayload } from '../episode/episode.service';

export class RiskEpisodeNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`Pregnancy episode ${episodeId} not found`);
  }
}

export class RiskAssessmentNotFoundError extends Error {
  constructor(public readonly assessmentId: string) {
    super(`Risk assessment ${assessmentId} not found`);
  }
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly rulesEngine: RiskRulesEngineService,
    private readonly mlService: RiskMlService,
  ) {}

  async assess(
    tenantId: string,
    actorUserId: string,
    pregnancyEpisodeId: string,
  ): Promise<RiskAssessmentResponseDto> {
    const client = this.supabaseService.getServiceClient();

    const { data: episode, error: episodeError } = await client
      .from('pregnancy_episode')
      .select('id')
      .eq('id', pregnancyEpisodeId)
      .single();
    if (episodeError || !episode) {
      throw new RiskEpisodeNotFoundError(pregnancyEpisodeId);
    }

    const { data: latestNote, error: noteError } = await client
      .from('encounter_note')
      .select('vitals_json')
      .eq('pregnancy_episode_id', pregnancyEpisodeId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (noteError) {
      throw noteError;
    }
    const vitals: RiskVitalsInput = (latestNote?.vitals_json as RiskVitalsInput) ?? {};

    const ruleResult = this.rulesEngine.evaluate(vitals);

    const mlResult = await this.mlService.assess({
      pregnancyEpisodeId,
      vitals,
      ruleBand: ruleResult.band,
      ruleFactors: ruleResult.factors,
    });

    const explanation: Record<string, unknown> = { ruleFactors: ruleResult.factors };
    let finalBand: RiskBand;
    let mlScoreValue: number | null;
    let status: string;

    if (!mlResult.ok) {
      finalBand = ruleResult.band;
      mlScoreValue = null;
      status = 'FallbackRuleOnly';
      explanation.mlError = mlResult.errorReason;
    } else {
      mlScoreValue = RISK_BAND_SCORE[mlResult.riskBand];
      explanation.mlReasoning = mlResult.reasoning;
      if (RISK_BAND_SCORE[mlResult.riskBand] < RISK_BAND_SCORE[ruleResult.band]) {
        finalBand = ruleResult.band;
        explanation.mlDisagreement = {
          ruleBand: ruleResult.band,
          mlBand: mlResult.riskBand,
          resolution:
            'rule band retained; rules take precedence on disagreement (docs/DECISIONS.md #19)',
        };
      } else {
        finalBand = mlResult.riskBand;
      }
      status = 'Computed';
    }

    const { data, error } = await client
      .from('risk_assessment')
      .insert({
        pregnancy_episode_id: pregnancyEpisodeId,
        rule_score: ruleResult.score,
        ml_score: mlScoreValue,
        final_risk_band: finalBand,
        explanation_json: explanation,
        status,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    const { error: updateError } = await client
      .from('pregnancy_episode')
      .update({ risk_band: finalBand, updated_at: new Date().toISOString() })
      .eq('id', pregnancyEpisodeId);
    if (updateError) {
      throw updateError;
    }

    // Section 6 of the design spec requires every model call and response to be traceable
    // alongside the risk_assessment row, so a clinician can review exactly what the model
    // saw (mlInput) and returned (mlOutcome) — not just the final combined result.
    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'risk_assessment',
      entityId: data.id,
      action: 'computed',
      metadata: {
        finalRiskBand: finalBand,
        status,
        mlInput: { vitals, ruleBand: ruleResult.band, ruleFactors: ruleResult.factors },
        mlOutcome: mlResult,
      },
    });

    return RiskAssessmentResponseDto.fromRow(data);
  }

  async override(
    jwt: string,
    actorUserId: string,
    assessmentId: string,
    dto: OverrideRiskAssessmentDto,
  ): Promise<RiskAssessmentResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: existing, error: fetchError } = await client
      .from('risk_assessment')
      .select('id, pregnancy_episode_id, pregnancy_episode(facility(tenant_id))')
      .eq('id', assessmentId)
      .single();
    if (fetchError || !existing) {
      throw new RiskAssessmentNotFoundError(assessmentId);
    }
    const tenantId = (existing as any).pregnancy_episode?.facility?.tenant_id;
    const pregnancyEpisodeId = (existing as any).pregnancy_episode_id;

    const { data, error } = await client
      .from('risk_assessment')
      .update({
        final_risk_band: dto.finalRiskBand,
        overridden_by: actorUserId,
        override_reason: dto.overrideReason,
        status: 'Overridden',
      })
      .eq('id', assessmentId)
      .select()
      .single();
    if (error) {
      throw error;
    }

    const { error: episodeUpdateError } = await client
      .from('pregnancy_episode')
      .update({ risk_band: dto.finalRiskBand, updated_at: new Date().toISOString() })
      .eq('id', pregnancyEpisodeId);
    if (episodeUpdateError) {
      throw episodeUpdateError;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'risk_assessment',
      entityId: assessmentId,
      action: 'overridden',
      metadata: { finalRiskBand: dto.finalRiskBand, overrideReason: dto.overrideReason },
    });

    return RiskAssessmentResponseDto.fromRow(data);
  }

  async getLatestForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto | null> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('risk_assessment')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('assessment_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? RiskAssessmentResponseDto.fromRow(data) : null;
  }

  async listHistoryForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('risk_assessment')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('assessment_time', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []).map(RiskAssessmentResponseDto.fromRow);
  }

  @OnEvent('episode.created')
  async handleEpisodeCreated(payload: EpisodeLifecycleEventPayload): Promise<void> {
    try {
      await this.assess(payload.tenantId, payload.actorUserId, payload.episodeId);
    } catch (err) {
      this.logger.error(
        `Risk assessment failed for episode ${payload.episodeId} after episode.created: ${
          (err as Error).message
        }`,
      );
    }
  }

  @OnEvent('episode.clinical_data_updated')
  async handleClinicalDataUpdated(payload: EpisodeLifecycleEventPayload): Promise<void> {
    try {
      await this.assess(payload.tenantId, payload.actorUserId, payload.episodeId);
    } catch (err) {
      this.logger.error(
        `Risk assessment failed for episode ${payload.episodeId} after episode.clinical_data_updated: ${
          (err as Error).message
        }`,
      );
    }
  }
}
