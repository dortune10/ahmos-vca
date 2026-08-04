import { AiAssistantService } from './ai-assistant.service';
import { ProfileContext } from './profile-context.service';
import { AuditService } from '../audit/audit.service';

const REFUSAL_MESSAGE =
  "I can't help with that — please contact your community health worker or clinic for " +
  'questions about symptoms, medication, or general health advice.';

function buildContext(): ProfileContext {
  return {
    firstName: 'Amina',
    episodeStatus: 'Active',
    estimatedDeliveryDate: '2026-10-08',
    gestationalAgeWeeks: 20,
    riskBand: 'low',
    upcomingTasks: [{ taskType: 'anc_visit', dueAt: '2026-09-01T00:00:00.000Z', status: 'Scheduled' }],
    latestReferralStatus: null,
  };
}

const AUDIT_REF = { tenantId: 't1', personId: 'p1' };

function buildAudit() {
  const log = jest.fn().mockResolvedValue(undefined);
  return { auditService: { log } as unknown as AuditService, log };
}

describe('AiAssistantService', () => {
  it("returns the model's text response for a profile-data question", async () => {
    const client = {
      messages: {
        create: jest.fn().mockResolvedValue({
          content: [{ type: 'text', text: 'Your next visit is scheduled around September 1st.' }],
        }),
      },
    } as any;
    const { auditService } = buildAudit();
    const service = new AiAssistantService(client, auditService);

    const result = await service.answer(buildContext(), 'When is my next appointment?', AUDIT_REF);

    expect(result).toBe('Your next visit is scheduled around September 1st.');
  });

  // Prompt-injection posture: the trusted profile JSON must live in the system prompt, and
  // the patient's own words must arrive delimited in the user turn — never concatenated
  // together in one untrusted blob.
  it('puts the profile in the system prompt and delimits the untrusted patient message', async () => {
    const createMock = jest.fn().mockResolvedValue({
      content: [{ type: 'text', text: 'ok' }],
    });
    const client = { messages: { create: createMock } } as any;
    const { auditService } = buildAudit();
    const service = new AiAssistantService(client, auditService);

    await service.answer(buildContext(), 'When is my next appointment?', AUDIT_REF);

    const call = createMock.mock.calls[0][0];
    expect(call.system).toContain('2026-10-08'); // profile data is in the system prompt
    expect(call.system).toContain('UNTRUSTED PATIENT TEXT');
    expect(call.messages).toEqual([
      { role: 'user', content: '<patient_message>When is my next appointment?</patient_message>' },
    ]);
    // The profile must NOT also be pasted into the user turn.
    expect(JSON.stringify(call.messages)).not.toContain('2026-10-08');
  });

  it('records the model version and outcome in the audit trail, but not the message content', async () => {
    const client = {
      messages: {
        create: jest.fn().mockResolvedValue({ content: [{ type: 'text', text: 'Your EDD is October 8th.' }] }),
      },
    } as any;
    const { auditService, log } = buildAudit();
    const service = new AiAssistantService(client, auditService);

    await service.answer(buildContext(), 'When is my baby due?', AUDIT_REF);

    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'ai_assistant_answered',
        entityId: 'p1',
        metadata: expect.objectContaining({ model: expect.any(String), outcome: 'answered' }),
      }),
    );
    expect(JSON.stringify(log.mock.calls[0][0].metadata)).not.toContain('October');
  });

  it('falls back to the refusal message when the API call throws, and marks the outcome', async () => {
    const client = {
      messages: { create: jest.fn().mockRejectedValue(new Error('network error')) },
    } as any;
    const { auditService, log } = buildAudit();
    const service = new AiAssistantService(client, auditService);

    const result = await service.answer(buildContext(), 'What medication should I take?', AUDIT_REF);

    expect(result).toBe(REFUSAL_MESSAGE);
    // A silent deflection because the API was down must be distinguishable from a real answer.
    expect(log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ outcome: 'fallback_api_error' }),
      }),
    );
  });

  it('falls back to the refusal message when the response has no text block', async () => {
    const client = {
      messages: { create: jest.fn().mockResolvedValue({ content: [] }) },
    } as any;
    const { auditService } = buildAudit();
    const service = new AiAssistantService(client, auditService);

    const result = await service.answer(buildContext(), 'anything', AUDIT_REF);

    expect(result).toBe(REFUSAL_MESSAGE);
  });
});
