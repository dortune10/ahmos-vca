# Episode & Task Management Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `episode` module (pregnancy episode lifecycle + encounter notes) and a
`tasks` module (care task generation/tracking) on top of Plan 1's backend foundation, so
that a CHW/Nurse can register a pregnancy episode, a clinician can record clinical
encounters against it, and both get a schedulable/completable ANC task list — all
tenant-isolated via RLS, exactly as Plan 1 established.

**Architecture:** Two new NestJS modules — `episode` and `tasks` — following Plan 1's
modular-monolith pattern. `episode` depends on `tasks` (episode creation triggers initial
ANC task generation) but nothing downstream (the not-yet-built `risk` module, Plan 3)
depends on `episode`; that dependency is inverted via two NestJS events (`episode.created`,
`episode.clinical_data_updated`) so Plan 3 can listen without Plan 2 knowing Plan 3 exists.
Same no-ORM approach as Plan 1: `@supabase/supabase-js` clients scoped to the caller's JWT,
RLS as the actual enforcement mechanism (`docs/DECISIONS.md` #21).

Because `EpisodeService` in this plan is materially larger than any single service in Plan
1 (five public methods versus Plan 1's one-or-two per service), its steps are split across
three tasks (Task 4 build-up of methods, matching one TDD red/green pair per method) rather
than the single-task-per-service granularity Plan 1 used throughout — the `tasks` module and
final controller/wiring keep Plan 1's one-task-per-slice shape.

**Tech Stack:** Same as Plan 1 (Node.js 20 LTS, NestJS 10.x, TypeScript 5.x,
`@supabase/supabase-js` v2, Jest + Supertest, Supabase CLI), plus two new dependencies this
plan introduces: `@nestjs/event-emitter` (episode lifecycle events for Plan 3) and
`class-transformer` (nested DTO validation for encounter-note vitals).

## Global Constraints

Same as Plan 1 (Backend Foundation) — see that plan for the full list, **including the
database approach**: one hosted Supabase project (`amhos`, `wjgyivxvmqchlhgmxcxe`), no local
Docker stack, no `supabase start`/`db reset`/`link`; every migration in this plan is applied
via the Supabase MCP's `apply_migration` tool exactly as Plan 1's Global Constraints
describe (API base path, `X-Correlation-Id`, error response shape,
no-ORM/RLS-as-source-of-truth, `created_at`/`updated_at` convention). This plan adds:

- **Global `ValidationPipe` gap fix.** Plan 1 decorated its DTOs with `class-validator`
  decorators (`@IsString`, `@IsIn`, etc.) but never called
  `app.useGlobalPipes(new ValidationPipe(...))` in `main.ts`, so those decorators were never
  actually enforced at runtime. This plan's `RecordEncounterNoteDto` is the first DTO whose
  validation genuinely matters (out-of-range vitals must be rejected with a 400, not
  silently stored), so Task 3 below wires up the global pipe — a real prerequisite gap found
  during planning, fixed directly rather than re-litigated, per the same precedent as
  `docs/DECISIONS.md` #22 (the `encounter_note` table gap).
- **Vitals numeric ranges** (`encounter_note.vitals_json`), chosen as physiologically wide
  bounds that reject obvious data-entry errors without rejecting real clinical extremes:
  - `bpSystolic`: 60–260 mmHg
  - `bpDiastolic`: 40–150 mmHg
  - `temperatureC`: 30–43 °C
  - `hemoglobinGdl`: 2–20 g/dL
  These are enforced via `class-validator` `@Min`/`@Max` on a nested `VitalsDto`
  (`RecordEncounterNoteDto.vitals`), **not** as a Postgres `CHECK` constraint on the
  `vitals_json` jsonb column. Chosen over a DB-level check because: (a) jsonb-field-level
  `CHECK` constraints are brittle against schema evolution (adding a new vital later means
  editing a constraint expression, not just a DTO field) and (b) the API is the only write
  path into this table (no service-role bypass writes this table), so application-level
  validation is not a security gap — it just needs a pipe wired up, which is the fix above.
- **`pregnancy_episode.status` value set.** This plan's own schema (Task 1's `CREATE TABLE`
  CHECK constraint) uses exactly the seven values the approved design spec's Data Model
  table (Section 4) lists: `Draft`, `Active`, `Referred`, `Delivered`, `PostnatalActive`,
  `Closed`, `Archived`. Note for whoever plans Referral (Plan 4): the PRD's own state diagram
  (`docs/PRD.md` Section 16) additionally shows `Admitted` (between `Referred` and
  `Delivered`) and `Cancelled` (from `Active`), which the approved spec's table does not
  carry forward. This plan follows the approved spec exactly rather than silently adding two
  more enum values on its own authority — if Plan 4 needs `Admitted` as a distinct state,
  that's a schema decision for that plan to make explicitly. (Plan 4 did in fact need both,
  and extends this CHECK constraint via its own `ALTER TABLE` migration after this plan's
  `CREATE TABLE` has already run — see that plan's Task 1. That is a database-schema
  decision only; at the application layer, this plan's own `UpdateEpisodeStatusDto` — Task 5,
  Step 1 — separately allow-lists all nine values up front, since it's harmless for the DTO
  to accept two values the database doesn't yet permit, but see the note beside that DTO for
  the execution-order caveat this implies.)
- **RLS join strategy for `pregnancy_episode`, `encounter_note`, `care_task`.** None of
  these three tables carries a `tenant_id` column (per the approved spec's Data Model — only
  `facility_id`/`person_id`/`pregnancy_episode_id` foreign keys). Tenant scope is derived via
  a join to `facility.tenant_id` through `facility_id` (on `pregnancy_episode` directly, and
  transitively through `pregnancy_episode_id` on the other two) rather than through
  `person.tenant_id`, because every later dashboard/service in this plan already filters
  primarily by `facility_id` for staff-scoping — reusing the same join key keeps RLS policy
  logic and application query logic aligned on one relationship, not two independent ones
  that could drift.
- **RLS granularity matches Plan 1's precedent, not the spec's full ambition.** The design
  spec's Section 3 says a CHW/nurse/clinician should only see records "within their own
  facility," but Plan 1's actual RLS policies (`person_tenant_isolation`, etc.) only enforce
  tenant-level isolation, not facility-level. This plan's policies match that same
  tenant-only granularity for consistency with the established precedent — facility-level
  restriction is real future hardening work, not something this plan silently skips while
  claiming to be done; it is explicitly deferred, matching Plan 1's own scope line.
- **Episode creation starts at `Active`, not `Draft`.** See Task 5, Step 4 for the full
  justification — summary: the PRD's `Draft` state assumes a CHW-mobile app creating a
  locally-unsynced episode before it reaches the server; this build has no offline-sync
  requirement (an always-online web app hits the API directly), so there is no "not yet
  submitted" state to represent. `Draft` remains a legal value in the `status` CHECK
  constraint for forward compatibility but nothing in this plan ever sets it.

---

### Task 1: Schema migration — `pregnancy_episode`, `encounter_note`, `care_task`

**Files:**
- Create: `supabase/migrations/00000000000004_episode_task_schema.sql`
- Test: `backend/test/episode-task-schema.e2e-spec.ts`

**Interfaces:**
- Consumes: `person`, `facility`, `app_user` tables (Plan 1, Task 3).
- Produces: three tables every later task in this plan queries —
  - `pregnancy_episode(id uuid pk, person_id uuid fk -> person not null, facility_id uuid fk -> facility not null, lmp_date date, estimated_delivery_date date, gestational_age_weeks integer, risk_band text nullable check in ('low','medium','high'), status text not null default 'Active' check in ('Draft','Active','Referred','Delivered','PostnatalActive','Closed','Archived'), created_at, updated_at)`
  - `encounter_note(id uuid pk, pregnancy_episode_id uuid fk -> pregnancy_episode not null, recorded_by uuid fk -> app_user not null, recorded_at timestamptz not null default now(), note_text text nullable, vitals_json jsonb nullable, created_at)` — **no `updated_at`**: encounter notes are append-only from the application's perspective, same rationale as `audit_event` (Plan 1, Task 7).
  - `care_task(id uuid pk, pregnancy_episode_id uuid fk -> pregnancy_episode not null, task_type text not null check in ('anc_visit','pnc_visit','newborn_check'), assigned_user_id uuid fk -> app_user nullable, due_at timestamptz not null, completed_at timestamptz nullable, status text not null default 'Scheduled' check in ('Scheduled','Due','Completed','Missed'), priority text not null default 'routine' check in ('routine','urgent'), created_at, updated_at)`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000004_episode_task_schema.sql`:
```sql
create table pregnancy_episode (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id),
  facility_id uuid not null references facility (id),
  lmp_date date,
  estimated_delivery_date date,
  gestational_age_weeks integer check (
    gestational_age_weeks is null or (gestational_age_weeks >= 0 and gestational_age_weeks <= 45)
  ),
  risk_band text check (risk_band is null or risk_band in ('low', 'medium', 'high')),
  status text not null default 'Active' check (
    status in ('Draft', 'Active', 'Referred', 'Delivered', 'PostnatalActive', 'Closed', 'Archived')
  ),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index pregnancy_episode_person_id_idx on pregnancy_episode (person_id);
create index pregnancy_episode_facility_id_idx on pregnancy_episode (facility_id);
create index pregnancy_episode_status_idx on pregnancy_episode (status);

create table encounter_note (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  recorded_by uuid not null references app_user (id),
  recorded_at timestamptz not null default now(),
  note_text text,
  vitals_json jsonb,
  created_at timestamptz not null default now()
);
create index encounter_note_pregnancy_episode_id_idx on encounter_note (pregnancy_episode_id);

create table care_task (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  task_type text not null check (task_type in ('anc_visit', 'pnc_visit', 'newborn_check')),
  assigned_user_id uuid references app_user (id),
  due_at timestamptz not null,
  completed_at timestamptz,
  status text not null default 'Scheduled' check (status in ('Scheduled', 'Due', 'Completed', 'Missed')),
  priority text not null default 'routine' check (priority in ('routine', 'urgent')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index care_task_pregnancy_episode_id_idx on care_task (pregnancy_episode_id);
create index care_task_assigned_user_id_idx on care_task (assigned_user_id);
create index care_task_status_idx on care_task (status);
create index care_task_due_at_idx on care_task (due_at);

alter table pregnancy_episode enable row level security;
alter table encounter_note enable row level security;
alter table care_task enable row level security;
```

- [ ] **Step 2: Apply the migration**

Call the `apply_migration` MCP tool: `project_id: "wjgyivxvmqchlhgmxcxe"`,
`name: "episode_task_schema"`, `query: <the exact SQL from Step 1>`.
Expected: applies cleanly to the `amhos` project, no errors returned.

- [ ] **Step 3: Write the failing verification test**

Create `backend/test/episode-task-schema.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

describe('episode & task schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let facilityId: string;
  let personId: string;

  beforeAll(async () => {
    const { data: facility, error: facilityError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Schema Test Clinic', type: 'clinic' })
      .select()
      .single();
    expect(facilityError).toBeNull();
    facilityId = facility!.id;

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Schema', phone_primary: '+254700000099' })
      .select()
      .single();
    expect(personError).toBeNull();
    personId = person!.id;
  });

  it('pregnancy_episode accepts a valid status and rejects an invalid one', async () => {
    const { error: goodError } = await admin.from('pregnancy_episode').insert({
      person_id: personId,
      facility_id: facilityId,
      status: 'Active',
    });
    expect(goodError).toBeNull();

    const { error: badError } = await admin.from('pregnancy_episode').insert({
      person_id: personId,
      facility_id: facilityId,
      status: 'NotARealStatus',
    });
    expect(badError).not.toBeNull();
  });

  it('care_task accepts a valid task_type/status/priority and rejects an invalid task_type', async () => {
    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();

    const { error: goodError } = await admin.from('care_task').insert({
      pregnancy_episode_id: episode!.id,
      task_type: 'anc_visit',
      due_at: new Date().toISOString(),
      status: 'Scheduled',
      priority: 'routine',
    });
    expect(goodError).toBeNull();

    const { error: badError } = await admin.from('care_task').insert({
      pregnancy_episode_id: episode!.id,
      task_type: 'not-a-real-type',
      due_at: new Date().toISOString(),
    });
    expect(badError).not.toBeNull();
  });

  it('encounter_note accepts note_text and vitals_json', async () => {
    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: facilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `nurse-schema-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });

    const { error: appUserError } = await admin.from('app_user').insert({
      id: authUser.user!.id,
      tenant_id: tenantId,
      email: authUser.user!.email,
      role: 'nurse',
      facility_id: facilityId,
      full_name: 'Schema Nurse',
    });
    expect(appUserError).toBeNull();

    const { error: noteError } = await admin.from('encounter_note').insert({
      pregnancy_episode_id: episode!.id,
      recorded_by: authUser.user!.id,
      note_text: 'Patient reports mild headache.',
      vitals_json: { bpSystolic: 120, bpDiastolic: 80, temperatureC: 37.1, hemoglobinGdl: 11.5 },
    });
    expect(noteError).toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- episode-task-schema.e2e-spec.ts`
Expected: FAIL if migration wasn't applied yet (tables don't exist), or already passes if
Step 2 succeeded — same "confirming, not introducing, the failure" caveat as Plan 1 Task 3
Step 4. Proceed regardless.

- [ ] **Step 5: Confirm pass**

Run: `cd backend && npm run test:e2e -- episode-task-schema.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/episode-task-schema.e2e-spec.ts
git commit -m "feat: add pregnancy_episode, encounter_note, care_task schema migration"
```

---

### Task 2: RLS policies for `pregnancy_episode`, `encounter_note`, `care_task`

**Files:**
- Create: `supabase/migrations/00000000000005_episode_task_rls_policies.sql`
- Test: `backend/test/episode-task-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `pregnancy_episode`, `encounter_note`, `care_task` tables (Task 1), the
  `private.auth_app_user()` helper function (Plan 1, Task 4 — note the `private.` schema
  qualifier, required after a real recursion/security-exposure bug found during Plan 1's
  execution; the unqualified `public.auth_app_user()` no longer exists).
- Produces: tenant-isolation RLS policies on all three tables, joined through
  `facility_id`/`pregnancy_episode_id` per the Global Constraints note above. Every later
  service in this plan (`EpisodeService`, `TasksService`) relies on these policies already
  being in place — no module-level authorization code duplicates this.

- [ ] **Step 1: Write the failing RLS test**

Create `backend/test/episode-task-rls.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';
import * as jwt from 'jsonwebtoken';

const SUPABASE_URL = process.env.SUPABASE_URL as string;
const ANON_KEY = process.env.SUPABASE_ANON_KEY as string;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY as string;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET as string;

function tokenFor(userId: string) {
  return jwt.sign(
    { sub: userId, role: 'authenticated', app_metadata: {}, aud: 'authenticated' },
    JWT_SECRET,
    { expiresIn: '1h' },
  );
}

describe('pregnancy_episode / encounter_note / care_task RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let nurseAId: string;
  let facilityAId: string;
  let facilityBId: string;
  let episodeAId: string;
  let episodeBId: string;

  beforeAll(async () => {
    const { data: facilityA } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'A Clinic', type: 'clinic' })
      .select()
      .single();
    facilityAId = facilityA!.id;

    const { data: facilityB } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'B Clinic', type: 'clinic' })
      .select()
      .single();
    facilityBId = facilityB!.id;

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Amina', phone_primary: '+254700000010' })
      .select()
      .single();

    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Beatrice', phone_primary: '+254700000020' })
      .select()
      .single();

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `nurse-a-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    nurseAId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: nurseAId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'nurse',
      facility_id: facilityAId,
      full_name: 'Nurse A',
    });

    const { data: episodeA } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personA!.id, facility_id: facilityAId, status: 'Active' })
      .select()
      .single();
    episodeAId = episodeA!.id;

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: facilityBId, status: 'Active' })
      .select()
      .single();
    episodeBId = episodeB!.id;
  });

  it('a nurse in tenant A only sees tenant A pregnancy_episode rows (fails before policies exist: deny-all hides tenant A too)', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(nurseAId)}` } },
    });

    const { data } = await userClient.from('pregnancy_episode').select('id');
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).toContain(episodeAId);
    expect(ids).not.toContain(episodeBId);
  });

  it("a nurse in tenant A cannot insert a care_task against tenant B's episode", async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(nurseAId)}` } },
    });

    const { error } = await userClient.from('care_task').insert({
      pregnancy_episode_id: episodeBId,
      task_type: 'anc_visit',
      due_at: new Date().toISOString(),
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- episode-task-rls.e2e-spec.ts`
Expected: FAIL — with RLS enabled and no policies yet, the first test's positive assertion
(`toContain(episodeAId)`) fails because deny-all hides tenant A's own row too, same signal
Plan 1 Task 4 Step 2 relies on.

- [ ] **Step 3: Write the RLS policies**

Create `supabase/migrations/00000000000005_episode_task_rls_policies.sql`:
```sql
create policy "pregnancy_episode_select_tenant" on pregnancy_episode
  for select using (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "pregnancy_episode_insert_tenant" on pregnancy_episode
  for insert with check (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "pregnancy_episode_update_tenant" on pregnancy_episode
  for update using (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  )
  with check (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "encounter_note_select_tenant" on encounter_note
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "encounter_note_insert_tenant" on encounter_note
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );
-- No update/delete policy: encounter notes are append-only from the application's
-- perspective, same rationale as audit_event (00000000000003_audit_event.sql).

create policy "care_task_select_tenant" on care_task
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "care_task_insert_tenant" on care_task
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "care_task_update_tenant" on care_task
  for update using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  )
  with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );
```

- [ ] **Step 4: Apply and run test to verify it passes**

Call the `apply_migration` MCP tool: `project_id: "wjgyivxvmqchlhgmxcxe"`,
`name: "episode_task_rls_policies"`, `query: <the exact SQL from Step 3>`. Then call the
`get_advisors` MCP tool with `project_id: "wjgyivxvmqchlhgmxcxe"`, `type: "security"` and
confirm it reports no missing-policy findings for `pregnancy_episode`, `encounter_note`, or
`care_task`. Then run:
```bash
cd backend && npm run test:e2e -- episode-task-rls.e2e-spec.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/episode-task-rls.e2e-spec.ts
git commit -m "feat: add tenant-isolation RLS policies for pregnancy_episode, encounter_note, care_task"
```

---

### Task 3: Event emitter + global `ValidationPipe` wiring

**Files:**
- Modify: `backend/package.json` (add `@nestjs/event-emitter`, `class-transformer`)
- Modify: `backend/src/app.module.ts`
- Modify: `backend/src/main.ts`
- Test: `backend/src/app.module.spec.ts`

**Interfaces:**
- Produces: an injectable `EventEmitter2` (from `@nestjs/event-emitter`) available
  application-wide, used by `EpisodeService` (Task 4) to emit `episode.created` and
  `episode.clinical_data_updated`. Also produces a working global `ValidationPipe`
  (`whitelist: true, transform: true`) so every `class-validator`-decorated DTO — in this
  plan and retroactively in Plan 1's — is actually enforced; Plan 1 defined the decorators
  but never wired the pipe, so this closes that gap for the whole app, not just this plan's
  DTOs.

- [ ] **Step 1: Install the new dependencies**

Run: `cd backend && npm install @nestjs/event-emitter class-transformer`

- [ ] **Step 2: Write the failing test**

Create `backend/src/app.module.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { AppModule } from './app.module';

describe('AppModule event emitter wiring', () => {
  beforeAll(() => {
    process.env.SUPABASE_URL = process.env.SUPABASE_URL ?? 'http://localhost:54321';
    process.env.SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY ?? 'anon-key';
    process.env.SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY ?? 'service-role-key';
  });

  it('provides an injectable EventEmitter2', async () => {
    const module: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    const emitter = module.get(EventEmitter2);
    expect(emitter).toBeInstanceOf(EventEmitter2);
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- app.module.spec.ts`
Expected: FAIL — `EventEmitter2` is not a provider anywhere in the module graph yet
(`Nest can't resolve dependencies` / "no provider" style error).

- [ ] **Step 4: Wire `EventEmitterModule` into `AppModule`**

Edit `backend/src/app.module.ts` to add `EventEmitterModule.forRoot()` (imported from
`@nestjs/event-emitter`) to the `imports` array, alongside the existing `SupabaseModule`,
`AuthModule`, `AuditModule`, `FacilityModule`, `IdentityModule`, `UsersModule` from Plan 1.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- app.module.spec.ts`
Expected: PASS

- [ ] **Step 6: Wire the global `ValidationPipe`**

Edit `backend/src/main.ts` to:
```typescript
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  await app.listen(process.env.PORT ?? 3000);
}
bootstrap();
```

Note: e2e test files that build their own `INestApplication` via
`Test.createTestingModule({ imports: [AppModule] }).compile()` (as Plan 1's
`facility.e2e-spec.ts` does, and as Task 6 below does) do not run `main.ts`'s `bootstrap()`
function, so each such e2e spec must also call
`app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }))` itself in its
own `beforeAll`, mirroring `app.setGlobalPrefix('api/v1')` — Task 6's e2e test does this.
There is no isolated unit to TDD for this line by itself; its effect is verified end-to-end
in Task 6's e2e test (an out-of-range vitals payload returning 400).

- [ ] **Step 7: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/package.json backend/package-lock.json backend/src/app.module.ts backend/src/app.module.spec.ts backend/src/main.ts
git commit -m "feat: add event emitter and global validation pipe"
```

---

### Task 4: `tasks` module — generation, listing, completion, overdue query

**Files:**
- Create: `backend/src/tasks/tasks.module.ts`
- Create: `backend/src/tasks/tasks.controller.ts`
- Create: `backend/src/tasks/tasks.service.ts`
- Create: `backend/src/tasks/dto/care-task-response.dto.ts`
- Test: `backend/src/tasks/tasks.service.spec.ts`
- Test: `backend/test/tasks.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `AuthGuard`, `AuditService` (Plan 1); `care_task` table
  (Task 1).
- Produces:
  - `TasksService.generateInitialAncSchedule(jwt, actorUserId, tenantId, pregnancyEpisodeId): Promise<CareTaskResponseDto[]>` — called by `EpisodeService.create()` (Task 5).
  - `TasksService.listForUser(jwt, assignedUserId): Promise<CareTaskResponseDto[]>` — CHW/Nurse dashboard task list.
  - `TasksService.complete(jwt, actorUserId, taskId): Promise<CareTaskResponseDto>`
  - `TasksService.listOverdue(jwt, facilityId?): Promise<CareTaskResponseDto[]>` — used later by the Supervisor dashboard; a full automated missed-task escalation job is explicitly NOT in scope for this plan, this just makes overdue tasks queryable.
  - `CareTaskNotFoundError` (thrown by `complete()` when the task id doesn't exist / isn't visible under RLS).
  - `GET /api/v1/tasks?assignedUserId=<id>` (defaults to the caller's own id), `GET /api/v1/tasks/overdue?facilityId=<id>`, `POST /api/v1/tasks/:id/complete`.

- [ ] **Step 1: Write the failing service test**

Create `backend/src/tasks/tasks.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { TasksService, CareTaskNotFoundError } from './tasks.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';

const SAMPLE_TASK = {
  id: 't1',
  pregnancy_episode_id: 'e1',
  task_type: 'anc_visit',
  assigned_user_id: 'u1',
  due_at: '2026-08-15T00:00:00.000Z',
  completed_at: null,
  status: 'Scheduled',
  priority: 'routine',
  created_at: '2026-08-01T00:00:00.000Z',
  updated_at: '2026-08-01T00:00:00.000Z',
};

async function buildService(supabaseService: SupabaseService, auditService: AuditService) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      TasksService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
    ],
  }).compile();
  return module.get<TasksService>(TasksService);
}

describe('TasksService', () => {
  it('generateInitialAncSchedule inserts 4 anc_visit tasks and logs an audit event', async () => {
    const insertedRows = [SAMPLE_TASK, SAMPLE_TASK, SAMPLE_TASK, SAMPLE_TASK];
    const selectMock = jest.fn().mockResolvedValue({ data: insertedRows, error: null });
    const insertMock = jest.fn().mockReturnValue({ select: selectMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ insert: insertMock }) }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.generateInitialAncSchedule('jwt', 'u1', 't1', 'e1');

    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(insertMock.mock.calls[0][0]).toHaveLength(4);
    expect(result).toHaveLength(4);
    expect(result[0].taskType).toBe('anc_visit');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', entityType: 'care_task', action: 'schedule_generated' }),
    );
  });

  it('listForUser lists tasks assigned to a user ordered by due date', async () => {
    const orderMock = jest.fn().mockResolvedValue({ data: [SAMPLE_TASK], error: null });
    const eqMock = jest.fn().mockReturnValue({ order: orderMock });
    const selectMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ select: selectMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.listForUser('jwt', 'u1');

    expect(eqMock).toHaveBeenCalledWith('assigned_user_id', 'u1');
    expect(result).toHaveLength(1);
  });

  it('complete marks a task completed and logs an audit event with the derived tenant id', async () => {
    const singleMock = jest.fn().mockResolvedValue({
      data: { ...SAMPLE_TASK, status: 'Completed', completed_at: '2026-08-01T00:00:00.000Z', pregnancy_episode: { facility_id: 'f1', facility: { tenant_id: 't1' } } },
      error: null,
    });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ update: updateMock }) }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.complete('jwt', 'u1', 't1');

    expect(result.status).toBe('Completed');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', entityType: 'care_task', action: 'completed' }),
    );
  });

  it('complete throws CareTaskNotFoundError when the task does not exist', async () => {
    const singleMock = jest.fn().mockResolvedValue({ data: null, error: { message: 'not found' } });
    const selectMock = jest.fn().mockReturnValue({ single: singleMock });
    const eqMock = jest.fn().mockReturnValue({ select: selectMock });
    const updateMock = jest.fn().mockReturnValue({ eq: eqMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ update: updateMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    await expect(service.complete('jwt', 'u1', 'missing')).rejects.toThrow(CareTaskNotFoundError);
  });

  it('listOverdue lists tasks not yet completed whose due date has passed', async () => {
    const overdueTask = { ...SAMPLE_TASK, due_at: '2020-01-01T00:00:00.000Z' };
    const orderMock = jest.fn().mockResolvedValue({ data: [overdueTask], error: null });
    const inMock = jest.fn().mockReturnValue({ order: orderMock });
    const ltMock = jest.fn().mockReturnValue({ in: inMock });
    const selectMock = jest.fn().mockReturnValue({ lt: ltMock });
    const supabaseService = {
      getClientForUser: () => ({ from: () => ({ select: selectMock }) }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;

    const service = await buildService(supabaseService, auditService);
    const result = await service.listOverdue('jwt');

    expect(inMock).toHaveBeenCalledWith('status', ['Scheduled', 'Due']);
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- tasks.service.spec.ts`
Expected: FAIL — cannot find module `./tasks.service`

- [ ] **Step 3: Implement the DTO and service**

Create `backend/src/tasks/dto/care-task-response.dto.ts`:
```typescript
export class CareTaskResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  taskType!: string;
  assignedUserId!: string | null;
  dueAt!: string;
  completedAt!: string | null;
  status!: string;
  priority!: string;
  createdAt!: string;
  updatedAt!: string;

  static fromRow(row: any): CareTaskResponseDto {
    const dto = new CareTaskResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.taskType = row.task_type;
    dto.assignedUserId = row.assigned_user_id;
    dto.dueAt = row.due_at;
    dto.completedAt = row.completed_at;
    dto.status = row.status;
    dto.priority = row.priority;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}
```

Create `backend/src/tasks/tasks.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { CareTaskResponseDto } from './dto/care-task-response.dto';

// Simplified fixed ANC visit schedule for MVP: 4 routine visits spaced roughly monthly
// starting 2 weeks out. Not clinically validated (see docs/DECISIONS.md "Still Open" —
// actual clinical scheduling rules need clinical input, same caveat as the risk rules
// engine's thresholds).
const ANC_SCHEDULE_OFFSETS_DAYS = [14, 45, 75, 105];

export class CareTaskNotFoundError extends Error {
  constructor(public readonly taskId: string) {
    super(`Care task ${taskId} not found`);
  }
}

@Injectable()
export class TasksService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
  ) {}

  async generateInitialAncSchedule(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    pregnancyEpisodeId: string,
  ): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const now = Date.now();
    const rows = ANC_SCHEDULE_OFFSETS_DAYS.map((offsetDays) => ({
      pregnancy_episode_id: pregnancyEpisodeId,
      task_type: 'anc_visit',
      assigned_user_id: actorUserId,
      due_at: new Date(now + offsetDays * 24 * 60 * 60 * 1000).toISOString(),
      status: 'Scheduled',
      priority: 'routine',
    }));

    const { data, error } = await client.from('care_task').insert(rows).select();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'care_task',
      entityId: pregnancyEpisodeId,
      action: 'schedule_generated',
      metadata: { taskIds: (data ?? []).map((row: any) => row.id), count: data?.length ?? 0 },
    });

    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }

  async listForUser(jwt: string, assignedUserId: string): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('care_task')
      .select('*')
      .eq('assigned_user_id', assignedUserId)
      .order('due_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }

  async complete(jwt: string, actorUserId: string, taskId: string): Promise<CareTaskResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data, error } = await client
      .from('care_task')
      .update({
        status: 'Completed',
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', taskId)
      .select('*, pregnancy_episode(facility_id, facility(tenant_id))')
      .single();

    if (error || !data) {
      throw new CareTaskNotFoundError(taskId);
    }

    const tenantId = (data as any).pregnancy_episode?.facility?.tenant_id;

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'care_task',
      entityId: taskId,
      action: 'completed',
      metadata: {},
    });

    return CareTaskResponseDto.fromRow(data);
  }

  async listOverdue(jwt: string, facilityId?: string): Promise<CareTaskResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client
      .from('care_task')
      .select('*, pregnancy_episode!inner(facility_id)')
      .lt('due_at', new Date().toISOString())
      .in('status', ['Scheduled', 'Due']);

    if (facilityId) {
      query = query.eq('pregnancy_episode.facility_id', facilityId);
    }

    const { data, error } = await query.order('due_at', { ascending: true });
    if (error) {
      throw error;
    }
    return (data ?? []).map(CareTaskResponseDto.fromRow);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- tasks.service.spec.ts`
Expected: PASS

- [ ] **Step 5: Write the controller**

Create `backend/src/tasks/tasks.controller.ts`:
```typescript
import { Controller, Get, NotFoundException, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { TasksService, CareTaskNotFoundError } from './tasks.service';

@Controller('tasks')
@UseGuards(AuthGuard)
export class TasksController {
  constructor(private readonly tasksService: TasksService) {}

  @Get()
  list(@CurrentUser() user: CurrentUserPayload, @Query('assignedUserId') assignedUserId?: string) {
    return this.tasksService.listForUser(user.jwt, assignedUserId ?? user.id);
  }

  @Get('overdue')
  listOverdue(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.tasksService.listOverdue(user.jwt, facilityId);
  }

  @Post(':id/complete')
  async complete(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.tasksService.complete(user.jwt, user.id, id);
    } catch (err) {
      if (err instanceof CareTaskNotFoundError) {
        throw new NotFoundException({
          error: { code: 'CARE_TASK_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
```

- [ ] **Step 6: Write the e2e test**

Create `backend/test/tasks.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('TasksController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects listing tasks with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/tasks').expect(401);
  });

  it('rejects completing a task with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/tasks/11111111-1111-1111-1111-111111111111/complete')
      .expect(401);
  });
});
```

- [ ] **Step 7: Run the e2e test to verify it passes**

Run: `cd backend && npm run test:e2e -- tasks.e2e-spec.ts`
Expected: PASS

- [ ] **Step 8: Wire the module and commit**

Create `backend/src/tasks/tasks.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';

@Module({
  controllers: [TasksController],
  providers: [TasksService],
  exports: [TasksService],
})
export class TasksModule {}
```

Add `TasksModule` to the `imports` array in `backend/src/app.module.ts`.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/tasks/ backend/test/tasks.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add tasks module with ANC schedule generation, listing, completion, overdue query"
```

---

### Task 5: `episode` module — `EpisodeService` (create, encounter notes, status, reads)

**Files:**
- Create: `backend/src/episode/dto/create-episode.dto.ts`
- Create: `backend/src/episode/dto/episode-response.dto.ts`
- Create: `backend/src/episode/dto/vitals.dto.ts`
- Create: `backend/src/episode/dto/record-encounter-note.dto.ts`
- Create: `backend/src/episode/dto/encounter-note-response.dto.ts`
- Create: `backend/src/episode/dto/update-episode-status.dto.ts`
- Create: `backend/src/episode/episode.service.ts`
- Test: `backend/src/episode/episode.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `AuditService` (Plan 1); `TasksService.generateInitialAncSchedule`
  (Task 4); `EventEmitter2` (Task 3); `person`, `pregnancy_episode`, `encounter_note` tables.
- Produces:
  - `EpisodeService.create(jwt, actorUserId, tenantId, dto: CreateEpisodeDto): Promise<EpisodeResponseDto>`
  - `EpisodeService.recordEncounterNote(jwt, actorUserId, episodeId, dto: RecordEncounterNoteDto): Promise<EncounterNoteResponseDto>`
  - `EpisodeService.updateStatus(jwt, actorUserId, episodeId, newStatus): Promise<EpisodeResponseDto>`
  - `EpisodeService.getById(jwt, episodeId): Promise<EpisodeResponseDto>`
  - `EpisodeService.listForCaseload(jwt, facilityId?): Promise<EpisodeResponseDto[]>`
  - `PersonNotFoundError`, `EpisodeNotFoundError` (thrown, caught by the controller in Task 6)
  - Emits `'episode.created'` and `'episode.clinical_data_updated'`, both with payload
    `{ episodeId: string; tenantId: string; actorUserId: string }` — see the Handoff section
    for Plan 3's exact contract.

- [ ] **Step 1: Write the DTOs**

Create `backend/src/episode/dto/create-episode.dto.ts`:
```typescript
import { IsDateString, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class CreateEpisodeDto {
  @IsUUID()
  personId!: string;

  @IsUUID()
  facilityId!: string;

  @IsOptional()
  @IsDateString()
  lmpDate?: string;

  @IsOptional()
  @IsDateString()
  estimatedDeliveryDate?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(45)
  gestationalAgeWeeks?: number;
}
```

Create `backend/src/episode/dto/episode-response.dto.ts`:
```typescript
export class EpisodeResponseDto {
  id!: string;
  personId!: string;
  facilityId!: string;
  lmpDate!: string | null;
  estimatedDeliveryDate!: string | null;
  gestationalAgeWeeks!: number | null;
  riskBand!: string | null;
  status!: string;
  createdAt!: string;
  updatedAt!: string;

  static fromRow(row: any): EpisodeResponseDto {
    const dto = new EpisodeResponseDto();
    dto.id = row.id;
    dto.personId = row.person_id;
    dto.facilityId = row.facility_id;
    dto.lmpDate = row.lmp_date;
    dto.estimatedDeliveryDate = row.estimated_delivery_date;
    dto.gestationalAgeWeeks = row.gestational_age_weeks;
    dto.riskBand = row.risk_band;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    dto.updatedAt = row.updated_at;
    return dto;
  }
}
```

Create `backend/src/episode/dto/vitals.dto.ts`:
```typescript
import { IsNumber, IsOptional, Max, Min } from 'class-validator';

// Numeric ranges are documented in this plan's Global Constraints section — wide
// physiological bounds meant to catch data-entry errors, not clinical edge cases.
export class VitalsDto {
  @IsOptional()
  @IsNumber()
  @Min(60)
  @Max(260)
  bpSystolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(40)
  @Max(150)
  bpDiastolic?: number;

  @IsOptional()
  @IsNumber()
  @Min(30)
  @Max(43)
  temperatureC?: number;

  @IsOptional()
  @IsNumber()
  @Min(2)
  @Max(20)
  hemoglobinGdl?: number;
}
```

Create `backend/src/episode/dto/record-encounter-note.dto.ts`:
```typescript
import { IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { VitalsDto } from './vitals.dto';

export class RecordEncounterNoteDto {
  @IsOptional()
  @IsString()
  @MaxLength(4000)
  noteText?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => VitalsDto)
  vitals?: VitalsDto;
}
```

Create `backend/src/episode/dto/encounter-note-response.dto.ts`:
```typescript
export class EncounterNoteResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  recordedBy!: string;
  recordedAt!: string;
  noteText!: string | null;
  vitals!: {
    bpSystolic: number | null;
    bpDiastolic: number | null;
    temperatureC: number | null;
    hemoglobinGdl: number | null;
  } | null;
  createdAt!: string;

  static fromRow(row: any): EncounterNoteResponseDto {
    const dto = new EncounterNoteResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.recordedBy = row.recorded_by;
    dto.recordedAt = row.recorded_at;
    dto.noteText = row.note_text;
    dto.vitals = row.vitals_json ?? null;
    dto.createdAt = row.created_at;
    return dto;
  }
}
```

Create `backend/src/episode/dto/update-episode-status.dto.ts`:
```typescript
import { IsIn } from 'class-validator';

// Allow-list includes 'Admitted' and 'Cancelled' even though this plan's own migration
// (Task 1) only adds the other seven values to the `pregnancy_episode.status` CHECK
// constraint. Plan 4 (Referral Lifecycle) extends that constraint via its own
// `ALTER TABLE` migration to add exactly these two values, because the referral state
// machine drives an episode to `Admitted` (referral arrived) and back to `Active` (referral
// failed/cancelled) — but Plan 4's `ReferralService` does that via a direct call to
// `EpisodeService.updateStatus()`, bypassing this DTO entirely (this DTO only guards the
// `PATCH /api/v1/pregnancy-episodes/:id/status` HTTP body). Without this allow-list
// extension, that HTTP endpoint itself would reject `Admitted`/`Cancelled` even after Plan
// 4's migration has run — exactly the "known cross-plan follow-up" Plan 4's own Global
// Constraints section flags as not fixed there. This fixes it here instead, so a
// clinician/nurse can also set those two states by hand through the endpoint, not only via
// the referral state machine. Execution order matters: run this plan (Plan 2) first, then
// Plan 4. Until Plan 4's migration has actually run, a PATCH with `status: "Admitted"` or
// `"Cancelled"` will pass this DTO's validation but still be rejected by the database's
// CHECK constraint — that is expected and fine, not a bug to work around here.
export class UpdateEpisodeStatusDto {
  @IsIn(['Draft', 'Active', 'Referred', 'Admitted', 'Delivered', 'PostnatalActive', 'Closed', 'Archived', 'Cancelled'])
  status!:
    | 'Draft'
    | 'Active'
    | 'Referred'
    | 'Admitted'
    | 'Delivered'
    | 'PostnatalActive'
    | 'Closed'
    | 'Archived'
    | 'Cancelled';
}
```

- [ ] **Step 2: Write the failing test for `create()`**

Create `backend/src/episode/episode.service.spec.ts` (starting with the `create()` tests —
later steps in this task append more `describe`/`it` blocks to this same file):
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { EventEmitter2 } from '@nestjs/event-emitter';
import {
  EpisodeService,
  PersonNotFoundError,
  EpisodeNotFoundError,
} from './episode.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';

function buildCreateClient(options: { personExists: boolean }) {
  return {
    from: (table: string) => {
      if (table === 'person') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                options.personExists
                  ? { data: { id: 'p1' }, error: null }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        };
      }
      if (table === 'pregnancy_episode') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'e1',
                  person_id: row.person_id,
                  facility_id: row.facility_id,
                  lmp_date: row.lmp_date,
                  estimated_delivery_date: row.estimated_delivery_date,
                  gestational_age_weeks: row.gestational_age_weeks,
                  risk_band: null,
                  status: row.status,
                  created_at: '2026-08-01T00:00:00.000Z',
                  updated_at: '2026-08-01T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

async function buildEpisodeService(
  supabaseService: SupabaseService,
  auditService: AuditService,
  tasksService: TasksService,
  eventEmitter: EventEmitter2,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      EpisodeService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
      { provide: TasksService, useValue: tasksService },
      { provide: EventEmitter2, useValue: eventEmitter },
    ],
  }).compile();
  return module.get<EpisodeService>(EpisodeService);
}

describe('EpisodeService', () => {
  describe('create', () => {
    it('creates an episode at status Active, generates the ANC schedule, and emits episode.created', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const generateScheduleMock = jest.fn().mockResolvedValue([]);
      const tasksService = {
        generateInitialAncSchedule: generateScheduleMock,
      } as unknown as TasksService;
      const emitMock = jest.fn();
      const eventEmitter = { emit: emitMock } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
      const result = await service.create('jwt', 'u1', 't1', { personId: 'p1', facilityId: 'f1' });

      expect(result.id).toBe('e1');
      expect(result.status).toBe('Active');
      expect(generateScheduleMock).toHaveBeenCalledWith('jwt', 'u1', 't1', 'e1');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'pregnancy_episode', action: 'created' }),
      );
      expect(emitMock).toHaveBeenCalledWith('episode.created', {
        episodeId: 'e1',
        tenantId: 't1',
        actorUserId: 'u1',
      });
    });

    it('throws PersonNotFoundError and never inserts an episode when the person does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ personExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const generateScheduleMock = jest.fn();
      const tasksService = {
        generateInitialAncSchedule: generateScheduleMock,
      } as unknown as TasksService;
      const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

      const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

      await expect(
        service.create('jwt', 'u1', 't1', { personId: 'missing', facilityId: 'f1' }),
      ).rejects.toThrow(PersonNotFoundError);
      expect(generateScheduleMock).not.toHaveBeenCalled();
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: FAIL — cannot find module `./episode.service`

- [ ] **Step 4: Implement `EpisodeService.create()`**

Create `backend/src/episode/episode.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { TasksService } from '../tasks/tasks.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { EpisodeResponseDto } from './dto/episode-response.dto';
import { RecordEncounterNoteDto } from './dto/record-encounter-note.dto';
import { EncounterNoteResponseDto } from './dto/encounter-note-response.dto';

export class PersonNotFoundError extends Error {
  constructor(public readonly personId: string) {
    super(`Person ${personId} not found`);
  }
}

export class EpisodeNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`Pregnancy episode ${episodeId} not found`);
  }
}

export interface EpisodeLifecycleEventPayload {
  episodeId: string;
  tenantId: string;
  actorUserId: string;
}

@Injectable()
export class EpisodeService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly tasksService: TasksService,
    private readonly eventEmitter: EventEmitter2,
  ) {}

  // EpisodeService.create() sets the new episode's status directly to 'Active', not
  // 'Draft'. The PRD's state diagram assumes a CHW-mobile app that can create a local,
  // not-yet-synced episode ('Draft') before it reaches the server. This build has no
  // offline-sync requirement — an always-online web app hits this API directly — so there
  // is no intermediate "not yet submitted" state to represent: by the time this method
  // runs at all, the full registration payload has already reached the server in one
  // request. This also matches the design spec's Section 5 registration flow, which treats
  // registration as a single atomic step that immediately assigns initial care tasks and
  // triggers risk assessment — behavior that belongs to an active episode, not a draft one.
  // 'Draft' remains a legal value in the pregnancy_episode.status CHECK constraint for
  // forward compatibility (e.g. a future multi-step registration wizard) but nothing in
  // this plan ever sets it.
  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateEpisodeDto,
  ): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: person, error: personError } = await client
      .from('person')
      .select('id')
      .eq('id', dto.personId)
      .single();
    if (personError || !person) {
      throw new PersonNotFoundError(dto.personId);
    }

    const { data, error } = await client
      .from('pregnancy_episode')
      .insert({
        person_id: dto.personId,
        facility_id: dto.facilityId,
        lmp_date: dto.lmpDate ?? null,
        estimated_delivery_date: dto.estimatedDeliveryDate ?? null,
        gestational_age_weeks: dto.gestationalAgeWeeks ?? null,
        status: 'Active',
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'pregnancy_episode',
      entityId: data.id,
      action: 'created',
      metadata: { personId: dto.personId, facilityId: dto.facilityId },
    });

    // Partial-failure note (accepted MVP limitation, not solved here): if task generation
    // below fails after the episode insert above has already committed, the episode is
    // left without its initial ANC schedule. supabase-js has no cross-table transaction
    // API, so this sequence (person check -> episode insert -> task insert) is
    // best-effort, not atomic. A retry/backfill path for orphaned episodes is future work,
    // not a distributed-transaction problem to solve in this plan.
    await this.tasksService.generateInitialAncSchedule(jwt, actorUserId, tenantId, data.id);

    const payload: EpisodeLifecycleEventPayload = { episodeId: data.id, tenantId, actorUserId };
    this.eventEmitter.emit('episode.created', payload);

    return EpisodeResponseDto.fromRow(data);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the failing test for `recordEncounterNote()`**

Append to `backend/src/episode/episode.service.spec.ts` (add these imports at the top —
`RecordEncounterNoteDto` isn't needed as a type import since the DTO literal is passed
inline — and add this `describe` block alongside `describe('create', ...)`):
```typescript
function buildEncounterNoteClient(options: { episodeExists: boolean }) {
  return {
    from: (table: string) => {
      if (table === 'pregnancy_episode') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                options.episodeExists
                  ? { data: { id: 'e1', facility: { tenant_id: 't1' } }, error: null }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        };
      }
      if (table === 'encounter_note') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'note-1',
                  pregnancy_episode_id: row.pregnancy_episode_id,
                  recorded_by: row.recorded_by,
                  recorded_at: '2026-08-01T00:00:00.000Z',
                  note_text: row.note_text,
                  vitals_json: row.vitals_json,
                  created_at: '2026-08-01T00:00:00.000Z',
                },
                error: null,
              }),
            }),
          }),
        };
      }
      throw new Error(`unexpected table ${table}`);
    },
  };
}

describe('recordEncounterNote', () => {
  it('records an encounter note and emits episode.clinical_data_updated with the derived tenant id', async () => {
    const supabaseService = {
      getClientForUser: () => buildEncounterNoteClient({ episodeExists: true }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const emitMock = jest.fn();
    const eventEmitter = { emit: emitMock } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
    const result = await service.recordEncounterNote('jwt', 'u1', 'e1', {
      noteText: 'Feeling fine.',
      vitals: { bpSystolic: 118, bpDiastolic: 76, temperatureC: 36.9, hemoglobinGdl: 12.1 },
    });

    expect(result.id).toBe('note-1');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({ tenantId: 't1', entityType: 'encounter_note', action: 'created' }),
    );
    expect(emitMock).toHaveBeenCalledWith('episode.clinical_data_updated', {
      episodeId: 'e1',
      tenantId: 't1',
      actorUserId: 'u1',
    });
  });

  it('throws EpisodeNotFoundError when the episode does not exist', async () => {
    const supabaseService = {
      getClientForUser: () => buildEncounterNoteClient({ episodeExists: false }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

    await expect(service.recordEncounterNote('jwt', 'u1', 'missing', {})).rejects.toThrow(
      EpisodeNotFoundError,
    );
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: FAIL — `service.recordEncounterNote is not a function`

- [ ] **Step 8: Implement `EpisodeService.recordEncounterNote()`**

Add this method to the `EpisodeService` class in `backend/src/episode/episode.service.ts`
(after `create()`):
```typescript
  async recordEncounterNote(
    jwt: string,
    actorUserId: string,
    episodeId: string,
    dto: RecordEncounterNoteDto,
  ): Promise<EncounterNoteResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: episode, error: episodeError } = await client
      .from('pregnancy_episode')
      .select('id, facility(tenant_id)')
      .eq('id', episodeId)
      .single();
    if (episodeError || !episode) {
      throw new EpisodeNotFoundError(episodeId);
    }
    const tenantId = (episode as any).facility?.tenant_id;

    const { data, error } = await client
      .from('encounter_note')
      .insert({
        pregnancy_episode_id: episodeId,
        recorded_by: actorUserId,
        note_text: dto.noteText ?? null,
        vitals_json: dto.vitals ?? null,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'encounter_note',
      entityId: data.id,
      action: 'created',
      metadata: { pregnancyEpisodeId: episodeId },
    });

    const payload: EpisodeLifecycleEventPayload = { episodeId, tenantId, actorUserId };
    this.eventEmitter.emit('episode.clinical_data_updated', payload);

    return EncounterNoteResponseDto.fromRow(data);
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: PASS

- [ ] **Step 10: Write the failing test for `updateStatus()`**

Append to `backend/src/episode/episode.service.spec.ts`:
```typescript
function buildStatusClient(options: { episodeExists: boolean }) {
  return {
    from: (_table: string) => ({
      update: (patch: any) => ({
        eq: () => ({
          select: () => ({
            single: async () =>
              options.episodeExists
                ? {
                    data: {
                      id: 'e1',
                      person_id: 'p1',
                      facility_id: 'f1',
                      lmp_date: null,
                      estimated_delivery_date: null,
                      gestational_age_weeks: null,
                      risk_band: null,
                      status: patch.status,
                      created_at: '2026-08-01T00:00:00.000Z',
                      updated_at: patch.updated_at,
                      facility: { tenant_id: 't1' },
                    },
                    error: null,
                  }
                : { data: null, error: { message: 'no rows' } },
          }),
        }),
      }),
    }),
  };
}

describe('updateStatus', () => {
  it('updates the episode status and logs an audit event with the derived tenant id', async () => {
    const supabaseService = {
      getClientForUser: () => buildStatusClient({ episodeExists: true }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
    const result = await service.updateStatus('jwt', 'u1', 'e1', 'Referred');

    expect(result.status).toBe('Referred');
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        entityType: 'pregnancy_episode',
        action: 'status_changed',
        metadata: { newStatus: 'Referred' },
      }),
    );
  });

  it('throws EpisodeNotFoundError when the episode does not exist', async () => {
    const supabaseService = {
      getClientForUser: () => buildStatusClient({ episodeExists: false }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

    await expect(service.updateStatus('jwt', 'u1', 'missing', 'Referred')).rejects.toThrow(
      EpisodeNotFoundError,
    );
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: FAIL — `service.updateStatus is not a function`

- [ ] **Step 12: Implement `EpisodeService.updateStatus()`**

Add this method to `EpisodeService`, after `recordEncounterNote()`. Note the "minimal
validation" design per this plan's brief: any string that passes `UpdateEpisodeStatusDto`'s
`@IsIn` check at the controller layer (Task 6) is accepted here without a transition-graph
check — the referral module (Plan 4) owns strict state-machine validation for its own
`referral.status`, and duplicating a transition graph here for `pregnancy_episode.status`
would be validating the same real-world event twice in two places that could drift apart:
```typescript
  async updateStatus(
    jwt: string,
    actorUserId: string,
    episodeId: string,
    newStatus: string,
  ): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data, error } = await client
      .from('pregnancy_episode')
      .update({ status: newStatus, updated_at: new Date().toISOString() })
      .eq('id', episodeId)
      .select('*, facility(tenant_id)')
      .single();
    if (error || !data) {
      throw new EpisodeNotFoundError(episodeId);
    }
    const tenantId = (data as any).facility?.tenant_id;

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'pregnancy_episode',
      entityId: episodeId,
      action: 'status_changed',
      metadata: { newStatus },
    });

    return EpisodeResponseDto.fromRow(data);
  }
```

- [ ] **Step 13: Run test to verify it passes**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: PASS

- [ ] **Step 14: Write the failing tests for `getById()` and `listForCaseload()`**

Append to `backend/src/episode/episode.service.spec.ts`:
```typescript
function buildGetByIdClient(options: { found: boolean }) {
  return {
    from: () => ({
      select: () => ({
        eq: () => ({
          single: async () =>
            options.found
              ? {
                  data: {
                    id: 'e1',
                    person_id: 'p1',
                    facility_id: 'f1',
                    lmp_date: null,
                    estimated_delivery_date: null,
                    gestational_age_weeks: null,
                    risk_band: 'low',
                    status: 'Active',
                    created_at: '2026-08-01T00:00:00.000Z',
                    updated_at: '2026-08-01T00:00:00.000Z',
                  },
                  error: null,
                }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
    }),
  };
}

function buildCaseloadClient(rows: any[]) {
  const eqMock = jest.fn();
  const builder: any = {
    eq: (...args: any[]) => {
      eqMock(...args);
      return builder;
    },
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  const selectMock = jest.fn().mockReturnValue(builder);
  return { client: { from: () => ({ select: selectMock }) }, eqMock };
}

describe('getById', () => {
  it('returns the episode when found', async () => {
    const supabaseService = {
      getClientForUser: () => buildGetByIdClient({ found: true }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
    const result = await service.getById('jwt', 'e1');

    expect(result.riskBand).toBe('low');
  });

  it('throws EpisodeNotFoundError when missing', async () => {
    const supabaseService = {
      getClientForUser: () => buildGetByIdClient({ found: false }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);

    await expect(service.getById('jwt', 'missing')).rejects.toThrow(EpisodeNotFoundError);
  });
});

describe('listForCaseload', () => {
  it('returns all visible episodes when no facilityId is given', async () => {
    const { client } = buildCaseloadClient([
      {
        id: 'e1',
        person_id: 'p1',
        facility_id: 'f1',
        lmp_date: null,
        estimated_delivery_date: null,
        gestational_age_weeks: null,
        risk_band: null,
        status: 'Active',
        created_at: '2026-08-01T00:00:00.000Z',
        updated_at: '2026-08-01T00:00:00.000Z',
      },
    ]);
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
    const result = await service.listForCaseload('jwt');

    expect(result).toHaveLength(1);
  });

  it('filters by facilityId when given', async () => {
    const { client, eqMock } = buildCaseloadClient([]);
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const tasksService = { generateInitialAncSchedule: jest.fn() } as unknown as TasksService;
    const eventEmitter = { emit: jest.fn() } as unknown as EventEmitter2;

    const service = await buildEpisodeService(supabaseService, auditService, tasksService, eventEmitter);
    await service.listForCaseload('jwt', 'f1');

    expect(eqMock).toHaveBeenCalledWith('facility_id', 'f1');
  });
});
```

- [ ] **Step 15: Run test to verify it fails**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: FAIL — `service.getById is not a function` (and `listForCaseload`)

- [ ] **Step 16: Implement `EpisodeService.getById()` and `EpisodeService.listForCaseload()`**

Add these two methods to `EpisodeService`, after `updateStatus()`:
```typescript
  async getById(jwt: string, episodeId: string): Promise<EpisodeResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('pregnancy_episode')
      .select('*')
      .eq('id', episodeId)
      .single();
    if (error || !data) {
      throw new EpisodeNotFoundError(episodeId);
    }
    return EpisodeResponseDto.fromRow(data);
  }

  async listForCaseload(jwt: string, facilityId?: string): Promise<EpisodeResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    let query = client.from('pregnancy_episode').select('*');
    if (facilityId) {
      query = query.eq('facility_id', facilityId);
    }
    const { data, error } = await query;
    if (error) {
      throw error;
    }
    return (data ?? []).map(EpisodeResponseDto.fromRow);
  }
```

- [ ] **Step 17: Run test to verify it passes**

Run: `cd backend && npm test -- episode.service.spec.ts`
Expected: PASS — all `EpisodeService` tests green.

- [ ] **Step 18: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/episode/
git commit -m "feat: add EpisodeService with create, encounter notes, status updates, caseload reads"
```

---

### Task 6: `EpisodeController`, module wiring, end-to-end tests

**Files:**
- Create: `backend/src/episode/episode.controller.ts`
- Create: `backend/src/episode/episode.module.ts`
- Test: `backend/test/episode.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `EpisodeService` (Task 5), `AuthGuard`/`CurrentUser` (Plan 1), `TasksModule`
  (Task 4, imported so `EpisodeModule` can inject `TasksService`).
- Produces:
  - `POST /api/v1/pregnancy-episodes` (any authenticated role — RLS scopes visibility, no
    `@Roles()` restriction per this plan's brief)
  - `GET /api/v1/pregnancy-episodes?facilityId=<id>`
  - `GET /api/v1/pregnancy-episodes/:id`
  - `POST /api/v1/pregnancy-episodes/:id/encounter-notes`
  - `PATCH /api/v1/pregnancy-episodes/:id/status`

- [ ] **Step 1: Write the controller**

Create `backend/src/episode/episode.controller.ts`:
```typescript
import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { EpisodeService, PersonNotFoundError, EpisodeNotFoundError } from './episode.service';
import { CreateEpisodeDto } from './dto/create-episode.dto';
import { RecordEncounterNoteDto } from './dto/record-encounter-note.dto';
import { UpdateEpisodeStatusDto } from './dto/update-episode-status.dto';

@Controller('pregnancy-episodes')
@UseGuards(AuthGuard)
export class EpisodeController {
  constructor(private readonly episodeService: EpisodeService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateEpisodeDto) {
    try {
      return await this.episodeService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof PersonNotFoundError) {
        throw new NotFoundException({
          error: { code: 'PERSON_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Get()
  list(@CurrentUser() user: CurrentUserPayload, @Query('facilityId') facilityId?: string) {
    return this.episodeService.listForCaseload(user.jwt, facilityId);
  }

  @Get(':id')
  async getById(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.episodeService.getById(user.jwt, id);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Post(':id/encounter-notes')
  async recordEncounterNote(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: RecordEncounterNoteDto,
  ) {
    try {
      return await this.episodeService.recordEncounterNote(user.jwt, user.id, id, dto);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateEpisodeStatusDto,
  ) {
    try {
      return await this.episodeService.updateStatus(user.jwt, user.id, id, dto.status);
    } catch (err) {
      if (err instanceof EpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Write the e2e tests**

Create `backend/test/episode.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('EpisodeController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects episode creation with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/pregnancy-episodes')
      .send({ personId: '11111111-1111-1111-1111-111111111111', facilityId: '11111111-1111-1111-1111-111111111111' })
      .expect(401);
  });

  it('rejects episode listing with no auth token', () => {
    return request(app.getHttpServer()).get('/api/v1/pregnancy-episodes').expect(401);
  });
});
```

Note: a positive-path e2e test (valid JWT, real 201/200 responses) requires the same
`tokenFor()`-style JWT-minting helper Plan 1's `rls.e2e-spec.ts` uses, plus seeded
facility/person/app_user rows — that full setup is exercised by the RLS-level e2e tests in
Task 2 and Plan 1's own precedent (Plan 1's `facility.e2e-spec.ts` also stops at the 401
case rather than a full authenticated round trip). This plan follows that same precedent
rather than introducing a heavier e2e harness Plan 1 didn't establish.

- [ ] **Step 3: Run the e2e tests to verify they pass**

Run: `cd backend && npm run test:e2e -- episode.e2e-spec.ts`
Expected: PASS

- [ ] **Step 4: Wire the module and commit**

Create `backend/src/episode/episode.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { EpisodeController } from './episode.controller';
import { EpisodeService } from './episode.service';
import { TasksModule } from '../tasks/tasks.module';

@Module({
  imports: [TasksModule],
  controllers: [EpisodeController],
  providers: [EpisodeService],
  exports: [EpisodeService],
})
export class EpisodeModule {}
```

Add `EpisodeModule` to the `imports` array in `backend/src/app.module.ts`.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/episode/ backend/test/episode.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add episode module controller and wire into app"
```

---

## Handoff to Plan 3, 4, 5

### Tables

**`pregnancy_episode`**
```
id uuid pk
person_id uuid fk -> person, not null
facility_id uuid fk -> facility, not null
lmp_date date nullable
estimated_delivery_date date nullable
gestational_age_weeks integer nullable (0-45)
risk_band text nullable, in ('low', 'medium', 'high')
status text not null, in ('Draft', 'Active', 'Referred', 'Delivered', 'PostnatalActive', 'Closed', 'Archived'), default 'Active'
created_at timestamptz
updated_at timestamptz
```
No `tenant_id` column — RLS/tenant scope is derived via `facility_id -> facility.tenant_id`.
No `Admitted`/`Cancelled` values (present in the PRD's diagram, not in the approved spec's
table) — Plan 4 (Referral) needs to decide explicitly whether it needs `Admitted`.

**`encounter_note`**
```
id uuid pk
pregnancy_episode_id uuid fk -> pregnancy_episode, not null
recorded_by uuid fk -> app_user, not null
recorded_at timestamptz not null, default now()
note_text text nullable
vitals_json jsonb nullable, shape: { bpSystolic?, bpDiastolic?, temperatureC?, hemoglobinGdl? } (all numbers, all optional)
created_at timestamptz
```
No `updated_at` (append-only). Numeric ranges (application-level, not DB-level — see Global
Constraints): `bpSystolic` 60-260, `bpDiastolic` 40-150, `temperatureC` 30-43,
`hemoglobinGdl` 2-20. This is exactly the clinical-input shape the risk rules engine (Plan
3) should read.

**`care_task`**
```
id uuid pk
pregnancy_episode_id uuid fk -> pregnancy_episode, not null
task_type text not null, in ('anc_visit', 'pnc_visit', 'newborn_check')
assigned_user_id uuid fk -> app_user, nullable
due_at timestamptz not null
completed_at timestamptz nullable
status text not null, in ('Scheduled', 'Due', 'Completed', 'Missed'), default 'Scheduled'
priority text not null, in ('routine', 'urgent'), default 'routine'
created_at timestamptz
updated_at timestamptz
```

### `EpisodeService` (`backend/src/episode/episode.service.ts`)

- `create(jwt: string, actorUserId: string, tenantId: string, dto: CreateEpisodeDto): Promise<EpisodeResponseDto>`
- `recordEncounterNote(jwt: string, actorUserId: string, episodeId: string, dto: RecordEncounterNoteDto): Promise<EncounterNoteResponseDto>`
- `updateStatus(jwt: string, actorUserId: string, episodeId: string, newStatus: string): Promise<EpisodeResponseDto>` — accepts any status value that passes the DB CHECK constraint; no transition-graph validation (that's Plan 4's job for `referral.status`). **This is the method Plan 4 calls to move an episode to `Referred` and back.**
- `getById(jwt: string, episodeId: string): Promise<EpisodeResponseDto>`
- `listForCaseload(jwt: string, facilityId?: string): Promise<EpisodeResponseDto[]>`
- Throws `PersonNotFoundError` (has `.personId`) and `EpisodeNotFoundError` (has `.episodeId`), both exported from `episode.service.ts`.

### `TasksService` (`backend/src/tasks/tasks.service.ts`)

- `generateInitialAncSchedule(jwt: string, actorUserId: string, tenantId: string, pregnancyEpisodeId: string): Promise<CareTaskResponseDto[]>`
- `listForUser(jwt: string, assignedUserId: string): Promise<CareTaskResponseDto[]>`
- `complete(jwt: string, actorUserId: string, taskId: string): Promise<CareTaskResponseDto>`
- `listOverdue(jwt: string, facilityId?: string): Promise<CareTaskResponseDto[]>` — read-only; no automated missed-task escalation exists yet (future work for whichever plan owns the Supervisor dashboard's alerting).
- Throws `CareTaskNotFoundError` (has `.taskId`), exported from `tasks.service.ts`.

### Events (`@nestjs/event-emitter`'s `EventEmitter2`, global via `EventEmitterModule.forRoot()`)

Both events share this exact payload shape (exported as `EpisodeLifecycleEventPayload` from
`episode.service.ts`):
```typescript
{ episodeId: string; tenantId: string; actorUserId: string }
```
- `'episode.created'` — emitted at the end of `EpisodeService.create()`, after the episode
  row and initial ANC schedule both exist.
- `'episode.clinical_data_updated'` — emitted at the end of
  `EpisodeService.recordEncounterNote()`, after the `encounter_note` row exists.

Plan 3 (risk scoring) should listen for both with `@OnEvent('episode.created')` /
`@OnEvent('episode.clinical_data_updated')` handlers and, on each, read the episode's latest
`encounter_note.vitals_json` (and any other clinical fields available at that point) to run
its rules engine — Plan 2 does not call into Plan 3 in either direction, only emits.

### DTOs (all under `backend/src/episode/dto/` or `backend/src/tasks/dto/`)

- `CreateEpisodeDto { personId: string (uuid); facilityId: string (uuid); lmpDate?: string; estimatedDeliveryDate?: string; gestationalAgeWeeks?: number }`
- `EpisodeResponseDto { id, personId, facilityId, lmpDate, estimatedDeliveryDate, gestationalAgeWeeks, riskBand, status, createdAt, updatedAt }` with `static fromRow(row): EpisodeResponseDto`
- `VitalsDto { bpSystolic?: number; bpDiastolic?: number; temperatureC?: number; hemoglobinGdl?: number }`
- `RecordEncounterNoteDto { noteText?: string; vitals?: VitalsDto }`
- `EncounterNoteResponseDto { id, pregnancyEpisodeId, recordedBy, recordedAt, noteText, vitals, createdAt }` with `static fromRow(row): EncounterNoteResponseDto`
- `UpdateEpisodeStatusDto { status: 'Draft' | 'Active' | 'Referred' | 'Admitted' | 'Delivered' | 'PostnatalActive' | 'Closed' | 'Archived' | 'Cancelled' }` — the DTO allow-list already includes `Admitted`/`Cancelled` in anticipation of Plan 4's `ALTER TABLE` migration (see the note beside the DTO definition in Task 5, Step 1); this plan's own schema (below) still only has the original seven values until Plan 4 runs.
- `CareTaskResponseDto { id, pregnancyEpisodeId, taskType, assignedUserId, dueAt, completedAt, status, priority, createdAt, updatedAt }` with `static fromRow(row): CareTaskResponseDto`

### REST endpoints

- `POST /api/v1/pregnancy-episodes` — any authenticated role
- `GET /api/v1/pregnancy-episodes?facilityId=<id>`
- `GET /api/v1/pregnancy-episodes/:id`
- `POST /api/v1/pregnancy-episodes/:id/encounter-notes`
- `PATCH /api/v1/pregnancy-episodes/:id/status`
- `GET /api/v1/tasks?assignedUserId=<id>` (defaults to caller's own id)
- `GET /api/v1/tasks/overdue?facilityId=<id>`
- `POST /api/v1/tasks/:id/complete`

### Not built in this plan (explicitly deferred)

- Facility-level RLS scoping (only tenant-level exists, matching Plan 1's precedent).
- Automated missed-task escalation (`listOverdue` is queryable; nothing runs on a schedule).
- Any strict `pregnancy_episode.status` transition graph — Plan 4 owns strict validation
  for `referral.status` only; `updateStatus()` here is intentionally permissive.
- A positive-path (valid-JWT) e2e test for the episode/task endpoints — only 401-on-missing-
  auth is covered, matching Plan 1's own e2e depth.

