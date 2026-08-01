# Clinician Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Clinician dashboard (`/clinician` route) — a facility triage board
sorted by risk/urgency, an episode detail view for encounter documentation and risk
assessment review, a risk-override control, and referral creation/status tracking —
completing the design spec's Section 5, Core User Flow #3 ("Triage"). Along the way, this
plan fixes a real, documented gap in Plan 1's `identity` module (no batch person-lookup
endpoint) that both this plan's triage board and Plan 5's caseload list need.

This plan has five hard prerequisites and must not be started before all five are done:

1. **Plan 1 (Backend Foundation)** — this plan extends Plan 1's existing `identity` module
   with one new method/route. It assumes `SupabaseService`, `AuthGuard`, `RolesGuard`,
   `@CurrentUser()`, `AuditService`, and the `person`/`facility`/`app_user` tables and their
   RLS policies are already in place exactly as Plan 1 built them.
2. **Plan 2 (Episode & Task Management)** — this plan reads `EpisodeService`'s
   `EpisodeResponseDto`/`RecordEncounterNoteDto` shapes and the
   `GET /api/v1/pregnancy-episodes` / `POST .../encounter-notes` endpoints exactly as Plan 2
   built them; it does not modify the `episode` module.
3. **Plan 3 (Risk Scoring Engine)** — this plan reads `RiskAssessmentResponseDto` and calls
   `GET .../risk-assessments/latest` and `PATCH /api/v1/risk-assessments/:id/override`
   exactly as Plan 3 built them; it does not modify the `risk` module.
4. **Plan 4 (Referral Lifecycle)** — this plan reads `ReferralResponseDto`, calls
   `POST /api/v1/referrals` and `PATCH /api/v1/referrals/:id/status`, and mirrors (does not
   import — see Task 4) Plan 4's `REFERRAL_STATUS_TRANSITIONS` graph; it does not modify the
   `referral` module.
5. **Plan 5 (Frontend Foundation + CHW/Nurse Dashboard)** — this plan's UI lives inside the
   `frontend/` Next.js app Plan 5 scaffolds, and reuses Plan 5's `apiFetch`/`ApiError`,
   `useCurrentUser`, `Button`/`Input`/`Card`/`Table`, and the `(dashboards)/layout.tsx`
   shell exactly as built. **If an agentic worker reaches this plan and Plan 5 has not been
   executed yet, execute Plan 5 first.**

**Architecture:** This plan spans both backend and frontend layers, following Plan 8
(Admin Dashboard)'s precedent for a plan that touches both:

- *Backend* — one small, additive change to Plan 1's existing `identity` module: a new
  `IdentityService.findByIds()` method plus a `GET /api/v1/persons?ids=id1,id2,id3` route
  branch, added alongside the existing `?phone=` search on the same controller/route. No
  new NestJS module, no new table, and — see Global Constraints — no new migration: the
  `person_tenant_isolation` RLS `select` policy Plan 1 already wrote scopes an
  `.in('id', ids)` query exactly the way it already scopes `.eq('phone_primary', phone)`
  today. This closes the gap Plan 5's Task 8 wrote up explicitly ("Known gap for a future
  backend plan") and that this plan's own triage board would otherwise hit identically.
- *Frontend* — the `/clinician` route tree under `frontend/app/(dashboards)/clinician/`:
  a triage board (`page.tsx`), an episode detail page (`episodes/[id]/page.tsx`) that
  combines the episode overview, risk-assessment review/override, and encounter-note
  recording into one view (per this plan's brief), and a referral status view
  (`referrals/page.tsx`). Built entirely against Plan 5's fixed frontend contract — no new
  frontend infrastructure (no new `lib/` client factories, no new test config, no new UI
  primitives). The one new frontend-only file this plan adds,
  `frontend/lib/referral-state-machine.ts`, mirrors Plan 4's backend state-machine graph
  (see Task 4 for why this is a deliberate duplication, not a live cross-package import —
  `frontend/` and `backend/` are separate npm projects with no shared workspace).

**Tech Stack:** Backend: same as Plan 1 — Node.js 20 LTS, NestJS 10.x, TypeScript 5.x,
`@supabase/supabase-js` v2, Jest + Supertest. Frontend: same as Plan 5 — Next.js 14+ (App
Router), TypeScript, React 18, Tailwind CSS, Jest + React Testing Library via the
`next/jest` preset Plan 5 configures. No new dependencies are introduced by this plan on
either side.

## Global Constraints

**Backend (inherited from Plan 1 — see `docs/superpowers/plans/2026-08-01-backend-foundation.md`
for the full list):**
- Backend lives in `backend/` at the repo root. API base path `/api/v1`. Every response
  header includes `X-Correlation-Id`. Error responses use the exact shape
  `{ "error": { "code": "STRING_CODE", "message": "...", "details": [], "correlationId": "uuid" } }`.
- No ORM. All Postgres access goes through `@supabase/supabase-js`, scoped to the caller's
  JWT (`SupabaseService.getClientForUser`) — RLS is the authorization mechanism, not
  application-level filtering (`docs/DECISIONS.md` #21).
- **This plan adds zero migrations.** `IdentityService.findByIds()` is a new read method
  against the existing `person` table, using the existing `person_tenant_isolation` RLS
  `select` policy Plan 1's Task 4 already wrote (`tenant_id = (select tenant_id from
  auth_app_user())`). That policy filters rows regardless of the client-side query shape
  (`.eq(...)` vs `.in(...)`), so no new policy is needed. If this were ever proven wrong,
  the fix would be a new migration file — this plan asserts it is not needed and shows why
  in Task 1, rather than skipping the question.

**Frontend (fixed contract shared with Plan 5 and Plan 8 — this plan builds against it
exactly, does not deviate):**
- Location: `frontend/` at repo root. Next.js App Router, TypeScript, React 18, Tailwind.
- `frontend/lib/api-client.ts` exports
  `apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>`
  and `class ApiError extends Error { code; details; correlationId }`. Every page in this
  plan imports both from `@/lib/api-client` and mocks that module in tests — never mocks
  `fetch` or `@supabase/supabase-js` directly.
- `frontend/lib/current-user.ts` exports `interface AppUser { id, tenantId, role,
  facilityId, fullName, email }`. `frontend/components/current-user-provider.tsx` exports
  `CurrentUserProvider`/`useCurrentUser(): AppUser`, mocked in page tests as
  `jest.mock('@/components/current-user-provider', () => ({ useCurrentUser: jest.fn() }))`.
- `frontend/components/ui/{button,input,card,table}.tsx` — `Button`
  (`ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'danger' }`),
  `Input` (`InputHTMLAttributes<HTMLInputElement> & { label: string; error?: string }`),
  `Card` (`{ children; className? }`), `Table` (`TableHTMLAttributes<HTMLTableElement>`,
  thin wrapper — author `<thead>`/`<tbody>` directly, no columns/rows data API).
- `frontend/app/(dashboards)/layout.tsx` exports `ROLE_HOME_ROUTE: Record<string, string>`
  and `resolveRedirectForRole(pathname, role): string | null`. **Verified directly against
  Plan 5's own Task 7 code and Handoff section (not assumed): `ROLE_HOME_ROUTE` already
  contains `clinician: '/clinician'`** — unlike `admin`, which Plan 5 deliberately left out
  for Plan 8 to add, Plan 5 pre-populated the `clinician` (and `supervisor`) keys. This
  plan therefore does **not** need to modify `ROLE_HOME_ROUTE` — see Task 2 for the full
  verification and the one real Nav diff this plan does need.
- `frontend/components/nav.tsx` exports `Nav({ user })`, keyed off an internal
  `NAV_LINKS_BY_ROLE` map. Verified directly against Plan 5's Task 7 code: `clinician` is
  already present as `[{ href: '/clinician', label: 'Triage Board' }]`. Task 2 extends this
  array with a second entry for this plan's new `/clinician/referrals` page.
- Jest + React Testing Library, `next/jest` preset. Test files are colocated
  (`page.tsx`/`page.test.tsx`), run via `cd frontend && npm test -- <path>`. No
  Playwright/e2e, per Plan 5's Global Constraints and the design spec's Testing Strategy.
- Do not run `git commit` or `npm install` while executing this plan's Steps unless a Step
  explicitly says to.

---

### Task 1: Backend — batch person lookup (`IdentityService.findByIds`)

**Files:**
- Modify: `backend/src/identity/identity.service.ts`
- Modify: `backend/src/identity/identity.service.spec.ts`
- Modify: `backend/src/identity/identity.controller.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser` (Plan 1); the `person` table and its
  `person_tenant_isolation` RLS `select` policy (Plan 1, Tasks 3–4).
- Produces: `IdentityService.findByIds(jwt: string, ids: string[]): Promise<PersonResponseDto[]>`.
  Extends the existing `GET /api/v1/persons` route: `?ids=id1,id2,id3` (comma-separated,
  whitespace-trimmed, empty segments dropped) returns a batch lookup; the existing
  `?phone=<phone>` search continues to work completely unchanged when `ids` is absent. This
  is exactly the gap Plan 5's Task 8 documented ("Known gap for a future backend plan") and
  what this plan's own Task 3 (triage board) needs to show names instead of raw person ids.

- [ ] **Step 1: Write the failing tests for `findByIds`**

Open `backend/src/identity/identity.service.spec.ts` (created by Plan 1, Task 9). Append
two new `it` blocks inside the existing `describe('IdentityService', ...)` block, after the
existing `search returns matches by phone` test, and add one new helper function
(`buildClientForIds`) alongside the existing `buildClient`/`buildService` helpers:

```typescript
function buildClientForIds(rows: any[]) {
  return {
    from: () => ({
      select: () => ({
        in: () => Promise.resolve({ data: rows, error: null }),
      }),
    }),
  };
}

async function buildServiceForIds(rows: any[]) {
  const supabaseService = {
    getClientForUser: () => buildClientForIds(rows),
  } as unknown as SupabaseService;
  const auditService = { log: jest.fn() } as unknown as AuditService;

  const module: TestingModule = await Test.createTestingModule({
    providers: [
      IdentityService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();

  return module.get<IdentityService>(IdentityService);
}
```

Then append the two tests:

```typescript
  it('findByIds returns persons matching the given id list', async () => {
    const svc = await buildServiceForIds([
      { id: 'p1', tenant_id: 't1', first_name: 'Amina', last_name: null, phone_primary: '+254700000001', date_of_birth: null },
      { id: 'p2', tenant_id: 't1', first_name: 'Beatrice', last_name: 'Wanjiru', phone_primary: '+254700000002', date_of_birth: null },
    ]);

    const result = await svc.findByIds('jwt', ['p1', 'p2']);

    expect(result).toHaveLength(2);
    expect(result.map((p) => p.firstName)).toEqual(['Amina', 'Beatrice']);
    expect(result[1].lastName).toBe('Wanjiru');
  });

  it('findByIds returns an empty array without querying the database when given an empty id list', async () => {
    const fromMock = jest.fn();
    const supabaseService = {
      getClientForUser: () => ({ from: fromMock }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const svc = module.get<IdentityService>(IdentityService);

    const result = await svc.findByIds('jwt', []);

    expect(result).toEqual([]);
    expect(fromMock).not.toHaveBeenCalled();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd backend && npm test -- identity.service.spec.ts`
Expected: FAIL — `svc.findByIds is not a function`.

- [ ] **Step 3: Implement `findByIds`**

Open `backend/src/identity/identity.service.ts`. Add this method to the `IdentityService`
class, immediately after the existing `search` method and before `create`:

```typescript
  async findByIds(jwt: string, ids: string[]): Promise<PersonResponseDto[]> {
    if (ids.length === 0) {
      return [];
    }
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('person').select('*').in('id', ids);
    if (error) {
      throw error;
    }
    return (data ?? []).map(PersonResponseDto.fromRow);
  }
```

No other change to this file — `search`, `create`, and `DuplicatePersonError` are
untouched, and `PersonResponseDto` is already imported.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd backend && npm test -- identity.service.spec.ts`
Expected: PASS — all `IdentityService` tests (search, create, duplicate detection,
findByIds) green.

- [ ] **Step 5: Extend the controller's `GET /api/v1/persons` route**

Open `backend/src/identity/identity.controller.ts`. Replace the existing `search` handler:

Before:
```typescript
  @Get()
  search(@CurrentUser() user: CurrentUserPayload, @Query('phone') phone: string) {
    return this.identityService.search(user.jwt, phone);
  }
```

After:
```typescript
  @Get()
  search(
    @CurrentUser() user: CurrentUserPayload,
    @Query('phone') phone?: string,
    @Query('ids') ids?: string,
  ) {
    if (ids) {
      const idList = ids
        .split(',')
        .map((id) => id.trim())
        .filter((id) => id.length > 0);
      return this.identityService.findByIds(user.jwt, idList);
    }
    return this.identityService.search(user.jwt, phone as string);
  }
```

The `phone`-only path is byte-for-byte the same call it was before (`this.identityService
.search(user.jwt, phone)`) whenever `ids` is absent — no behavior change for any existing
caller. This mirrors Plan 1's own precedent of not adding a dedicated controller unit-test
file for `IdentityController` (there is no `identity.e2e-spec.ts` in Plan 1 either): the
real behavioral coverage is the service-level test above, and this handler is a thin,
directly-readable dispatch with no logic of its own to test in isolation.

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/identity/identity.service.ts backend/src/identity/identity.service.spec.ts backend/src/identity/identity.controller.ts
git commit -m "feat: add batch person lookup (GET /api/v1/persons?ids=) to the identity module"
```

---

### Task 2: Frontend — wire the clinician's second Nav link (Referrals)

**Files:**
- Modify: `frontend/components/nav.tsx`
- Modify: `frontend/components/nav.test.tsx`

**Interfaces:**
- Consumes: `NAV_LINKS_BY_ROLE` (internal to `frontend/components/nav.tsx`, Plan 5 Task 7).
- Produces: a second clinician nav link, `/clinician/referrals` (built in Task 8 of this
  plan), alongside the existing `/clinician` Triage Board link.

**What this task verifies but does not change:** `frontend/app/(dashboards)/layout.tsx`'s
`ROLE_HOME_ROUTE` map, read directly from Plan 5's Task 7 implementation, is:
```typescript
export const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
};
```
`clinician: '/clinician'` is already present — unlike Plan 8's `admin` situation (where
Plan 5 deliberately left the key out for Plan 8 to add), Plan 5 pre-populated this one.
**This plan makes no change to `layout.tsx`.** Stating this explicitly, with the exact
quoted map, rather than silently skipping a step the plan's brief expected to exist, or
worse, mechanically "adding" a key that is already there and calling it a diff.

`frontend/components/nav.tsx`'s `NAV_LINKS_BY_ROLE`, also read directly from Plan 5's Task
7 implementation, already has:
```typescript
clinician: [{ href: '/clinician', label: 'Triage Board' }],
```
This **is** a real, needed change: this plan adds a second link for the referral status
view (Task 8).

- [ ] **Step 1: Write the failing Nav test**

Open `frontend/components/nav.test.tsx` (created by Plan 5, Task 7). Append a new `it`
block inside the existing `describe('Nav', ...)` block, after the existing admin test:

```tsx
  it('shows both clinician links: Triage Board and Referrals', () => {
    render(<Nav user={buildUser({ role: 'clinician' })} />);

    expect(screen.getByRole('link', { name: 'Triage Board' })).toHaveAttribute(
      'href',
      '/clinician',
    );
    expect(screen.getByRole('link', { name: 'Referrals' })).toHaveAttribute(
      'href',
      '/clinician/referrals',
    );
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: FAIL — no link named `'Referrals'` exists yet.

- [ ] **Step 3: Extend `NAV_LINKS_BY_ROLE.clinician`**

Open `frontend/components/nav.tsx`. Change only the `clinician` entry:

Before:
```typescript
  clinician: [{ href: '/clinician', label: 'Triage Board' }],
```

After:
```typescript
  clinician: [
    { href: '/clinician', label: 'Triage Board' },
    { href: '/clinician/referrals', label: 'Referrals' },
  ],
```

No other line in the file changes.

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd frontend && npm test -- components/nav.test.tsx`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/components/nav.tsx frontend/components/nav.test.tsx
git commit -m "feat: add clinician Referrals nav link"
```

---

### Task 3: Facility triage board (`/clinician`)

**Files:**
- Create: `frontend/app/(dashboards)/clinician/page.tsx`
- Create: `frontend/app/(dashboards)/clinician/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Plan 5), `useCurrentUser` (Plan 5), `Card`/`Table` (Plan
  5), `GET /api/v1/pregnancy-episodes?facilityId=<id>` → `EpisodeResponseDto[]` (Plan 2
  Handoff), `GET /api/v1/persons?ids=id1,id2,...` → `PersonResponseDto[]` (Task 1 of this
  plan).
- Produces: the clinician's landing page (`ROLE_HOME_ROUTE.clinician`, already `/clinician`
  per Task 2's verification).

**This is a real improvement over Plan 5's interim workaround, called out explicitly:**
Plan 5's Task 8 (the CHW/Nurse caseload list) hit the exact same wall this page would
otherwise hit — `EpisodeResponseDto` only carries `personId`, never a name, and Plan 1's
identity API had no batch lookup — and worked around it by displaying `#{personId.slice(-8)}`
with an explicit "known limitation" comment. Because Task 1 of this plan adds
`GET /api/v1/persons?ids=...`, this triage board shows real names, not that workaround.
(Plan 5's own caseload list is not touched by this plan — its workaround remains in place
until whoever next touches `frontend/app/(dashboards)/frontline/page.tsx` wires the new
endpoint in; see this plan's closing Handoff section.)

**Sort order, decided here:** the spec (Section 5, Core Flow #3) says "sorted by
`risk_band`/urgency." `pregnancy_episode` carries no standalone `urgency` field (that lives
on `referral.urgency` and `care_task.priority`, neither of which this list fetches) — so
this task's interpretation is: primary sort key `riskBand` (`high` → `medium` → `low` →
unassessed, in that order — an unassessed episode is not treated as more urgent than a
known high-risk one), secondary sort key `estimatedDeliveryDate` ascending (soonest EDD
first; episodes with no EDD yet sort last within their risk tier).

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/clinician/page.test.tsx`:

```tsx
import { render, screen, waitFor } from '@testing-library/react';
import ClinicianTriageBoardPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const HIGH_RISK_EPISODE = {
  id: 'e-high',
  personId: 'person-high-0001',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-09-01',
  gestationalAgeWeeks: 30,
  riskBand: 'high',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const LOW_RISK_EPISODE = {
  id: 'e-low',
  personId: 'person-low-00002',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-08-15',
  gestationalAgeWeeks: 25,
  riskBand: 'low',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

function mockFetchByPath(map: Record<string, unknown>) {
  mockedApiFetch.mockImplementation((path: string) => {
    for (const key of Object.keys(map)) {
      if (path.startsWith(key)) {
        return Promise.resolve(map[key]);
      }
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianTriageBoardPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: 'f1',
      fullName: 'Dr. Njoroge',
      email: 'njoroge@example.com',
    });
  });

  it('lists episodes sorted high-risk first and shows names from the batch person lookup', async () => {
    mockFetchByPath({
      '/pregnancy-episodes': [LOW_RISK_EPISODE, HIGH_RISK_EPISODE],
      '/persons': [
        { id: 'person-high-0001', tenantId: 't1', firstName: 'Amina', lastName: 'Njeri', phonePrimary: null, dateOfBirth: null },
        { id: 'person-low-00002', tenantId: 't1', firstName: 'Beatrice', lastName: 'Wanjiru', phonePrimary: null, dateOfBirth: null },
      ],
    });

    render(<ClinicianTriageBoardPage />);

    expect(screen.getByText('Loading triage board...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Amina Njeri')).toBeInTheDocument());

    const rows = screen.getAllByRole('row').slice(1); // skip header row
    expect(rows[0]).toHaveTextContent('Amina Njeri');
    expect(rows[0]).toHaveTextContent('high');
    expect(rows[1]).toHaveTextContent('Beatrice Wanjiru');
    expect(rows[1]).toHaveTextContent('low');

    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes?facilityId=f1');
    expect(mockedApiFetch).toHaveBeenCalledWith('/persons?ids=person-low-00002,person-high-0001');
  });

  it('skips the person-lookup call when the facility has no active episodes', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);

    render(<ClinicianTriageBoardPage />);

    await waitFor(() =>
      expect(screen.getByText('No active episodes at this facility.')).toBeInTheDocument(),
    );
    expect(mockedApiFetch).toHaveBeenCalledTimes(1);
  });

  it('shows a message and never calls the API when the user has no facility assigned', async () => {
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: null,
      fullName: 'Dr. No Facility',
      email: 'nf@example.com',
    });

    render(<ClinicianTriageBoardPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });

  it('shows an error message when the episode load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<ClinicianTriageBoardPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/page.test.tsx"`
Expected: FAIL — cannot find module `./page`.

- [ ] **Step 3: Implement the triage board page**

Create `frontend/app/(dashboards)/clinician/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface Person {
  id: string;
  tenantId: string;
  firstName: string;
  lastName: string | null;
  phonePrimary: string | null;
  dateOfBirth: string | null;
}

// Highest urgency first. An episode with no risk band yet (assessment still pending) sorts
// after every scored band, not before it — "not yet triaged" is not the same as "known
// low risk," and treating it that way would bury it under low-risk cases.
const RISK_BAND_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
function riskBandRank(riskBand: string | null): number {
  return riskBand !== null && riskBand in RISK_BAND_ORDER ? RISK_BAND_ORDER[riskBand] : 3;
}

// Secondary sort key: soonest estimated delivery date first. Decided here because
// pregnancy_episode carries no standalone "urgency" field of its own (that lives on
// referral.urgency and care_task.priority, neither fetched by this list) — see this task's
// write-up.
function sortEpisodes(episodes: Episode[]): Episode[] {
  return [...episodes].sort((a, b) => {
    const rankDiff = riskBandRank(a.riskBand) - riskBandRank(b.riskBand);
    if (rankDiff !== 0) return rankDiff;
    if (!a.estimatedDeliveryDate && !b.estimatedDeliveryDate) return 0;
    if (!a.estimatedDeliveryDate) return 1;
    if (!b.estimatedDeliveryDate) return -1;
    return a.estimatedDeliveryDate.localeCompare(b.estimatedDeliveryDate);
  });
}

export default function ClinicianTriageBoardPage() {
  const user = useCurrentUser();
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [personNames, setPersonNames] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user.facilityId) {
      setLoading(false);
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    let cancelled = false;

    async function load() {
      try {
        const loadedEpisodes = await apiFetch<Episode[]>(
          `/pregnancy-episodes?facilityId=${user.facilityId}`,
        );
        if (cancelled) return;
        setEpisodes(sortEpisodes(loadedEpisodes));

        const uniquePersonIds = Array.from(new Set(loadedEpisodes.map((e) => e.personId)));
        if (uniquePersonIds.length === 0) {
          return;
        }
        const persons = await apiFetch<Person[]>(`/persons?ids=${uniquePersonIds.join(',')}`);
        if (cancelled) return;
        const nameById: Record<string, string> = {};
        for (const person of persons) {
          nameById[person.id] = [person.firstName, person.lastName].filter(Boolean).join(' ');
        }
        setPersonNames(nameById);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load triage board.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [user.facilityId]);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Facility Triage Board</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {loading ? (
        <p>Loading triage board...</p>
      ) : (
        <Card>
          <Table>
            <thead>
              <tr>
                <th>Person</th>
                <th>Risk band</th>
                <th>Status</th>
                <th>EDD</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {episodes.length === 0 && (
                <tr>
                  <td colSpan={5}>No active episodes at this facility.</td>
                </tr>
              )}
              {episodes.map((episode) => (
                <tr key={episode.id}>
                  <td>{personNames[episode.personId] ?? `#${episode.personId.slice(-8)}`}</td>
                  <td>{episode.riskBand ?? 'unassessed'}</td>
                  <td>{episode.status}</td>
                  <td>{episode.estimatedDeliveryDate ?? '—'}</td>
                  <td>
                    <Link href={`/clinician/episodes/${episode.id}`}>View</Link>
                  </td>
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

The `personNames[episode.personId] ?? '#' + slice(-8)` fallback only fires transiently
(during the brief window before the batch lookup resolves) or defensively (a person row
somehow missing from the batch response) — the steady-state path always shows a name.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/clinician/page.tsx" "frontend/app/(dashboards)/clinician/page.test.tsx"
git commit -m "feat: add clinician facility triage board sorted by risk band and EDD"
```

---

### Task 4: Frontend — client-side referral state machine + episode-eligibility rule

**Files:**
- Create: `frontend/lib/referral-state-machine.ts`
- Create: `frontend/lib/referral-state-machine.test.ts`

**Interfaces:**
- Produces: `type ReferralStatus`, `REFERRAL_STATUS_TRANSITIONS`, `TERMINAL_REFERRAL_STATUSES`,
  `nextValidReferralStatuses(currentStatus: string): ReferralStatus[]`,
  `isTerminalReferralStatus(status: string): boolean`, and
  `isEpisodeEligibleForReferral(episodeStatus: string): boolean` — consumed by Task 7
  (referral creation gating) and Task 8 (referral status view's transition buttons).

**Why this is a duplication, not an import — checked against Plan 4's own guidance:**
Plan 4's Handoff section ("What Plan 6 (Clinician) needs") says to use
`REFERRAL_STATUS_TRANSITIONS[currentStatus]` client-side "since the server will reject
anything else with 409 anyway," and separately calls `backend/src/referral/referral-state-machine.ts`
"importable if a dashboard wants to render 'what can this referral become next.'" Taken
literally, "importable" only holds within the `backend/` TypeScript project itself — Plan
1/5's Global Constraints establish `frontend/`, `backend/`, and `supabase/` as three
independent top-level directories with no shared npm workspace, so Next.js's bundler has no
module-resolution path from `frontend/` into a sibling, separate npm package's `src/`. This
plan's reading of Plan 4's intent is therefore: keep the *values* identical and centralized
in one named, tested frontend module (not scattered inline across components), not a live
cross-package `import`. If a future plan introduces a shared workspace package, this file
is the natural one to delete in favor of a real shared import — noted, not attempted here
(restructuring package boundaries is out of this plan's scope).

**Episode-referral-eligibility rule, decided here:** `pregnancy_episode.status` has nine
legal values after Plan 4 extended it (Plan 4 Handoff: `Draft, Active, Referred, Admitted,
Delivered, PostnatalActive, Closed, Archived, Cancelled`). This plan allows referral
creation only when the episode is `Active` or `Admitted`:
- `Active` — ordinary ongoing care; the common case.
- `Admitted` — the episode arrived at a receiving facility via a prior referral and may
  still need to be escalated further (e.g., a district hospital referring on to a
  specialist center); referral chains are a real clinical pattern, not an edge case to
  exclude.
- Excluded — `Draft` (this build never actually sets it, per Plan 2's Global Constraints,
  but it is a legal DB value, handled defensively); `Referred` (a referral is already in
  flight for this episode — Plan 4's `ReferralService.create()` does not itself guard
  against a second concurrent referral, so this client-side rule exists specifically to
  stop staff from creating confusing duplicate referrals while one is open, since the
  backend won't catch it); `Delivered`/`PostnatalActive` (the pregnancy-referral flow this
  plan builds doesn't cover post-delivery escalation — Plan 4's own Handoff lists this as
  explicitly not built); `Closed`/`Archived`/`Cancelled` (terminal, nothing left to refer).

- [ ] **Step 1: Write the failing tests**

Create `frontend/lib/referral-state-machine.test.ts`:

```typescript
import {
  REFERRAL_STATUS_TRANSITIONS,
  TERMINAL_REFERRAL_STATUSES,
  nextValidReferralStatuses,
  isTerminalReferralStatus,
  isEpisodeEligibleForReferral,
} from './referral-state-machine';

describe('referral-state-machine (frontend mirror of backend/src/referral/referral-state-machine.ts)', () => {
  it('matches the exact 9-state graph from Plan 4', () => {
    expect(REFERRAL_STATUS_TRANSITIONS).toEqual({
      Created: ['Sent', 'Cancelled'],
      Sent: ['Accepted', 'Cancelled'],
      Accepted: ['Dispatched', 'Cancelled'],
      Dispatched: ['InTransit', 'Failed'],
      InTransit: ['Arrived', 'Failed'],
      Arrived: ['Completed'],
      Completed: [],
      Failed: [],
      Cancelled: [],
    });
    expect(TERMINAL_REFERRAL_STATUSES).toEqual(['Completed', 'Failed', 'Cancelled']);
  });

  it('nextValidReferralStatuses returns the allowed next states for a mid-flow status', () => {
    expect(nextValidReferralStatuses('Sent')).toEqual(['Accepted', 'Cancelled']);
    expect(nextValidReferralStatuses('Accepted')).toEqual(['Dispatched', 'Cancelled']);
  });

  it('nextValidReferralStatuses returns an empty array for a terminal status', () => {
    expect(nextValidReferralStatuses('Completed')).toEqual([]);
  });

  it('nextValidReferralStatuses returns an empty array for an unrecognized status rather than throwing', () => {
    expect(nextValidReferralStatuses('NotARealStatus')).toEqual([]);
  });

  it('isTerminalReferralStatus is true only for Completed, Failed, Cancelled', () => {
    expect(isTerminalReferralStatus('Completed')).toBe(true);
    expect(isTerminalReferralStatus('Failed')).toBe(true);
    expect(isTerminalReferralStatus('Cancelled')).toBe(true);
    expect(isTerminalReferralStatus('Sent')).toBe(false);
  });
});

describe('isEpisodeEligibleForReferral', () => {
  it('is true for Active and Admitted episodes', () => {
    expect(isEpisodeEligibleForReferral('Active')).toBe(true);
    expect(isEpisodeEligibleForReferral('Admitted')).toBe(true);
  });

  it('is false for Draft, Referred, Delivered, PostnatalActive, Closed, Archived, Cancelled', () => {
    for (const status of [
      'Draft',
      'Referred',
      'Delivered',
      'PostnatalActive',
      'Closed',
      'Archived',
      'Cancelled',
    ]) {
      expect(isEpisodeEligibleForReferral(status)).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- lib/referral-state-machine.test.ts`
Expected: FAIL — cannot find module `./referral-state-machine`.

- [ ] **Step 3: Implement the module**

Create `frontend/lib/referral-state-machine.ts`:

```typescript
// Mirrors backend/src/referral/referral-state-machine.ts (Plan 4) exactly. Duplicated, not
// imported — frontend/ and backend/ are separate npm packages with no shared workspace
// (Plan 1/5 Global Constraints), so Next.js cannot resolve a module living in a sibling
// package. See this plan's Task 4 for the full rationale. Keep this file's transition
// graph byte-for-byte identical to the backend source; the backend remains authoritative
// and will reject with 409 REFERRAL_INVALID_STATE anything this table wrongly allows.
export type ReferralStatus =
  | 'Created'
  | 'Sent'
  | 'Accepted'
  | 'Dispatched'
  | 'InTransit'
  | 'Arrived'
  | 'Completed'
  | 'Failed'
  | 'Cancelled';

export const REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]> = {
  Created: ['Sent', 'Cancelled'],
  Sent: ['Accepted', 'Cancelled'],
  Accepted: ['Dispatched', 'Cancelled'],
  Dispatched: ['InTransit', 'Failed'],
  InTransit: ['Arrived', 'Failed'],
  Arrived: ['Completed'],
  Completed: [],
  Failed: [],
  Cancelled: [],
};

export const TERMINAL_REFERRAL_STATUSES: ReferralStatus[] = ['Completed', 'Failed', 'Cancelled'];

export function nextValidReferralStatuses(currentStatus: string): ReferralStatus[] {
  return REFERRAL_STATUS_TRANSITIONS[currentStatus as ReferralStatus] ?? [];
}

export function isTerminalReferralStatus(status: string): boolean {
  return TERMINAL_REFERRAL_STATUSES.includes(status as ReferralStatus);
}

// Episode statuses (Plan 2 + Plan 4's 9-value pregnancy_episode.status set) for which
// creating a new referral makes sense. See this task's write-up for the reasoning behind
// each inclusion/exclusion.
const EPISODE_STATUSES_ELIGIBLE_FOR_REFERRAL = ['Active', 'Admitted'];

export function isEpisodeEligibleForReferral(episodeStatus: string): boolean {
  return EPISODE_STATUSES_ELIGIBLE_FOR_REFERRAL.includes(episodeStatus);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- lib/referral-state-machine.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/lib/referral-state-machine.ts frontend/lib/referral-state-machine.test.ts
git commit -m "feat: add frontend referral state-machine mirror and episode-eligibility rule"
```

---

### Task 5: Episode detail page — overview, risk assessment display, encounter note form

**Files:**
- Create: `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx`
- Create: `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Plan 5), `Card`/`Input`/`Button` (Plan 5),
  `GET /api/v1/pregnancy-episodes/:id` → `EpisodeResponseDto` (Plan 2),
  `GET /api/v1/pregnancy-episodes/:id/risk-assessments/latest` → `RiskAssessmentResponseDto
  | null` (Plan 3), `POST /api/v1/pregnancy-episodes/:id/encounter-notes` (Plan 2's
  `RecordEncounterNoteDto` → `EncounterNoteResponseDto`).
- Produces: the base episode detail page — overview, risk assessment (with the mandatory
  caveat), and encounter note recording. Task 6 extends this same file with the risk
  override control; Task 7 extends it again with referral creation. Both later tasks show
  this file's complete, updated content — there is no separate "final" version to look up
  elsewhere.

**No CHW/nurse role branching, per this plan's brief:** Plan 5's Task 11 built the
`/frontline` encounter note form with a `user.role === 'nurse'` conditional gating the four
vitals fields, because a CHW in the field is not assumed to carry a BP cuff/thermometer/
hemoglobinometer. A clinician, by contrast, is always facility-based with access to that
equipment — so this page always renders all four vitals fields, with no role check at all.

**The provisional-thresholds caveat, surfaced prominently, per Plan 3's explicit
requirement:** Plan 3's Handoff to this plan says the caveat "should make this legible to
the clinician viewing it, not just to whoever reads this plan" and suggests "a badge, a
tooltip, a footnote." This task renders it as a visible, bordered, colored callout at the
top of the risk assessment card — above the risk band and reason codes, not below them,
and not inside a collapsed/details element — so it cannot be missed or dismissed as fine
print.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClinicianEpisodeDetailPage from './page';
import { apiFetch } from '@/lib/api-client';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;

const SAMPLE_EPISODE = {
  id: 'e1',
  personId: 'p1',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-12-01',
  gestationalAgeWeeks: 20,
  riskBand: 'high',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const SAMPLE_RISK_ASSESSMENT = {
  id: 'ra1',
  pregnancyEpisodeId: 'e1',
  assessmentTime: '2026-08-01T00:00:00.000Z',
  ruleScore: 2,
  mlScore: 2,
  finalRiskBand: 'high',
  explanation: {
    ruleFactors: [
      { factor: 'bloodPressure', band: 'high', detail: 'severe hypertension: systolic 165 mmHg (>=160)' },
    ],
    mlReasoning: 'Elevated BP consistent with preeclampsia risk.',
  },
  overriddenBy: null,
  overrideReason: null,
  status: 'Computed',
  createdAt: '2026-08-01T00:00:00.000Z',
};

function mockFetchByPath(map: Record<string, unknown>) {
  mockedApiFetch.mockImplementation((path: string) => {
    for (const key of Object.keys(map)) {
      if (path.startsWith(key)) {
        return Promise.resolve(map[key]);
      }
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianEpisodeDetailPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and renders the episode overview and latest risk assessment with the provisional-thresholds caveat shown prominently', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    expect(screen.getByText('Loading episode...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());

    expect(
      screen.getByText(/provisional and have not received clinical sign-off/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/severe hypertension/)).toBeInTheDocument();
    expect(screen.getByText(/Elevated BP consistent with preeclampsia risk\./)).toBeInTheDocument();
  });

  it('shows a placeholder when no risk assessment exists yet', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('No risk assessment yet for this episode.')).toBeInTheDocument(),
    );
  });

  it('submits the encounter note with noteText and all four vitals fields, with no role branching', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByLabelText('Note')).toBeInTheDocument());

    expect(screen.getByLabelText('BP systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature (C)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hemoglobin (g/dL)')).toBeInTheDocument();

    mockedApiFetch.mockResolvedValueOnce({ id: 'note-1' });

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'BP elevated on exam.' } });
    fireEvent.change(screen.getByLabelText('BP systolic'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('BP diastolic'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Temperature (C)'), { target: { value: '37.0' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin (g/dL)'), { target: { value: '11.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(screen.getByText('Encounter note saved.')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: {
        noteText: 'BP elevated on exam.',
        vitals: { bpSystolic: 150, bpDiastolic: 95, temperatureC: 37, hemoglobinGdl: 11 },
      },
    });
  });

  it('shows an error message when the episode load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: FAIL — cannot find module `./page`.

- [ ] **Step 3: Implement the episode detail page**

Create `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx`:

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RuleFactor {
  factor: string;
  band: 'low' | 'medium' | 'high' | null;
  detail: string;
}

interface RiskAssessment {
  id: string;
  pregnancyEpisodeId: string;
  assessmentTime: string;
  ruleScore: number;
  mlScore: number | null;
  finalRiskBand: 'low' | 'medium' | 'high';
  explanation: {
    ruleFactors: RuleFactor[];
    mlReasoning?: string;
    mlDisagreement?: { ruleBand: string; mlBand: string; resolution: string };
    mlError?: string;
  };
  overriddenBy: string | null;
  overrideReason: string | null;
  status: 'Pending' | 'Computed' | 'Overridden' | 'Failed' | 'FallbackRuleOnly';
  createdAt: string;
}

export default function ClinicianEpisodeDetailPage() {
  const params = useParams<{ id: string }>();
  const episodeId = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [loadedEpisode, latestRisk] = await Promise.all([
          apiFetch<Episode>(`/pregnancy-episodes/${episodeId}`),
          apiFetch<RiskAssessment | null>(`/pregnancy-episodes/${episodeId}/risk-assessments/latest`),
        ]);
        if (cancelled) return;
        setEpisode(loadedEpisode);
        setRiskAssessment(latestRisk);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load episode.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  async function handleNoteSubmit(event: FormEvent) {
    event.preventDefault();
    setNoteSubmitting(true);
    setNoteError(null);
    setNoteSaved(false);

    try {
      const body: { noteText?: string; vitals?: Record<string, number> } = {};
      if (noteText) {
        body.noteText = noteText;
      }
      const vitals: Record<string, number> = {};
      if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
      if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
      if (temperatureC) vitals.temperatureC = Number(temperatureC);
      if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
      if (Object.keys(vitals).length > 0) {
        body.vitals = vitals;
      }

      await apiFetch(`/pregnancy-episodes/${episodeId}/encounter-notes`, {
        method: 'POST',
        body,
      });

      setNoteText('');
      setBpSystolic('');
      setBpDiastolic('');
      setTemperatureC('');
      setHemoglobinGdl('');
      setNoteSaved(true);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setNoteSubmitting(false);
    }
  }

  if (loading) {
    return <p>Loading episode...</p>;
  }

  if (error || !episode) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'Episode not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Episode {episode.id}</h1>

      <Card>
        <h2 className="text-lg font-medium">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Status</dt>
          <dd>{episode.status}</dd>
          <dt className="text-gray-500">Gestational age</dt>
          <dd>{episode.gestationalAgeWeeks ?? '—'} weeks</dd>
          <dt className="text-gray-500">Estimated delivery date</dt>
          <dd>{episode.estimatedDeliveryDate ?? '—'}</dd>
          <dt className="text-gray-500">Risk band</dt>
          <dd>{episode.riskBand ?? 'unassessed'}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Latest Risk Assessment</h2>
        {riskAssessment === null ? (
          <p>No risk assessment yet for this episode.</p>
        ) : (
          <div className="space-y-2">
            <p className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm font-medium text-yellow-800">
              Caution: these rule thresholds are provisional and have not received clinical
              sign-off. Use clinical judgment — do not treat this band as a final diagnosis.
            </p>
            <p>
              <span className="font-medium">Final risk band:</span> {riskAssessment.finalRiskBand}
              {' '}({riskAssessment.status})
            </p>
            <ul className="list-disc pl-5 text-sm">
              {riskAssessment.explanation.ruleFactors.map((factor) => (
                <li key={factor.factor}>
                  {factor.factor}: {factor.band ?? 'insufficient data'} — {factor.detail}
                </li>
              ))}
            </ul>
            {riskAssessment.explanation.mlReasoning && (
              <p className="text-sm">ML reasoning: {riskAssessment.explanation.mlReasoning}</p>
            )}
            {riskAssessment.explanation.mlDisagreement && (
              <p className="text-sm">
                Model suggested {riskAssessment.explanation.mlDisagreement.mlBand}; rules band
                retained ({riskAssessment.explanation.mlDisagreement.resolution}).
              </p>
            )}
            {riskAssessment.explanation.mlError && (
              <p className="text-sm text-gray-600">
                ML enrichment did not run: {riskAssessment.explanation.mlError}. This is a
                rule-only score, not a model-reviewed one.
              </p>
            )}
            {riskAssessment.overriddenBy && (
              <p className="text-sm">Overridden. Reason: {riskAssessment.overrideReason}</p>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Record Encounter Note</h2>
        <form onSubmit={handleNoteSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <Input
            label="BP systolic"
            type="number"
            value={bpSystolic}
            onChange={(e) => setBpSystolic(e.target.value)}
          />
          <Input
            label="BP diastolic"
            type="number"
            value={bpDiastolic}
            onChange={(e) => setBpDiastolic(e.target.value)}
          />
          <Input
            label="Temperature (C)"
            type="number"
            value={temperatureC}
            onChange={(e) => setTemperatureC(e.target.value)}
          />
          <Input
            label="Hemoglobin (g/dL)"
            type="number"
            value={hemoglobinGdl}
            onChange={(e) => setHemoglobinGdl(e.target.value)}
          />
          {noteError && (
            <p role="alert" className="text-sm text-red-600">
              {noteError}
            </p>
          )}
          {noteSaved && <p className="text-sm text-green-700">Encounter note saved.</p>}
          <Button type="submit" disabled={noteSubmitting}>
            {noteSubmitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/clinician/episodes/"
git commit -m "feat: add clinician episode detail page with risk assessment display and encounter note form"
```

---

### Task 6: Risk override control

**Files:**
- Modify: `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx`
- Modify: `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `PATCH /api/v1/risk-assessments/:id/override` (Plan 3's
  `OverrideRiskAssessmentDto { finalRiskBand: 'low' | 'medium' | 'high'; overrideReason:
  string }` → `RiskAssessmentResponseDto`).
- Produces: an "Override risk band" button inside the risk assessment card (shown whenever
  a risk assessment exists) that reveals a small inline form: a risk-band select and an
  override-reason field. Client-side validation requires a non-empty reason (at least 3
  characters, matching Plan 3's own `@MinLength(3)` on `overrideReason`) before calling the
  API; any error the backend returns (e.g. a 400 from its own validation) is surfaced
  as-is.

- [ ] **Step 1: Write the failing tests**

Open `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx` (from Task 5).
Append three new `it` blocks inside the existing `describe('ClinicianEpisodeDetailPage',
...)` block, after the "shows a placeholder when no risk assessment exists yet" test:

```tsx
  it('requires an override reason before calling the API', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Override risk band'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(await screen.findByText(/Override reason is required/)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/override'),
      expect.anything(),
    );
  });

  it('submits a valid override and shows the updated band, status, and reason', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    mockedApiFetch.mockResolvedValueOnce({
      ...SAMPLE_RISK_ASSESSMENT,
      finalRiskBand: 'medium',
      status: 'Overridden',
      overriddenBy: 'u1',
      overrideReason: 'Clinical exam does not support high risk.',
    });

    fireEvent.change(screen.getByLabelText('New risk band'), { target: { value: 'medium' } });
    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Clinical exam does not support high risk.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/risk-assessments/ra1/override', {
        method: 'PATCH',
        body: { finalRiskBand: 'medium', overrideReason: 'Clinical exam does not support high risk.' },
      }),
    );
    expect(
      await screen.findByText('Overridden. Reason: Clinical exam does not support high risk.'),
    ).toBeInTheDocument();
  });

  it('surfaces an error returned by the backend override call', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    class OverrideApiError extends Error {
      code = 'BAD_REQUEST';
      details: unknown[] = [];
      correlationId = 'corr-1';
    }
    mockedApiFetch.mockRejectedValueOnce(
      new OverrideApiError('overrideReason must be longer than or equal to 3 characters'),
    );

    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Valid length reason passing client-side validation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(
      await screen.findByText('overrideReason must be longer than or equal to 3 characters'),
    ).toBeInTheDocument();
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: FAIL — no "Override risk band" control exists yet.

- [ ] **Step 3: Add the override control**

Replace `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx` with the following
(this is Task 5's file with the override state, handler, and JSX added — every line not
shown as new is unchanged from Task 5):

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RuleFactor {
  factor: string;
  band: 'low' | 'medium' | 'high' | null;
  detail: string;
}

interface RiskAssessment {
  id: string;
  pregnancyEpisodeId: string;
  assessmentTime: string;
  ruleScore: number;
  mlScore: number | null;
  finalRiskBand: 'low' | 'medium' | 'high';
  explanation: {
    ruleFactors: RuleFactor[];
    mlReasoning?: string;
    mlDisagreement?: { ruleBand: string; mlBand: string; resolution: string };
    mlError?: string;
  };
  overriddenBy: string | null;
  overrideReason: string | null;
  status: 'Pending' | 'Computed' | 'Overridden' | 'Failed' | 'FallbackRuleOnly';
  createdAt: string;
}

export default function ClinicianEpisodeDetailPage() {
  const params = useParams<{ id: string }>();
  const episodeId = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideBand, setOverrideBand] = useState<'low' | 'medium' | 'high'>('low');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [loadedEpisode, latestRisk] = await Promise.all([
          apiFetch<Episode>(`/pregnancy-episodes/${episodeId}`),
          apiFetch<RiskAssessment | null>(`/pregnancy-episodes/${episodeId}/risk-assessments/latest`),
        ]);
        if (cancelled) return;
        setEpisode(loadedEpisode);
        setRiskAssessment(latestRisk);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load episode.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  async function handleNoteSubmit(event: FormEvent) {
    event.preventDefault();
    setNoteSubmitting(true);
    setNoteError(null);
    setNoteSaved(false);

    try {
      const body: { noteText?: string; vitals?: Record<string, number> } = {};
      if (noteText) {
        body.noteText = noteText;
      }
      const vitals: Record<string, number> = {};
      if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
      if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
      if (temperatureC) vitals.temperatureC = Number(temperatureC);
      if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
      if (Object.keys(vitals).length > 0) {
        body.vitals = vitals;
      }

      await apiFetch(`/pregnancy-episodes/${episodeId}/encounter-notes`, {
        method: 'POST',
        body,
      });

      setNoteText('');
      setBpSystolic('');
      setBpDiastolic('');
      setTemperatureC('');
      setHemoglobinGdl('');
      setNoteSaved(true);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setNoteSubmitting(false);
    }
  }

  function openOverrideForm() {
    if (riskAssessment) {
      setOverrideBand(riskAssessment.finalRiskBand);
    }
    setOverrideError(null);
    setOverrideOpen(true);
  }

  async function handleOverrideSubmit(event: FormEvent) {
    event.preventDefault();
    setOverrideError(null);

    if (overrideReason.trim().length < 3) {
      setOverrideError('Override reason is required (at least 3 characters).');
      return;
    }
    if (!riskAssessment) {
      return;
    }

    setOverrideSubmitting(true);
    try {
      const updated = await apiFetch<RiskAssessment>(
        `/risk-assessments/${riskAssessment.id}/override`,
        { method: 'PATCH', body: { finalRiskBand: overrideBand, overrideReason } },
      );
      setRiskAssessment(updated);
      setOverrideOpen(false);
      setOverrideReason('');
    } catch (err) {
      setOverrideError(err instanceof ApiError ? err.message : 'Failed to override risk band.');
    } finally {
      setOverrideSubmitting(false);
    }
  }

  if (loading) {
    return <p>Loading episode...</p>;
  }

  if (error || !episode) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'Episode not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Episode {episode.id}</h1>

      <Card>
        <h2 className="text-lg font-medium">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Status</dt>
          <dd>{episode.status}</dd>
          <dt className="text-gray-500">Gestational age</dt>
          <dd>{episode.gestationalAgeWeeks ?? '—'} weeks</dd>
          <dt className="text-gray-500">Estimated delivery date</dt>
          <dd>{episode.estimatedDeliveryDate ?? '—'}</dd>
          <dt className="text-gray-500">Risk band</dt>
          <dd>{episode.riskBand ?? 'unassessed'}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Latest Risk Assessment</h2>
        {riskAssessment === null ? (
          <p>No risk assessment yet for this episode.</p>
        ) : (
          <div className="space-y-2">
            <p className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm font-medium text-yellow-800">
              Caution: these rule thresholds are provisional and have not received clinical
              sign-off. Use clinical judgment — do not treat this band as a final diagnosis.
            </p>
            <p>
              <span className="font-medium">Final risk band:</span> {riskAssessment.finalRiskBand}
              {' '}({riskAssessment.status})
            </p>
            <ul className="list-disc pl-5 text-sm">
              {riskAssessment.explanation.ruleFactors.map((factor) => (
                <li key={factor.factor}>
                  {factor.factor}: {factor.band ?? 'insufficient data'} — {factor.detail}
                </li>
              ))}
            </ul>
            {riskAssessment.explanation.mlReasoning && (
              <p className="text-sm">ML reasoning: {riskAssessment.explanation.mlReasoning}</p>
            )}
            {riskAssessment.explanation.mlDisagreement && (
              <p className="text-sm">
                Model suggested {riskAssessment.explanation.mlDisagreement.mlBand}; rules band
                retained ({riskAssessment.explanation.mlDisagreement.resolution}).
              </p>
            )}
            {riskAssessment.explanation.mlError && (
              <p className="text-sm text-gray-600">
                ML enrichment did not run: {riskAssessment.explanation.mlError}. This is a
                rule-only score, not a model-reviewed one.
              </p>
            )}
            {riskAssessment.overriddenBy && (
              <p className="text-sm">Overridden. Reason: {riskAssessment.overrideReason}</p>
            )}

            {!overrideOpen ? (
              <Button variant="secondary" onClick={openOverrideForm}>
                Override risk band
              </Button>
            ) : (
              <form
                onSubmit={handleOverrideSubmit}
                className="space-y-3 rounded-md border border-gray-200 p-3"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor="override-band" className="text-sm font-medium text-gray-700">
                    New risk band
                  </label>
                  <select
                    id="override-band"
                    value={overrideBand}
                    onChange={(e) => setOverrideBand(e.target.value as 'low' | 'medium' | 'high')}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <Input
                  label="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                {overrideError && (
                  <p role="alert" className="text-sm text-red-600">
                    {overrideError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={overrideSubmitting}>
                    {overrideSubmitting ? 'Submitting...' : 'Submit override'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setOverrideOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Record Encounter Note</h2>
        <form onSubmit={handleNoteSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <Input
            label="BP systolic"
            type="number"
            value={bpSystolic}
            onChange={(e) => setBpSystolic(e.target.value)}
          />
          <Input
            label="BP diastolic"
            type="number"
            value={bpDiastolic}
            onChange={(e) => setBpDiastolic(e.target.value)}
          />
          <Input
            label="Temperature (C)"
            type="number"
            value={temperatureC}
            onChange={(e) => setTemperatureC(e.target.value)}
          />
          <Input
            label="Hemoglobin (g/dL)"
            type="number"
            value={hemoglobinGdl}
            onChange={(e) => setHemoglobinGdl(e.target.value)}
          />
          {noteError && (
            <p role="alert" className="text-sm text-red-600">
              {noteError}
            </p>
          )}
          {noteSaved && <p className="text-sm text-green-700">Encounter note saved.</p>}
          <Button type="submit" disabled={noteSubmitting}>
            {noteSubmitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: PASS — all seven tests (four from Task 5, three new) green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/clinician/episodes/"
git commit -m "feat: add risk override control to clinician episode detail page"
```

---

### Task 7: Referral creation form

**Files:**
- Modify: `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx`
- Modify: `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx`

**Interfaces:**
- Consumes: `useCurrentUser` (Plan 5), `isEpisodeEligibleForReferral` (Task 4 of this
  plan), `GET /api/v1/facilities?acceptingReferrals=true` → `FacilityResponseDto[]` (Plan
  1), `POST /api/v1/referrals` (Plan 4's `CreateReferralDto { pregnancyEpisodeId,
  toFacilityId, fromFacilityId?, reasonCode, urgency }` → `ReferralResponseDto`).
- Produces: a "Create Referral" card, shown only when
  `isEpisodeEligibleForReferral(episode.status)` is true (Task 4's rule — `Active` or
  `Admitted`); otherwise shows a short explanation instead of the form. `toFacilityId` is a
  `<select>` populated from the accepting-referrals facility list; `fromFacilityId`
  defaults to the clinician's own `facilityId` (not a separate user-editable field — the
  clinician is, by definition, viewing this episode from their own facility).

This task introduces `useCurrentUser()` into this page for the first time (Tasks 5–6 did
not need it). Because that changes what every test in this file must mock, this task
replaces the full test file, not just appends to it — every existing test from Tasks 5–6 is
carried forward with the new mock/fixture wiring, and the new referral tests are added
alongside them.

- [ ] **Step 1: Write the failing tests (full replacement of the test file)**

Replace `frontend/app/(dashboards)/clinician/episodes/[id]/page.test.tsx` in full:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import ClinicianEpisodeDetailPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));
jest.mock('next/navigation', () => ({
  useParams: () => ({ id: 'e1' }),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const SAMPLE_EPISODE = {
  id: 'e1',
  personId: 'p1',
  facilityId: 'f1',
  lmpDate: null,
  estimatedDeliveryDate: '2026-12-01',
  gestationalAgeWeeks: 20,
  riskBand: 'high',
  status: 'Active',
  createdAt: '2026-08-01T00:00:00.000Z',
  updatedAt: '2026-08-01T00:00:00.000Z',
};

const CLOSED_EPISODE = { ...SAMPLE_EPISODE, status: 'Closed' };

const SAMPLE_RISK_ASSESSMENT = {
  id: 'ra1',
  pregnancyEpisodeId: 'e1',
  assessmentTime: '2026-08-01T00:00:00.000Z',
  ruleScore: 2,
  mlScore: 2,
  finalRiskBand: 'high',
  explanation: {
    ruleFactors: [
      { factor: 'bloodPressure', band: 'high', detail: 'severe hypertension: systolic 165 mmHg (>=160)' },
    ],
    mlReasoning: 'Elevated BP consistent with preeclampsia risk.',
  },
  overriddenBy: null,
  overrideReason: null,
  status: 'Computed',
  createdAt: '2026-08-01T00:00:00.000Z',
};

const SAMPLE_FACILITIES = [
  { id: 'f2', tenantId: 't1', name: 'District Referral Hospital', type: 'hospital', contactPhone: null, acceptingReferrals: true },
];

function mockFetchByPath(map: Record<string, unknown>) {
  mockedApiFetch.mockImplementation((path: string) => {
    for (const key of Object.keys(map)) {
      if (path.startsWith(key)) {
        return Promise.resolve(map[key]);
      }
    }
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianEpisodeDetailPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: 'f1',
      fullName: 'Dr. Njoroge',
      email: 'njoroge@example.com',
    });
  });

  it('loads and renders the episode overview and latest risk assessment with the provisional-thresholds caveat shown prominently', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);

    expect(screen.getByText('Loading episode...')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Active')).toBeInTheDocument());

    expect(
      screen.getByText(/provisional and have not received clinical sign-off/i),
    ).toBeInTheDocument();
    expect(screen.getByText(/severe hypertension/)).toBeInTheDocument();
    expect(screen.getByText(/Elevated BP consistent with preeclampsia risk\./)).toBeInTheDocument();
  });

  it('shows a placeholder when no risk assessment exists yet', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(screen.getByText('No risk assessment yet for this episode.')).toBeInTheDocument(),
    );
  });

  it('submits the encounter note with noteText and all four vitals fields, with no role branching', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByLabelText('Note')).toBeInTheDocument());

    expect(screen.getByLabelText('BP systolic')).toBeInTheDocument();
    expect(screen.getByLabelText('BP diastolic')).toBeInTheDocument();
    expect(screen.getByLabelText('Temperature (C)')).toBeInTheDocument();
    expect(screen.getByLabelText('Hemoglobin (g/dL)')).toBeInTheDocument();

    mockedApiFetch.mockResolvedValueOnce({ id: 'note-1' });

    fireEvent.change(screen.getByLabelText('Note'), { target: { value: 'BP elevated on exam.' } });
    fireEvent.change(screen.getByLabelText('BP systolic'), { target: { value: '150' } });
    fireEvent.change(screen.getByLabelText('BP diastolic'), { target: { value: '95' } });
    fireEvent.change(screen.getByLabelText('Temperature (C)'), { target: { value: '37.0' } });
    fireEvent.change(screen.getByLabelText('Hemoglobin (g/dL)'), { target: { value: '11.0' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save note' }));

    await waitFor(() => expect(screen.getByText('Encounter note saved.')).toBeInTheDocument());
    expect(mockedApiFetch).toHaveBeenCalledWith('/pregnancy-episodes/e1/encounter-notes', {
      method: 'POST',
      body: {
        noteText: 'BP elevated on exam.',
        vitals: { bpSystolic: 150, bpDiastolic: 95, temperatureC: 37, hemoglobinGdl: 11 },
      },
    });
  });

  it('shows an error message when the episode load fails', async () => {
    mockedApiFetch.mockRejectedValue(new Error('network down'));

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
  });

  it('requires an override reason before calling the API', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());

    fireEvent.click(screen.getByText('Override risk band'));
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(await screen.findByText(/Override reason is required/)).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/override'),
      expect.anything(),
    );
  });

  it('submits a valid override and shows the updated band, status, and reason', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    mockedApiFetch.mockResolvedValueOnce({
      ...SAMPLE_RISK_ASSESSMENT,
      finalRiskBand: 'medium',
      status: 'Overridden',
      overriddenBy: 'u1',
      overrideReason: 'Clinical exam does not support high risk.',
    });

    fireEvent.change(screen.getByLabelText('New risk band'), { target: { value: 'medium' } });
    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Clinical exam does not support high risk.' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/risk-assessments/ra1/override', {
        method: 'PATCH',
        body: { finalRiskBand: 'medium', overrideReason: 'Clinical exam does not support high risk.' },
      }),
    );
    expect(
      await screen.findByText('Overridden. Reason: Clinical exam does not support high risk.'),
    ).toBeInTheDocument();
  });

  it('surfaces an error returned by the backend override call', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': SAMPLE_RISK_ASSESSMENT,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() => expect(screen.getByText('Override risk band')).toBeInTheDocument());
    fireEvent.click(screen.getByText('Override risk band'));

    class OverrideApiError extends Error {
      code = 'BAD_REQUEST';
      details: unknown[] = [];
      correlationId = 'corr-1';
    }
    mockedApiFetch.mockRejectedValueOnce(
      new OverrideApiError('overrideReason must be longer than or equal to 3 characters'),
    );

    fireEvent.change(screen.getByLabelText('Override reason'), {
      target: { value: 'Valid length reason passing client-side validation' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Submit override' }));

    expect(
      await screen.findByText('overrideReason must be longer than or equal to 3 characters'),
    ).toBeInTheDocument();
  });

  it('shows the referral form with facilities loaded from the accepting-referrals list when the episode is Active', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );
    expect(mockedApiFetch).toHaveBeenCalledWith('/facilities?acceptingReferrals=true');
  });

  it('hides the referral form and explains why when the episode is not eligible (e.g. Closed)', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': CLOSED_EPISODE,
    });

    render(<ClinicianEpisodeDetailPage />);

    await waitFor(() =>
      expect(
        screen.getByText('Referral creation is not available while this episode is Closed.'),
      ).toBeInTheDocument(),
    );
    expect(mockedApiFetch).not.toHaveBeenCalledWith(
      expect.stringContaining('/facilities'),
      expect.anything(),
    );
  });

  it('creates a referral with the clinician facility as fromFacilityId and shows the created status', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    mockedApiFetch.mockResolvedValueOnce({
      id: 'ref1',
      pregnancyEpisodeId: 'e1',
      fromFacilityId: 'f1',
      toFacilityId: 'f2',
      reasonCode: 'Suspected preeclampsia',
      urgency: 'urgent',
      status: 'Created',
      createdAt: '2026-08-01T00:00:00.000Z',
      acceptedAt: null,
      departedAt: null,
      arrivedAt: null,
      closedAt: null,
    });

    fireEvent.change(screen.getByLabelText('Receiving facility'), { target: { value: 'f2' } });
    fireEvent.change(screen.getByLabelText('Reason'), { target: { value: 'Suspected preeclampsia' } });
    fireEvent.change(screen.getByLabelText('Urgency'), { target: { value: 'urgent' } });
    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/referrals', {
        method: 'POST',
        body: {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'f2',
          fromFacilityId: 'f1',
          reasonCode: 'Suspected preeclampsia',
          urgency: 'urgent',
        },
      }),
    );
    expect(await screen.findByText('Referral created (status: Created).')).toBeInTheDocument();
  });

  it('requires a receiving facility and a reason before calling the API', async () => {
    mockFetchByPath({
      '/pregnancy-episodes/e1/risk-assessments/latest': null,
      '/pregnancy-episodes/e1': SAMPLE_EPISODE,
      '/facilities': SAMPLE_FACILITIES,
    });

    render(<ClinicianEpisodeDetailPage />);
    await waitFor(() =>
      expect(screen.getByRole('option', { name: 'District Referral Hospital' })).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Create referral' }));

    expect(await screen.findByText('Select a receiving facility.')).toBeInTheDocument();
    expect(mockedApiFetch).not.toHaveBeenCalledWith('/referrals', expect.anything());
  });
});
```

- [ ] **Step 2: Run the tests to verify the new ones fail**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: FAIL on the four new referral-related tests — no "Create Referral" section exists
yet. The pre-existing tests should still pass unchanged (the new `useCurrentUser` mock and
`/facilities` fixture don't change their behavior).

- [ ] **Step 3: Add the referral creation section**

Replace `frontend/app/(dashboards)/clinician/episodes/[id]/page.tsx` with the following
(Task 6's file with `useCurrentUser`, the facilities fetch, the referral form state/handler,
and its JSX added):

```tsx
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { isEpisodeEligibleForReferral } from '@/lib/referral-state-machine';

interface Episode {
  id: string;
  personId: string;
  facilityId: string;
  lmpDate: string | null;
  estimatedDeliveryDate: string | null;
  gestationalAgeWeeks: number | null;
  riskBand: 'low' | 'medium' | 'high' | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

interface RuleFactor {
  factor: string;
  band: 'low' | 'medium' | 'high' | null;
  detail: string;
}

interface RiskAssessment {
  id: string;
  pregnancyEpisodeId: string;
  assessmentTime: string;
  ruleScore: number;
  mlScore: number | null;
  finalRiskBand: 'low' | 'medium' | 'high';
  explanation: {
    ruleFactors: RuleFactor[];
    mlReasoning?: string;
    mlDisagreement?: { ruleBand: string; mlBand: string; resolution: string };
    mlError?: string;
  };
  overriddenBy: string | null;
  overrideReason: string | null;
  status: 'Pending' | 'Computed' | 'Overridden' | 'Failed' | 'FallbackRuleOnly';
  createdAt: string;
}

interface Facility {
  id: string;
  tenantId: string;
  name: string;
  type: string;
  contactPhone: string | null;
  acceptingReferrals: boolean;
}

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
}

export default function ClinicianEpisodeDetailPage() {
  const user = useCurrentUser();
  const params = useParams<{ id: string }>();
  const episodeId = params.id;

  const [episode, setEpisode] = useState<Episode | null>(null);
  const [riskAssessment, setRiskAssessment] = useState<RiskAssessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [noteText, setNoteText] = useState('');
  const [bpSystolic, setBpSystolic] = useState('');
  const [bpDiastolic, setBpDiastolic] = useState('');
  const [temperatureC, setTemperatureC] = useState('');
  const [hemoglobinGdl, setHemoglobinGdl] = useState('');
  const [noteSubmitting, setNoteSubmitting] = useState(false);
  const [noteError, setNoteError] = useState<string | null>(null);
  const [noteSaved, setNoteSaved] = useState(false);

  const [overrideOpen, setOverrideOpen] = useState(false);
  const [overrideBand, setOverrideBand] = useState<'low' | 'medium' | 'high'>('low');
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideSubmitting, setOverrideSubmitting] = useState(false);
  const [overrideError, setOverrideError] = useState<string | null>(null);

  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [toFacilityId, setToFacilityId] = useState('');
  const [reasonCode, setReasonCode] = useState('');
  const [urgency, setUrgency] = useState<'routine' | 'urgent'>('routine');
  const [referralSubmitting, setReferralSubmitting] = useState(false);
  const [referralError, setReferralError] = useState<string | null>(null);
  const [referralCreated, setReferralCreated] = useState<Referral | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const [loadedEpisode, latestRisk] = await Promise.all([
          apiFetch<Episode>(`/pregnancy-episodes/${episodeId}`),
          apiFetch<RiskAssessment | null>(`/pregnancy-episodes/${episodeId}/risk-assessments/latest`),
        ]);
        if (cancelled) return;
        setEpisode(loadedEpisode);
        setRiskAssessment(latestRisk);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load episode.');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [episodeId]);

  useEffect(() => {
    if (!episode || !isEpisodeEligibleForReferral(episode.status)) {
      return;
    }
    let cancelled = false;
    apiFetch<Facility[]>('/facilities?acceptingReferrals=true')
      .then((data) => {
        if (!cancelled) setFacilities(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setReferralError(
            err instanceof ApiError ? err.message : 'Failed to load receiving facilities.',
          );
        }
      });
    return () => {
      cancelled = true;
    };
  }, [episode?.status]);

  async function handleNoteSubmit(event: FormEvent) {
    event.preventDefault();
    setNoteSubmitting(true);
    setNoteError(null);
    setNoteSaved(false);

    try {
      const body: { noteText?: string; vitals?: Record<string, number> } = {};
      if (noteText) {
        body.noteText = noteText;
      }
      const vitals: Record<string, number> = {};
      if (bpSystolic) vitals.bpSystolic = Number(bpSystolic);
      if (bpDiastolic) vitals.bpDiastolic = Number(bpDiastolic);
      if (temperatureC) vitals.temperatureC = Number(temperatureC);
      if (hemoglobinGdl) vitals.hemoglobinGdl = Number(hemoglobinGdl);
      if (Object.keys(vitals).length > 0) {
        body.vitals = vitals;
      }

      await apiFetch(`/pregnancy-episodes/${episodeId}/encounter-notes`, {
        method: 'POST',
        body,
      });

      setNoteText('');
      setBpSystolic('');
      setBpDiastolic('');
      setTemperatureC('');
      setHemoglobinGdl('');
      setNoteSaved(true);
    } catch (err) {
      setNoteError(err instanceof ApiError ? err.message : 'Failed to save encounter note.');
    } finally {
      setNoteSubmitting(false);
    }
  }

  function openOverrideForm() {
    if (riskAssessment) {
      setOverrideBand(riskAssessment.finalRiskBand);
    }
    setOverrideError(null);
    setOverrideOpen(true);
  }

  async function handleOverrideSubmit(event: FormEvent) {
    event.preventDefault();
    setOverrideError(null);

    if (overrideReason.trim().length < 3) {
      setOverrideError('Override reason is required (at least 3 characters).');
      return;
    }
    if (!riskAssessment) {
      return;
    }

    setOverrideSubmitting(true);
    try {
      const updated = await apiFetch<RiskAssessment>(
        `/risk-assessments/${riskAssessment.id}/override`,
        { method: 'PATCH', body: { finalRiskBand: overrideBand, overrideReason } },
      );
      setRiskAssessment(updated);
      setOverrideOpen(false);
      setOverrideReason('');
    } catch (err) {
      setOverrideError(err instanceof ApiError ? err.message : 'Failed to override risk band.');
    } finally {
      setOverrideSubmitting(false);
    }
  }

  async function handleReferralSubmit(event: FormEvent) {
    event.preventDefault();
    setReferralError(null);
    setReferralCreated(null);

    if (!toFacilityId) {
      setReferralError('Select a receiving facility.');
      return;
    }
    if (!reasonCode.trim()) {
      setReferralError('A reason is required.');
      return;
    }

    setReferralSubmitting(true);
    try {
      const created = await apiFetch<Referral>('/referrals', {
        method: 'POST',
        body: {
          pregnancyEpisodeId: episodeId,
          toFacilityId,
          fromFacilityId: user.facilityId ?? undefined,
          reasonCode,
          urgency,
        },
      });
      setReferralCreated(created);
      setToFacilityId('');
      setReasonCode('');
      setUrgency('routine');
    } catch (err) {
      setReferralError(err instanceof ApiError ? err.message : 'Failed to create referral.');
    } finally {
      setReferralSubmitting(false);
    }
  }

  if (loading) {
    return <p>Loading episode...</p>;
  }

  if (error || !episode) {
    return (
      <p role="alert" className="text-sm text-red-600">
        {error ?? 'Episode not found.'}
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Episode {episode.id}</h1>

      <Card>
        <h2 className="text-lg font-medium">Overview</h2>
        <dl className="grid grid-cols-2 gap-2 text-sm">
          <dt className="text-gray-500">Status</dt>
          <dd>{episode.status}</dd>
          <dt className="text-gray-500">Gestational age</dt>
          <dd>{episode.gestationalAgeWeeks ?? '—'} weeks</dd>
          <dt className="text-gray-500">Estimated delivery date</dt>
          <dd>{episode.estimatedDeliveryDate ?? '—'}</dd>
          <dt className="text-gray-500">Risk band</dt>
          <dd>{episode.riskBand ?? 'unassessed'}</dd>
        </dl>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Latest Risk Assessment</h2>
        {riskAssessment === null ? (
          <p>No risk assessment yet for this episode.</p>
        ) : (
          <div className="space-y-2">
            <p className="border-l-4 border-yellow-500 bg-yellow-50 p-3 text-sm font-medium text-yellow-800">
              Caution: these rule thresholds are provisional and have not received clinical
              sign-off. Use clinical judgment — do not treat this band as a final diagnosis.
            </p>
            <p>
              <span className="font-medium">Final risk band:</span> {riskAssessment.finalRiskBand}
              {' '}({riskAssessment.status})
            </p>
            <ul className="list-disc pl-5 text-sm">
              {riskAssessment.explanation.ruleFactors.map((factor) => (
                <li key={factor.factor}>
                  {factor.factor}: {factor.band ?? 'insufficient data'} — {factor.detail}
                </li>
              ))}
            </ul>
            {riskAssessment.explanation.mlReasoning && (
              <p className="text-sm">ML reasoning: {riskAssessment.explanation.mlReasoning}</p>
            )}
            {riskAssessment.explanation.mlDisagreement && (
              <p className="text-sm">
                Model suggested {riskAssessment.explanation.mlDisagreement.mlBand}; rules band
                retained ({riskAssessment.explanation.mlDisagreement.resolution}).
              </p>
            )}
            {riskAssessment.explanation.mlError && (
              <p className="text-sm text-gray-600">
                ML enrichment did not run: {riskAssessment.explanation.mlError}. This is a
                rule-only score, not a model-reviewed one.
              </p>
            )}
            {riskAssessment.overriddenBy && (
              <p className="text-sm">Overridden. Reason: {riskAssessment.overrideReason}</p>
            )}

            {!overrideOpen ? (
              <Button variant="secondary" onClick={openOverrideForm}>
                Override risk band
              </Button>
            ) : (
              <form
                onSubmit={handleOverrideSubmit}
                className="space-y-3 rounded-md border border-gray-200 p-3"
              >
                <div className="flex flex-col gap-1">
                  <label htmlFor="override-band" className="text-sm font-medium text-gray-700">
                    New risk band
                  </label>
                  <select
                    id="override-band"
                    value={overrideBand}
                    onChange={(e) => setOverrideBand(e.target.value as 'low' | 'medium' | 'high')}
                    className="rounded-md border border-gray-300 px-3 py-2 text-sm"
                  >
                    <option value="low">low</option>
                    <option value="medium">medium</option>
                    <option value="high">high</option>
                  </select>
                </div>
                <Input
                  label="Override reason"
                  value={overrideReason}
                  onChange={(e) => setOverrideReason(e.target.value)}
                />
                {overrideError && (
                  <p role="alert" className="text-sm text-red-600">
                    {overrideError}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button type="submit" disabled={overrideSubmitting}>
                    {overrideSubmitting ? 'Submitting...' : 'Submit override'}
                  </Button>
                  <Button type="button" variant="secondary" onClick={() => setOverrideOpen(false)}>
                    Cancel
                  </Button>
                </div>
              </form>
            )}
          </div>
        )}
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Record Encounter Note</h2>
        <form onSubmit={handleNoteSubmit} className="space-y-4">
          <Input label="Note" value={noteText} onChange={(e) => setNoteText(e.target.value)} />
          <Input
            label="BP systolic"
            type="number"
            value={bpSystolic}
            onChange={(e) => setBpSystolic(e.target.value)}
          />
          <Input
            label="BP diastolic"
            type="number"
            value={bpDiastolic}
            onChange={(e) => setBpDiastolic(e.target.value)}
          />
          <Input
            label="Temperature (C)"
            type="number"
            value={temperatureC}
            onChange={(e) => setTemperatureC(e.target.value)}
          />
          <Input
            label="Hemoglobin (g/dL)"
            type="number"
            value={hemoglobinGdl}
            onChange={(e) => setHemoglobinGdl(e.target.value)}
          />
          {noteError && (
            <p role="alert" className="text-sm text-red-600">
              {noteError}
            </p>
          )}
          {noteSaved && <p className="text-sm text-green-700">Encounter note saved.</p>}
          <Button type="submit" disabled={noteSubmitting}>
            {noteSubmitting ? 'Saving...' : 'Save note'}
          </Button>
        </form>
      </Card>

      <Card>
        <h2 className="text-lg font-medium">Create Referral</h2>
        {!isEpisodeEligibleForReferral(episode.status) ? (
          <p className="text-sm text-gray-500">
            Referral creation is not available while this episode is {episode.status}.
          </p>
        ) : (
          <form onSubmit={handleReferralSubmit} className="space-y-4">
            <div className="flex flex-col gap-1">
              <label htmlFor="to-facility" className="text-sm font-medium text-gray-700">
                Receiving facility
              </label>
              <select
                id="to-facility"
                value={toFacilityId}
                onChange={(e) => setToFacilityId(e.target.value)}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="">Select a facility</option>
                {facilities.map((facility) => (
                  <option key={facility.id} value={facility.id}>
                    {facility.name}
                  </option>
                ))}
              </select>
            </div>
            <Input label="Reason" value={reasonCode} onChange={(e) => setReasonCode(e.target.value)} />
            <div className="flex flex-col gap-1">
              <label htmlFor="urgency" className="text-sm font-medium text-gray-700">
                Urgency
              </label>
              <select
                id="urgency"
                value={urgency}
                onChange={(e) => setUrgency(e.target.value as 'routine' | 'urgent')}
                className="rounded-md border border-gray-300 px-3 py-2 text-sm"
              >
                <option value="routine">routine</option>
                <option value="urgent">urgent</option>
              </select>
            </div>
            {referralError && (
              <p role="alert" className="text-sm text-red-600">
                {referralError}
              </p>
            )}
            {referralCreated && (
              <p className="text-sm text-green-700">
                Referral created (status: {referralCreated.status}).
              </p>
            )}
            <Button type="submit" disabled={referralSubmitting}>
              {referralSubmitting ? 'Creating...' : 'Create referral'}
            </Button>
          </form>
        )}
      </Card>
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/episodes/\[id\]/page.test.tsx"`
Expected: PASS — all eleven tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/clinician/episodes/"
git commit -m "feat: add referral creation form to clinician episode detail page"
```

---

### Task 8: Referral status view (`/clinician/referrals`)

**Files:**
- Create: `frontend/app/(dashboards)/clinician/referrals/page.tsx`
- Create: `frontend/app/(dashboards)/clinician/referrals/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch`/`ApiError` (Plan 5), `useCurrentUser` (Plan 5), `Card`/`Table`/
  `Button` (Plan 5), `GET /api/v1/referrals?facilityId=<id>&direction=incoming` and
  `...&direction=outgoing` (Plan 4) → `ReferralResponseDto[]`,
  `PATCH /api/v1/referrals/:id/status` (Plan 4) → `ReferralResponseDto`,
  `nextValidReferralStatuses` (Task 4 of this plan).
- Produces: `/clinician/referrals`, linked from Nav (Task 2).

**Action-button scope, per this plan's brief:** status-transition buttons appear only on
the *incoming* table (referrals where this clinician's facility is `to_facility_id` — the
brief's own words: "for referrals where the clinician's facility is the receiving one").
The outgoing table is read-only status tracking. Each incoming row's buttons come from
`nextValidReferralStatuses(referral.status)` (Task 4's mirror of Plan 4's
`REFERRAL_STATUS_TRANSITIONS`), so the UI only ever offers a transition the backend's real
state machine would also accept — it can still 409 on a race (another user transitions the
same referral first), which is surfaced through the same error-display path as any other
`ApiError`, not specially handled.

- [ ] **Step 1: Write the failing tests**

Create `frontend/app/(dashboards)/clinician/referrals/page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react';
import ClinicianReferralsPage from './page';
import { apiFetch } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';

jest.mock('@/lib/api-client', () => ({
  apiFetch: jest.fn(),
  ApiError: class ApiError extends Error {
    code = 'ERROR';
    details: unknown[] = [];
    correlationId = 'test-correlation-id';
  },
}));
jest.mock('@/components/current-user-provider', () => ({
  useCurrentUser: jest.fn(),
}));

const mockedApiFetch = apiFetch as jest.MockedFunction<typeof apiFetch>;
const mockedUseCurrentUser = useCurrentUser as jest.MockedFunction<typeof useCurrentUser>;

const INCOMING_REFERRAL = {
  id: 'r1',
  pregnancyEpisodeId: 'e1',
  fromFacilityId: 'f2',
  toFacilityId: 'f1',
  reasonCode: 'Suspected preeclampsia',
  urgency: 'urgent',
  status: 'Sent',
  createdAt: '2026-08-01T00:00:00.000Z',
  acceptedAt: null,
  departedAt: null,
  arrivedAt: null,
  closedAt: null,
};

const OUTGOING_REFERRAL = {
  id: 'r2',
  pregnancyEpisodeId: 'e2',
  fromFacilityId: 'f1',
  toFacilityId: 'f3',
  reasonCode: 'Routine specialist review',
  urgency: 'routine',
  status: 'Accepted',
  createdAt: '2026-08-01T00:00:00.000Z',
  acceptedAt: '2026-08-02T00:00:00.000Z',
  departedAt: null,
  arrivedAt: null,
  closedAt: null,
};

function mockFetchByDirection(incoming: unknown[], outgoing: unknown[]) {
  mockedApiFetch.mockImplementation((path: string) => {
    if (path.includes('direction=incoming')) return Promise.resolve(incoming);
    if (path.includes('direction=outgoing')) return Promise.resolve(outgoing);
    return Promise.reject(new Error(`unexpected path ${path}`));
  });
}

describe('ClinicianReferralsPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: 'f1',
      fullName: 'Dr. Njoroge',
      email: 'njoroge@example.com',
    });
  });

  it('loads incoming and outgoing referrals and only offers transition buttons on incoming rows', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], [OUTGOING_REFERRAL]);

    render(<ClinicianReferralsPage />);

    await waitFor(() => expect(screen.getByText('Suspected preeclampsia')).toBeInTheDocument());

    // 'Sent' -> valid next statuses are Accepted, Cancelled per the backend state machine.
    expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancelled' })).toBeInTheDocument();

    const outgoingRow = screen.getByText('Routine specialist review').closest('tr')!;
    expect(within(outgoingRow).queryByRole('button')).not.toBeInTheDocument();

    expect(mockedApiFetch).toHaveBeenCalledWith('/referrals?facilityId=f1&direction=incoming');
    expect(mockedApiFetch).toHaveBeenCalledWith('/referrals?facilityId=f1&direction=outgoing');
  });

  it('transitions an incoming referral to the next status and updates its row', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], []);

    render(<ClinicianReferralsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument());

    mockedApiFetch.mockResolvedValueOnce({
      ...INCOMING_REFERRAL,
      status: 'Accepted',
      acceptedAt: '2026-08-02T00:00:00.000Z',
    });

    fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/referrals/r1/status', {
        method: 'PATCH',
        body: { status: 'Accepted' },
      }),
    );
    await waitFor(() => expect(screen.getByRole('button', { name: 'Dispatched' })).toBeInTheDocument());
  });

  it('shows an error when a transition is rejected by the backend', async () => {
    mockFetchByDirection([INCOMING_REFERRAL], []);

    render(<ClinicianReferralsPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Accepted' })).toBeInTheDocument());

    class ReferralApiError extends Error {
      code = 'REFERRAL_INVALID_STATE';
      details: unknown[] = [];
      correlationId = 'corr-2';
    }
    mockedApiFetch.mockRejectedValueOnce(
      new ReferralApiError('Referral cannot transition from Sent to Accepted'),
    );

    fireEvent.click(screen.getByRole('button', { name: 'Accepted' }));

    expect(
      await screen.findByText('Referral cannot transition from Sent to Accepted'),
    ).toBeInTheDocument();
  });

  it('shows a message and never calls the API when the user has no facility assigned', async () => {
    mockedUseCurrentUser.mockReturnValue({
      id: 'u1',
      tenantId: 't1',
      role: 'clinician',
      facilityId: null,
      fullName: 'Dr. No Facility',
      email: 'nf@example.com',
    });

    render(<ClinicianReferralsPage />);

    expect(await screen.findByRole('alert')).toHaveTextContent('no facility assigned');
    expect(mockedApiFetch).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/referrals/page.test.tsx"`
Expected: FAIL — cannot find module `./page`.

- [ ] **Step 3: Implement the referral status view**

Create `frontend/app/(dashboards)/clinician/referrals/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { useCurrentUser } from '@/components/current-user-provider';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { nextValidReferralStatuses } from '@/lib/referral-state-machine';

interface Referral {
  id: string;
  pregnancyEpisodeId: string;
  fromFacilityId: string | null;
  toFacilityId: string;
  reasonCode: string;
  urgency: string;
  status: string;
  createdAt: string;
  acceptedAt: string | null;
  departedAt: string | null;
  arrivedAt: string | null;
  closedAt: string | null;
}

export default function ClinicianReferralsPage() {
  const user = useCurrentUser();
  const [incoming, setIncoming] = useState<Referral[]>([]);
  const [outgoing, setOutgoing] = useState<Referral[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [transitionError, setTransitionError] = useState<string | null>(null);
  const [transitioningId, setTransitioningId] = useState<string | null>(null);

  useEffect(() => {
    if (!user.facilityId) {
      setLoading(false);
      setError('Your account has no facility assigned. Contact an admin.');
      return;
    }

    let cancelled = false;

    Promise.all([
      apiFetch<Referral[]>(`/referrals?facilityId=${user.facilityId}&direction=incoming`),
      apiFetch<Referral[]>(`/referrals?facilityId=${user.facilityId}&direction=outgoing`),
    ])
      .then(([incomingData, outgoingData]) => {
        if (cancelled) return;
        setIncoming(incomingData);
        setOutgoing(outgoingData);
      })
      .catch((err) => {
        if (!cancelled) {
          setError(err instanceof ApiError ? err.message : 'Failed to load referrals.');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [user.facilityId]);

  async function handleTransition(referralId: string, nextStatus: string) {
    setTransitionError(null);
    setTransitioningId(referralId);
    try {
      const updated = await apiFetch<Referral>(`/referrals/${referralId}/status`, {
        method: 'PATCH',
        body: { status: nextStatus },
      });
      setIncoming((current) =>
        current.map((referral) => (referral.id === referralId ? updated : referral)),
      );
    } catch (err) {
      setTransitionError(err instanceof ApiError ? err.message : 'Failed to update referral status.');
    } finally {
      setTransitioningId(null);
    }
  }

  if (loading) {
    return <p>Loading referrals...</p>;
  }

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Referrals</h1>
      {error && (
        <p role="alert" className="text-sm text-red-600">
          {error}
        </p>
      )}
      {transitionError && (
        <p role="alert" className="text-sm text-red-600">
          {transitionError}
        </p>
      )}
      {!error && (
        <>
          <Card>
            <h2 className="text-lg font-medium">Incoming (to your facility)</h2>
            <Table>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Urgency</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {incoming.length === 0 && (
                  <tr>
                    <td colSpan={4}>No incoming referrals.</td>
                  </tr>
                )}
                {incoming.map((referral) => (
                  <tr key={referral.id}>
                    <td>{referral.reasonCode}</td>
                    <td>{referral.urgency}</td>
                    <td>{referral.status}</td>
                    <td className="space-x-2">
                      {nextValidReferralStatuses(referral.status).map((nextStatus) => (
                        <Button
                          key={nextStatus}
                          variant="secondary"
                          disabled={transitioningId === referral.id}
                          onClick={() => handleTransition(referral.id, nextStatus)}
                        >
                          {nextStatus}
                        </Button>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>

          <Card>
            <h2 className="text-lg font-medium">Outgoing (from your facility)</h2>
            <Table>
              <thead>
                <tr>
                  <th>Reason</th>
                  <th>Urgency</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {outgoing.length === 0 && (
                  <tr>
                    <td colSpan={3}>No outgoing referrals.</td>
                  </tr>
                )}
                {outgoing.map((referral) => (
                  <tr key={referral.id}>
                    <td>{referral.reasonCode}</td>
                    <td>{referral.urgency}</td>
                    <td>{referral.status}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `cd frontend && npm test -- "app/(dashboards)/clinician/referrals/page.test.tsx"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add "frontend/app/(dashboards)/clinician/referrals/"
git commit -m "feat: add clinician referral status view with state-machine-gated transitions"
```

---

## Self-Review

**Spec coverage** (design spec Section 5, Core User Flow #3, and this plan's five-point
brief):
1. Facility triage board, sorted by risk band then EDD — Task 3, using Task 1's new batch
   person lookup instead of Plan 5's raw-id workaround (called out explicitly in Task 3's
   write-up).
2. Episode detail / encounter view, with the risk assessment's `explanation` and the
   provisional-thresholds caveat surfaced prominently (not buried) — Task 5.
3. Risk override, requiring a reason client-side and surfacing backend errors — Task 6.
4. Referral creation, gated to episodes in a sensible state, with the facility picker from
   the accepting-referrals list — Task 7, gating rule documented and justified in Task 4.
5. Referral status view, both directions, with transition actions restricted to the
   receiving side and gated by the real state machine — Task 8.

**Placeholder scan:** no `TODO`, `FIXME`, or "similar to Task N" language anywhere in this
plan's code blocks. Every Step contains complete, runnable code — including Tasks 6 and 7,
which each show the full, current content of the files they modify (not a diff fragment),
specifically to avoid "similar to the previous task" hand-waving on a file that changes
three times across this plan.

**Type/DTO consistency, checked directly against Plans 2/3/4's exact Handoff sections (not
memory or assumption) — every field name below was re-read from those sections while
writing this plan:**
- `EpisodeResponseDto` fields used (`id, personId, facilityId, lmpDate,
  estimatedDeliveryDate, gestationalAgeWeeks, riskBand, status, createdAt, updatedAt`) match
  Plan 2's Handoff section exactly.
- `PersonResponseDto` fields used (`id, tenantId, firstName, lastName, phonePrimary,
  dateOfBirth`) match Plan 1 Task 9's actual `PersonResponseDto` source, re-read directly
  (not the Handoff prose, which doesn't restate this DTO — the source file itself).
- `RiskAssessmentResponseDto` fields used (`id, pregnancyEpisodeId, assessmentTime,
  ruleScore, mlScore, finalRiskBand, explanation, overriddenBy, overrideReason, status,
  createdAt`) match Plan 3's Handoff exactly — note the field is `explanation`, not
  `explanationJson`; this plan's `RiskAssessment` interface and every JSX reference use
  `explanation.ruleFactors` / `explanation.mlReasoning` / `explanation.mlDisagreement` /
  `explanation.mlError` per Plan 3's documented `explanation_json` shape.
- `OverrideRiskAssessmentDto` request body (`finalRiskBand`, `overrideReason`) matches Plan
  3's Handoff exactly, including the `@MinLength(3)` this plan's client-side check mirrors.
- `CreateReferralDto` request body (`pregnancyEpisodeId`, `toFacilityId`, `fromFacilityId?`,
  `reasonCode`, `urgency`) and `ReferralResponseDto` fields (`id, pregnancyEpisodeId,
  fromFacilityId, toFacilityId, reasonCode, urgency, status, createdAt, acceptedAt,
  departedAt, arrivedAt, closedAt`) match Plan 4's Handoff exactly.
- `REFERRAL_STATUS_TRANSITIONS`/`TERMINAL_REFERRAL_STATUSES` values in Task 4's frontend
  mirror match Plan 4's own `backend/src/referral/referral-state-machine.ts` source
  byte-for-byte (re-read directly, not summarized from the Handoff prose).
- `FacilityResponseDto` fields used (`id, tenantId, name, type, contactPhone,
  acceptingReferrals`) match Plan 1 Task 8's source.
- `AppUser` fields (`id, tenantId, role, facilityId, fullName, email`) and the
  `apiFetch`/`ApiError` shapes match Plan 5's Handoff exactly, including the exact mock
  pattern (`jest.mock('@/lib/api-client', ...)`) used in every test file in this plan.

**`ROLE_HOME_ROUTE`/Nav finding, verified rather than assumed:** this plan's brief asked for
an explicit before/after diff adding `clinician: '/clinician'` to `ROLE_HOME_ROUTE`.
Re-reading Plan 5's actual Task 7 implementation (not the brief's assumption) shows that key
already exists — Plan 5 pre-populated `clinician` and `supervisor` in that map, unlike
`admin`, which it deliberately left for Plan 8. This plan makes no change to `layout.tsx`
and says so explicitly in Task 2, rather than manufacturing a no-op "diff" to satisfy the
letter of the brief. The one real Nav change this plan needs — a second link,
`/clinician/referrals` — is a genuine addition and is shown as a real before/after diff in
Task 2.

**Backend RLS/migration check:** Task 1 adds no migration. `person_tenant_isolation`'s
existing `select` policy (`tenant_id = (select tenant_id from auth_app_user())`) filters
returned rows independent of whether the query used `.eq()` or `.in()` — verified by reading
the policy definition directly in Plan 1's migration file, not assumed from the pattern
holding for `phone`.

No issues found requiring further fixes.

## Handoff to Plan 7 (Supervisor Dashboard)

If Plan 7 (District Supervisor dashboard, not yet written) needs to show person names
anywhere (e.g. a high-risk-case list), the gap Plan 5's Task 8 originally documented is now
closed: `GET /api/v1/persons?ids=id1,id2,id3` (Task 1 of this plan) returns
`PersonResponseDto[]` for a batch of ids, RLS-scoped to the caller's tenant exactly like the
existing `?phone=` search. Plan 5's own `frontend/app/(dashboards)/frontline/page.tsx`
caseload list still uses its documented `#{personId.slice(-8)}` workaround — this plan does
not touch that file (out of scope, per this plan's brief), but whoever next edits it can
now replace the workaround with a real batch lookup call, following the exact pattern this
plan's own Task 3 (`frontend/app/(dashboards)/clinician/page.tsx`) already establishes.
