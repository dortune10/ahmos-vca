import { Test, TestingModule } from '@nestjs/testing';
import { ReportingService } from './reporting.service';
import { SupabaseService } from '../common/supabase/supabase.service';

interface PregnancyEpisodeFixture {
  totalCount?: number;
  highRiskCount?: number;
  riskBandRows?: { risk_band: string | null }[];
}

// Mimics the real supabase-js chain closely enough for this service's purposes: `.select()`
// returns a thenable builder supporting `.eq()`; awaiting it (or letting Promise.all await
// it) resolves to `{ count, error }` for a count-style select or `{ data, error }` for a
// row-fetching one. Which canned response a given `.select('id', {...})` count call
// resolves to is disambiguated by whether `.eq('risk_band', 'high')` was chained onto it
// before it settles — exactly mirroring how countRegisteredPregnancies vs.
// countHighRiskCases differ in the real service.
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

function buildFakeClient(tables: {
  pregnancyEpisode: ReturnType<typeof buildPregnancyEpisodeTable>;
}) {
  return {
    from: (table: string) => {
      if (table === 'pregnancy_episode') {
        return tables.pregnancyEpisode;
      }
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

describe('ReportingService.getKpiSummary — episode-based aggregates', () => {
  it('counts registeredPregnancies with no facility filter', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 4 });
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
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
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt', 'f1');

    expect(result.registeredPregnancies).toBe(2);
    expect(pregnancyEpisode.eqCalls).toContainEqual(['facility_id', 'f1']);
  });

  it('counts highRiskCaseCount as episodes with risk_band = high only, independent of the total', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 10, highRiskCount: 3 });
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
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
        { risk_band: null }, // no risk assessment run yet — must not land in any bucket
      ],
    });
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.riskBandDistribution).toEqual({ low: 2, medium: 1, high: 1 });
  });

  it('returns the not-yet-implemented Task 2 fields at their documented neutral values', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({});
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.ancTaskCompletionRate).toBe(0);
    expect(result.referralSlaBreaches).toBe(0);
    expect(result.referralOutcomeBreakdown).toEqual({ completed: 0, failed: 0, cancelled: 0 });
  });
});
