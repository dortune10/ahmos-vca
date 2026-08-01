import { Injectable } from '@nestjs/common';

// PROVISIONAL THRESHOLDS — see this plan's Global Constraints and docs/DECISIONS.md's
// "Still Open" section. These are real, widely-cited obstetric reference ranges (not
// placeholder numbers), but they have NOT received clinical sign-off. Do not treat this
// engine's output as clinically validated; a clinician's own judgment and the override
// path in RiskService always take precedence in practice.

export type RiskBand = 'low' | 'medium' | 'high';

export const RISK_BAND_SCORE: Record<RiskBand, number> = { low: 0, medium: 1, high: 2 };

export interface RiskVitalsInput {
  bpSystolic?: number;
  bpDiastolic?: number;
  temperatureC?: number;
  hemoglobinGdl?: number;
}

export interface RuleFactorEvaluation {
  factor: 'bloodPressure' | 'hemoglobin' | 'temperature';
  band: RiskBand | null; // null = insufficient data; this factor does not contribute
  detail: string;
}

export interface RuleEngineResult {
  score: number; // 0 (low) | 1 (medium) | 2 (high) — ordinal encoding of `band`
  band: RiskBand; // highest band among factors that had data; 'low' if none had data
  factors: RuleFactorEvaluation[];
}

function higherBand(a: RiskBand, b: RiskBand): RiskBand {
  return RISK_BAND_SCORE[b] > RISK_BAND_SCORE[a] ? b : a;
}

@Injectable()
export class RiskRulesEngineService {
  evaluate(vitals: RiskVitalsInput): RuleEngineResult {
    const factors: RuleFactorEvaluation[] = [
      this.evaluateBloodPressure(vitals),
      this.evaluateHemoglobin(vitals),
      this.evaluateTemperature(vitals),
    ];

    const contributing = factors.filter(
      (f): f is RuleFactorEvaluation & { band: RiskBand } => f.band !== null,
    );
    const band: RiskBand =
      contributing.length === 0
        ? 'low'
        : contributing.reduce<RiskBand>((acc, f) => higherBand(acc, f.band), 'low');

    return { score: RISK_BAND_SCORE[band], band, factors };
  }

  private evaluateBloodPressure(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { bpSystolic, bpDiastolic } = vitals;
    if (bpSystolic === undefined && bpDiastolic === undefined) {
      return {
        factor: 'bloodPressure',
        band: null,
        detail: 'insufficient data: no bpSystolic or bpDiastolic recorded',
      };
    }

    const systolicText = bpSystolic === undefined ? 'n/a' : `${bpSystolic}`;
    const diastolicText = bpDiastolic === undefined ? 'n/a' : `${bpDiastolic}`;

    const isSevere =
      (bpSystolic !== undefined && bpSystolic >= 160) ||
      (bpDiastolic !== undefined && bpDiastolic >= 110);
    if (isSevere) {
      return {
        factor: 'bloodPressure',
        band: 'high',
        detail: `severe hypertension: systolic ${systolicText} mmHg (>=160) or diastolic ${diastolicText} mmHg (>=110)`,
      };
    }

    const isElevated =
      (bpSystolic !== undefined && bpSystolic >= 140) ||
      (bpDiastolic !== undefined && bpDiastolic >= 90);
    if (isElevated) {
      return {
        factor: 'bloodPressure',
        band: 'medium',
        detail: `hypertension: systolic ${systolicText} mmHg (>=140) or diastolic ${diastolicText} mmHg (>=90)`,
      };
    }

    return {
      factor: 'bloodPressure',
      band: 'low',
      detail: `systolic ${systolicText} mmHg and diastolic ${diastolicText} mmHg within normal range`,
    };
  }

  private evaluateHemoglobin(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { hemoglobinGdl } = vitals;
    if (hemoglobinGdl === undefined) {
      return { factor: 'hemoglobin', band: null, detail: 'insufficient data: no hemoglobinGdl recorded' };
    }
    if (hemoglobinGdl < 7) {
      return { factor: 'hemoglobin', band: 'high', detail: `severe anemia: hemoglobin ${hemoglobinGdl} g/dL < 7` };
    }
    if (hemoglobinGdl < 11) {
      return { factor: 'hemoglobin', band: 'medium', detail: `anemia: hemoglobin ${hemoglobinGdl} g/dL < 11` };
    }
    return { factor: 'hemoglobin', band: 'low', detail: `hemoglobin ${hemoglobinGdl} g/dL >= 11` };
  }

  private evaluateTemperature(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { temperatureC } = vitals;
    if (temperatureC === undefined) {
      return { factor: 'temperature', band: null, detail: 'insufficient data: no temperatureC recorded' };
    }
    if (temperatureC >= 38) {
      return {
        factor: 'temperature',
        band: 'medium',
        detail: `possible infection/fever: temperature ${temperatureC} C >= 38`,
      };
    }
    return { factor: 'temperature', band: 'low', detail: `temperature ${temperatureC} C < 38` };
  }
}
