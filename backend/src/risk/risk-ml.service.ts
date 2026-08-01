import { Inject, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { RiskBand } from './risk-rules-engine.service';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';
export const RISK_ML_TIMEOUT_MS = 8000;

export interface RiskMlInput {
  pregnancyEpisodeId: string;
  vitals: {
    bpSystolic?: number;
    bpDiastolic?: number;
    temperatureC?: number;
    hemoglobinGdl?: number;
  };
  ruleBand: RiskBand;
  ruleFactors: Array<{ factor: string; band: RiskBand | null; detail: string }>;
}

export interface RiskMlSuccess {
  ok: true;
  riskBand: RiskBand;
  reasoning: string;
}

export interface RiskMlFailure {
  ok: false;
  errorReason: string;
}

export type RiskMlResult = RiskMlSuccess | RiskMlFailure;

// Advisory-only, structured-input-only system prompt — see this plan's design notes
// (docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md Section 6): the model
// never sees free-text notes or PII, only the same structured vitals fields already
// computed by the rule engine.
const SYSTEM_PROMPT = [
  'You are an advisory clinical risk-classification assistant for a maternal health platform.',
  'You are NOT providing a diagnosis and your output does not replace clinical judgment — a',
  "qualified clinician always makes the final risk determination.",
  '',
  "You will be given a JSON object describing a pregnancy episode's structured vitals and the",
  'output of a deterministic rules engine that already ran over the same data. Using this',
  'structured data only (do not assume any information not present in the JSON), call the',
  'submit_risk_assessment tool exactly once with your own advisory classification ("low",',
  '"medium", or "high") plus a short, one-or-two-sentence, plain-language reasoning string.',
].join('\n');

// Not `as const`: the Anthropic SDK's `Tool.InputSchema.required` type is a mutable
// `string[]`, and `as const` here would narrow it to a readonly tuple that no longer
// satisfies that type (a real TS2769 build error hit while implementing this against the
// installed SDK version, not present in the plan's own reference code). An explicit
// `Anthropic.Tool` annotation gives the same compile-time safety without that mismatch.
const RISK_ASSESSMENT_TOOL: Anthropic.Tool = {
  name: 'submit_risk_assessment',
  description:
    'Submit an advisory maternal-health risk classification (low, medium, or high) with a short reasoning string, based only on the structured clinical data provided in the user message.',
  input_schema: {
    type: 'object',
    properties: {
      riskBand: { type: 'string', enum: ['low', 'medium', 'high'] },
      reasoning: { type: 'string' },
    },
    required: ['riskBand', 'reasoning'],
  },
};

class RiskMlTimeoutError extends Error {}

@Injectable()
export class RiskMlService {
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  constructor(@Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic) {}

  async assess(input: RiskMlInput): Promise<RiskMlResult> {
    try {
      const response = await Promise.race([
        this.client.messages.create({
          model: this.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          tools: [RISK_ASSESSMENT_TOOL],
          tool_choice: { type: 'tool', name: 'submit_risk_assessment' },
        }),
        this.timeout(),
      ]);

      const content = (response as any).content ?? [];
      const toolUse = content.find((block: any) => block.type === 'tool_use');
      if (!toolUse || toolUse.name !== 'submit_risk_assessment') {
        return { ok: false, errorReason: 'malformed_response: no submit_risk_assessment tool_use block' };
      }

      const toolInput = toolUse.input as { riskBand?: unknown; reasoning?: unknown };
      const riskBand = toolInput?.riskBand;
      const reasoning = toolInput?.reasoning;

      if (riskBand !== 'low' && riskBand !== 'medium' && riskBand !== 'high') {
        return { ok: false, errorReason: 'malformed_response: riskBand missing or invalid' };
      }
      if (typeof reasoning !== 'string' || reasoning.length === 0) {
        return { ok: false, errorReason: 'malformed_response: reasoning missing or empty' };
      }

      return { ok: true, riskBand, reasoning };
    } catch (err) {
      if (err instanceof RiskMlTimeoutError) {
        return { ok: false, errorReason: 'timeout' };
      }
      const message = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, errorReason: `api_error: ${message}` };
    }
  }

  private timeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new RiskMlTimeoutError('Claude API call exceeded the 8s timeout')),
        RISK_ML_TIMEOUT_MS,
      );
    });
  }
}
