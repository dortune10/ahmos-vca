import { RiskMlService, RiskMlInput } from './risk-ml.service';

const SAMPLE_INPUT: RiskMlInput = {
  pregnancyEpisodeId: 'e1',
  vitals: { bpSystolic: 150, bpDiastolic: 95, temperatureC: 37.2, hemoglobinGdl: 10.5 },
  ruleBand: 'medium',
  ruleFactors: [
    { factor: 'bloodPressure', band: 'medium', detail: 'hypertension: systolic 150 mmHg (>=140)' },
    { factor: 'hemoglobin', band: 'medium', detail: 'anemia: hemoglobin 10.5 g/dL < 11' },
    { factor: 'temperature', band: 'low', detail: 'temperature 37.2 C < 38' },
  ],
};

function buildToolUseMessage(input: unknown) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'submit_risk_assessment',
        input,
      },
    ],
  };
}

describe('RiskMlService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an ok result with the model riskBand and reasoning on a well-formed tool response', async () => {
    const fakeClient = {
      messages: {
        create: jest
          .fn()
          .mockResolvedValue(
            buildToolUseMessage({ riskBand: 'high', reasoning: 'Elevated BP combined with anemia.' }),
          ),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result).toEqual({ ok: true, riskBand: 'high', reasoning: 'Elevated BP combined with anemia.' });
    expect(fakeClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'submit_risk_assessment' },
      }),
    );
  });

  it('falls back with errorReason "timeout" when the call exceeds the timeout window', async () => {
    jest.useFakeTimers();
    const neverResolves = new Promise(() => {});
    const fakeClient = { messages: { create: jest.fn().mockReturnValue(neverResolves) } };
    const service = new RiskMlService(fakeClient as any);

    const resultPromise = service.assess(SAMPLE_INPUT);
    jest.advanceTimersByTime(8000);
    const result = await resultPromise;

    expect(result).toEqual({ ok: false, errorReason: 'timeout' });
  });

  it('falls back with a malformed_response reason when no tool_use block is returned', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockResolvedValue({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I cannot comply.' }],
        }),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with a malformed_response reason when the tool input has an invalid riskBand', async () => {
    const fakeClient = {
      messages: {
        create: jest
          .fn()
          .mockResolvedValue(buildToolUseMessage({ riskBand: 'severe', reasoning: 'not a valid band' })),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with a malformed_response reason when reasoning is missing', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockResolvedValue(buildToolUseMessage({ riskBand: 'low' })),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with an api_error reason when the SDK call rejects', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('connection reset')),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result).toEqual({ ok: false, errorReason: 'api_error: connection reset' });
  });
});
