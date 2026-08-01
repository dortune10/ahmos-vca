# Admin Dashboard Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Tenant Admin's staff-management, facility-management, and
audit-log-viewing screens — the design spec's Core User Flow #6 ("Administration": manage
facilities, assign staff to facilities/roles, view audit log) and the Tenant Admin dashboard
scope from spec Section 2 ("roles, facility hierarchy, tenant configuration") — plus the
backend read/write endpoints those screens need that don't exist in any prior plan yet.

This plan has two hard prerequisites and must not be started before both are done:

1. **Plan 1 (Backend Foundation)** — this plan extends Plan 1's existing `audit`,
   `facility`, and `users` NestJS modules with new endpoints. It does not create any new
   backend module, and it assumes `SupabaseService`, `AuthGuard`, `RolesGuard`,
   `@CurrentUser()`, `AuditService.log()`, and the `facility`/`app_user`/`audit_event`
   tables and their existing RLS policies are already in place exactly as Plan 1 built them.
2. **Plan 5 (Frontend Foundation + CHW/Nurse Dashboard)** — this plan's UI lives inside the
   `frontend/` Next.js app Plan 5 scaffolds, and Task 1 below edits
   `frontend/app/(dashboards)/layout.tsx`, a file Plan 5 creates. **If an agentic worker
   reaches this plan and Plan 5 has not been executed yet, execute Plan 5 first** — Task 1
   cannot start without that file existing.

**Architecture:**

*Backend* — three new endpoints added to Plan 1's existing modules, no new NestJS modules,
no new tables:
- `GET /api/v1/audit-events?entityType=&entityId=` — Plan 1's `audit` module has
  `AuditService.log()` (a write-only method used internally by other modules) but never got
  an HTTP-facing controller at all. This plan adds `AuditController` plus
  `AuditService.list()` alongside the existing `log()` method, in the same module.
- `PATCH /api/v1/facilities/:id` — Plan 1's `facility` module only has create + list; there
  is no way to ever flip `accepting_referrals` from its `false` default after a facility is
  created, which means no facility could ever actually receive a referral in practice
  (Plan 4's referral flow needs at least one `accepting_referrals = true` facility to
  exist). This plan adds `FacilityService.update()` + a `PATCH` route to the existing
  `FacilityController`.
- `GET /api/v1/users` — Plan 1's `users` module only has admin-only create; there's no way
  to list existing staff. This plan adds `UsersService.list()` + a `GET` route to the
  existing `UsersController`.

While implementing the `PATCH /api/v1/facilities/:id` endpoint, this plan found and fixes a
real gap in Plan 1's own RLS migration (`supabase/migrations/00000000000002_core_rls_policies.sql`):
it defines a `select` policy for `facility` but **no `insert` or `update` policy at all**.
That means Plan 1's own `FacilityService.create()` (Task 8) cannot actually succeed against
a real RLS-enabled Postgres database, even though it passes Plan 1's unit test (mocked
Supabase client) and its e2e test (which only asserts a 401 for missing auth, never
exercises a real authenticated write). This plan adds one new migration
(`00000000000004_facility_admin_write_policies.sql`) with both the missing `insert` policy
(retroactively fixing Plan 1's create endpoint) and the new `update` policy this plan's
`PATCH` endpoint requires — see Global Constraints for why this is one migration, not two
separate concerns punted to different plans.

*Frontend* — four new pages under `frontend/app/(dashboards)/admin/` (`page.tsx` landing
screen, `facilities/page.tsx`, `staff/page.tsx`, `audit/page.tsx`), plus the one-line
`ROLE_HOME_ROUTE` addition that makes `/admin` reachable after login. Every page follows the
exact `apiFetch` + Supabase-session pattern Plan 5 establishes for `/frontline`: client
components that call `apiFetch<T>()` against the NestJS backend, no direct
`@supabase/supabase-js` calls from the browser for anything other than the session token
`apiFetch` itself reads. No new frontend infrastructure (no new `lib/` files, no new test
config) — only new route-segment pages and their tests.

**Tech Stack:** Backend: same as Plan 1 — Node.js 20 LTS, NestJS 10.x, TypeScript 5.x,
`@supabase/supabase-js` v2, Jest + Supertest, Supabase CLI for local Postgres + migrations.
Frontend: Next.js 14+ (App Router), TypeScript, React 18, Tailwind CSS, Jest + React Testing
Library via the `next/jest` preset Plan 5 configures.

## Global Constraints

**Backend (inherited from Plan 1 — see `docs/superpowers/plans/2026-08-01-backend-foundation.md`):**
- Backend lives in `backend/` at the repo root; Supabase config/migrations live in
  `supabase/` at the repo root.
- API base path: `/api/v1`. Every response header includes `X-Correlation-Id`. Error
  responses use the exact shape
  `{ "error": { "code": "STRING_CODE", "message": "...", "details": [], "correlationId": "uuid" } }`.
- No ORM. All Postgres access goes through `@supabase/supabase-js`. RLS policies are the
  authorization mechanism — this plan's new service methods use `getClientForUser(jwt)`,
  never `getServiceClient()`, for exactly the same reason Plan 1's `FacilityService` and
  `IdentityService` do: these are user-initiated reads/writes that RLS should scope, not
  system-triggered writes.
- Migrations are plain SQL files in `supabase/migrations/`, applied via
  `npx supabase db reset` locally, never hand-edited outside a migration file.
- **This plan adds exactly one new migration**,
  `supabase/migrations/00000000000004_facility_admin_write_policies.sql`, numbered
  sequentially after Plan 1's `00000000000001`–`00000000000003`. No other task in this plan
  needs a schema or RLS change — the audit-events and users-list endpoints are pure reads
  layered on tables and policies Plan 1 already created correctly.
- Local dev/test requires `supabase start` running before any test touching the database.
  Tests run against the local instance only.

**Frontend (fixed contract shared with Plan 5 — both plans build against this, do not
deviate):**
- Location: `frontend/` at repo root. Next.js 14+ (App Router), TypeScript, React 18,
  Tailwind CSS, no component library beyond hand-rolled `frontend/components/ui/`
  primitives (`Button`, `Input`, `Card`, `Table`, etc.).
- `frontend/lib/supabase/client.ts` exports `createClient(): SupabaseClient` (browser).
- `frontend/lib/api-client.ts` exports
  `async function apiFetch<T>(path: string, options?: { method?: string; body?: unknown }): Promise<T>`
  — attaches the Supabase session's bearer token, calls
  `${NEXT_PUBLIC_API_BASE_URL}/api/v1${path}`, throws `ApiError` (`.code`, `.message`,
  `.details`, `.correlationId`) on non-2xx. Every page in this plan imports `apiFetch` and
  `ApiError` from `@/lib/api-client` and mocks that module in tests — never mocks
  `fetch` or Supabase directly.
- `frontend/app/(dashboards)/layout.tsx` — shared layout Plan 5 builds, containing a
  `ROLE_HOME_ROUTE: Record<string, string>` map used to redirect each role to its home
  route after login. Task 1 adds one entry to it.
- Path alias: this plan assumes `@/*` resolves to the `frontend/` directory root (the
  `create-next-app` TypeScript default), matching Plan 5's `tsconfig.json`.
- Jest + React Testing Library, same `next/jest` setup Plan 5 establishes. Frontend test
  files are colocated with the page they test (`page.tsx` / `page.test.tsx`) and run via
  `cd frontend && npm test -- <path>`.
- **UI primitive assumption:** `Button`, `Input`, `Card`, and `Table` are assumed to be thin
  wrappers that render standard semantic HTML and forward standard HTML props
  (`Button`: `type`, `onClick`, `disabled`, `children`; `Input`: `label`, `value`,
  `onChange`, `type`, `placeholder`, `required`; `Card`: `children`; `Table`: `children`,
  rendering a native `<table>`). This plan's tests query rendered output by ARIA role and
  accessible label/text (`getByRole`, `getByLabelText`, `getByText`), not component
  internals, so if Plan 5's actual primitive prop names differ slightly, only this plan's
  JSX needs a small adjustment at execution time — the tests themselves stay valid.
- Do not run `git commit` or `npm install` while executing this plan's Steps unless a Step
  explicitly says to — several Steps below do end with a commit, matching Plan 1's
  convention of committing at the end of each task.

---

### Task 1: Wire `/admin` into the shared dashboard shell

**Files:**
- Modify: `frontend/app/(dashboards)/layout.tsx`
- Create: `frontend/app/(dashboards)/admin/page.tsx`
- Create: `frontend/app/(dashboards)/admin/page.test.tsx`

**Interfaces:**
- Consumes: `ROLE_HOME_ROUTE` map from `frontend/app/(dashboards)/layout.tsx` (Plan 5).
- Produces: `admin` role now redirects to `/admin` after login (previously unmapped —
  before this task, an admin user logging in has no home route to land on); `/admin`
  renders a landing screen linking to `/admin/facilities`, `/admin/staff`, `/admin/audit`.

- [ ] **Step 1: Add the `admin` entry to `ROLE_HOME_ROUTE`**

Open `frontend/app/(dashboards)/layout.tsx`. Per the design spec's routing section
(`docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md`, Section 3) and the
fixed frontend contract, Plan 5 builds this map with one entry per non-admin role:

```typescript
const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
};
```

Add exactly one line so the map becomes:

```typescript
const ROLE_HOME_ROUTE: Record<string, string> = {
  chw: '/frontline',
  nurse: '/frontline',
  clinician: '/clinician',
  supervisor: '/supervisor',
  admin: '/admin',
};
```

If Plan 5's actual map uses different key ordering, additional keys, or a different
variable name for the same purpose, add the `admin: '/admin',` line to that map instead —
the mechanical change is the same regardless of the surrounding map's exact shape.

- [ ] **Step 2: Write the failing test for the admin landing page**

Create `frontend/app/(dashboards)/admin/page.test.tsx`:

```tsx
import { render, screen } from '@testing-library/react';
import AdminHomePage from './page';

describe('AdminHomePage', () => {
  it('links to the three admin management screens', () => {
    render(<AdminHomePage />);

    expect(screen.getByRole('link', { name: /facilities/i })).toHaveAttribute(
      'href',
      '/admin/facilities',
    );
    expect(screen.getByRole('link', { name: /^staff$/i })).toHaveAttribute(
      'href',
      '/admin/staff',
    );
    expect(screen.getByRole('link', { name: /audit log/i })).toHaveAttribute(
      'href',
      '/admin/audit',
    );
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd frontend && npm test -- admin/page.test.tsx`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 4: Implement the admin landing page**

Create `frontend/app/(dashboards)/admin/page.tsx`:

```tsx
import Link from 'next/link';
import { Card } from '@/components/ui/card';

export default function AdminHomePage() {
  return (
    <div className="p-6 space-y-4">
      <h1 className="text-xl font-semibold">Admin</h1>
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <Link href="/admin/facilities">Facilities</Link>
        </Card>
        <Card>
          <Link href="/admin/staff">Staff</Link>
        </Card>
        <Card>
          <Link href="/admin/audit">Audit Log</Link>
        </Card>
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd frontend && npm test -- admin/page.test.tsx`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/layout.tsx frontend/app/\(dashboards\)/admin/page.tsx frontend/app/\(dashboards\)/admin/page.test.tsx
git commit -m "feat: add admin role home route and admin landing page"
```

---

### Task 2: `GET /api/v1/audit-events` — audit log read endpoint

**Files:**
- Create: `backend/src/audit/dto/audit-event-response.dto.ts`
- Create: `backend/src/audit/audit.controller.ts`
- Create: `backend/test/audit.e2e-spec.ts`
- Modify: `backend/src/audit/audit.service.ts`
- Modify: `backend/src/audit/audit.module.ts`
- Modify: `backend/src/audit/audit.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser` (Plan 1 Task 2), `AuthGuard`/`RolesGuard`/
  `@Roles`/`@CurrentUser` (Plan 1 Tasks 5–6), the existing `audit_event_tenant_read` RLS
  policy (Plan 1 Task 7) — no new policy needed, this is a pure read.
- Produces:
  - `AuditService.list(jwt: string, filters?: { entityType?: string; entityId?: string }): Promise<AuditEventResponseDto[]>`
  - `GET /api/v1/audit-events?entityType=&entityId=` (roles: `admin`), new `AuditController`.
  - `AuditEventResponseDto { id, tenantId, actorUserId, entityType, entityId, action, eventTime, metadata }`

- [ ] **Step 1: Write the failing service test**

Replace `backend/src/audit/audit.service.spec.ts` with (this preserves Plan 1's existing
`log` tests unchanged and appends a new `describe('list', ...)` block):

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AuditService } from './audit.service';
import { SupabaseService } from '../common/supabase/supabase.service';

describe('AuditService', () => {
  let service: AuditService;
  let insertMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockResolvedValue({ error: null });
    const fakeServiceClient = { from: () => ({ insert: insertMock }) };
    const supabaseService = {
      getServiceClient: () => fakeServiceClient,
    } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
    }).compile();

    service = module.get<AuditService>(AuditService);
  });

  it('writes an audit_event row with the given fields', async () => {
    await service.log({
      tenantId: 't1',
      actorUserId: 'u1',
      entityType: 'person',
      entityId: 'p1',
      action: 'created',
      metadata: { source: 'chw' },
    });

    expect(insertMock).toHaveBeenCalledWith({
      tenant_id: 't1',
      actor_user_id: 'u1',
      entity_type: 'person',
      entity_id: 'p1',
      action: 'created',
      metadata_json: { source: 'chw' },
    });
  });

  describe('list', () => {
    function buildQueryBuilder(rows: any[]) {
      const builder: any = {
        select: jest.fn().mockReturnThis(),
        order: jest.fn().mockReturnThis(),
        eq: jest.fn().mockReturnThis(),
        then: (resolve: any) => resolve({ data: rows, error: null }),
      };
      return builder;
    }

    it('returns audit events mapped to AuditEventResponseDto, scoped by RLS via getClientForUser', async () => {
      const row = {
        id: 'a1',
        tenant_id: 't1',
        actor_user_id: 'u1',
        entity_type: 'facility',
        entity_id: 'f1',
        action: 'created',
        event_time: '2026-08-01T00:00:00.000Z',
        metadata_json: { name: 'Test Clinic' },
      };
      const builder = buildQueryBuilder([row]);
      const getClientForUser = jest.fn().mockReturnValue({ from: () => builder });
      const supabaseService = { getClientForUser } as unknown as SupabaseService;

      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
      }).compile();
      const listService = module.get<AuditService>(AuditService);

      const result = await listService.list('jwt');

      expect(getClientForUser).toHaveBeenCalledWith('jwt');
      expect(result).toEqual([
        {
          id: 'a1',
          tenantId: 't1',
          actorUserId: 'u1',
          entityType: 'facility',
          entityId: 'f1',
          action: 'created',
          eventTime: '2026-08-01T00:00:00.000Z',
          metadata: { name: 'Test Clinic' },
        },
      ]);
      expect(builder.eq).not.toHaveBeenCalled();
    });

    it('applies entityType and entityId filters when provided', async () => {
      const builder = buildQueryBuilder([]);
      const supabaseService = {
        getClientForUser: () => ({ from: () => builder }),
      } as unknown as SupabaseService;

      const module: TestingModule = await Test.createTestingModule({
        providers: [AuditService, { provide: SupabaseService, useValue: supabaseService }],
      }).compile();
      const listService = module.get<AuditService>(AuditService);

      await listService.list('jwt', { entityType: 'facility', entityId: 'f1' });

      expect(builder.eq).toHaveBeenCalledWith('entity_type', 'facility');
      expect(builder.eq).toHaveBeenCalledWith('entity_id', 'f1');
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- audit.service.spec.ts`
Expected: FAIL — `listService.list is not a function`

- [ ] **Step 3: Implement `AuditEventResponseDto` and `AuditService.list`**

Create `backend/src/audit/dto/audit-event-response.dto.ts`:

```typescript
export class AuditEventResponseDto {
  id!: string;
  tenantId!: string;
  actorUserId!: string | null;
  entityType!: string;
  entityId!: string;
  action!: string;
  eventTime!: string;
  metadata!: Record<string, unknown>;

  static fromRow(row: any): AuditEventResponseDto {
    const dto = new AuditEventResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.actorUserId = row.actor_user_id;
    dto.entityType = row.entity_type;
    dto.entityId = row.entity_id;
    dto.action = row.action;
    dto.eventTime = row.event_time;
    dto.metadata = row.metadata_json;
    return dto;
  }
}
```

Replace `backend/src/audit/audit.service.ts` with:

```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditEventResponseDto } from './dto/audit-event-response.dto';

export interface AuditLogEntry {
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
}

export interface AuditEventFilters {
  entityType?: string;
  entityId?: string;
}

@Injectable()
export class AuditService {
  constructor(private readonly supabaseService: SupabaseService) {}

  async log(entry: AuditLogEntry): Promise<void> {
    const client = this.supabaseService.getServiceClient();
    await client.from('audit_event').insert({
      tenant_id: entry.tenantId,
      actor_user_id: entry.actorUserId,
      entity_type: entry.entityType,
      entity_id: entry.entityId,
      action: entry.action,
      metadata_json: entry.metadata,
    });
  }

  async list(jwt: string, filters?: AuditEventFilters): Promise<AuditEventResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('audit_event').select('*').order('event_time', { ascending: false });
    if (filters?.entityType) {
      query = query.eq('entity_type', filters.entityType);
    }
    if (filters?.entityId) {
      query = query.eq('entity_id', filters.entityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(AuditEventResponseDto.fromRow);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- audit.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller**

Create `backend/src/audit/audit.controller.ts`:

```typescript
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { AuditService } from './audit.service';

@Controller('audit-events')
@UseGuards(AuthGuard, RolesGuard)
export class AuditController {
  constructor(private readonly auditService: AuditService) {}

  @Get()
  @Roles('admin')
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
  ) {
    return this.auditService.list(user.jwt, { entityType, entityId });
  }
}
```

- [ ] **Step 6: Write the e2e test**

Create `backend/test/audit.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('AuditController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/audit-events').expect(401);
  });
});
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- audit.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Wire the controller into `AuditModule` and commit**

Replace `backend/src/audit/audit.module.ts` with:

```typescript
import { Global, Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';

@Global()
@Module({
  controllers: [AuditController],
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/audit/ backend/test/audit.e2e-spec.ts
git commit -m "feat: add admin-only GET /api/v1/audit-events endpoint"
```

---

### Task 3: `PATCH /api/v1/facilities/:id` — facility update endpoint

**Files:**
- Create: `supabase/migrations/00000000000004_facility_admin_write_policies.sql`
- Create: `backend/src/facility/dto/update-facility.dto.ts`
- Modify: `backend/src/facility/facility.service.ts`
- Modify: `backend/src/facility/facility.controller.ts`
- Modify: `backend/src/facility/facility.service.spec.ts`
- Modify: `backend/test/facility.e2e-spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser`, `AuditService.log()`, `AuthGuard`/
  `RolesGuard`/`@Roles`/`@CurrentUser` (all Plan 1), `FacilityResponseDto` (Plan 1 Task 8).
- Produces:
  - `FacilityService.update(jwt: string, actorUserId: string, tenantId: string, id: string, dto: UpdateFacilityDto): Promise<FacilityResponseDto>`
  - `PATCH /api/v1/facilities/:id` (roles: `admin`)
  - `UpdateFacilityDto { name?: string; type?: 'community'|'clinic'|'hospital'; contactPhone?: string; acceptingReferrals?: boolean; }`
  - New RLS policies `facility_admin_insert` and `facility_admin_update` on `facility` —
    see this task's Step 1 for why the insert policy is included here even though insert
    itself was Plan 1's endpoint, not this plan's.

- [ ] **Step 1: Write the missing facility write-policy migration**

Plan 1's RLS migration (`supabase/migrations/00000000000002_core_rls_policies.sql`) gives
`facility` a `select` policy only:

```sql
create policy "facility_tenant_isolation" on facility
  for select using (tenant_id = (select tenant_id from auth_app_user()));
```

There is no `insert` or `update` policy on `facility` anywhere in Plan 1. With RLS enabled
and no matching policy, Postgres denies the operation by default — meaning Plan 1's own
`FacilityService.create()` (which calls `.insert()` via `getClientForUser(jwt)`, not the
service-role client) cannot succeed against a real database, and this task's new
`FacilityService.update()` (`.update()` via the same user-scoped client) cannot either. Add
both policies together since they're the same root cause and the same table:

Create `supabase/migrations/00000000000004_facility_admin_write_policies.sql`:

```sql
create policy "facility_admin_insert" on facility
  for insert with check (
    tenant_id = (select tenant_id from auth_app_user())
    and (select role from auth_app_user()) = 'admin'
  );

create policy "facility_admin_update" on facility
  for update using (
    tenant_id = (select tenant_id from auth_app_user())
    and (select role from auth_app_user()) = 'admin'
  ) with check (
    tenant_id = (select tenant_id from auth_app_user())
  );
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: migration applies cleanly, no errors printed.

- [ ] **Step 3: Write the failing service test**

Add the following `describe('update', ...)` block to the end of
`backend/src/facility/facility.service.spec.ts` (append after the existing
`describe('FacilityService', ...)` block's closing `});` — i.e. as a sibling top-level
`describe`, so Plan 1's existing `create`/`list` tests and their shared `beforeEach` stay
untouched):

```typescript
describe('FacilityService.update', () => {
  it('updates a facility and writes an "updated" audit event', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'f1',
              tenant_id: 't1',
              name: 'Test Clinic',
              type: 'clinic',
              contact_phone: null,
              accepting_referrals: true,
            },
            error: null,
          }),
        }),
      }),
    });
    const fakeClient = { from: () => ({ update: updateMock }) };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const service = module.get<FacilityService>(FacilityService);

    const result = await service.update('jwt', 'admin-1', 't1', 'f1', {
      acceptingReferrals: true,
    });

    expect(result.acceptingReferrals).toBe(true);
    expect(updateMock).toHaveBeenCalledWith({ accepting_referrals: true });
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'facility', action: 'updated', entityId: 'f1' }),
    );
  });

  it('only includes fields present on the dto in the update payload', async () => {
    const updateMock = jest.fn().mockReturnValue({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'f1',
              tenant_id: 't1',
              name: 'Renamed Clinic',
              type: 'clinic',
              contact_phone: null,
              accepting_referrals: false,
            },
            error: null,
          }),
        }),
      }),
    });
    const fakeClient = { from: () => ({ update: updateMock }) };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();
    const service = module.get<FacilityService>(FacilityService);

    await service.update('jwt', 'admin-1', 't1', 'f1', { name: 'Renamed Clinic' });

    expect(updateMock).toHaveBeenCalledWith({ name: 'Renamed Clinic' });
  });
});
```

Make sure the top of `backend/src/facility/facility.service.spec.ts` still imports
`AuditService` from `'../audit/audit.service'` alongside the existing imports (Plan 1's
original file already imports it for the `create` tests).

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- facility.service.spec.ts`
Expected: FAIL — `service.update is not a function`

- [ ] **Step 5: Implement `UpdateFacilityDto` and `FacilityService.update`**

Create `backend/src/facility/dto/update-facility.dto.ts`:

```typescript
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class UpdateFacilityDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  name?: string;

  @IsOptional()
  @IsIn(['community', 'clinic', 'hospital'])
  type?: 'community' | 'clinic' | 'hospital';

  @IsOptional()
  @IsString()
  contactPhone?: string;

  @IsOptional()
  @IsBoolean()
  acceptingReferrals?: boolean;
}
```

Add this method to the `FacilityService` class in `backend/src/facility/facility.service.ts`
(alongside the existing `create` and `list` methods — add the import for
`UpdateFacilityDto` at the top of the file too):

```typescript
import { UpdateFacilityDto } from './dto/update-facility.dto';

// ...inside the FacilityService class, after list():

  async update(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    id: string,
    dto: UpdateFacilityDto,
  ): Promise<FacilityResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const patch: Record<string, unknown> = {};
    if (dto.name !== undefined) patch.name = dto.name;
    if (dto.type !== undefined) patch.type = dto.type;
    if (dto.contactPhone !== undefined) patch.contact_phone = dto.contactPhone;
    if (dto.acceptingReferrals !== undefined) patch.accepting_referrals = dto.acceptingReferrals;

    const { data, error } = await client
      .from('facility')
      .update(patch)
      .eq('id', id)
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'facility',
      entityId: data.id,
      action: 'updated',
      metadata: patch,
    });

    return FacilityResponseDto.fromRow(data);
  }
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- facility.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Add the `PATCH` route**

In `backend/src/facility/facility.controller.ts`, add `Patch` and `Param` to the
`@nestjs/common` import, add the `UpdateFacilityDto` import, and add this method to the
`FacilityController` class (after `list`):

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
// ...
import { UpdateFacilityDto } from './dto/update-facility.dto';

// ...inside the FacilityController class, after list():

  @Patch(':id')
  @Roles('admin')
  update(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateFacilityDto,
  ) {
    return this.facilityService.update(user.jwt, user.id, user.tenantId, id, dto);
  }
```

- [ ] **Step 8: Add an e2e test for the new route**

Add this test to `backend/test/facility.e2e-spec.ts`, inside the existing
`describe('FacilityController (e2e)', ...)` block, after the existing
`'rejects facility creation with no auth token'` test:

```typescript
  it('rejects facility update with no auth token', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/facilities/11111111-1111-1111-1111-111111111111')
      .send({ acceptingReferrals: true })
      .expect(401);
  });
```

- [ ] **Step 9: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- facility.e2e-spec.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/00000000000004_facility_admin_write_policies.sql backend/src/facility/ backend/test/facility.e2e-spec.ts
git commit -m "feat: add facility update endpoint and missing admin write RLS policies"
```

---

### Task 4: `GET /api/v1/users` — staff list endpoint

**Files:**
- Create: `backend/src/users/dto/staff-user-response.dto.ts`
- Create: `backend/test/users.e2e-spec.ts`
- Modify: `backend/src/users/users.service.ts`
- Modify: `backend/src/users/users.controller.ts`
- Modify: `backend/src/users/users.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser`, `AuthGuard`/`RolesGuard`/`@Roles`/
  `@CurrentUser` (Plan 1), the existing `app_user_self_and_tenant_admins` RLS policy
  (Plan 1 Task 4) — no new policy needed, admins already see their whole tenant's
  `app_user` rows under that policy.
- Produces:
  - `UsersService.list(jwt: string): Promise<StaffUserResponseDto[]>`
  - `GET /api/v1/users` (roles: `admin`)
  - `StaffUserResponseDto { id, tenantId, email, role, facilityId, fullName }`

- [ ] **Step 1: Write the failing service test**

Add the following `describe('list', ...)` block to the end of
`backend/src/users/users.service.spec.ts` (as a sibling top-level `describe`, leaving Plan
1's existing `describe('UsersService', ...)` block and its `createStaffUser` test
untouched):

```typescript
describe('UsersService.list', () => {
  it('returns staff users mapped to StaffUserResponseDto', async () => {
    const row = {
      id: 'auth-user-1',
      tenant_id: 't1',
      email: 'nurse@example.com',
      role: 'nurse',
      facility_id: 'f1',
      full_name: 'Nurse Joy',
    };
    const selectMock = jest.fn().mockResolvedValue({ data: [row], error: null });
    const fakeUserClient = { from: () => ({ select: selectMock }) };
    const supabaseService = {
      getClientForUser: jest.fn().mockReturnValue(fakeUserClient),
    } as unknown as SupabaseService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();
    const service = module.get<UsersService>(UsersService);

    const result = await service.list('jwt');

    expect(supabaseService.getClientForUser).toHaveBeenCalledWith('jwt');
    expect(result).toEqual([
      {
        id: 'auth-user-1',
        tenantId: 't1',
        email: 'nurse@example.com',
        role: 'nurse',
        facilityId: 'f1',
        fullName: 'Nurse Joy',
      },
    ]);
  });
});
```

Confirm the file's existing imports already include `Test`, `TestingModule`, `UsersService`,
`SupabaseService`, and `AuditService` (Plan 1's original file has all of these).

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- users.service.spec.ts`
Expected: FAIL — `service.list is not a function`

- [ ] **Step 3: Implement `StaffUserResponseDto` and `UsersService.list`**

Create `backend/src/users/dto/staff-user-response.dto.ts`:

```typescript
export class StaffUserResponseDto {
  id!: string;
  tenantId!: string;
  email!: string;
  role!: string;
  facilityId!: string | null;
  fullName!: string;

  static fromRow(row: any): StaffUserResponseDto {
    const dto = new StaffUserResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.email = row.email;
    dto.role = row.role;
    dto.facilityId = row.facility_id;
    dto.fullName = row.full_name;
    return dto;
  }
}
```

Add this method to the `UsersService` class in `backend/src/users/users.service.ts`
(alongside the existing `createStaffUser` — add the `StaffUserResponseDto` import at the
top of the file, note this method uses `getClientForUser`, not `getServiceClient` like
`createStaffUser` does, since listing is a plain RLS-scoped read, not an auth-admin-API
call):

```typescript
import { StaffUserResponseDto } from './dto/staff-user-response.dto';

// ...inside the UsersService class, after createStaffUser():

  async list(jwt: string): Promise<StaffUserResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('app_user').select('*');
    if (error) {
      throw error;
    }
    return (data ?? []).map(StaffUserResponseDto.fromRow);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- users.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the `GET` route**

In `backend/src/users/users.controller.ts`, add `Get` to the `@nestjs/common` import and
add this method to the `UsersController` class (after `create`):

```typescript
import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';

// ...inside the UsersController class, after create():

  @Get()
  @Roles('admin')
  list(@CurrentUser() user: CurrentUserPayload) {
    return this.usersService.list(user.jwt);
  }
```

- [ ] **Step 6: Write the e2e test**

Create `backend/test/users.e2e-spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('UsersController list (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects a request with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/users').expect(401);
  });
});
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- users.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/users/ backend/test/users.e2e-spec.ts
git commit -m "feat: add admin-only GET /api/v1/users staff list endpoint"
```

---

### Task 5: Facility management page (`admin/facilities/page.tsx`)

**Files:**
- Create: `frontend/app/(dashboards)/admin/facilities/page.tsx`
- Create: `frontend/app/(dashboards)/admin/facilities/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<Facility[]>('/facilities')`,
  `apiFetch<Facility>('/facilities', { method: 'POST', body })`,
  `apiFetch<Facility>('/facilities/:id', { method: 'PATCH', body })` — the three facility
  endpoints from Plan 1 Task 8 and this plan's Task 3.
- Produces: the admin's facility list + create-facility form + accepting-referrals toggle
  screen at `/admin/facilities`.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(dashboards)/admin/facilities/page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import FacilitiesPage from './page';
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

describe('FacilitiesPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('lists facilities returned by GET /facilities', async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'f1',
        tenantId: 't1',
        name: 'Test Clinic',
        type: 'clinic',
        contactPhone: '+254700000000',
        acceptingReferrals: false,
      },
    ]);

    render(<FacilitiesPage />);

    expect(await screen.findByText('Test Clinic')).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith('/facilities');
  });

  it('submits the create-facility form and reloads the list', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce({
        id: 'f2',
        tenantId: 't1',
        name: 'New Facility',
        type: 'clinic',
        contactPhone: null,
        acceptingReferrals: false,
      })
      .mockResolvedValueOnce([
        {
          id: 'f2',
          tenantId: 't1',
          name: 'New Facility',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: false,
        },
      ]);

    render(<FacilitiesPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'New Facility' } });
    fireEvent.click(screen.getByRole('button', { name: /create facility/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/facilities', {
        method: 'POST',
        body: { name: 'New Facility', type: 'clinic', contactPhone: undefined },
      }),
    );
    expect(await screen.findByText('New Facility')).toBeInTheDocument();
  });

  it('toggles acceptingReferrals via PATCH when the button is clicked', async () => {
    mockedApiFetch
      .mockResolvedValueOnce([
        {
          id: 'f1',
          tenantId: 't1',
          name: 'Test Clinic',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: false,
        },
      ])
      .mockResolvedValueOnce({
        id: 'f1',
        tenantId: 't1',
        name: 'Test Clinic',
        type: 'clinic',
        contactPhone: null,
        acceptingReferrals: true,
      })
      .mockResolvedValueOnce([
        {
          id: 'f1',
          tenantId: 't1',
          name: 'Test Clinic',
          type: 'clinic',
          contactPhone: null,
          acceptingReferrals: true,
        },
      ]);

    render(<FacilitiesPage />);
    await screen.findByText('Test Clinic');

    fireEvent.click(screen.getByRole('button', { name: /start accepting/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/facilities/f1', {
        method: 'PATCH',
        body: { acceptingReferrals: true },
      }),
    );
    expect(await screen.findByRole('button', { name: /stop accepting/i })).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- admin/facilities/page.test.tsx`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the facilities page**

Create `frontend/app/(dashboards)/admin/facilities/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface Facility {
  id: string;
  tenantId: string;
  name: string;
  type: 'community' | 'clinic' | 'hospital';
  contactPhone: string | null;
  acceptingReferrals: boolean;
}

const FACILITY_TYPES: Facility['type'][] = ['community', 'clinic', 'hospital'];

export default function FacilitiesPage() {
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [type, setType] = useState<Facility['type']>('clinic');
  const [contactPhone, setContactPhone] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadFacilities() {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<Facility[]>('/facilities');
      setFacilities(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load facilities');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadFacilities();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch<Facility>('/facilities', {
        method: 'POST',
        body: { name, type, contactPhone: contactPhone || undefined },
      });
      setName('');
      setContactPhone('');
      setType('clinic');
      await loadFacilities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create facility');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleToggleAcceptingReferrals(facility: Facility) {
    setError(null);
    try {
      await apiFetch<Facility>(`/facilities/${facility.id}`, {
        method: 'PATCH',
        body: { acceptingReferrals: !facility.acceptingReferrals },
      });
      await loadFacilities();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update facility');
    }
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Facilities</h1>

      {error && <p role="alert">{error}</p>}

      <Card>
        <form onSubmit={handleCreate} className="space-y-4" aria-label="Create facility">
          <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required />
          <label>
            Type
            <select value={type} onChange={(e) => setType(e.target.value as Facility['type'])}>
              {FACILITY_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </label>
          <Input
            label="Contact phone"
            value={contactPhone}
            onChange={(e) => setContactPhone(e.target.value)}
          />
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create facility'}
          </Button>
        </form>
      </Card>

      {loading ? (
        <p>Loading facilities...</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Type</th>
              <th>Contact phone</th>
              <th>Accepting referrals</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((facility) => (
              <tr key={facility.id}>
                <td>{facility.name}</td>
                <td>{facility.type}</td>
                <td>{facility.contactPhone ?? '—'}</td>
                <td>{facility.acceptingReferrals ? 'Yes' : 'No'}</td>
                <td>
                  <Button onClick={() => handleToggleAcceptingReferrals(facility)}>
                    {facility.acceptingReferrals ? 'Stop accepting' : 'Start accepting'}
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- admin/facilities/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/admin/facilities/
git commit -m "feat: add admin facility management page"
```

---

### Task 6: Staff management page (`admin/staff/page.tsx`)

**Files:**
- Create: `frontend/app/(dashboards)/admin/staff/page.tsx`
- Create: `frontend/app/(dashboards)/admin/staff/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<StaffUser[]>('/users')` (this plan's Task 4),
  `apiFetch<{id,email,role}>('/users', { method: 'POST', body })` (Plan 1 Task 10),
  `apiFetch<Facility[]>('/facilities')` (Plan 1 Task 8, used to populate the facility
  dropdown).
- Produces: the admin's staff list + create-staff-account form at `/admin/staff`, with
  `role` as a select of `chw|nurse|clinician|supervisor|admin` and `facility` as a select
  populated from the facilities list.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(dashboards)/admin/staff/page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import StaffPage from './page';
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

function setupApiFetchMock(options: { staff?: any[]; facilities?: any[] }) {
  let currentStaff = options.staff ?? [];
  const facilities = options.facilities ?? [];
  mockedApiFetch.mockImplementation(((path: string, reqOptions?: any) => {
    if (path === '/facilities') {
      return Promise.resolve(facilities);
    }
    if (path === '/users' && reqOptions?.method === 'POST') {
      const created = { id: 'new-user', ...reqOptions.body };
      currentStaff = [...currentStaff, created];
      return Promise.resolve(created);
    }
    if (path === '/users') {
      return Promise.resolve(currentStaff);
    }
    return Promise.resolve(undefined);
  }) as typeof apiFetch);
}

describe('StaffPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('lists staff with resolved facility names', async () => {
    setupApiFetchMock({
      staff: [
        {
          id: 'u1',
          tenantId: 't1',
          email: 'nurse@example.com',
          role: 'nurse',
          facilityId: 'f1',
          fullName: 'Nurse Joy',
        },
      ],
      facilities: [{ id: 'f1', name: 'Test Clinic' }],
    });

    render(<StaffPage />);

    expect(await screen.findByText('Nurse Joy')).toBeInTheDocument();
    expect(screen.getByText('Test Clinic')).toBeInTheDocument();
  });

  it('submits the create-staff form with the selected role and facility, then reloads', async () => {
    setupApiFetchMock({ staff: [], facilities: [{ id: 'f1', name: 'Test Clinic' }] });

    render(<StaffPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledWith('/facilities'));

    fireEvent.change(screen.getByLabelText('Full name'), { target: { value: 'Nurse Joy' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'nurse@example.com' } });
    fireEvent.change(screen.getByLabelText('Temporary password'), {
      target: { value: 'temp-password-123' },
    });
    fireEvent.change(screen.getByLabelText('Role'), { target: { value: 'nurse' } });
    fireEvent.change(screen.getByLabelText('Facility'), { target: { value: 'f1' } });
    fireEvent.click(screen.getByRole('button', { name: /create staff account/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/users', {
        method: 'POST',
        body: {
          email: 'nurse@example.com',
          password: 'temp-password-123',
          role: 'nurse',
          facilityId: 'f1',
          fullName: 'Nurse Joy',
        },
      }),
    );
    expect(await screen.findByText('Nurse Joy')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- admin/staff/page.test.tsx`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the staff page**

Create `frontend/app/(dashboards)/admin/staff/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card } from '@/components/ui/card';
import { Table } from '@/components/ui/table';

interface StaffUser {
  id: string;
  tenantId: string;
  email: string;
  role: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';
  facilityId: string | null;
  fullName: string;
}

interface FacilityOption {
  id: string;
  name: string;
}

const ROLES: StaffUser['role'][] = ['chw', 'nurse', 'clinician', 'supervisor', 'admin'];

export default function StaffPage() {
  const [staff, setStaff] = useState<StaffUser[]>([]);
  const [facilities, setFacilities] = useState<FacilityOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setRole] = useState<StaffUser['role']>('chw');
  const [facilityId, setFacilityId] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function loadData() {
    setLoading(true);
    setError(null);
    try {
      const [staffData, facilityData] = await Promise.all([
        apiFetch<StaffUser[]>('/users'),
        apiFetch<FacilityOption[]>('/facilities'),
      ]);
      setStaff(staffData);
      setFacilities(facilityData);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load staff');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await apiFetch('/users', {
        method: 'POST',
        body: {
          email,
          password,
          role,
          facilityId: facilityId || undefined,
          fullName,
        },
      });
      setEmail('');
      setPassword('');
      setFullName('');
      setRole('chw');
      setFacilityId('');
      await loadData();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create staff account');
    } finally {
      setSubmitting(false);
    }
  }

  function facilityName(id: string | null): string {
    if (!id) return '—';
    return facilities.find((f) => f.id === id)?.name ?? id;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Staff</h1>

      {error && <p role="alert">{error}</p>}

      <Card>
        <form onSubmit={handleCreate} className="space-y-4" aria-label="Create staff account">
          <Input
            label="Full name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          <Input
            label="Temporary password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
          <label>
            Role
            <select value={role} onChange={(e) => setRole(e.target.value as StaffUser['role'])}>
              {ROLES.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label>
            Facility
            <select value={facilityId} onChange={(e) => setFacilityId(e.target.value)}>
              <option value="">— none —</option>
              {facilities.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </label>
          <Button type="submit" disabled={submitting}>
            {submitting ? 'Creating...' : 'Create staff account'}
          </Button>
        </form>
      </Card>

      {loading ? (
        <p>Loading staff...</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Email</th>
              <th>Role</th>
              <th>Facility</th>
            </tr>
          </thead>
          <tbody>
            {staff.map((s) => (
              <tr key={s.id}>
                <td>{s.fullName}</td>
                <td>{s.email}</td>
                <td>{s.role}</td>
                <td>{facilityName(s.facilityId)}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- admin/staff/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/admin/staff/
git commit -m "feat: add admin staff management page"
```

---

### Task 7: Audit log page (`admin/audit/page.tsx`)

**Files:**
- Create: `frontend/app/(dashboards)/admin/audit/page.tsx`
- Create: `frontend/app/(dashboards)/admin/audit/page.test.tsx`

**Interfaces:**
- Consumes: `apiFetch<AuditEvent[]>('/audit-events')` and
  `apiFetch<AuditEvent[]>('/audit-events?entityType=...')` (this plan's Task 2).
- Produces: a table view of the tenant's audit log at `/admin/audit`, with an
  `entityType` filter that re-issues the request with the query param.

- [ ] **Step 1: Write the failing test**

Create `frontend/app/(dashboards)/admin/audit/page.test.tsx`:

```tsx
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import AuditLogPage from './page';
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

describe('AuditLogPage', () => {
  beforeEach(() => {
    mockedApiFetch.mockReset();
  });

  it('loads and displays audit events on mount', async () => {
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'a1',
        tenantId: 't1',
        actorUserId: 'u1',
        entityType: 'facility',
        entityId: 'f1',
        action: 'created',
        eventTime: '2026-08-01T00:00:00.000Z',
        metadata: {},
      },
    ]);

    render(<AuditLogPage />);

    expect(await screen.findByText('facility:f1')).toBeInTheDocument();
    expect(mockedApiFetch).toHaveBeenCalledWith('/audit-events');
  });

  it('refetches with an entityType query param when the filter form is submitted', async () => {
    mockedApiFetch.mockResolvedValueOnce([]);
    mockedApiFetch.mockResolvedValueOnce([
      {
        id: 'a2',
        tenantId: 't1',
        actorUserId: null,
        entityType: 'app_user',
        entityId: 'u2',
        action: 'created',
        eventTime: '2026-08-01T01:00:00.000Z',
        metadata: {},
      },
    ]);

    render(<AuditLogPage />);
    await waitFor(() => expect(mockedApiFetch).toHaveBeenCalledTimes(1));

    fireEvent.change(screen.getByLabelText('Entity type'), { target: { value: 'app_user' } });
    fireEvent.click(screen.getByRole('button', { name: /filter/i }));

    await waitFor(() =>
      expect(mockedApiFetch).toHaveBeenCalledWith('/audit-events?entityType=app_user'),
    );
    expect(await screen.findByText('app_user:u2')).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && npm test -- admin/audit/page.test.tsx`
Expected: FAIL — cannot find module `./page`

- [ ] **Step 3: Implement the audit log page**

Create `frontend/app/(dashboards)/admin/audit/page.tsx`:

```tsx
'use client';

import { useEffect, useState } from 'react';
import { apiFetch, ApiError } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table } from '@/components/ui/table';

interface AuditEvent {
  id: string;
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  eventTime: string;
  metadata: Record<string, unknown>;
}

export default function AuditLogPage() {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [entityTypeFilter, setEntityTypeFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function loadEvents(entityType: string) {
    setLoading(true);
    setError(null);
    try {
      const query = entityType ? `?entityType=${encodeURIComponent(entityType)}` : '';
      const data = await apiFetch<AuditEvent[]>(`/audit-events${query}`);
      setEvents(data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadEvents('');
    // Intentionally runs once on mount; the filter form triggers subsequent loads.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleFilterSubmit(e: React.FormEvent) {
    e.preventDefault();
    loadEvents(entityTypeFilter);
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-xl font-semibold">Audit Log</h1>

      {error && <p role="alert">{error}</p>}

      <form onSubmit={handleFilterSubmit} className="flex items-end gap-2" aria-label="Filter audit log">
        <Input
          label="Entity type"
          value={entityTypeFilter}
          onChange={(e) => setEntityTypeFilter(e.target.value)}
          placeholder="e.g. facility"
        />
        <Button type="submit">Filter</Button>
      </form>

      {loading ? (
        <p>Loading audit log...</p>
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Time</th>
              <th>Actor</th>
              <th>Entity</th>
              <th>Action</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>{new Date(event.eventTime).toLocaleString()}</td>
                <td>{event.actorUserId ?? 'system'}</td>
                <td>
                  {event.entityType}:{event.entityId}
                </td>
                <td>{event.action}</td>
              </tr>
            ))}
          </tbody>
        </Table>
      )}
    </div>
  );
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && npm test -- admin/audit/page.test.tsx`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add frontend/app/\(dashboards\)/admin/audit/
git commit -m "feat: add admin audit log page"
```

---

## Definition of Done / Self-Review

**Spec coverage** (design spec Section 5, Flow 6 — "Administration": manage facilities,
assign staff to facilities/roles, view audit log; Section 2 — Tenant Admin dashboard scope:
"roles, facility hierarchy, tenant configuration"):

| Requirement | Covered by |
|---|---|
| Manage facilities (create) | Task 5, `POST /facilities` (Plan 1, already existed) |
| Manage facilities (list) | Task 5, `GET /facilities` (Plan 1, already existed) |
| Manage facilities (toggle accepting referrals) | Task 3 + Task 5, new `PATCH /facilities/:id` |
| Assign staff to facilities/roles | Task 6, `POST /users` (Plan 1) with role + facility selects set at account creation |
| View audit log | Task 2 + Task 7, new `GET /audit-events` |
| "Roles" (Section 2) | `app_user.role` is a fixed DB check-constraint enum (`chw`/`nurse`/`clinician`/`supervisor`/`admin`), not a separately configurable entity — the staff-creation role dropdown (Task 6) is the full extent of "roles" management for this MVP; no separate roles-config screen exists because there is no `roles` table to configure |

**Known, accepted gaps** (not silently dropped — flagged here, matching the "log all
decisions" convention `docs/DECISIONS.md` already uses for this project):
- **Reassigning an already-created staff member's role or facility** (an
  `PATCH /api/v1/users/:id`) is not built in this plan. Task 6 only covers creating new
  staff accounts with a role/facility fixed at creation time, per this plan's exact task
  scope as specified. A future plan would need to add that endpoint plus an edit action on
  the staff table row.
- **"Facility hierarchy"** (spec Section 2) has no corresponding field in the approved data
  model (`facility` has no `parent_facility_id` or similar) — this is a pre-existing gap
  between the spec's Tenant Admin scope description and Section 4's Data Model table, not
  something introduced or fixable by this plan without a schema change outside this plan's
  scope. Flagging it here rather than building an ungrounded hierarchy UI against a
  nonexistent column.

**Placeholder scan:** no `TODO`, no `FIXME`, no "similar to Task N" deferrals anywhere in
this document — every task has complete, runnable code for both its failing and passing
states.

**Type consistency check** (backend DTO → frontend TS interface, field-by-field):
- `FacilityResponseDto` (Plan 1) / `UpdateFacilityDto` (Task 3) ↔ frontend `Facility`
  (Task 5): `id/tenantId/name/type/contactPhone/acceptingReferrals` match exactly.
- `StaffUserResponseDto` (Task 4) / `CreateStaffUserDto` (Plan 1) ↔ frontend `StaffUser`
  (Task 6): `id/tenantId/email/role/facilityId/fullName` match exactly.
- `AuditEventResponseDto` (Task 2) ↔ frontend `AuditEvent` (Task 7):
  `id/tenantId/actorUserId/entityType/entityId/action/eventTime/metadata` match exactly.

**New backend endpoints added by this plan (none existed before this plan):**
1. `GET /api/v1/audit-events?entityType=&entityId=` (roles: `admin`) — Task 2.
2. `PATCH /api/v1/facilities/:id` (roles: `admin`) — Task 3.
3. `GET /api/v1/users` (roles: `admin`) — Task 4.

Plus one new migration, `00000000000004_facility_admin_write_policies.sql` (Task 3), fixing
Plan 1's missing `facility` insert/update RLS policies.
