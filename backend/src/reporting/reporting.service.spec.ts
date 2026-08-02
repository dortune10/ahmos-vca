import { Test, TestingModule } from '@nestjs/testing';
import { ReportingService } from './reporting.service';
import { SupabaseService } from '../common/supabase/supabase.service';

interface PregnancyEpisodeFixture {
  totalCount?: number;
  highRiskCount?: number;
  riskBandRows?: { risk_band: string | null }[];
}

function buildPregnancyEpisodeTable(fixture: PregnancyEpisodeFixture) {
  const { totalCount = 0, highRiskCount = 0, riskBandRows = [] } = fixture;
  const eqCalls: Array<[string, string]> = [];

  return {
    eqCalls,
    select: (columns: string) => {
      if (columns === 'risk_band') {
        const builder: any = {
          eq: (col: string, val: string) => {
            eqCalls.push([col, val]);
            return builder;
          },
          then: (resolve: any) => resolve({ data: riskBandRows, error: null }),
        };
        return builder;
      }

      let highRiskFilterApplied = false;
      const builder: any = {
        eq: (col: string, val: string) => {
          eqCalls.push([col, val]);
          if (col === 'risk_band' && val === 'high') {
            highRiskFilterApplied = true;
          }
          return builder;
        },
        then: (resolve: any) =>
          resolve({ count: highRiskFilterApplied ? highRiskCount : totalCount, error: null }),
      };
      return builder;
    },
  };
}

interface CareTaskFixture {
  totalCount?: number;
  completedCount?: number;
}

// Disambiguates the two anc_visit count queries (total vs. completed) the same way
// buildPregnancyEpisodeTable disambiguates its two count queries: by which `.eq()` was
// chained on before the caller awaits.
function buildCareTaskTable(fixture: CareTaskFixture = {}) {
  const { totalCount = 0, completedCount = 0 } = fixture;
  const eqCalls: Array<[string, string]> = [];

  return {
    eqCalls,
    select: () => {
      let completedFilterApplied = false;
      const builder: any = {
        eq: (col: string, val: string) => {
          eqCalls.push([col, val]);
          if (col === 'status' && val === 'Completed') {
            completedFilterApplied = true;
          }
          return builder;
        },
        then: (resolve: any) =>
          resolve({ count: completedFilterApplied ? completedCount : totalCount, error: null }),
      };
      return builder;
    },
  };
}

interface ReferralFixture {
  slaBreachCount?: number;
  statusCounts?: Partial<Record<'Completed' | 'Failed' | 'Cancelled', number>>;
}

// Disambiguates the SLA-breach count query (which chains `.not('status', 'in', ...)`) from
// the three per-status outcome-breakdown count queries (which chain `.eq('status', X)`).
function buildReferralTable(fixture: ReferralFixture = {}) {
  const { slaBreachCount = 0, statusCounts = {} } = fixture;
  const eqCalls: Array<[string, string]> = [];
  const notCalls: Array<[string, string, string]> = [];

  return {
    eqCalls,
    notCalls,
    select: () => {
      let isSlaBreachQuery = false;
      let matchedStatus: string | null = null;
      const builder: any = {
        not: (col: string, op: string, val: string) => {
          notCalls.push([col, op, val]);
          isSlaBreachQuery = true;
          return builder;
        },
        lt: () => builder,
        eq: (col: string, val: string) => {
          eqCalls.push([col, val]);
          if (col === 'status') {
            matchedStatus = val;
          }
          return builder;
        },
        then: (resolve: any) =>
          resolve({
            count: isSlaBreachQuery
              ? slaBreachCount
              : matchedStatus
                ? (statusCounts[matchedStatus as 'Completed' | 'Failed' | 'Cancelled'] ?? 0)
                : 0,
            error: null,
          }),
      };
      return builder;
    },
  };
}

function buildFakeClient(tables: {
  pregnancyEpisode?: ReturnType<typeof buildPregnancyEpisodeTable>;
  careTask?: ReturnType<typeof buildCareTaskTable>;
  referral?: ReturnType<typeof buildReferralTable>;
}) {
  return {
    from: (table: string) => {
      if (table === 'pregnancy_episode' && tables.pregnancyEpisode) return tables.pregnancyEpisode;
      if (table === 'care_task' && tables.careTask) return tables.careTask;
      if (table === 'referral' && tables.referral) return tables.referral;
      throw new Error(`unexpected table "${table}" queried in this test (no fixture provided)`);
    },
  };
}

async function buildService(supabaseService: SupabaseService) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [ReportingService, { provide: SupabaseService, useValue: supabaseService }],
  }).compile();
  return module.get<ReportingService>(ReportingService);
}

// getKpiSummary queries pregnancy_episode, care_task, and referral unconditionally on every
// call (via Promise.all across all six aggregates), while buildFakeClient throws on any
// table queried without an explicit fixture (to catch real typos/bugs). So every test below
// must supply a fixture for all three tables, even ones it isn't exercising — these three
// NEUTRAL_* constants are that filler, reused across tests the same way Task 1 introduced
// NEUTRAL_PREGNANCY_EPISODE for its own not-yet-implemented-fields test.
const NEUTRAL_PREGNANCY_EPISODE = buildPregnancyEpisodeTable({});
const NEUTRAL_CARE_TASK = buildCareTaskTable({});
const NEUTRAL_REFERRAL = buildReferralTable({});

describe('ReportingService.getKpiSummary — episode-based aggregates', () => {
  it('counts registeredPregnancies with no facility filter', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 4 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode, careTask: NEUTRAL_CARE_TASK, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.registeredPregnancies).toBe(4);
    // Not `toEqual([])`: getKpiSummary's Promise.all dispatches countHighRiskCases
    // concurrently against this same pregnancy_episode table double, and that call's own
    // unconditional `.eq('risk_band', 'high')` lands in this shared eqCalls log too — that's
    // real, correct high-risk-count behavior, unrelated to facility scoping. What this test
    // actually asserts is "no facility_id filter was applied" when facilityId is omitted.
    expect(pregnancyEpisode.eqCalls).not.toContainEqual(['facility_id', expect.anything()]);
  });

  it('scopes registeredPregnancies to facilityId when provided', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 2 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode, careTask: NEUTRAL_CARE_TASK, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt', 'f1');

    expect(result.registeredPregnancies).toBe(2);
    expect(pregnancyEpisode.eqCalls).toContainEqual(['facility_id', 'f1']);
  });

  it('counts highRiskCaseCount as episodes with risk_band = high only, independent of the total', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 10, highRiskCount: 3 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode, careTask: NEUTRAL_CARE_TASK, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.highRiskCaseCount).toBe(3);
    expect(result.registeredPregnancies).toBe(10);
  });

  it('computes riskBandDistribution by tallying risk_band values and excluding nulls', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({
      riskBandRows: [
        { risk_band: 'low' },
        { risk_band: 'low' },
        { risk_band: 'medium' },
        { risk_band: 'high' },
        { risk_band: null },
      ],
    });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode, careTask: NEUTRAL_CARE_TASK, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.riskBandDistribution).toEqual({ low: 2, medium: 1, high: 1 });
  });
});

describe('ReportingService.getKpiSummary — anc task completion rate', () => {
  it('computes completed / total for anc_visit tasks only', async () => {
    const careTask = buildCareTaskTable({ totalCount: 4, completedCount: 3 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.ancTaskCompletionRate).toBe(0.75);
  });

  it('returns 0 rather than dividing by zero when there are no anc_visit tasks', async () => {
    const careTask = buildCareTaskTable({ totalCount: 0, completedCount: 0 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.ancTaskCompletionRate).toBe(0);
  });

  it('scopes both the total and completed counts to facilityId via the pregnancy_episode join', async () => {
    const careTask = buildCareTaskTable({ totalCount: 1, completedCount: 1 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask, referral: NEUTRAL_REFERRAL }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    await service.getKpiSummary('jwt', 'f1');

    expect(careTask.eqCalls).toContainEqual(['pregnancy_episode.facility_id', 'f1']);
  });
});

describe('ReportingService.getKpiSummary — referral SLA breaches and outcome breakdown', () => {
  it('counts referralSlaBreaches using the terminal-status exclusion and the 24-hour cutoff', async () => {
    const referral = buildReferralTable({ slaBreachCount: 2 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral, careTask: NEUTRAL_CARE_TASK }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.referralSlaBreaches).toBe(2);
    expect(referral.notCalls).toContainEqual(['status', 'in', '(Completed,Failed,Cancelled)']);
  });

  it('computes referralOutcomeBreakdown across Completed, Failed, and Cancelled', async () => {
    const referral = buildReferralTable({
      statusCounts: { Completed: 5, Failed: 2, Cancelled: 1 },
    });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral, careTask: NEUTRAL_CARE_TASK }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.referralOutcomeBreakdown).toEqual({ completed: 5, failed: 2, cancelled: 1 });
  });

  it('scopes referral aggregates to facilityId via the pregnancy_episode join', async () => {
    const referral = buildReferralTable({ slaBreachCount: 1, statusCounts: { Completed: 1 } });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral, careTask: NEUTRAL_CARE_TASK }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    await service.getKpiSummary('jwt', 'f1');

    expect(referral.eqCalls).toContainEqual(['pregnancy_episode.facility_id', 'f1']);
  });
});

function buildReferralRowsTable(rows: any[]) {
  const calls: { not?: [string, string, string]; eq?: [string, string] } = {};
  const builder: any = {
    not: (...args: [string, string, string]) => {
      calls.not = args;
      return builder;
    },
    lt: () => builder,
    eq: (...args: [string, string]) => {
      calls.eq = args;
      return builder;
    },
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { select: () => builder, calls };
}

describe('ReportingService.getSlaBreachDetail', () => {
  it('returns breaching referrals mapped through ReferralResponseDto', async () => {
    const row = {
      id: 'r1',
      pregnancy_episode_id: 'e1',
      from_facility_id: 'f0',
      to_facility_id: 'f1',
      reason_code: 'high_risk_pregnancy',
      urgency: 'urgent',
      status: 'Sent',
      created_at: '2020-01-01T00:00:00.000Z',
      accepted_at: null,
      departed_at: null,
      arrived_at: null,
      closed_at: null,
    };
    const referralTable = buildReferralRowsTable([row]);
    const supabaseService = {
      getClientForUser: () => ({ from: () => referralTable }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getSlaBreachDetail('jwt');

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe('r1');
    expect(result[0].pregnancyEpisodeId).toBe('e1');
    expect(result[0].status).toBe('Sent');
    expect(referralTable.calls.not).toEqual(['status', 'in', '(Completed,Failed,Cancelled)']);
  });

  it('scopes to facilityId when provided', async () => {
    const referralTable = buildReferralRowsTable([]);
    const supabaseService = {
      getClientForUser: () => ({ from: () => referralTable }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    await service.getSlaBreachDetail('jwt', 'f1');

    expect(referralTable.calls.eq).toEqual(['pregnancy_episode.facility_id', 'f1']);
  });
});
