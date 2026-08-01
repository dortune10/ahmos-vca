import { Test, TestingModule } from '@nestjs/testing';
import { RiskService, RiskEpisodeNotFoundError, RiskAssessmentNotFoundError } from './risk.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { RiskRulesEngineService } from './risk-rules-engine.service';
import { RiskMlService } from './risk-ml.service';

function buildServiceClientForAssess(opts: {
  episodeExists?: boolean;
  encounterNoteRow?: { vitals_json: any } | null;
  insertedRow: any;
}) {
  const episodeSingle = jest
    .fn()
    .mockResolvedValue(
      opts.episodeExists === false ? { data: null, error: null } : { data: { id: 'e1' }, error: null },
    );
  const episodeEq = jest.fn().mockReturnValue({ single: episodeSingle });
  const episodeSelect = jest.fn().mockReturnValue({ eq: episodeEq });

  const episodeUpdateEq = jest.fn().mockResolvedValue({ error: null });
  const episodeUpdate = jest.fn().mockReturnValue({ eq: episodeUpdateEq });

  const noteMaybeSingle = jest.fn().mockResolvedValue({ data: opts.encounterNoteRow ?? null, error: null });
  const noteLimit = jest.fn().mockReturnValue({ maybeSingle: noteMaybeSingle });
  const noteOrder = jest.fn().mockReturnValue({ limit: noteLimit });
  const noteEq = jest.fn().mockReturnValue({ order: noteOrder });
  const noteSelect = jest.fn().mockReturnValue({ eq: noteEq });

  const insertSingle = jest.fn().mockResolvedValue({ data: opts.insertedRow, error: null });
  const insertSelect = jest.fn().mockReturnValue({ single: insertSingle });
  const insert = jest.fn().mockReturnValue({ select: insertSelect });

  const client = {
    from: (table: string) => {
      if (table === 'pregnancy_episode') return { select: episodeSelect, update: episodeUpdate };
      if (table === 'encounter_note') return { select: noteSelect };
      if (table === 'risk_assessment') return { insert };
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { client, insert, episodeUpdate, episodeUpdateEq };
}

describe('RiskService.assess', () => {
  let auditLogMock: jest.Mock;
  let rulesEvaluateMock: jest.Mock;
  let mlAssessMock: jest.Mock;

  async function buildService(clientBundle: ReturnType<typeof buildServiceClientForAssess>) {
    const supabaseService = { getServiceClient: () => clientBundle.client } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    rulesEvaluateMock = jest.fn();
    const rulesEngine = { evaluate: rulesEvaluateMock } as unknown as RiskRulesEngineService;
    mlAssessMock = jest.fn();
    const mlService = { assess: mlAssessMock } as unknown as RiskMlService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
        { provide: RiskRulesEngineService, useValue: rulesEngine },
        { provide: RiskMlService, useValue: mlService },
      ],
    }).compile();

    return module.get<RiskService>(RiskService);
  }

  it('throws RiskEpisodeNotFoundError when the episode does not exist', async () => {
    const clientBundle = buildServiceClientForAssess({ episodeExists: false, insertedRow: {} });
    const service = await buildService(clientBundle);

    await expect(service.assess('t1', 'u1', 'missing')).rejects.toThrow(RiskEpisodeNotFoundError);
  });

  it('runs the rule engine on an empty vitals object when there is no encounter_note yet', async () => {
    const clientBundle = buildServiceClientForAssess({
      encounterNoteRow: null,
      insertedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '0',
        ml_score: null,
        final_risk_band: 'low',
        explanation_json: {},
        overridden_by: null,
        override_reason: null,
        status: 'FallbackRuleOnly',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(clientBundle);
    rulesEvaluateMock.mockReturnValue({ score: 0, band: 'low', factors: [] });
    mlAssessMock.mockResolvedValue({ ok: false, errorReason: 'timeout' });

    await service.assess('t1', 'u1', 'e1');

    expect(rulesEvaluateMock).toHaveBeenCalledWith({});
  });

  it('sets status Computed and final_risk_band = ML band when ML agrees with or exceeds the rule band', async () => {
    const clientBundle = buildServiceClientForAssess({
      encounterNoteRow: { vitals_json: { bpSystolic: 150 } },
      insertedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '1',
        ml_score: '2',
        final_risk_band: 'high',
        explanation_json: {},
        overridden_by: null,
        override_reason: null,
        status: 'Computed',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(clientBundle);
    rulesEvaluateMock.mockReturnValue({
      score: 1,
      band: 'medium',
      factors: [{ factor: 'bloodPressure', band: 'medium', detail: 'hypertension' }],
    });
    mlAssessMock.mockResolvedValue({ ok: true, riskBand: 'high', reasoning: 'Multiple concerning signs.' });

    await service.assess('t1', 'u1', 'e1');

    expect(clientBundle.insert).toHaveBeenCalledWith(
      expect.objectContaining({ final_risk_band: 'high', status: 'Computed', ml_score: 2 }),
    );
    expect(clientBundle.episodeUpdate).toHaveBeenCalledWith(expect.objectContaining({ risk_band: 'high' }));
  });

  it('keeps the rule band and records the disagreement when ML suggests a lower band than the rules', async () => {
    const clientBundle = buildServiceClientForAssess({
      encounterNoteRow: { vitals_json: { bpSystolic: 165 } },
      insertedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '2',
        ml_score: '0',
        final_risk_band: 'high',
        explanation_json: { mlDisagreement: {} },
        overridden_by: null,
        override_reason: null,
        status: 'Computed',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(clientBundle);
    rulesEvaluateMock.mockReturnValue({
      score: 2,
      band: 'high',
      factors: [{ factor: 'bloodPressure', band: 'high', detail: 'severe hypertension' }],
    });
    mlAssessMock.mockResolvedValue({ ok: true, riskBand: 'low', reasoning: 'Looks fine overall.' });

    await service.assess('t1', 'u1', 'e1');

    expect(clientBundle.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        final_risk_band: 'high',
        status: 'Computed',
        ml_score: 0,
        explanation_json: expect.objectContaining({ mlDisagreement: expect.anything() }),
      }),
    );
  });

  it('falls back to rule-only scoring with status FallbackRuleOnly when the ML call fails', async () => {
    const clientBundle = buildServiceClientForAssess({
      encounterNoteRow: { vitals_json: { hemoglobinGdl: 6 } },
      insertedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '2',
        ml_score: null,
        final_risk_band: 'high',
        explanation_json: { mlError: 'timeout' },
        overridden_by: null,
        override_reason: null,
        status: 'FallbackRuleOnly',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(clientBundle);
    rulesEvaluateMock.mockReturnValue({
      score: 2,
      band: 'high',
      factors: [{ factor: 'hemoglobin', band: 'high', detail: 'severe anemia' }],
    });
    mlAssessMock.mockResolvedValue({ ok: false, errorReason: 'timeout' });

    const result = await service.assess('t1', 'u1', 'e1');

    expect(clientBundle.insert).toHaveBeenCalledWith(
      expect.objectContaining({
        final_risk_band: 'high',
        ml_score: null,
        status: 'FallbackRuleOnly',
        explanation_json: expect.objectContaining({ mlError: 'timeout' }),
      }),
    );
    expect(result.status).toBe('FallbackRuleOnly');
  });

  it('writes a computed audit_event capturing what the model saw and returned, and returns the mapped DTO', async () => {
    const clientBundle = buildServiceClientForAssess({
      encounterNoteRow: { vitals_json: { temperatureC: 36.5 } },
      insertedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '0',
        ml_score: '0',
        final_risk_band: 'low',
        explanation_json: {},
        overridden_by: null,
        override_reason: null,
        status: 'Computed',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(clientBundle);
    rulesEvaluateMock.mockReturnValue({ score: 0, band: 'low', factors: [] });
    mlAssessMock.mockResolvedValue({ ok: true, riskBand: 'low', reasoning: 'No concerning signs.' });

    const result = await service.assess('t1', 'u1', 'e1');

    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        actorUserId: 'u1',
        entityType: 'risk_assessment',
        action: 'computed',
        metadata: expect.objectContaining({ mlInput: expect.anything(), mlOutcome: expect.anything() }),
      }),
    );
    expect(result.id).toBe('ra1');
    expect(result.ruleScore).toBe(0);
    expect(result.mlScore).toBe(0);
  });
});

describe('RiskService event listeners', () => {
  async function buildServiceForEvents() {
    const clientBundle = buildServiceClientForAssess({ insertedRow: {} });
    const supabaseService = { getServiceClient: () => clientBundle.client } as unknown as SupabaseService;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RiskRulesEngineService, useValue: { evaluate: jest.fn() } },
        { provide: RiskMlService, useValue: { assess: jest.fn() } },
      ],
    }).compile();
    return module.get<RiskService>(RiskService);
  }

  it('handleEpisodeCreated calls assess with the event payload fields', async () => {
    const service = await buildServiceForEvents();
    const assessSpy = jest.spyOn(service, 'assess').mockResolvedValue({} as any);

    await service.handleEpisodeCreated({ episodeId: 'e1', tenantId: 't1', actorUserId: 'u1' });

    expect(assessSpy).toHaveBeenCalledWith('t1', 'u1', 'e1');
  });

  it('handleClinicalDataUpdated calls assess with the event payload fields', async () => {
    const service = await buildServiceForEvents();
    const assessSpy = jest.spyOn(service, 'assess').mockResolvedValue({} as any);

    await service.handleClinicalDataUpdated({ episodeId: 'e2', tenantId: 't2', actorUserId: 'u2' });

    expect(assessSpy).toHaveBeenCalledWith('t2', 'u2', 'e2');
  });

  it('swallows assess() failures so a broken pipeline never rejects the event handler', async () => {
    const service = await buildServiceForEvents();
    jest.spyOn(service, 'assess').mockRejectedValue(new Error('db is down'));

    await expect(
      service.handleEpisodeCreated({ episodeId: 'e1', tenantId: 't1', actorUserId: 'u1' }),
    ).resolves.toBeUndefined();
  });
});

describe('RiskService.override', () => {
  function buildOverrideClient(opts: { existing: any; updatedRow: any }) {
    const fetchSingle = jest
      .fn()
      .mockResolvedValue(
        opts.existing ? { data: opts.existing, error: null } : { data: null, error: { message: 'not found' } },
      );
    const fetchEq = jest.fn().mockReturnValue({ single: fetchSingle });
    const fetchSelect = jest.fn().mockReturnValue({ eq: fetchEq });

    const updateSingle = jest.fn().mockResolvedValue({ data: opts.updatedRow, error: null });
    const updateSelect = jest.fn().mockReturnValue({ single: updateSingle });
    const updateEq = jest.fn().mockReturnValue({ select: updateSelect });
    const update = jest.fn().mockReturnValue({ eq: updateEq });

    const episodeUpdateEq = jest.fn().mockResolvedValue({ error: null });
    const episodeUpdate = jest.fn().mockReturnValue({ eq: episodeUpdateEq });

    const client = {
      from: (table: string) => {
        if (table === 'risk_assessment') return { select: fetchSelect, update };
        if (table === 'pregnancy_episode') return { update: episodeUpdate };
        throw new Error(`unexpected table: ${table}`);
      },
    };
    return { client, update, episodeUpdate };
  }

  let auditLogMock: jest.Mock;

  async function buildService(client: any) {
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
        { provide: RiskRulesEngineService, useValue: { evaluate: jest.fn() } },
        { provide: RiskMlService, useValue: { assess: jest.fn() } },
      ],
    }).compile();
    return module.get<RiskService>(RiskService);
  }

  it('updates final_risk_band, overridden_by, override_reason, status, and the episode denormalized risk_band', async () => {
    const bundle = buildOverrideClient({
      existing: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        pregnancy_episode: { facility: { tenant_id: 't1' } },
      },
      updatedRow: {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '2',
        ml_score: '2',
        final_risk_band: 'medium',
        explanation_json: {},
        overridden_by: 'clinician-1',
        override_reason: 'Patient stable on review',
        status: 'Overridden',
        created_at: '2026-01-01T00:00:00Z',
      },
    });
    const service = await buildService(bundle.client);

    const result = await service.override('jwt', 'clinician-1', 'ra1', {
      finalRiskBand: 'medium',
      overrideReason: 'Patient stable on review',
    });

    expect(bundle.update).toHaveBeenCalledWith({
      final_risk_band: 'medium',
      overridden_by: 'clinician-1',
      override_reason: 'Patient stable on review',
      status: 'Overridden',
    });
    expect(bundle.episodeUpdate).toHaveBeenCalledWith(expect.objectContaining({ risk_band: 'medium' }));
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        actorUserId: 'clinician-1',
        entityType: 'risk_assessment',
        action: 'overridden',
      }),
    );
    expect(result.status).toBe('Overridden');
  });

  it('throws RiskAssessmentNotFoundError when the assessment does not exist or is not visible under RLS', async () => {
    const bundle = buildOverrideClient({ existing: null, updatedRow: {} });
    const service = await buildService(bundle.client);

    await expect(
      service.override('jwt', 'clinician-1', 'missing', { finalRiskBand: 'low', overrideReason: 'n/a' }),
    ).rejects.toThrow(RiskAssessmentNotFoundError);
  });
});

describe('RiskService.getLatestForEpisode', () => {
  async function buildService(row: any | null) {
    const maybeSingle = jest.fn().mockResolvedValue({ data: row, error: null });
    const limit = jest.fn().mockReturnValue({ maybeSingle });
    const order = jest.fn().mockReturnValue({ limit });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const client = { from: () => ({ select }) };
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RiskRulesEngineService, useValue: { evaluate: jest.fn() } },
        { provide: RiskMlService, useValue: { assess: jest.fn() } },
      ],
    }).compile();
    return module.get<RiskService>(RiskService);
  }

  it('returns the mapped DTO for the most recent assessment row', async () => {
    const service = await buildService({
      id: 'ra1',
      pregnancy_episode_id: 'e1',
      assessment_time: '2026-01-02T00:00:00Z',
      rule_score: '1',
      ml_score: '1',
      final_risk_band: 'medium',
      explanation_json: {},
      overridden_by: null,
      override_reason: null,
      status: 'Computed',
      created_at: '2026-01-02T00:00:00Z',
    });

    const result = await service.getLatestForEpisode('jwt', 'e1');

    expect(result?.id).toBe('ra1');
    expect(result?.finalRiskBand).toBe('medium');
  });

  it('returns null when the episode has no risk assessments yet', async () => {
    const service = await buildService(null);

    const result = await service.getLatestForEpisode('jwt', 'e1');

    expect(result).toBeNull();
  });
});

describe('RiskService.listHistoryForEpisode', () => {
  async function buildService(rows: any[]) {
    const order = jest.fn().mockResolvedValue({ data: rows, error: null });
    const eq = jest.fn().mockReturnValue({ order });
    const select = jest.fn().mockReturnValue({ eq });
    const client = { from: () => ({ select }) };
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        RiskService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: { log: jest.fn() } },
        { provide: RiskRulesEngineService, useValue: { evaluate: jest.fn() } },
        { provide: RiskMlService, useValue: { assess: jest.fn() } },
      ],
    }).compile();
    return module.get<RiskService>(RiskService);
  }

  it('returns assessments newest-first as mapped DTOs', async () => {
    const service = await buildService([
      {
        id: 'ra2',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-02T00:00:00Z',
        rule_score: '2',
        ml_score: null,
        final_risk_band: 'high',
        explanation_json: {},
        overridden_by: null,
        override_reason: null,
        status: 'FallbackRuleOnly',
        created_at: '2026-01-02T00:00:00Z',
      },
      {
        id: 'ra1',
        pregnancy_episode_id: 'e1',
        assessment_time: '2026-01-01T00:00:00Z',
        rule_score: '0',
        ml_score: '0',
        final_risk_band: 'low',
        explanation_json: {},
        overridden_by: null,
        override_reason: null,
        status: 'Computed',
        created_at: '2026-01-01T00:00:00Z',
      },
    ]);

    const result = await service.listHistoryForEpisode('jwt', 'e1');

    expect(result.map((r) => r.id)).toEqual(['ra2', 'ra1']);
  });
});
