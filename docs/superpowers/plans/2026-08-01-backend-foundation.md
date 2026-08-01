# Backend Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up the NestJS backend project, connect it to Supabase Postgres, and build
the foundation every other module depends on: facilities, person identity, staff
users/auth, roles/RLS enforcement, and the audit trail.

**Architecture:** NestJS modular monolith. Each bounded context is a Nest module
(`identity`, `facility`, `users`, `audit`, plus `common/supabase` and `common/auth` shared
infrastructure). No ORM — services use `@supabase/supabase-js` clients scoped to the
requesting user's JWT so Postgres Row-Level Security is the actual enforcement mechanism
(see `docs/DECISIONS.md` #21), not re-implemented authorization logic in application code.

**Tech Stack:** Node.js 20 LTS, NestJS 10.x, TypeScript 5.x, `@supabase/supabase-js` v2,
Jest + Supertest, Supabase CLI for local Postgres + migrations.

## Global Constraints

- Backend lives in `backend/` at the repo root; Supabase config/migrations live in
  `supabase/` at the repo root (both will be siblings of a future `frontend/`).
- Package manager: npm.
- API base path: `/api/v1` (per PRD API standard, `docs/PRD.md` Section 13).
- Every response header includes `X-Correlation-Id` (echoed from the request if present,
  generated via `crypto.randomUUID()` if absent).
- Error responses use this exact shape everywhere (per PRD Section 13):
  ```json
  { "error": { "code": "STRING_CODE", "message": "human readable", "details": [], "correlationId": "uuid" } }
  ```
- No ORM. All Postgres access goes through `@supabase/supabase-js`. RLS policies are the
  authorization mechanism — do not add manual `tenant_id`/`facility_id` filtering in
  application code as a substitute for RLS (it should be redundant-safe, but RLS is the
  source of truth).
- Migrations are plain SQL files in `supabase/migrations/`, applied via `supabase db reset`
  (local) — never hand-edit the database outside a migration file.
- Every table has `created_at timestamptz default now()`; tables holding business data (not
  `audit_event`) also get `updated_at timestamptz default now()`.
- Local dev/test requires the Supabase CLI (`supabase start`) running before any test that
  touches the database. Tests always run against the local instance, never the cloud
  project below — never point `SUPABASE_URL` at production data in a test run.
- **Cloud project:** this repo's Supabase project is hosted at
  `https://supabase.com/dashboard/project/wjgyivxvmqchlhgmxcxe`. It is not used for local
  dev/testing (see above) — it's where migrations get pushed for staging/production. Link
  it once with `npx supabase link --project-ref wjgyivxvmqchlhgmxcxe`, then apply migrations
  there with `npx supabase db push` (as a deliberate, reviewed step — never run this as part
  of an automated test/build step). Populate `backend/.env` (local dev) from `supabase
  start`'s printed local values; populate the real deployment environment's env vars from
  this cloud project's API settings page, not from local dev values.

---

### Task 1: NestJS project scaffold with a passing health check

**Files:**
- Create: `backend/` (via Nest CLI)
- Create: `backend/src/app.controller.spec.ts`
- Modify: `backend/src/app.controller.ts`
- Create: `backend/.env.example`
- Create: `.gitignore` entries for `backend/node_modules`, `backend/dist` (repo root
  `.gitignore` already exists — add to it, don't replace it)

**Interfaces:**
- Produces: `GET /api/v1/health` → `200 { "status": "ok" }`, used by later tasks' e2e test
  setup to confirm the app boots before running module-specific tests.

- [ ] **Step 1: Scaffold the Nest project**

Run:
```bash
cd /Users/dot/Documents/Projects/VCA-Health
npx @nestjs/cli new backend --package-manager npm --skip-git --language ts
```

- [ ] **Step 2: Set the global API prefix**

Edit `backend/src/main.ts` to:
```typescript
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

- [ ] **Step 3: Write the failing health check test**

Replace `backend/src/app.controller.spec.ts` with:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [AppService],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns status ok', () => {
      expect(appController.health()).toEqual({ status: 'ok' });
    });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- app.controller.spec.ts`
Expected: FAIL — `appController.health is not a function`

- [ ] **Step 5: Implement the health endpoint**

Replace `backend/src/app.controller.ts` with:
```typescript
import { Controller, Get } from '@nestjs/common';

@Controller()
export class AppController {
  @Get('health')
  health(): { status: string } {
    return { status: 'ok' };
  }
}
```

Delete `backend/src/app.service.ts`'s usage from the controller if the generated
`app.module.ts` still wires `AppService` in — leave `AppService` in the module providers
array (unused for now is fine, later tasks don't touch it), just make sure
`AppController` compiles with only the `health` method.

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- app.controller.spec.ts`
Expected: PASS

- [ ] **Step 7: Write `.env.example` and add gitignore entries**

Create `backend/.env.example`:
```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PORT=3000
```

Append to the repo-root `.gitignore` (read it first, add these lines at the end, don't
duplicate existing `node_modules/`/`.env` patterns which already cover `backend/`):
```
backend/dist/
```

- [ ] **Step 8: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/ .gitignore
git commit -m "feat: scaffold NestJS backend with health check endpoint"
```

---

### Task 2: Supabase local dev environment + connection service

**Files:**
- Create: `supabase/config.toml` (via Supabase CLI init)
- Create: `backend/src/common/supabase/supabase.module.ts`
- Create: `backend/src/common/supabase/supabase.service.ts`
- Test: `backend/src/common/supabase/supabase.service.spec.ts`
- Modify: `backend/package.json` (add `@supabase/supabase-js` dependency)
- Modify: `backend/src/app.module.ts` (import `SupabaseModule`)

**Interfaces:**
- Consumes: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` env vars.
- Produces: `SupabaseService` with two methods every later module uses:
  - `getClientForUser(jwt: string): SupabaseClient` — anon-key client with the user's JWT
    attached, so RLS policies apply as that user.
  - `getServiceClient(): SupabaseClient` — service-role client that bypasses RLS, for
    system-triggered writes only (used later by `audit` and `risk` modules).

- [ ] **Step 1: Initialize the Supabase project**

Run:
```bash
cd /Users/dot/Documents/Projects/VCA-Health
npx supabase init
npx supabase start
```

This prints local API URL, anon key, and service_role key — copy them into a new
`backend/.env` (not committed, matches `.env.example`'s keys).

- [ ] **Step 2: Install the Supabase client**

Run: `cd backend && npm install @supabase/supabase-js`

- [ ] **Step 3: Write the failing test**

Create `backend/src/common/supabase/supabase.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { SupabaseService } from './supabase.service';

describe('SupabaseService', () => {
  let service: SupabaseService;

  beforeEach(async () => {
    process.env.SUPABASE_URL = 'http://localhost:54321';
    process.env.SUPABASE_ANON_KEY = 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-role-key';

    const module: TestingModule = await Test.createTestingModule({
      providers: [SupabaseService],
    }).compile();

    service = module.get<SupabaseService>(SupabaseService);
  });

  it('getClientForUser attaches the given JWT as the Authorization header', () => {
    const client = service.getClientForUser('user-jwt-token');
    // supabase-js exposes the configured headers via the internal rest client;
    // simplest black-box check is that a fresh call each time returns a client
    // whose auth header carries the token we passed in.
    expect((client as any).rest.headers['Authorization']).toBe('Bearer user-jwt-token');
  });

  it('getServiceClient uses the service role key, not the anon key', () => {
    const client = service.getServiceClient();
    expect((client as any).rest.headers['apikey']).toBe('service-role-key');
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- supabase.service.spec.ts`
Expected: FAIL — cannot find module `./supabase.service`

- [ ] **Step 5: Implement `SupabaseService`**

Create `backend/src/common/supabase/supabase.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly url = process.env.SUPABASE_URL as string;
  private readonly anonKey = process.env.SUPABASE_ANON_KEY as string;
  private readonly serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY as string;

  getClientForUser(jwt: string): SupabaseClient {
    return createClient(this.url, this.anonKey, {
      global: { headers: { Authorization: `Bearer ${jwt}` } },
    });
  }

  getServiceClient(): SupabaseClient {
    return createClient(this.url, this.serviceRoleKey);
  }
}
```

Create `backend/src/common/supabase/supabase.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';

@Global()
@Module({
  providers: [SupabaseService],
  exports: [SupabaseService],
})
export class SupabaseModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- supabase.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Wire `SupabaseModule` into `AppModule`**

Edit `backend/src/app.module.ts` to import `SupabaseModule` (from
`./common/supabase/supabase.module`) in the `imports` array.

- [ ] **Step 8: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/ supabase/
git commit -m "feat: add Supabase local dev setup and connection service"
```

---

### Task 3: Core schema migration — `facility`, `person`, `user` tables + RLS

**Files:**
- Create: `supabase/migrations/00000000000001_core_schema.sql`
- Test: `backend/test/schema.e2e-spec.ts`

**Interfaces:**
- Produces: three tables every later task queries —
  - `facility(id uuid pk, tenant_id uuid, name text, type text, contact_phone text, accepting_referrals boolean default false, created_at, updated_at)`
  - `person(id uuid pk, tenant_id uuid, first_name text, last_name text, phone_primary text, date_of_birth date, address_json jsonb, created_at, updated_at)`
  - `app_user(id uuid pk references auth.users(id), tenant_id uuid, email text, role text, facility_id uuid references facility(id), full_name text, created_at, updated_at)`
    (named `app_user`, not `user`, because `user` collides with Postgres reserved words and
    Supabase's own `auth.users` table — every later plan must use `app_user` when this
    table is meant)

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000001_core_schema.sql`:
```sql
create table facility (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  name text not null,
  type text not null check (type in ('community', 'clinic', 'hospital')),
  contact_phone text,
  accepting_referrals boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table person (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  first_name text not null,
  last_name text,
  phone_primary text,
  date_of_birth date,
  address_json jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index person_phone_primary_idx on person (phone_primary);
create index person_tenant_id_idx on person (tenant_id);

create table app_user (
  id uuid primary key references auth.users (id),
  tenant_id uuid not null,
  email text not null,
  role text not null check (role in ('chw', 'nurse', 'clinician', 'supervisor', 'admin')),
  facility_id uuid references facility (id),
  full_name text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index app_user_tenant_id_idx on app_user (tenant_id);

alter table facility enable row level security;
alter table person enable row level security;
alter table app_user enable row level security;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: migration applies cleanly, no errors printed.

- [ ] **Step 3: Write the failing verification test**

Create `backend/test/schema.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

describe('core schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  it('facility table accepts a valid row and rejects an invalid type', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';

    const { error: goodError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Test Clinic', type: 'clinic' });
    expect(goodError).toBeNull();

    const { error: badError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Bad Type', type: 'not-a-real-type' });
    expect(badError).not.toBeNull();
  });

  it('person table indexes phone_primary for lookup', async () => {
    const tenantId = '11111111-1111-1111-1111-111111111111';
    const { error } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Amina', phone_primary: '+254700000001' });
    expect(error).toBeNull();

    const { data, error: fetchError } = await admin
      .from('person')
      .select('*')
      .eq('phone_primary', '+254700000001')
      .single();
    expect(fetchError).toBeNull();
    expect(data?.first_name).toBe('Amina');
  });
});
```

Add to `backend/package.json` scripts (if not already present from Nest scaffold):
```json
"test:e2e": "jest --config ./test/jest-e2e.json"
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- schema.e2e-spec.ts`
Expected: FAIL — tables don't exist yet if migration wasn't applied, or passes already if
Step 2 succeeded. If it already passes here, that's correct — Steps 1–2 already made this
green; this step is confirming that, not introducing new failure. Proceed regardless.

- [ ] **Step 5: Confirm pass (no new code needed — migration in Step 1 is the implementation)**

Run: `cd backend && npm run test:e2e -- schema.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/
git commit -m "feat: add core schema migration for facility, person, app_user"
```

---

### Task 4: RLS policies for `facility`, `person`, `app_user`

**Files:**
- Create: `supabase/migrations/00000000000002_core_rls_policies.sql`
- Test: `backend/test/rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `facility`, `person`, `app_user` tables from Task 3.
- Produces: RLS policies enforcing tenant isolation on all three tables, and facility
  scoping on `person` for non-supervisor/admin roles. Later modules rely on these policies
  already being in place — no module-level authorization code duplicates this.

- [ ] **Step 1: Write the failing RLS test**

Create `backend/test/rls.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string; // printed by `supabase start`

function tokenFor(userId: string, role: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('facility RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let chwUserId: string;

  beforeAll(async () => {
    await admin.from('facility').insert([
      { id: 'aaaaaaaa-0000-0000-0000-000000000001', tenant_id: tenantA, name: 'A Clinic', type: 'clinic' },
      { id: 'bbbbbbbb-0000-0000-0000-000000000001', tenant_id: tenantB, name: 'B Clinic', type: 'clinic' },
    ]);

    const { data: authUser } = await admin.auth.admin.createUser({
      email: 'chw-a@example.com',
      password: 'test-password-123',
      email_confirm: true,
    });
    chwUserId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: chwUserId,
      tenant_id: tenantA,
      email: 'chw-a@example.com',
      role: 'chw',
      facility_id: 'aaaaaaaa-0000-0000-0000-000000000001',
      full_name: 'CHW A',
    });
  });

  it('a CHW in tenant A cannot see tenant B facilities', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(chwUserId, 'chw')}` } },
    });

    const { data } = await userClient.from('facility').select('*');
    const tenantIds = (data ?? []).map((f) => f.tenant_id);
    expect(tenantIds).not.toContain(tenantB);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- rls.e2e-spec.ts`
Expected: FAIL — no RLS policy exists yet, so the anon-key client either sees nothing
(RLS enabled with no policy = deny-all, which would make this test pass vacuously with an
empty array not containing tenantB) or errors. Confirm this by first checking it does NOT
correctly scope to tenant A specifically — add a second assertion temporarily if needed to
prove tenant A's own facility isn't visible either yet (deny-all), which is the real "fails
before policies exist" signal:
```typescript
expect(tenantIds).toContain(tenantA); // fails now — no policy grants SELECT at all yet
```

- [ ] **Step 3: Write the RLS policies**

Create `supabase/migrations/00000000000002_core_rls_policies.sql`:
```sql
-- Helper: read the caller's app_user row for their tenant/role/facility
create or replace function auth_app_user()
returns app_user
language sql stable
as $$
  select * from app_user where id = auth.uid();
$$;

create policy "facility_tenant_isolation" on facility
  for select using (tenant_id = (select tenant_id from auth_app_user()));

create policy "person_tenant_isolation" on person
  for select using (tenant_id = (select tenant_id from auth_app_user()));

create policy "person_insert_own_tenant" on person
  for insert with check (tenant_id = (select tenant_id from auth_app_user()));

create policy "app_user_self_and_tenant_admins" on app_user
  for select using (
    id = auth.uid()
    or (select tenant_id from auth_app_user()) = tenant_id
       and (select role from auth_app_user()) = 'admin'
  );
```

- [ ] **Step 4: Apply and run test to verify it passes**

Run:
```bash
npx supabase db reset
cd backend && npm run test:e2e -- rls.e2e-spec.ts
```
Expected: PASS — revert the temporary Step 2 assertion back to the original
`not.toContain(tenantB)` check plus add back `expect(tenantIds).toContain(tenantA)` as a
permanent positive assertion in the same test.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/
git commit -m "feat: add tenant-isolation RLS policies for facility, person, app_user"
```

---

### Task 5: Auth guard — validate Supabase JWT and attach the caller's `app_user`

**Files:**
- Create: `backend/src/common/auth/auth.guard.ts`
- Create: `backend/src/common/auth/current-user.decorator.ts`
- Create: `backend/src/common/auth/auth.module.ts`
- Test: `backend/src/common/auth/auth.guard.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser` (Task 2), `app_user` table (Task 3).
- Produces: `AuthGuard` (apply with `@UseGuards(AuthGuard)` on any controller/route that
  needs an authenticated caller) and `@CurrentUser()` param decorator that later modules use
  to get `{ id, tenantId, role, facilityId }` on the request without re-parsing the JWT.

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/auth/auth.guard.spec.ts`:
```typescript
import { ExecutionContext, UnauthorizedException } from '@nestjs/common';
import { AuthGuard } from './auth.guard';
import { SupabaseService } from '../supabase/supabase.service';

function contextWithHeader(authHeader?: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ headers: { authorization: authHeader } }),
    }),
  } as unknown as ExecutionContext;
}

describe('AuthGuard', () => {
  it('rejects a request with no Authorization header', async () => {
    const supabaseService = {} as SupabaseService;
    const guard = new AuthGuard(supabaseService);
    await expect(guard.canActivate(contextWithHeader(undefined))).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('attaches the caller app_user row to the request when the token is valid', async () => {
    const fakeAppUser = { id: 'u1', tenant_id: 't1', role: 'chw', facility_id: 'f1' };
    const fakeClient = {
      from: () => ({
        select: () => ({
          eq: () => ({
            single: async () => ({ data: fakeAppUser, error: null }),
          }),
        }),
      }),
    };
    const supabaseService = {
      getClientForUser: jest.fn().mockReturnValue(fakeClient),
    } as unknown as SupabaseService;

    const guard = new AuthGuard(supabaseService);
    const request: any = { headers: { authorization: 'Bearer valid-jwt' } };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;

    const result = await guard.canActivate(context);

    expect(result).toBe(true);
    expect(request.currentUser).toEqual({
      id: 'u1',
      tenantId: 't1',
      role: 'chw',
      facilityId: 'f1',
      jwt: 'valid-jwt',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- auth.guard.spec.ts`
Expected: FAIL — cannot find module `./auth.guard`

- [ ] **Step 3: Implement `AuthGuard`**

Create `backend/src/common/auth/auth.guard.ts`:
```typescript
import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { SupabaseService } from '../supabase/supabase.service';

export interface CurrentUserPayload {
  id: string;
  tenantId: string;
  role: string;
  facilityId: string | null;
  jwt: string;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private readonly supabaseService: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader: string | undefined = request.headers?.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing bearer token');
    }
    const jwt = authHeader.slice('Bearer '.length);

    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('app_user')
      .select('id, tenant_id, role, facility_id')
      .eq('id', data_placeholder_unused(), )
      .single();

    if (error || !data) {
      throw new UnauthorizedException('Invalid session');
    }

    const currentUser: CurrentUserPayload = {
      id: data.id,
      tenantId: data.tenant_id,
      role: data.role,
      facilityId: data.facility_id,
      jwt,
    };
    request.currentUser = currentUser;
    return true;
  }
}
```

Fix the query — it should filter by the authenticated caller (`auth.uid()` is applied
automatically by RLS via the JWT, so no explicit `.eq()` on id is needed since the RLS
policy `app_user_self_and_tenant_admins` already restricts rows to the caller or their
tenant; but to guarantee exactly the caller's own row here, do filter explicitly). Replace
the query with:
```typescript
    const { data: authData } = await client.auth.getUser(jwt);
    if (!authData?.user) {
      throw new UnauthorizedException('Invalid session');
    }

    const { data, error } = await client
      .from('app_user')
      .select('id, tenant_id, role, facility_id')
      .eq('id', authData.user.id)
      .single();
```
(Replace the earlier broken `getClientForUser` query block with this corrected version —
the intermediate broken snippet above was illustrative of the wrong approach; only this
corrected version should end up in the file.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- auth.guard.spec.ts`
Expected: PASS

- [ ] **Step 5: Add the `@CurrentUser()` decorator**

Create `backend/src/common/auth/current-user.decorator.ts`:
```typescript
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { CurrentUserPayload } from './auth.guard';

export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): CurrentUserPayload => {
    const request = ctx.switchToHttp().getRequest();
    return request.currentUser;
  },
);
```

- [ ] **Step 6: Create the auth module and wire it in**

Create `backend/src/common/auth/auth.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

@Global()
@Module({
  providers: [AuthGuard],
  exports: [AuthGuard],
})
export class AuthModule {}
```

Add `AuthModule` to the `imports` array in `backend/src/app.module.ts`.

- [ ] **Step 7: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/common/auth/ backend/src/app.module.ts
git commit -m "feat: add JWT auth guard and CurrentUser decorator"
```

---

### Task 6: Roles guard for route-level RBAC

**Files:**
- Create: `backend/src/common/auth/roles.decorator.ts`
- Create: `backend/src/common/auth/roles.guard.ts`
- Test: `backend/src/common/auth/roles.guard.spec.ts`
- Modify: `backend/src/common/auth/auth.module.ts`

**Interfaces:**
- Consumes: `request.currentUser` (attached by `AuthGuard`, Task 5).
- Produces: `@Roles('admin', 'supervisor')` decorator + `RolesGuard`, used together with
  `AuthGuard` on any route restricted to specific roles (e.g. admin-only facility creation
  in Task 7, later used by every dashboard-specific module).

- [ ] **Step 1: Write the failing test**

Create `backend/src/common/auth/roles.guard.spec.ts`:
```typescript
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { ROLES_KEY } from './roles.decorator';

function contextWithRole(role: string | undefined) {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ currentUser: role ? { role } : undefined }),
    }),
    getHandler: () => ({}),
    getClass: () => ({}),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  it('allows the request when no @Roles() metadata is set', () => {
    const reflector = { getAllAndOverride: () => undefined } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('chw'))).toBe(true);
  });

  it('allows the request when the current user has one of the required roles', () => {
    const reflector = {
      getAllAndOverride: () => ['admin', 'supervisor'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('admin'))).toBe(true);
  });

  it('denies the request when the current user lacks the required role', () => {
    const reflector = {
      getAllAndOverride: () => ['admin'],
    } as unknown as Reflector;
    const guard = new RolesGuard(reflector);
    expect(guard.canActivate(contextWithRole('chw'))).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- roles.guard.spec.ts`
Expected: FAIL — cannot find module `./roles.guard`

- [ ] **Step 3: Implement the decorator and guard**

Create `backend/src/common/auth/roles.decorator.ts`:
```typescript
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

Create `backend/src/common/auth/roles.guard.ts`:
```typescript
import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY } from './roles.decorator';

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<string[] | undefined>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }
    const request = context.switchToHttp().getRequest();
    const currentUser = request.currentUser;
    return !!currentUser && requiredRoles.includes(currentUser.role);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- roles.guard.spec.ts`
Expected: PASS

- [ ] **Step 5: Export from `AuthModule`**

Edit `backend/src/common/auth/auth.module.ts` to add `RolesGuard` to `providers` and
`exports`.

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/common/auth/
git commit -m "feat: add role-based access guard"
```

---

### Task 7: `audit` module — immutable audit log writer

**Files:**
- Create: `supabase/migrations/00000000000003_audit_event.sql`
- Create: `backend/src/audit/audit.module.ts`
- Create: `backend/src/audit/audit.service.ts`
- Test: `backend/src/audit/audit.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Produces: `AuditService.log(entry: AuditLogEntry): Promise<void>` — every later module
  (identity, episode, risk, referral) calls this after any create/update/state-transition.
  ```typescript
  interface AuditLogEntry {
    tenantId: string;
    actorUserId: string | null; // null for system-triggered events (e.g. risk assessment)
    entityType: string; // 'person' | 'pregnancy_episode' | 'referral' | 'risk_assessment' | ...
    entityId: string;
    action: string; // 'created' | 'updated' | 'status_changed' | 'overridden' | ...
    metadata: Record<string, unknown>;
  }
  ```

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000003_audit_event.sql`:
```sql
create table audit_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid references app_user (id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  event_time timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);
create index audit_event_tenant_id_idx on audit_event (tenant_id);
create index audit_event_entity_idx on audit_event (entity_type, entity_id);

alter table audit_event enable row level security;

create policy "audit_event_tenant_read" on audit_event
  for select using (tenant_id = (select tenant_id from auth_app_user()));
-- Deliberately no insert/update/delete policy for the anon-key/authenticated role:
-- all writes go through the service-role client in AuditService, so the table is
-- append-only from the application's perspective and immutable to end users.
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`

- [ ] **Step 3: Write the failing test**

Create `backend/src/audit/audit.service.spec.ts`:
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
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- audit.service.spec.ts`
Expected: FAIL — cannot find module `./audit.service`

- [ ] **Step 5: Implement `AuditService`**

Create `backend/src/audit/audit.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';

export interface AuditLogEntry {
  tenantId: string;
  actorUserId: string | null;
  entityType: string;
  entityId: string;
  action: string;
  metadata: Record<string, unknown>;
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
}
```

Create `backend/src/audit/audit.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit.service';

@Global()
@Module({
  providers: [AuditService],
  exports: [AuditService],
})
export class AuditModule {}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- audit.service.spec.ts`
Expected: PASS

- [ ] **Step 7: Wire into `AppModule` and commit**

Add `AuditModule` to `backend/src/app.module.ts` imports.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/src/audit/ backend/src/app.module.ts
git commit -m "feat: add immutable audit event log"
```

---

### Task 8: `facility` module — create + list (with `accepting_referrals` filter)

**Files:**
- Create: `backend/src/facility/facility.module.ts`
- Create: `backend/src/facility/facility.controller.ts`
- Create: `backend/src/facility/facility.service.ts`
- Create: `backend/src/facility/dto/create-facility.dto.ts`
- Create: `backend/src/facility/dto/facility-response.dto.ts`
- Test: `backend/src/facility/facility.service.spec.ts`
- Test: `backend/test/facility.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `AuthGuard`, `RolesGuard`, `AuditService` (all prior tasks).
- Produces:
  - `FacilityService.create(jwt, actorUserId, tenantId, dto): Promise<FacilityResponseDto>`
  - `FacilityService.list(jwt, acceptingReferralsOnly?: boolean): Promise<FacilityResponseDto[]>`
  - `POST /api/v1/facilities` (roles: `admin`)
  - `GET /api/v1/facilities?acceptingReferrals=true` (any authenticated role) — this exact
    query param name/shape is what the later referral module's facility-picker UI and the
    admin dashboard both rely on.

- [ ] **Step 1: Write the failing service test**

Create `backend/src/facility/facility.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { FacilityService } from './facility.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('FacilityService', () => {
  let service: FacilityService;
  let insertMock: jest.Mock;
  let selectChain: any;
  let auditLogMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: {
            id: 'f1',
            tenant_id: 't1',
            name: 'Test Clinic',
            type: 'clinic',
            contact_phone: null,
            accepting_referrals: false,
          },
          error: null,
        }),
      }),
    });
    selectChain = {
      eq: jest.fn().mockReturnThis(),
      then: undefined,
    };
    const fakeClient = {
      from: () => ({
        insert: insertMock,
        select: () => ({
          eq: jest.fn().mockResolvedValue({
            data: [{ id: 'f1', tenant_id: 't1', name: 'Test Clinic', type: 'clinic', contact_phone: null, accepting_referrals: true }],
            error: null,
          }),
        }),
      }),
    };
    const supabaseService = {
      getClientForUser: () => fakeClient,
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacilityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<FacilityService>(FacilityService);
  });

  it('creates a facility and writes an audit event', async () => {
    const result = await service.create('jwt', 'u1', 't1', {
      name: 'Test Clinic',
      type: 'clinic',
    });

    expect(result.id).toBe('f1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'facility', action: 'created' }),
    );
  });

  it('lists facilities filtered by accepting_referrals', async () => {
    const result = await service.list('jwt', true);
    expect(result).toHaveLength(1);
    expect(result[0].acceptingReferrals).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- facility.service.spec.ts`
Expected: FAIL — cannot find module `./facility.service`

- [ ] **Step 3: Implement DTOs and the service**

Create `backend/src/facility/dto/create-facility.dto.ts`:
```typescript
import { IsIn, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreateFacilityDto {
  @IsString()
  @MaxLength(200)
  name!: string;

  @IsIn(['community', 'clinic', 'hospital'])
  type!: 'community' | 'clinic' | 'hospital';

  @IsOptional()
  @IsString()
  contactPhone?: string;
}
```

Create `backend/src/facility/dto/facility-response.dto.ts`:
```typescript
export class FacilityResponseDto {
  id!: string;
  tenantId!: string;
  name!: string;
  type!: string;
  contactPhone!: string | null;
  acceptingReferrals!: boolean;

  static fromRow(row: any): FacilityResponseDto {
    const dto = new FacilityResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.name = row.name;
    dto.type = row.type;
    dto.contactPhone = row.contact_phone;
    dto.acceptingReferrals = row.accepting_referrals;
    return dto;
  }
}
```

Create `backend/src/facility/facility.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreateFacilityDto } from './dto/create-facility.dto';
import { FacilityResponseDto } from './dto/facility-response.dto';

@Injectable()
export class FacilityService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateFacilityDto,
  ): Promise<FacilityResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('facility')
      .insert({
        tenant_id: tenantId,
        name: dto.name,
        type: dto.type,
        contact_phone: dto.contactPhone ?? null,
      })
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
      action: 'created',
      metadata: { name: dto.name, type: dto.type },
    });

    return FacilityResponseDto.fromRow(data);
  }

  async list(jwt: string, acceptingReferralsOnly?: boolean): Promise<FacilityResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('facility').select('*');
    if (acceptingReferralsOnly) {
      query = query.eq('accepting_referrals', true);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(FacilityResponseDto.fromRow);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- facility.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller**

Create `backend/src/facility/facility.controller.ts`:
```typescript
import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { FacilityService } from './facility.service';
import { CreateFacilityDto } from './dto/create-facility.dto';

@Controller('facilities')
@UseGuards(AuthGuard, RolesGuard)
export class FacilityController {
  constructor(private readonly facilityService: FacilityService) {}

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateFacilityDto) {
    return this.facilityService.create(user.jwt, user.id, user.tenantId, dto);
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('acceptingReferrals') acceptingReferrals?: string,
  ) {
    return this.facilityService.list(user.jwt, acceptingReferrals === 'true');
  }
}
```

- [ ] **Step 6: Write the e2e test**

Create `backend/test/facility.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('FacilityController (e2e)', () => {
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

  it('rejects facility creation with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/facilities')
      .send({ name: 'Test', type: 'clinic' })
      .expect(401);
  });
});
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- facility.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Wire the module and commit**

Create `backend/src/facility/facility.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { FacilityController } from './facility.controller';
import { FacilityService } from './facility.service';

@Module({
  controllers: [FacilityController],
  providers: [FacilityService],
  exports: [FacilityService],
})
export class FacilityModule {}
```

Add `FacilityModule` to `backend/src/app.module.ts` imports.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/facility/ backend/test/facility.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add facility module with create and list-by-accepting-referrals"
```

---

### Task 9: `identity` module — person registration with duplicate detection

**Files:**
- Create: `backend/src/identity/identity.module.ts`
- Create: `backend/src/identity/identity.controller.ts`
- Create: `backend/src/identity/identity.service.ts`
- Create: `backend/src/identity/dto/create-person.dto.ts`
- Create: `backend/src/identity/dto/person-response.dto.ts`
- Test: `backend/src/identity/identity.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `AuditService`.
- Produces:
  - `IdentityService.search(jwt, phone: string): Promise<PersonResponseDto[]>` — used by
    Task 2's (Plan 2) registration flow to check for an existing person before creating one.
  - `IdentityService.create(jwt, actorUserId, tenantId, dto): Promise<PersonResponseDto>` —
    throws `DuplicatePersonError` if `phone_primary` already exists for the tenant, per the
    spec's duplicate-detection requirement; the caller (a later frontend task) is expected
    to call `search` first and only call `create` after the user confirms it's not a
    duplicate.
  - `POST /api/v1/persons`, `GET /api/v1/persons?phone=...`

- [ ] **Step 1: Write the failing test**

Create `backend/src/identity/identity.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { IdentityService, DuplicatePersonError } from './identity.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('IdentityService', () => {
  let service: IdentityService;
  let auditLogMock: jest.Mock;

  function buildClient(existingByPhone: any[]) {
    return {
      from: () => ({
        select: () => ({
          eq: () => Promise.resolve({ data: existingByPhone, error: null }),
        }),
        insert: (row: any) => ({
          select: () => ({
            single: async () => ({
              data: { id: 'p1', tenant_id: row.tenant_id, first_name: row.first_name, last_name: row.last_name ?? null, phone_primary: row.phone_primary, date_of_birth: row.date_of_birth ?? null },
              error: null,
            }),
          }),
        }),
      }),
    };
  }

  async function buildService(existingByPhone: any[]) {
    const supabaseService = {
      getClientForUser: () => buildClient(existingByPhone),
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        IdentityService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    return module.get<IdentityService>(IdentityService);
  }

  it('creates a person when no phone match exists', async () => {
    service = await buildService([]);
    const result = await service.create('jwt', 'u1', 't1', {
      firstName: 'Amina',
      phonePrimary: '+254700000001',
    });
    expect(result.id).toBe('p1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'person', action: 'created' }),
    );
  });

  it('throws DuplicatePersonError when phone_primary already exists for the tenant', async () => {
    service = await buildService([{ id: 'existing-1', phone_primary: '+254700000001' }]);
    await expect(
      service.create('jwt', 'u1', 't1', { firstName: 'Amina', phonePrimary: '+254700000001' }),
    ).rejects.toThrow(DuplicatePersonError);
  });

  it('search returns matches by phone', async () => {
    service = await buildService([
      { id: 'p1', tenant_id: 't1', first_name: 'Amina', last_name: null, phone_primary: '+254700000001', date_of_birth: null },
    ]);
    const result = await service.search('jwt', '+254700000001');
    expect(result).toHaveLength(1);
    expect(result[0].firstName).toBe('Amina');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- identity.service.spec.ts`
Expected: FAIL — cannot find module `./identity.service`

- [ ] **Step 3: Implement DTOs and the service**

Create `backend/src/identity/dto/create-person.dto.ts`:
```typescript
import { IsDateString, IsOptional, IsString, MaxLength } from 'class-validator';

export class CreatePersonDto {
  @IsString()
  @MaxLength(120)
  firstName!: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  lastName?: string;

  @IsOptional()
  @IsString()
  phonePrimary?: string;

  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;
}
```

Create `backend/src/identity/dto/person-response.dto.ts`:
```typescript
export class PersonResponseDto {
  id!: string;
  tenantId!: string;
  firstName!: string;
  lastName!: string | null;
  phonePrimary!: string | null;
  dateOfBirth!: string | null;

  static fromRow(row: any): PersonResponseDto {
    const dto = new PersonResponseDto();
    dto.id = row.id;
    dto.tenantId = row.tenant_id;
    dto.firstName = row.first_name;
    dto.lastName = row.last_name;
    dto.phonePrimary = row.phone_primary;
    dto.dateOfBirth = row.date_of_birth;
    return dto;
  }
}
```

Create `backend/src/identity/identity.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { PersonResponseDto } from './dto/person-response.dto';

export class DuplicatePersonError extends Error {
  constructor(public readonly existingPersonId: string) {
    super('A person with this phone number already exists for this tenant');
  }
}

@Injectable()
export class IdentityService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async search(jwt: string, phone: string): Promise<PersonResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('person').select('*').eq('phone_primary', phone);
    if (error) {
      throw error;
    }
    return (data ?? []).map(PersonResponseDto.fromRow);
  }

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreatePersonDto,
  ): Promise<PersonResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    if (dto.phonePrimary) {
      const { data: existing, error: searchError } = await client
        .from('person')
        .select('id')
        .eq('phone_primary', dto.phonePrimary);
      if (searchError) {
        throw searchError;
      }
      if (existing && existing.length > 0) {
        throw new DuplicatePersonError(existing[0].id);
      }
    }

    const { data, error } = await client
      .from('person')
      .insert({
        tenant_id: tenantId,
        first_name: dto.firstName,
        last_name: dto.lastName ?? null,
        phone_primary: dto.phonePrimary ?? null,
        date_of_birth: dto.dateOfBirth ?? null,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'person',
      entityId: data.id,
      action: 'created',
      metadata: {},
    });

    return PersonResponseDto.fromRow(data);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- identity.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller**

Create `backend/src/identity/identity.controller.ts`:
```typescript
import {
  Body,
  ConflictException,
  Controller,
  Get,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { IdentityService, DuplicatePersonError } from './identity.service';
import { CreatePersonDto } from './dto/create-person.dto';

@Controller('persons')
@UseGuards(AuthGuard)
export class IdentityController {
  constructor(private readonly identityService: IdentityService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreatePersonDto) {
    try {
      return await this.identityService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof DuplicatePersonError) {
        throw new ConflictException({
          error: {
            code: 'DUPLICATE_PERSON',
            message: err.message,
            details: [{ existingPersonId: err.existingPersonId }],
          },
        });
      }
      throw err;
    }
  }

  @Get()
  search(@CurrentUser() user: CurrentUserPayload, @Query('phone') phone: string) {
    return this.identityService.search(user.jwt, phone);
  }
}
```

- [ ] **Step 6: Wire the module and commit**

Create `backend/src/identity/identity.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';

@Module({
  controllers: [IdentityController],
  providers: [IdentityService],
  exports: [IdentityService],
})
export class IdentityModule {}
```

Add `IdentityModule` to `backend/src/app.module.ts` imports.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/identity/ backend/src/app.module.ts
git commit -m "feat: add identity module with duplicate-detecting person registration"
```

---

### Task 10: `users` module — staff account creation (admin-only)

**Files:**
- Create: `backend/src/users/users.module.ts`
- Create: `backend/src/users/users.controller.ts`
- Create: `backend/src/users/users.service.ts`
- Create: `backend/src/users/dto/create-staff-user.dto.ts`
- Test: `backend/src/users/users.service.spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SupabaseService.getServiceClient()` (needed because creating a Supabase Auth
  user requires the admin API, which requires the service-role key — this is one of the
  deliberate service-role exceptions noted in Global Constraints).
- Produces: `UsersService.createStaffUser(actorUserId, tenantId, dto): Promise<{id, email, role}>`,
  `POST /api/v1/users` (roles: `admin`) — creates both the Supabase Auth identity and the
  `app_user` row in one call, used later by the admin dashboard's staff-management screen.

- [ ] **Step 1: Write the failing test**

Create `backend/src/users/users.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { UsersService } from './users.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

describe('UsersService', () => {
  let service: UsersService;
  let auditLogMock: jest.Mock;
  let insertMock: jest.Mock;

  beforeEach(async () => {
    insertMock = jest.fn().mockReturnValue({
      select: () => ({
        single: async () => ({
          data: { id: 'auth-user-1', tenant_id: 't1', email: 'nurse@example.com', role: 'nurse', facility_id: 'f1', full_name: 'Nurse Joy' },
          error: null,
        }),
      }),
    });
    const fakeServiceClient = {
      auth: {
        admin: {
          createUser: jest.fn().mockResolvedValue({
            data: { user: { id: 'auth-user-1' } },
            error: null,
          }),
        },
      },
      from: () => ({ insert: insertMock }),
    };
    const supabaseService = {
      getServiceClient: () => fakeServiceClient,
    } as unknown as SupabaseService;
    auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        UsersService,
        { provide: SupabaseService, useValue: supabaseService },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<UsersService>(UsersService);
  });

  it('creates the auth identity, the app_user row, and an audit event', async () => {
    const result = await service.createStaffUser('admin-1', 't1', {
      email: 'nurse@example.com',
      password: 'temp-password-123',
      role: 'nurse',
      facilityId: 'f1',
      fullName: 'Nurse Joy',
    });

    expect(result.id).toBe('auth-user-1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ entityType: 'app_user', action: 'created' }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- users.service.spec.ts`
Expected: FAIL — cannot find module `./users.service`

- [ ] **Step 3: Implement the DTO and service**

Create `backend/src/users/dto/create-staff-user.dto.ts`:
```typescript
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateStaffUserDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(12)
  password!: string;

  @IsIn(['chw', 'nurse', 'clinician', 'supervisor', 'admin'])
  role!: 'chw' | 'nurse' | 'clinician' | 'supervisor' | 'admin';

  @IsOptional()
  @IsString()
  facilityId?: string;

  @IsString()
  fullName!: string;
}
```

Create `backend/src/users/users.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';

@Injectable()
export class UsersService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async createStaffUser(
    actorUserId: string,
    tenantId: string,
    dto: CreateStaffUserDto,
  ): Promise<{ id: string; email: string; role: string }> {
    const client = this.supabaseService.getServiceClient();

    const { data: authResult, error: authError } = await client.auth.admin.createUser({
      email: dto.email,
      password: dto.password,
      email_confirm: true,
    });
    if (authError || !authResult.user) {
      throw authError ?? new Error('Failed to create auth user');
    }

    const { data, error } = await client
      .from('app_user')
      .insert({
        id: authResult.user.id,
        tenant_id: tenantId,
        email: dto.email,
        role: dto.role,
        facility_id: dto.facilityId ?? null,
        full_name: dto.fullName,
      })
      .select()
      .single();

    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'app_user',
      entityId: data.id,
      action: 'created',
      metadata: { role: dto.role },
    });

    return { id: data.id, email: data.email, role: data.role };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- users.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller and module**

Create `backend/src/users/users.controller.ts`:
```typescript
import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { UsersService } from './users.service';
import { CreateStaffUserDto } from './dto/create-staff-user.dto';

@Controller('users')
@UseGuards(AuthGuard, RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles('admin')
  create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateStaffUserDto) {
    return this.usersService.createStaffUser(user.id, user.tenantId, dto);
  }
}
```

Create `backend/src/users/users.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';

@Module({
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService],
})
export class UsersModule {}
```

Add `UsersModule` to `backend/src/app.module.ts` imports.

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/users/ backend/src/app.module.ts
git commit -m "feat: add admin-only staff user creation"
```

---

## Handoff to Plan 2

Plan 2 (Episode & Task Management) depends on this plan's:
- `person` table and `IdentityService` (Task 9)
- `facility` table (Task 8)
- `AuthGuard`/`CurrentUser`/`Roles`/`RolesGuard` (Tasks 5–6)
- `AuditService.log()` (Task 7)
- `SupabaseService.getClientForUser` / `getServiceClient` (Task 2)

No further backend-foundation work is needed before Plan 2 begins.
