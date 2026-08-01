# Supervisor Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the District Supervisor's `/supervisor` dashboard — a KPI summary,
risk-band distribution, and a referral SLA-breach cohort list — backed by a new read-only
`reporting` NestJS module that aggregates data Plans 1–4 already produce (facilities,
pregnancy episodes, care tasks, risk assessments, referrals) via SQL queries through
`@supabase/supabase-js`'s query builder, no new schema, per the design spec's Section 5 flow
5 guidance: "KPI dashboard computed from existing tables ... via SQL queries/views, no new
schema needed for MVP."

**Architecture:** This plan spans backend and frontend, the same shape as Plan 6 (Clinician)
and Plan 8 (Admin).

*Backend* — one new NestJS module, `reporting`, not an extension of any existing module.
This is deliberate: every prior backend module (`identity`, `facility`, `episode`, `tasks`,
`risk`, `referral`) is CRUD or a state machine over one entity; `reporting` is read-only
cross-entity aggregation spanning `pregnancy_episode`, `care_task`, and `referral` at once,
a genuinely different concern that doesn't belong bolted onto any one of them. It imports
two things from Plan 4's `referral` module — `ReferralResponseDto` and
`TERMINAL_REFERRAL_STATUSES` — as plain type/constant imports (no service injection, no
module-to-module dependency in Nest's DI graph) so this plan's referral-shaped output and
terminal-status list stay identical to Plan 4's own, rather than redefining them and risking
drift. Same no-ORM approach as every prior plan: `@supabase/supabase-js` clients scoped to
the caller's JWT via `SupabaseService.getClientForUser(jwt)`, RLS as the actual enforcement
mechanism (`docs/DECISIONS.md` #21) — see Global Constraints for how RLS scoping works
differently for these cross-facility aggregate queries than it does for Plans 1–4's
single-entity CRUD.

*Frontend* — two new pages under `frontend/app/(dashboards)/supervisor/`
(`page.tsx` the KPI dashboard, `referrals/page.tsx` the SLA-breach cohort view), inside the
`frontend/` Next.js app Plan 5 scaffolds. Every page follows the exact `apiFetch` +
Supabase-session pattern every other dashboard plan uses: client components calling
`apiFetch<T>()` against the NestJS backend, no direct `@supabase/supabase-js` calls from the
browser for anything beyond the session token `apiFetch` itself reads. No new frontend
infrastructure (no new `lib/` files, no new test config, no charting library) — new
route-segment pages, one new `NAV_LINKS_BY_ROLE` entry, and their tests.

This plan has two hard prerequisites and must not be started before both are done:

1. **Plan 1 (Backend Foundation)** — `SupabaseService`, `AuthGuard`, `RolesGuard`,
   `@CurrentUser()`, `app_user` and its RLS policies.
2. **Plan 5 (Frontend Foundation + CHW/Nurse Dashboard)** — the `(dashboards)` shell,
   `apiFetch`/`ApiError`, `AppUser`/`useCurrentUser`, the `Button`/`Input`/`Card`/`Table` UI
   primitives, and — see Global Constraints below — the `supervisor` entries Plan 5 already
   added to `ROLE_HOME_ROUTE` and `NAV_LINKS_BY_ROLE`.

It also reads (never writes) tables built by **Plan 2 (Episode & Task Management)** —
`pregnancy_episode`, `care_task` — and **Plan 4 (Referral Lifecycle)** — `referral`, plus
that plan's `ReferralResponseDto`/`TERMINAL_REFERRAL_STATUSES` — and the `risk_band` column
**Plan 3 (Risk Scoring)** populates on `pregnancy_episode`. None of those plans are modified
by this one.

**Tech Stack:** Backend: same as every prior plan — Node.js 20 LTS, NestJS 10.x,
TypeScript 5.x, `@supabase/supabase-js` v2, Jest + Supertest. Frontend: same as Plan 5/6/8 —
Next.js 14+ (App Router), TypeScript, React 18, Tailwind CSS, Jest + React Testing Library
via the `next/jest` preset Plan 5 configures.

## Global Constraints

**Backend (inherited from Plan 1 — see `docs/superpowers/plans/2026-08-01-backend-foundation.md`):**
- Backend lives in `backend/` at the repo root; Supabase config/migrations live in
  `supabase/` at the repo root.
- API base path: `/api/v1`. Every response header includes `X-Correlation-Id`. Error
  responses use the exact shape
  `{ "error": { "code": "STRING_CODE", "message": "...", "details": [], "correlationId": "uuid" } }`.
- No ORM. All Postgres access goes through `@supabase/supabase-js`, implemented as real SQL
  via the query builder (`.select('...', { count: 'exact' })`, `.eq()`, `.not()`, `.lt()`,
  etc.) — RLS policies are the authorization mechanism. `ReportingService` uses
  `getClientForUser(jwt)` exclusively, never `getServiceClient()` — these are
  supervisor-initiated reads RLS should scope, not system-triggered writes.
- **This plan adds exactly one new backend module, `reporting`, with exactly two endpoints**
  (`GET /api/v1/reports/kpi-summary`, `GET /api/v1/reports/sla-breaches`) **and zero new
  migrations.** Every table this plan reads (`pregnancy_episode`, `care_task`, `referral`,
  and `facility` transitively through the joins those two tables already use) and every RLS
  policy governing them already exists from Plans 1, 2, and 4 — this is a pure read layer
  over what's already there, exactly the design spec's "no new schema needed for MVP" line.

**RLS scoping for cross-facility aggregates — read before writing any query in this
plan.** Plans 1/2/4's services scope every read/write through `getClientForUser(jwt)` and
let RLS enforce isolation as the actual security boundary — no module re-implements that
filtering in application code, and this plan doesn't either. But the *shape* of what RLS
allows differs here from single-entity CRUD: a supervisor's job is to see their whole
district, not one facility, and Plan 1/2/4's RLS policies are tenant-scoped only (no
facility-level restriction exists yet — both plans call this out as deferred hardening, and
this plan inherits that same limitation unchanged). That means a supervisor's JWT-scoped
client, called with **no** `facilityId` query param at all, already returns an aggregate
over every row RLS lets that supervisor's tenant membership see — the whole tenant, by
construction, with zero extra code. The `facilityId` param `ReportingService`'s two public
methods accept is **not** an additional security boundary layered on top of RLS — it is a
display filter letting the supervisor narrow *which subset of their own already-RLS-permitted
data* to look at (e.g. one facility in their district instead of all of them). If
facility-level RLS is ever added, this distinction stops mattering because RLS itself would
enforce it directly; until then, don't mistake this parameter for a security control, and
don't add any manual tenant-id filtering "just in case" — that would just be redundant with,
and could silently drift from, what RLS already guarantees.

**ANC coverage proxy, not the PRD's literal metric.** The design spec's Section 5 flow 5
lists "ANC coverage (1st/4th/8th as configured)" as a KPI. Nothing in the data model Plan 2
built tracks which numbered ANC visit a given `care_task` row represents —
`care_task.task_type` only distinguishes `anc_visit`/`pnc_visit`/`newborn_check`, with no
visit-sequence field anywhere. `ancTaskCompletionRate` is therefore an overall
`anc_visit`-task completion-rate proxy (completed ÷ total), **not** the PRD's per-milestone
coverage figure. This is a known, deliberate MVP simplification, documented here, again
inline in the service code (Task 2), and surfaced in the frontend's own copy (Task 4) so a
supervisor reading the dashboard doesn't mistake it for the exact PRD metric. Building the
real metric would need a visit-sequence-number field added to `care_task` or
`encounter_note` — a schema change explicitly out of scope for a plan whose whole premise is
"no new schema needed."

**Referral SLA breach threshold: 24 hours, a placeholder default, not a validated target.**
`REFERRAL_SLA_BREACH_HOURS = 24` (defined once, in `reporting.service.ts`) flags any
referral that has been open — not yet in a terminal state (`Completed`/`Failed`/`Cancelled`,
reusing Plan 4's own `TERMINAL_REFERRAL_STATUSES` rather than redefining that list) — for
more than a full day since `created_at`. This is a single flat threshold applied to every
referral regardless of `urgency`; a real SLA policy would likely set a shorter threshold for
`urgent` referrals and a longer one for `routine`, but no stakeholder-provided target exists
yet for either (`docs/DECISIONS.md`'s "Still Open" section notes the identical gap for the
risk rules engine's own thresholds). 24 hours is a reasonable, defensible default for a
first cut — not a clinically validated figure — exported as a single named constant
specifically so it is a one-line change once real targets are set, not a magic number
scattered across multiple queries.

**Aggregation technique: count queries where cleanly expressible, fetch-and-reduce where a
real group-by isn't.** `@supabase/supabase-js`'s fluent query builder supports
`.select(columns, { count: 'exact', head: true })` for a true count-only query — used for
`registeredPregnancies`, `highRiskCaseCount`, the two `care_task` counts behind
`ancTaskCompletionRate`, `referralSlaBreaches`, and the three per-status counts behind
`referralOutcomeBreakdown` (six independent, cleanly-expressible count queries, each a real
`SELECT count(*) ... WHERE ...`). It has no `.groupBy()`/aggregate-count-by-column method,
so `riskBandDistribution` (a `risk_band, count(*) group by risk_band`-shaped question)
genuinely cannot be expressed that way. `computeRiskBandDistribution()` (Task 1) instead
fetches just the `risk_band` column for every episode in scope and tallies it in the service
method itself — a real, deliberate MVP trade-off, documented again inline in the code, safe
because a single tenant/district's episode volume is expected to stay small (low thousands
at most) for the foreseeable MVP lifetime. Revisit with a Postgres view or three separate
`.eq('risk_band', X)` count queries if that assumption stops holding.

**Frontend (fixed contract shared with Plan 5/6/8 — do not deviate):**
- Location: `frontend/` at repo root. Next.js 14+ (App Router), TypeScript, React 18,
  Tailwind CSS, no component library beyond `frontend/components/ui/` (`Button`, `Input`,
  `Card`, `Table`).
- `frontend/lib/api-client.ts` exports
  `async function apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>`
  and `class ApiError extends Error { code; message; details; correlationId }`. Every page
  in this plan imports both from `@/lib/api-client` and mocks that module in tests exactly
  as: `jest.mock('@/lib/api-client', () => ({ apiFetch: jest.fn(), ApiError: class ApiError extends Error { code = 'ERROR'; details: unknown[] = []; correlationId = 'test-correlation-id'; } }))`
  — never mocks `fetch` or Supabase directly.
- `Table` is a thin wrapper around a native `<table>` — author `<thead>`/`<tbody>` directly
  as children, no data-driven `columns`/`rows` API. `Card` takes `{ children, className? }`.
- Jest + React Testing Library via the `next/jest` preset Plan 5 configures. Test files are
  colocated `*.test.tsx`, run via `cd frontend && npm test -- <path>`.

**Frontend routing note — no `layout.tsx` change needed in this plan.** Plan 5 already added
`supervisor: '/supervisor'` to `ROLE_HOME_ROUTE` (`frontend/app/(dashboards)/layout.tsx`)
and a `supervisor` entry — `[{ href: '/supervisor', label: 'KPIs' }]` — to `Nav`'s
`NAV_LINKS_BY_ROLE` (`frontend/components/nav.tsx`), pre-emptively alongside `clinician`'s
entry, even though Plan 5 itself only builds `/frontline` (see Plan 5's own routing task and
its "Handoff to Plan 6, 7, 8" section: `"currently { chw: '/frontline', nurse: '/frontline', clinician: '/clinician', supervisor: '/supervisor' }, no admin key"`).
Unlike Plan 8's Task 1, which genuinely had to add a missing `admin` key to both maps, this
plan does **not** touch `layout.tsx` at all — the redirect-after-login wiring for
`supervisor` already works, and `frontend/app/(dashboards)/supervisor/...` was explicitly
called out in Plan 5 as "Plan 7, not built here." The only shared-shell file this plan edits
is `nav.tsx`, to add one more link for the new SLA-breach page (Task 6).

**Why this plan's e2e test scopes everything to a freshly created facility, not a shared
fixed tenant id.** Every prior plan's e2e specs run directly against the shared hosted
`amhos` project (`docs/DECISIONS.md` #23) using a couple of fixed tenant UUIDs
(`11111111-...`, `22222222-...`) reused across many test files and many runs — safe for
those tests because they only assert set membership (a row is or isn't visible under RLS),
which tolerates however much unrelated leftover data already exists in that tenant. This
plan's e2e test (Task 3) asserts **exact** aggregate counts, which that pattern would break
silently (a stray leftover episode from an earlier test run would inflate
`registeredPregnancies` with no error, just a wrong number). Task 3's e2e spec instead
creates one facility under a freshly generated tenant id (`crypto.randomUUID()`) in its own
`beforeAll` and scopes every KPI/SLA-breach query in the test to that facility's id via the
`facilityId` query param — so its counts are exact and immune to whatever else exists
elsewhere in the shared project, without needing a dedicated test database or any schema
change.

---

### Task 1: `reporting` module scaffold — `getKpiSummary()` episode-based aggregates

**Files:**
- Create: `backend/src/reporting/reporting.module.ts`
- Create: `backend/src/reporting/reporting.service.ts`
- Create: `backend/src/reporting/dto/kpi-summary.dto.ts`
- Create: `backend/src/reporting/reporting.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser` (Plan 1); `pregnancy_episode` table (Plan 2),
  specifically its `facility_id` and `risk_band` columns.
- Produces: `ReportingService.getKpiSummary(jwt: string, facilityId?: string): Promise<KpiSummaryDto>`
  — this task implements the three episode-based fields
  (`registeredPregnancies`, `highRiskCaseCount`, `riskBandDistribution`); the other three
  fields (`ancTaskCompletionRate`, `referralSlaBreaches`, `referralOutcomeBreakdown`) are
  present on the returned object at a neutral value, implemented for real in Task 2 — see
  the step-3 code comments for exactly why, matching the same incremental-method-build
  approach Plan 2's Task 5 (`EpisodeService`) used.

- [ ] **Step 1: Write the DTO**

Create `backend/src/reporting/dto/kpi-summary.dto.ts`:
```typescript
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
```

- [ ] **Step 2: Write the failing test**

Create `backend/src/reporting/reporting.service.spec.ts`:
```typescript
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
    expect(pregnancyEpisode.eqCalls).toEqual([]);
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
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: FAIL — cannot find module `./reporting.service`

- [ ] **Step 4: Implement `ReportingService` (episode-based fields for real, others stubbed)**

Create `backend/src/reporting/reporting.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseClient } from '@supabase/supabase-js';
import { SupabaseService } from '../common/supabase/supabase.service';
import {
  KpiSummaryDto,
  ReferralOutcomeBreakdownDto,
  RiskBandDistributionDto,
} from './dto/kpi-summary.dto';

@Injectable()
export class ReportingService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async getKpiSummary(jwt: string, facilityId?: string): Promise<KpiSummaryDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const [
      registeredPregnancies,
      highRiskCaseCount,
      riskBandDistribution,
      ancTaskCompletionRate,
      referralSlaBreaches,
      referralOutcomeBreakdown,
    ] = await Promise.all([
      this.countRegisteredPregnancies(client, facilityId),
      this.countHighRiskCases(client, facilityId),
      this.computeRiskBandDistribution(client, facilityId),
      this.computeAncTaskCompletionRate(client, facilityId),
      this.countReferralSlaBreaches(client, facilityId),
      this.computeReferralOutcomeBreakdown(client, facilityId),
    ]);

    const dto = new KpiSummaryDto();
    dto.registeredPregnancies = registeredPregnancies;
    dto.highRiskCaseCount = highRiskCaseCount;
    dto.riskBandDistribution = riskBandDistribution;
    dto.ancTaskCompletionRate = ancTaskCompletionRate;
    dto.referralSlaBreaches = referralSlaBreaches;
    dto.referralOutcomeBreakdown = referralOutcomeBreakdown;
    return dto;
  }

  private async countRows(
    client: SupabaseClient,
    table: string,
    selectColumns: string,
    applyFilters: (query: any) => any,
  ): Promise<number> {
    const base = client.from(table).select(selectColumns, { count: 'exact', head: true });
    const { count, error } = await applyFilters(base);
    if (error) {
      throw error;
    }
    return count ?? 0;
  }

  private countRegisteredPregnancies(client: SupabaseClient, facilityId?: string): Promise<number> {
    return this.countRows(client, 'pregnancy_episode', 'id', (query) =>
      facilityId ? query.eq('facility_id', facilityId) : query,
    );
  }

  private countHighRiskCases(client: SupabaseClient, facilityId?: string): Promise<number> {
    return this.countRows(client, 'pregnancy_episode', 'id', (query) => {
      let scoped = query.eq('risk_band', 'high');
      if (facilityId) {
        scoped = scoped.eq('facility_id', facilityId);
      }
      return scoped;
    });
  }

  private async computeRiskBandDistribution(
    client: SupabaseClient,
    facilityId?: string,
  ): Promise<RiskBandDistributionDto> {
    // See this plan's Global Constraints ("Aggregation technique") for why this fetches
    // rows and tallies in-process rather than issuing a group-by count: supabase-js's
    // query builder has no groupBy() equivalent.
    let query = client.from('pregnancy_episode').select('risk_band');
    if (facilityId) {
      query = query.eq('facility_id', facilityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }

    const distribution: RiskBandDistributionDto = { low: 0, medium: 0, high: 0 };
    for (const row of (data ?? []) as { risk_band: string | null }[]) {
      if (row.risk_band === 'low' || row.risk_band === 'medium' || row.risk_band === 'high') {
        distribution[row.risk_band] += 1;
      }
      // Episodes with risk_band === null (no risk assessment has run yet) are excluded
      // from all three buckets on purpose — the DTO has no "unknown" bucket, and silently
      // lumping them into one of the three bands would misrepresent the distribution.
    }
    return distribution;
  }

  // Implemented for real in Task 2 of this plan (needs care_task fixtures this task's
  // tests don't set up) — returns a neutral 0 for now so getKpiSummary() is already fully
  // callable and its DTO shape is complete from this task onward.
  private async computeAncTaskCompletionRate(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<number> {
    return 0;
  }

  // Implemented for real in Task 2.
  private async countReferralSlaBreaches(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<number> {
    return 0;
  }

  // Implemented for real in Task 2.
  private async computeReferralOutcomeBreakdown(
    _client: SupabaseClient,
    _facilityId?: string,
  ): Promise<ReferralOutcomeBreakdownDto> {
    return { completed: 0, failed: 0, cancelled: 0 };
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Wire the module**

Create `backend/src/reporting/reporting.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReportingService } from './reporting.service';

@Module({
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
```

No controller yet — Task 3 adds `ReportingController` once both service methods exist. Do
not add `ReportingModule` to `app.module.ts` yet either; Task 3 does that alongside the
controller so there's never a module with no routes sitting half-wired into the app.

- [ ] **Step 7: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/reporting/
git commit -m "feat: add reporting module with episode-based KPI aggregates"
```

---

### Task 2: `getKpiSummary()` — task and referral-based aggregates

**Files:**
- Modify: `backend/src/reporting/reporting.service.ts`
- Modify: `backend/src/reporting/reporting.service.spec.ts`

**Interfaces:**
- Consumes: `care_task` table (Plan 2) — `task_type`, `status`, and its
  `pregnancy_episode_id` join to `pregnancy_episode.facility_id`; `referral` table (Plan 4)
  — `status`, `created_at`, and its `pregnancy_episode_id` join to the same; Plan 4's
  `TERMINAL_REFERRAL_STATUSES` (`backend/src/referral/referral-state-machine.ts`).
- Produces: `getKpiSummary()`'s three remaining fields implemented for real —
  `ancTaskCompletionRate`, `referralSlaBreaches`, `referralOutcomeBreakdown` — plus the
  exported `REFERRAL_SLA_BREACH_HOURS` constant (see Global Constraints for the 24-hour
  rationale).

- [ ] **Step 1: Replace the failing/updated test file**

The `buildFakeClient` helper from Task 1 needs to grow to cover two more tables
(`care_task`, `referral`), which changes its call signature — every existing test in the
file needs that one-line update too. Replace
`backend/src/reporting/reporting.service.spec.ts` in full with:
```typescript
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

const NEUTRAL_PREGNANCY_EPISODE = buildPregnancyEpisodeTable({});

describe('ReportingService.getKpiSummary — episode-based aggregates', () => {
  it('counts registeredPregnancies with no facility filter', async () => {
    const pregnancyEpisode = buildPregnancyEpisodeTable({ totalCount: 4 });
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.registeredPregnancies).toBe(4);
    expect(pregnancyEpisode.eqCalls).toEqual([]);
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
        { risk_band: null },
      ],
    });
    const supabaseService = {
      getClientForUser: () => buildFakeClient({ pregnancyEpisode }),
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
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.ancTaskCompletionRate).toBe(0.75);
  });

  it('returns 0 rather than dividing by zero when there are no anc_visit tasks', async () => {
    const careTask = buildCareTaskTable({ totalCount: 0, completedCount: 0 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.ancTaskCompletionRate).toBe(0);
  });

  it('scopes both the total and completed counts to facilityId via the pregnancy_episode join', async () => {
    const careTask = buildCareTaskTable({ totalCount: 1, completedCount: 1 });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, careTask }),
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
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral }),
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
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    const result = await service.getKpiSummary('jwt');

    expect(result.referralOutcomeBreakdown).toEqual({ completed: 5, failed: 2, cancelled: 1 });
  });

  it('scopes referral aggregates to facilityId via the pregnancy_episode join', async () => {
    const referral = buildReferralTable({ slaBreachCount: 1, statusCounts: { Completed: 1 } });
    const supabaseService = {
      getClientForUser: () =>
        buildFakeClient({ pregnancyEpisode: NEUTRAL_PREGNANCY_EPISODE, referral }),
    } as unknown as SupabaseService;

    const service = await buildService(supabaseService);
    await service.getKpiSummary('jwt', 'f1');

    expect(referral.eqCalls).toContainEqual(['pregnancy_episode.facility_id', 'f1']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: FAIL — the three new `describe` blocks' assertions fail against the Task 1 stub
values (`ancTaskCompletionRate` stays `0` regardless of the `careTask` fixture,
`referralSlaBreaches`/`referralOutcomeBreakdown` stay at their stub neutrals too), and the
`care_task`/`referral` fixtures are now present but unused by the stub methods — confirming
these tests are exercising real gaps, not typos.

- [ ] **Step 3: Implement the three remaining aggregates**

Edit `backend/src/reporting/reporting.service.ts`. Add these imports at the top:
```typescript
import { TERMINAL_REFERRAL_STATUSES } from '../referral/referral-state-machine';
import { ReferralOutcomeBreakdownDto } from './dto/kpi-summary.dto'; // already imported — no change if already present
```

Add this exported constant above the `@Injectable()` class (see Global Constraints for the
24-hour rationale):
```typescript
// Placeholder SLA threshold for "referral open too long" — a single flat default applied
// regardless of urgency, pending real targets from clinical/operations stakeholders. See
// this plan's Global Constraints for the full rationale. Exported as a named constant
// specifically so it's a one-line change once real targets exist.
export const REFERRAL_SLA_BREACH_HOURS = 24;

const OUTCOME_FIELD_BY_STATUS: Record<string, keyof ReferralOutcomeBreakdownDto> = {
  Completed: 'completed',
  Failed: 'failed',
  Cancelled: 'cancelled',
};
```

Replace the three stub methods (`computeAncTaskCompletionRate`, `countReferralSlaBreaches`,
`computeReferralOutcomeBreakdown`) with:
```typescript
  private slaBreachCutoffIso(): string {
    return new Date(Date.now() - REFERRAL_SLA_BREACH_HOURS * 60 * 60 * 1000).toISOString();
  }

  private async computeAncTaskCompletionRate(client: SupabaseClient, facilityId?: string): Promise<number> {
    // Known MVP simplification — see this plan's Global Constraints ("ANC coverage proxy,
    // not the PRD's literal metric"). This is completed anc_visit tasks / all anc_visit
    // tasks, not the PRD's 1st/4th/8th-visit coverage figure.
    const totalFilter = (query: any) => {
      let scoped = query.eq('task_type', 'anc_visit');
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    };
    const completedFilter = (query: any) => {
      let scoped = query.eq('task_type', 'anc_visit').eq('status', 'Completed');
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    };

    const [total, completed] = await Promise.all([
      this.countRows(client, 'care_task', 'id, pregnancy_episode!inner(facility_id)', totalFilter),
      this.countRows(client, 'care_task', 'id, pregnancy_episode!inner(facility_id)', completedFilter),
    ]);

    return total > 0 ? completed / total : 0;
  }

  private countReferralSlaBreaches(client: SupabaseClient, facilityId?: string): Promise<number> {
    const cutoffIso = this.slaBreachCutoffIso();
    return this.countRows(client, 'referral', 'id, pregnancy_episode!inner(facility_id)', (query) => {
      let scoped = query
        .not('status', 'in', `(${TERMINAL_REFERRAL_STATUSES.join(',')})`)
        .lt('created_at', cutoffIso);
      if (facilityId) {
        scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
      }
      return scoped;
    });
  }

  private async computeReferralOutcomeBreakdown(
    client: SupabaseClient,
    facilityId?: string,
  ): Promise<ReferralOutcomeBreakdownDto> {
    const breakdown: ReferralOutcomeBreakdownDto = { completed: 0, failed: 0, cancelled: 0 };

    await Promise.all(
      TERMINAL_REFERRAL_STATUSES.map(async (status) => {
        const count = await this.countRows(
          client,
          'referral',
          'id, pregnancy_episode!inner(facility_id)',
          (query) => {
            let scoped = query.eq('status', status);
            if (facilityId) {
              scoped = scoped.eq('pregnancy_episode.facility_id', facilityId);
            }
            return scoped;
          },
        );
        breakdown[OUTCOME_FIELD_BY_STATUS[status]] = count;
      }),
    );

    return breakdown;
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: PASS (all four `describe` blocks)

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/reporting/
git commit -m "feat: implement anc task completion rate and referral SLA/outcome aggregates"
```

---

### Task 3: `getSlaBreachDetail()` + `ReportingController` + real-Postgres integration test

**Files:**
- Modify: `backend/src/reporting/reporting.service.ts`
- Modify: `backend/src/reporting/reporting.service.spec.ts`
- Create: `backend/src/reporting/reporting.controller.ts`
- Modify: `backend/src/reporting/reporting.module.ts`
- Modify: `backend/src/app.module.ts`
- Create: `backend/test/reporting.e2e-spec.ts`

**Interfaces:**
- Consumes: Plan 4's `ReferralResponseDto` (`backend/src/referral/dto/referral-response.dto.ts`);
  `AuthGuard`, `RolesGuard`, `@Roles`, `@CurrentUser` (Plan 1).
- Produces:
  - `ReportingService.getSlaBreachDetail(jwt: string, facilityId?: string): Promise<ReferralResponseDto[]>`
    — the full list backing the SLA-breach alert requirement, using the exact same
    breach criteria (`TERMINAL_REFERRAL_STATUSES` exclusion + `REFERRAL_SLA_BREACH_HOURS`
    cutoff) as `getKpiSummary()`'s `referralSlaBreaches` count, so the count on the KPI page
    and the list on the SLA-breach page are always consistent with each other by
    construction (same threshold constant, same exclusion list) — not two independently
    maintained definitions of "breach" that could silently drift apart.
  - `GET /api/v1/reports/kpi-summary?facilityId=<id>` and
    `GET /api/v1/reports/sla-breaches?facilityId=<id>`, both `@UseGuards(AuthGuard, RolesGuard)`,
    `@Roles('supervisor', 'admin')`.

- [ ] **Step 1: Append the failing service test**

Append this `describe` block to the end of `backend/src/reporting/reporting.service.spec.ts`
(the `buildFakeClient`/`buildService` helpers already in the file are reused as-is; this
step only adds a small new table-fixture helper and the new tests):
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: FAIL — `service.getSlaBreachDetail is not a function`

- [ ] **Step 3: Implement `getSlaBreachDetail`**

Edit `backend/src/reporting/reporting.service.ts`. Add this import:
```typescript
import { ReferralResponseDto } from '../referral/dto/referral-response.dto';
```

Add this public method (placed after `getKpiSummary`):
```typescript
  async getSlaBreachDetail(jwt: string, facilityId?: string): Promise<ReferralResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const cutoffIso = this.slaBreachCutoffIso();

    let query = client
      .from('referral')
      .select('*, pregnancy_episode!inner(facility_id)')
      .not('status', 'in', `(${TERMINAL_REFERRAL_STATUSES.join(',')})`)
      .lt('created_at', cutoffIso);
    if (facilityId) {
      query = query.eq('pregnancy_episode.facility_id', facilityId);
    }

    const { data, error } = await query.order('created_at', { ascending: true });
    if (error) {
      throw error;
    }
    // The embedded `pregnancy_episode` object the join above adds to each row is extra
    // data ReferralResponseDto.fromRow simply ignores — it only reads the referral table's
    // own named columns (Plan 4's fromRow implementation), so no conflict.
    return (data ?? []).map(ReferralResponseDto.fromRow);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- reporting.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller**

Create `backend/src/reporting/reporting.controller.ts`:
```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { ReportingService } from './reporting.service';

@Controller('reports')
@UseGuards(AuthGuard, RolesGuard)
@Roles('supervisor', 'admin')
export class ReportingController {
  constructor(private readonly reportingService: ReportingService) {}

  @Get('kpi-summary')
  getKpiSummary(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.reportingService.getKpiSummary(user.jwt, facilityId);
  }

  @Get('sla-breaches')
  getSlaBreaches(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.reportingService.getSlaBreachDetail(user.jwt, facilityId);
  }
}
```

- [ ] **Step 6: Wire the controller into the module and the module into the app**

Edit `backend/src/reporting/reporting.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReportingController } from './reporting.controller';
import { ReportingService } from './reporting.service';

@Module({
  controllers: [ReportingController],
  providers: [ReportingService],
  exports: [ReportingService],
})
export class ReportingModule {}
```

Add `ReportingModule` (imported from `./reporting/reporting.module`) to the `imports` array
in `backend/src/app.module.ts`, alongside the other feature modules.

- [ ] **Step 7: Write the failing integration test with real seeded data**

Create `backend/test/reporting.e2e-spec.ts`. Read this plan's Global Constraints note "Why
this plan's e2e test scopes everything to a freshly created facility" before touching this
file — every assertion below relies on that isolation strategy to be exact.
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import * as jwt from 'jsonwebtoken';
import { randomUUID } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { AppModule } from '../src/app.module';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;

function tokenFor(userId: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('ReportingController (e2e)', () => {
  let app: INestApplication;
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);

  const tenantId = randomUUID();
  let facilityId: string;
  let supervisorToken: string;
  let chwToken: string;
  let breachingReferralId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const { data: facility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Reporting Test Clinic', type: 'clinic' })
      .select()
      .single();
    facilityId = facility!.id;

    const { data: supervisorAuth } = await admin.auth.admin.createUser({
      email: `supervisor-reporting-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    supervisorToken = tokenFor(supervisorAuth.user!.id);
    await admin.from('app_user').insert({
      id: supervisorAuth.user!.id,
      tenant_id: tenantId,
      email: supervisorAuth.user!.email,
      role: 'supervisor',
      facility_id: null,
      full_name: 'Test Supervisor',
    });

    const { data: chwAuth } = await admin.auth.admin.createUser({
      email: `chw-reporting-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    chwToken = tokenFor(chwAuth.user!.id);
    await admin.from('app_user').insert({
      id: chwAuth.user!.id,
      tenant_id: tenantId,
      email: chwAuth.user!.email,
      role: 'chw',
      facility_id: facilityId,
      full_name: 'Test CHW',
    });

    const { data: person } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Reporting', phone_primary: `+254700${Date.now()}` })
      .select()
      .single();

    // 5 episodes at this facility: 2 low, 1 medium, 1 high, 1 not-yet-assessed (null) —
    // registeredPregnancies=5, highRiskCaseCount=1, riskBandDistribution excludes the null.
    const riskBands: (string | null)[] = ['low', 'low', 'medium', 'high', null];
    const episodeIds: string[] = [];
    for (const riskBand of riskBands) {
      const { data: episode } = await admin
        .from('pregnancy_episode')
        .insert({ person_id: person!.id, facility_id: facilityId, status: 'Active', risk_band: riskBand })
        .select()
        .single();
      episodeIds.push(episode!.id);
    }

    // 4 anc_visit care_task rows against the first 4 episodes, 3 completed => rate = 0.75.
    const taskCompletionFlags = [true, true, true, false];
    for (let i = 0; i < taskCompletionFlags.length; i++) {
      await admin.from('care_task').insert({
        pregnancy_episode_id: episodeIds[i],
        task_type: 'anc_visit',
        due_at: new Date().toISOString(),
        status: taskCompletionFlags[i] ? 'Completed' : 'Scheduled',
        completed_at: taskCompletionFlags[i] ? new Date().toISOString() : null,
      });
    }
    // A completed pnc_visit task must NOT count toward the anc_visit rate — proves the
    // task_type filter is applied, not just "any completed task."
    await admin.from('care_task').insert({
      pregnancy_episode_id: episodeIds[0],
      task_type: 'pnc_visit',
      due_at: new Date().toISOString(),
      status: 'Completed',
      completed_at: new Date().toISOString(),
    });

    // Referrals: one open referral created 48h ago (a breach — proves the time threshold
    // is applied), one open referral created just now (not a breach — proves "open" alone
    // isn't sufficient), and one of each terminal status.
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: breachingReferral } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeIds[0],
        to_facility_id: facilityId,
        reason_code: 'high_risk_pregnancy',
        urgency: 'urgent',
        status: 'Sent',
        created_at: fortyEightHoursAgo,
      })
      .select()
      .single();
    breachingReferralId = breachingReferral!.id;

    await admin.from('referral').insert({
      pregnancy_episode_id: episodeIds[1],
      to_facility_id: facilityId,
      reason_code: 'routine_check',
      urgency: 'routine',
      status: 'Created',
    });

    for (const status of ['Completed', 'Failed', 'Cancelled']) {
      await admin.from('referral').insert({
        pregnancy_episode_id: episodeIds[2],
        to_facility_id: facilityId,
        reason_code: 'routine_check',
        urgency: 'routine',
        status,
        closed_at: new Date().toISOString(),
      });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/reports/kpi-summary').expect(401);
  });

  it('rejects a chw calling the reports endpoints (supervisor/admin only)', () => {
    return request(app.getHttpServer())
      .get(`/api/v1/reports/kpi-summary?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${chwToken}`)
      .expect(403);
  });

  it('returns exact KPI aggregate counts scoped to the seeded facility', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/kpi-summary?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(response.body).toEqual({
      registeredPregnancies: 5,
      highRiskCaseCount: 1,
      riskBandDistribution: { low: 2, medium: 1, high: 1 },
      ancTaskCompletionRate: 0.75,
      referralSlaBreaches: 1,
      referralOutcomeBreakdown: { completed: 1, failed: 1, cancelled: 1 },
    });
  });

  it('returns only the breaching referral in the SLA-breach detail list', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/v1/reports/sla-breaches?facilityId=${facilityId}`)
      .set('Authorization', `Bearer ${supervisorToken}`)
      .expect(200);

    expect(response.body).toHaveLength(1);
    expect(response.body[0].id).toBe(breachingReferralId);
    expect(response.body[0].status).toBe('Sent');
  });
});
```

- [ ] **Step 8: Run the e2e test to verify it fails, then passes**

Run: `cd backend && npm run test:e2e -- reporting.e2e-spec.ts`
Expected: first run FAILS if `ReportingModule` wasn't wired into `app.module.ts` yet (404 on
every route) or if any aggregate math above is off by one — if it fails on a count
assertion, that is exactly the class of bug this test exists to catch (see this plan's
Global Constraints); fix the service, not the test's expected numbers, unless you find the
test's own seeded data or arithmetic is wrong. Once `app.module.ts` is wired (Step 6) and
the service is correct, re-run:
```bash
cd backend && npm run test:e2e -- reporting.e2e-spec.ts
```
Expected: PASS

- [ ] **Step 9: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/reporting/ backend/src/app.module.ts backend/test/reporting.e2e-spec.ts
git commit -m "feat: add reporting controller with kpi-summary and sla-breaches endpoints"
```

---

### Task 4: Frontend — KPI dashboard page (`supervisor/page.tsx`)

**Files:**
- Create: `frontend/app/(dashboards)/supervisor/page.tsx`
- Create: `frontend/app/(dashboards)/supervisor/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<KpiSummary>('/reports/kpi-summary')`, `Card` (Plan 5).
- Produces: the `/supervisor` route's landing page — six stat cards plus a risk-band bar
  display, no facility picker in this MVP pass (see Task 3's Global-Constraints-adjacent
  note above: `facilityId` support exists in the API for a future UI enhancement; the
  default view here is the supervisor's whole tenant, matching "district" scope).

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(dashboards)/supervisor/page.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import SupervisorPage from './page';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('SupervisorPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders the KPI summary', async () => {
    mockedApiFetch.mockResolvedValue({
      registeredPregnancies: 12,
      ancTaskCompletionRate: 0.75,
      highRiskCaseCount: 9,
      riskBandDistribution: { low: 5, medium: 3, high: 1 },
      referralSlaBreaches: 6,
      referralOutcomeBreakdown: { completed: 8, failed: 2, cancelled: 4 },
    });

    render(<SupervisorPage />);

    expect(screen.getByText('Loading KPI summary...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('12')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/reports/kpi-summary');
    expect(screen.getByText('75%')).toBeInTheDocument();
    expect(screen.getByText('9')).toBeInTheDocument();
    expect(screen.getByText('6')).toBeInTheDocument();
    expect(screen.getByText(/^5 \(/)).toBeInTheDocument();
    expect(screen.getByText('8')).toBeInTheDocument();
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<SupervisorPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/supervisor/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the KPI dashboard page**

Create `frontend/app/(dashboards)/supervisor/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';

interface RiskBandDistribution {
  low: number;
  medium: number;
  high: number;
}

interface ReferralOutcomeBreakdown {
  completed: number;
  failed: number;
  cancelled: number;
}

interface KpiSummary {
  registeredPregnancies: number;
  ancTaskCompletionRate: number;
  highRiskCaseCount: number;
  riskBandDistribution: RiskBandDistribution;
  referralSlaBreaches: number;
  referralOutcomeBreakdown: ReferralOutcomeBreakdown;
}

const RISK_BAND_COLOR: Record<keyof RiskBandDistribution, string> = {
  low: 'bg-green-500',
  medium: 'bg-amber-500',
  high: 'bg-red-500',
};

function RiskBandBar({
  label,
  count,
  total,
  colorClassName,
}: {
  label: string;
  count: number;
  total: number;
  colorClassName: string;
}) {
  const pct = total > 0 ? Math.round((count / total) * 100) : 0;
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="font-medium capitalize">{label}</span>
        <span>
          {count} ({pct}%)
        </span>
      </div>
      <div className="h-2 w-full rounded bg-gray-200">
        <div className={`h-2 rounded ${colorClassName}`} style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export default function SupervisorPage() {
  const [summary, setSummary] = useState<KpiSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<KpiSummary>('/reports/kpi-summary')
      .then((data) => {
        if (!cancelled) setSummary(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load KPI summary.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  if (loading) {
    return <p>Loading KPI summary...</p>;
  }

  if (error || !summary) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'No KPI data available.'}
      </p>
    );
  }

  const riskTotal =
    summary.riskBandDistribution.low + summary.riskBandDistribution.medium + summary.riskBandDistribution.high;

  return (
    <div className="space-y-6">
      <h1 className="text-xl font-semibold">Supervisor KPI Dashboard</h1>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <p className="text-sm text-gray-500">Registered Pregnancies</p>
          <p className="text-2xl font-semibold">{summary.registeredPregnancies}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">ANC Task Completion</p>
          <p className="text-2xl font-semibold">{Math.round(summary.ancTaskCompletionRate * 100)}%</p>
          <p className="text-xs text-gray-400">
            Overall anc_visit task completion rate — a coverage proxy, not a 1st/4th/8th
            visit metric.
          </p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">High-Risk Cases</p>
          <p className="text-2xl font-semibold">{summary.highRiskCaseCount}</p>
        </Card>
        <Card>
          <p className="text-sm text-gray-500">Referral SLA Breaches</p>
          <p className="text-2xl font-semibold">{summary.referralSlaBreaches}</p>
          <p className="text-xs text-gray-400">Open more than 24 hours since creation.</p>
        </Card>
      </div>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Risk Band Distribution</h2>
        <div className="space-y-3">
          <RiskBandBar
            label="low"
            count={summary.riskBandDistribution.low}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.low}
          />
          <RiskBandBar
            label="medium"
            count={summary.riskBandDistribution.medium}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.medium}
          />
          <RiskBandBar
            label="high"
            count={summary.riskBandDistribution.high}
            total={riskTotal}
            colorClassName={RISK_BAND_COLOR.high}
          />
        </div>
      </Card>

      <Card>
        <h2 className="mb-3 text-sm font-semibold text-gray-700">Referral Outcomes</h2>
        <div className="grid grid-cols-3 gap-4 text-center">
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.completed}</p>
            <p className="text-xs text-gray-500">Completed</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.failed}</p>
            <p className="text-xs text-gray-500">Failed</p>
          </div>
          <div>
            <p className="text-lg font-semibold">{summary.referralOutcomeBreakdown.cancelled}</p>
            <p className="text-xs text-gray-500">Cancelled</p>
          </div>
        </div>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/supervisor/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/supervisor/page.tsx frontend/app/\(dashboards\)/supervisor/page.test.tsx
git commit -m "feat: add supervisor KPI dashboard page"
```

---

### Task 5: Frontend — SLA-breach cohort page (`supervisor/referrals/page.tsx`)

**Files:**
- Create: `frontend/app/(dashboards)/supervisor/referrals/page.tsx`
- Create: `frontend/app/(dashboards)/supervisor/referrals/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<Referral[]>('/reports/sla-breaches')`, `Card`/`Table` (Plan 5); the
  `ReferralResponseDto` shape from Plan 4 (`id, pregnancyEpisodeId, fromFacilityId,
  toFacilityId, reasonCode, urgency, status, createdAt, acceptedAt, departedAt, arrivedAt,
  closedAt`), mirrored here as a local `Referral` interface (same convention Plan 5's own
  `frontline/page.tsx` uses for `Episode`).
- Produces: a table of breaching referrals — episode id (truncated, same "no
  person/episode lookup endpoint exists" limitation Plan 5 and Plan 4 both already
  document, so this shows a truncated raw id, not a friendly name), urgency, current status,
  and hours open (computed client-side from `createdAt`, not a backend field).

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(dashboards)/supervisor/referrals/page.test.tsx`:
```tsx
import { render, screen, waitFor } from '@testing-library/react';
import SupervisorReferralsPage from './page';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

describe('SupervisorReferralsPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders breaching referrals with computed hours open', async () => {
    const fortyEightHoursAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    mockedApiFetch.mockResolvedValue([
      {
        id: 'r1',
        pregnancyEpisodeId: 'episode-1234567890',
        fromFacilityId: null,
        toFacilityId: 'f1',
        reasonCode: 'high_risk_pregnancy',
        urgency: 'urgent',
        status: 'Sent',
        createdAt: fortyEightHoursAgo,
        acceptedAt: null,
        departedAt: null,
        arrivedAt: null,
        closedAt: null,
      },
    ]);

    render(<SupervisorReferralsPage />);

    expect(screen.getByText('Loading SLA breaches...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('#34567890')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/reports/sla-breaches');
    expect(screen.getByText('urgent')).toBeInTheDocument();
    expect(screen.getByText('Sent')).toBeInTheDocument();
    expect(screen.getByText('48')).toBeInTheDocument();
  });

  it('shows an empty-state message when there are no breaches', async () => {
    mockedApiFetch.mockResolvedValue([]);

    render(<SupervisorReferralsPage />);

    await waitFor(() => expect(screen.getByText('No SLA breaches right now.')).toBeInTheDocument());
  });

  it('shows an error message when the load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<SupervisorReferralsPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- "app/(dashboards)/supervisor/referrals/page.test.tsx"`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the SLA-breach page**

Create `frontend/app/(dashboards)/supervisor/referrals/page.tsx`:
```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: 'routine' | 'urgent';
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
}

function hoursOpen(createdAt: string): number {
  return Math.floor((Date.now() - new Date(createdAt).getTime()) / (1000 * 60 * 60));
}

export default function SupervisorReferralsPage() {
  const [referrals, setReferrals] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    apiFetch<Referral[]>('/reports/sla-breaches')
      .then((data) => {
        if (!cancelled) setReferrals(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load SLA breaches.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Referral SLA Breaches</h1>
      <p className="text-sm text-gray-500">
        Referrals open more than 24 hours since creation without reaching a final status.
      </p>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading SLA breaches...</p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Episode</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Hours Open</th>
              </tr>
            </thead>
            <tbody>
              {referrals.length === 0 && (
                <tr>
                  <td colSpan={4}>No SLA breaches right now.</td>
                </tr>
              )}
              {referrals.map((referral) => (
                <tr key={referral.id}>
                  <td>#{referral.pregnancyEpisodeId.slice(-8)}</td>
                  <td>{referral.urgency}</td>
                  <td>{referral.status}</td>
                  <td>{hoursOpen(referral.createdAt)}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- "app/(dashboards)/supervisor/referrals/page.test.tsx"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/supervisor/referrals/
git commit -m "feat: add supervisor SLA-breach referral cohort page"
```

---

### Task 6: Nav — add the SLA-breach page link

**Files:**
- Modify: `frontend/components/nav.tsx`
- Modify: `frontend/components/nav.test.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS_BY_ROLE` (Plan 5, `frontend/components/nav.tsx`) — already has a
  `supervisor` key with one entry (see this plan's Global Constraints, "Frontend routing
  note"); `ROLE_HOME_ROUTE` is untouched by this task, it already has `supervisor:
  '/supervisor'` from Plan 5.
- Produces: a second `supervisor` nav link pointing at the page Task 5 built.

- [ ] **Step 1: Add the failing assertion**

Open `frontend/components/nav.test.tsx` (created by Plan 5). Add this `it()` block inside
the existing `describe('Nav', ...)` block, using the same `buildUser` helper already
defined in that file — do not recreate the file from scratch:
```tsx
  it('shows both supervisor nav links for a supervisor user', () => {
    render(<Nav user={buildUser({ role: 'supervisor', fullName: 'Sup User' })} />);

    expect(screen.getByRole('link', { name: 'KPIs' })).toHaveAttribute('href', '/supervisor');
    expect(screen.getByRole('link', { name: 'Referral SLA' })).toHaveAttribute(
      'href',
      '/supervisor/referrals',
    );
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: FAIL — no link named "Referral SLA" exists yet

- [ ] **Step 3: Add the second supervisor link**

Edit `frontend/components/nav.tsx`. In `NAV_LINKS_BY_ROLE`, change the `supervisor` entry
from:
```typescript
  supervisor: [{ href: '/supervisor', label: 'KPIs' }],
```
to:
```typescript
  supervisor: [
    { href: '/supervisor', label: 'KPIs' },
    { href: '/supervisor/referrals', label: 'Referral SLA' },
  ],
```
No other line in the file changes — `ROLE_HOME_ROUTE` in `layout.tsx` is not touched by this
plan at all (see Global Constraints).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: PASS (both the pre-existing supervisor test, if Plan 5 wrote one, and the new one
above)

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/components/nav.tsx frontend/components/nav.test.tsx
git commit -m "feat: add referral SLA-breach nav link for supervisor role"
```

---

## Not built in this plan (explicitly deferred)

- **Facility-level RLS scoping** — `pregnancy_episode`/`care_task`/`referral` RLS remains
  tenant-only, matching Plan 1/2/4's own established precedent and limitation; see this
  plan's Global Constraints for what that means for the `facilityId` query param
  specifically.
- **Clinical/operational validation of the 24-hour SLA threshold or the ANC completion-rate
  proxy** — both are documented, reasonable MVP defaults, not stakeholder-approved figures
  (`docs/DECISIONS.md`'s "Still Open" section already tracks the identical gap for the risk
  rules engine's own thresholds; this plan adds two more items of the same kind, not a new
  category of problem).
- **Automated SLA-breach alerting/notifications** — the data is queryable via
  `GET /api/v1/reports/sla-breaches` and shown on a page a supervisor can visit; nothing
  runs on a schedule or pushes a notification. Matches Plan 4's own "Not built" section,
  which flags this same gap for referrals generally.
- **A facility picker on the KPI dashboard UI** — the backend supports `?facilityId=` on
  both endpoints; the frontend pages in this plan always call them with no `facilityId`
  (whole-tenant view). Adding a facility dropdown that re-fetches with a chosen id is a
  small, isolated future enhancement, not attempted here to keep the MVP page simple per
  this plan's own brief.
- **Charting library / visual polish beyond Tailwind utility bars** — per this plan's brief,
  intentionally simple for MVP.
- **Historical trend views (KPIs over time)** — every aggregate in this plan is a snapshot
  as of "now"; no time-series storage or querying exists.
