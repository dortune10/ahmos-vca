# Referral Lifecycle Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `referral` module: creation (with a required receiving facility chosen
by the clinician/nurse at creation time), a strict state-machine for `referral.status`
transitions, and the side effects those transitions have on the linked pregnancy episode's
status — so a clinician can escalate a case to another facility, both sides can track it
through to completion, and invalid transitions are rejected exactly per the PRD's
`REFERRAL_INVALID_STATE` contract.

**Architecture:** One new NestJS module, `referral`, following Plan 1's modular-monolith
pattern. It depends on Plan 1's foundation (`SupabaseService`, `AuthGuard`, `CurrentUser`,
`AuditService`, `facility`/`person`/`app_user` tables) and Plan 2's `EpisodeService`
(imports `EpisodeModule` to call `EpisodeService.updateStatus()` as the mechanism for every
episode-status side effect this plan defines — `referral` never writes to
`pregnancy_episode` directly). Same no-ORM approach as Plans 1–2:
`@supabase/supabase-js` clients scoped to the caller's JWT, RLS as the actual enforcement
mechanism (`docs/DECISIONS.md` #21). The state-machine validation itself is plain
TypeScript (no framework dependency), so it can be unit-tested in isolation from any
Supabase mock.

**Tech Stack:** Same as Plans 1–2 (Node.js 20 LTS, NestJS 10.x, TypeScript 5.x,
`@supabase/supabase-js` v2, Jest + Supertest, Supabase CLI). No new dependencies.

## Global Constraints

Same as Plan 1 (Backend Foundation) — see that plan for the full list (API base path,
`X-Correlation-Id`, error response shape, no-ORM/RLS-as-source-of-truth, plain-SQL
migrations applied via the Supabase MCP's `apply_migration` tool against the hosted
`amhos` project (`wjgyivxvmqchlhgmxcxe`) — no local Docker, no CLI `db push`/`db reset`, no
`supabase link` (`docs/DECISIONS.md` #23) — `created_at`/`updated_at` convention). This plan
adds:

- **Migration numbering.** Plan 2's last two migrations were
  `00000000000004_episode_task_schema.sql` and
  `00000000000005_episode_task_rls_policies.sql` (confirmed by reading that plan in full).
  Plan 3 (Risk Scoring Engine) was authored in parallel from the same Plan 2 baseline and
  independently claimed `00000000000006`/`00000000000007` for its own `risk_assessment`
  schema/RLS migrations — that collision was expected, not a mistake by either plan's
  author. Plan 3 is being treated as keeping those two numbers, so this plan's two
  migrations are renumbered to `00000000000008` and `00000000000009` to resolve it: this
  plan now effectively continues the sequence after Plan 3's `00000000000007`, not directly
  after Plan 2's `00000000000005`. Plan 3 and this plan were both written in parallel from
  the same baseline; this renumbering is what actually resolves the expected overlap, rather
  than leaving it as a deferred execution-time cleanup.

- **`pregnancy_episode.status` gains `Admitted` and `Cancelled`.** Plan 2 shipped only the
  approved design spec's narrower 7-value set (`Draft, Active, Referred, Delivered,
  PostnatalActive, Closed, Archived`) and explicitly left the decision of whether to add the
  PRD's two additional states (`docs/PRD.md` Section 16's state diagram) to whichever plan
  needed them. This plan needs both: a referral that arrives at the receiving facility must
  be reflected as the woman now being physically at that facility (`Admitted`), and a
  referral that fails or is cancelled must return the episode to ordinary active care
  (`Active`) — see the side-effects table below. The migration in Task 1 extends the
  existing `CHECK` constraint via `ALTER TABLE ... DROP CONSTRAINT ... ADD CONSTRAINT`
  rather than hardcoding Postgres's default constraint-naming convention: it looks up the
  actual constraint name from `pg_constraint`/`pg_attribute` first, so it isn't fragile
  against exactly how Plan 2's migration happened to name it.

- **Episode-status side effects owned by this plan (call `EpisodeService.updateStatus`,
  never write `pregnancy_episode` directly):**

  | Referral event | Episode status becomes |
  |---|---|
  | Referral created | `Referred` |
  | Referral reaches `Arrived` | `Admitted` |
  | Referral reaches `Failed` or `Cancelled` | `Active` (the attempt didn't pan out — she's still in active care) |

  **Explicitly out of scope for this plan:** nothing in the current 8-plan MVP set records
  an actual delivery event, so nothing in this plan (or any plan so far) ever transitions an
  episode to `Delivered`, `PostnatalActive`, `Closed`, or `Archived`. That is a real, known
  gap — nothing here invents a delivery-recording feature to fill it. A referral reaching
  `Completed` (meaning: the receiving facility finished handling the case) intentionally
  does **not** change episode status at all, for the same reason — "completed referral" is
  not the same event as "delivered baby," and this plan does not conflate them.

- **`toFacilityId` is required at referral creation — this diverges from
  `docs/DECISIONS.md` #13.** Decision #13 says an auto-created referral (from the deferred
  WhatsApp assistant's danger-sign auto-escalation flow) starts with `to_facility_id = null`
  and gets picked later by whichever CHW/clinician is assigned. That decision is scoped to a
  different, deferred feature (automatic escalation with no human in the loop at creation
  time). In **this** plan, referral creation is always a direct clinician/nurse action
  through the web UI (design spec Section 2: "no bot involved — referrals are a direct
  clinician/nurse action here"), and the design spec's Core User Flow #3 has the clinician
  "creates a referral if escalation is needed, picking a receiving facility from the
  accepting-referrals list" as part of the same action. There is no later "pick a facility"
  step to defer to, so `toFacilityId` is a required field on `CreateReferralDto`, not
  nullable-then-backfilled. Do not import the null-then-pick-later pattern into this plan.

- **`referral` has no `updated_at` column**, unlike Plan 1's general "every business-data
  table gets `updated_at`" convention. The four milestone timestamps
  (`accepted_at`/`departed_at`/`arrived_at`/`closed_at`) already capture exactly when each
  meaningful state change happened, with more precision than a single generic `updated_at`
  would — the same reasoning Plan 2 used to justify `encounter_note` having no `updated_at`
  either. `status` itself changes independently of those four columns too (e.g. `Created` ->
  `Sent` sets no milestone timestamp at all), so a generic `updated_at` would be redundant
  with, not additive to, the audit trail this plan already writes on every transition.

- **RLS join strategy for `referral`: a single tenant join through `pregnancy_episode` is
  sufficient, deliberately not also joining through `to_facility_id`.** A referral
  references two facilities (`from_facility_id`, `to_facility_id`), but this MVP assumes a
  single tenant per deployment (Plan 1's tenant model), so both facilities on any given
  referral row are always in the same tenant as the episode's own facility — there is no
  cross-tenant referral to worry about. Separately: RLS granularity in this codebase is
  tenant-only, not facility-level (Plan 2's own documented gap — "RLS granularity matches
  Plan 1's precedent, not the spec's full ambition"). Because of that existing gap, a single
  tenant join through `pregnancy_episode` already grants visibility to every staff member in
  the tenant regardless of which facility they're at — which is exactly the behavior this
  table needs anyway: a receiving facility's clinician must be able to see referrals sent TO
  their facility even though the episode itself belongs to a different facility's caseload.
  No special-casing of `to_facility_id` is required to achieve that; it falls out of the
  existing tenant-only granularity for free. A future facility-level RLS hardening pass
  (already deferred by Plan 2) will need to explicitly `OR` across
  `from_facility_id`/`to_facility_id` when it happens — noted here so that pass doesn't miss
  this table.

- **Error response shape for this module's domain errors includes `correlationId`.** Plan
  1's Global Constraints define the error body shape as
  `{ "error": { "code", "message", "details", "correlationId" } }` for every response, but
  Plan 1's and Plan 2's own `NotFoundException` mappings (e.g. `CARE_TASK_NOT_FOUND`,
  `EPISODE_NOT_FOUND`) omit `correlationId` in practice — a real, pre-existing gap in those
  files. This plan does not go back and fix Plan 1/2's controllers (out of scope, not in
  this plan's file list), but every error body this plan's own controller produces
  (`REFERRAL_INVALID_STATE`, `REFERRAL_TARGET_FACILITY_NOT_ACCEPTING`,
  `REFERRAL_NOT_FOUND`, `INVALID_REFERRAL_DIRECTION`) includes a real `correlationId`
  generated via `crypto.randomUUID()`, matching the PRD's exact error contract in full —
  this is the one error contract the spec's acceptance criteria tests literally, so it gets
  built correctly from the start rather than inheriting the existing gap.

- **Known cross-plan follow-up (not fixed here): Plan 2's `UpdateEpisodeStatusDto`
  (`backend/src/episode/dto/update-episode-status.dto.ts`) still only allowlists the
  original 7 status values via `@IsIn`.** `Admitted` and `Cancelled` are only reachable in
  this plan through `ReferralService`'s internal calls to `EpisodeService.updateStatus()`,
  which is a direct method call bypassing that DTO entirely (the DTO only validates the
  `PATCH /api/v1/pregnancy-episodes/:id/status` HTTP body). This plan does not modify Plan
  2's DTO file. Consequence: a clinician cannot currently set an episode directly to
  `Admitted`/`Cancelled` by hand through that HTTP endpoint — only the referral state
  machine can drive those two values. If a future plan wants manual staff control over those
  states via that endpoint, `UpdateEpisodeStatusDto`'s `@IsIn` list needs extending then.

---

### Task 1: Schema migration — extend `pregnancy_episode.status`, create `referral`

**Files:**
- Create: `supabase/migrations/00000000000008_referral_schema.sql`
- Test: `backend/test/referral-schema.e2e-spec.ts`

**Interfaces:**
- Consumes: `pregnancy_episode`, `facility` tables (Plan 1/2).
- Produces: an extended `pregnancy_episode.status` CHECK constraint (adds `Admitted`,
  `Cancelled`) and a new `referral` table every later task in this plan queries —
  `referral(id uuid pk, pregnancy_episode_id uuid fk -> pregnancy_episode not null,
  from_facility_id uuid fk -> facility nullable, to_facility_id uuid fk -> facility not
  null, reason_code text not null, urgency text not null check in ('routine','urgent'),
  status text not null default 'Created' check in ('Created','Sent','Accepted','Dispatched',
  'InTransit','Arrived','Completed','Failed','Cancelled'), created_at timestamptz not null
  default now(), accepted_at timestamptz nullable, departed_at timestamptz nullable,
  arrived_at timestamptz nullable, closed_at timestamptz nullable)`.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000008_referral_schema.sql`:
```sql
-- Extend pregnancy_episode.status to include Admitted and Cancelled, completing the PRD's
-- full pregnancy-episode state diagram (docs/PRD.md Section 16: Draft -> Active -> Referred
-- -> Admitted -> Delivered -> PostnatalActive -> Closed -> Archived, plus Active ->
-- Cancelled). Plan 2 deliberately shipped only the approved design spec's narrower 7-value
-- set and left this decision to whichever plan needed the missing states explicitly (see
-- Plan 2's Global Constraints) — this plan needs both, per this plan's own Global
-- Constraints (episode-status side effects table).
--
-- The existing CHECK constraint on the status column was created unnamed by Plan 2's
-- migration (00000000000004_episode_task_schema.sql), so rather than hardcode Postgres's
-- default constraint-naming convention, this looks up the actual constraint name from the
-- system catalog and drops it dynamically.
do $$
declare
  status_check_constraint text;
begin
  select con.conname into status_check_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'pregnancy_episode'
    and con.contype = 'c'
    and att.attname = 'status';

  if status_check_constraint is not null then
    execute format('alter table pregnancy_episode drop constraint %I', status_check_constraint);
  end if;
end $$;

alter table pregnancy_episode add constraint pregnancy_episode_status_check
  check (status in (
    'Draft', 'Active', 'Referred', 'Admitted', 'Delivered', 'PostnatalActive', 'Closed',
    'Archived', 'Cancelled'
  ));

-- referral: created directly by clinicians/nurses through the web UI (no bot involved, per
-- the approved design spec Section 2). to_facility_id is required at creation time — see
-- this plan's Global Constraints for why that diverges from docs/DECISIONS.md #13's
-- null-then-pick-later pattern (that decision is for a different, deferred feature).
create table referral (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  from_facility_id uuid references facility (id),
  to_facility_id uuid not null references facility (id),
  reason_code text not null,
  urgency text not null check (urgency in ('routine', 'urgent')),
  status text not null default 'Created' check (
    status in ('Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled')
  ),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  departed_at timestamptz,
  arrived_at timestamptz,
  closed_at timestamptz
);
create index referral_pregnancy_episode_id_idx on referral (pregnancy_episode_id);
create index referral_from_facility_id_idx on referral (from_facility_id);
create index referral_to_facility_id_idx on referral (to_facility_id);
create index referral_status_idx on referral (status);

alter table referral enable row level security;
```

- [ ] **Step 2: Apply the migration**

Call the `apply_migration` MCP tool: `project_id: "wjgyivxvmqchlhgmxcxe"`,
`name: "referral_schema"`, `query: <the exact SQL from Step 1>`.
Expected: applies cleanly to the `amhos` project, no errors returned.

- [ ] **Step 3: Write the failing verification test**

Create `backend/test/referral-schema.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

describe('referral schema + pregnancy_episode status extension', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let originFacilityId: string;
  let receivingFacilityId: string;
  let personId: string;
  let episodeId: string;

  beforeAll(async () => {
    const { data: originFacility, error: originError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Origin Clinic', type: 'clinic' })
      .select()
      .single();
    expect(originError).toBeNull();
    originFacilityId = originFacility!.id;

    const { data: receivingFacility, error: receivingError } = await admin
      .from('facility')
      .insert({
        tenant_id: tenantId,
        name: 'Receiving Hospital',
        type: 'hospital',
        accepting_referrals: true,
      })
      .select()
      .single();
    expect(receivingError).toBeNull();
    receivingFacilityId = receivingFacility!.id;

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Referral', phone_primary: '+254700000100' })
      .select()
      .single();
    expect(personError).toBeNull();
    personId = person!.id;

    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personId, facility_id: originFacilityId, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();
    episodeId = episode!.id;
  });

  it('pregnancy_episode now accepts Admitted and Cancelled', async () => {
    const { error: admittedError } = await admin
      .from('pregnancy_episode')
      .update({ status: 'Admitted' })
      .eq('id', episodeId);
    expect(admittedError).toBeNull();

    const { error: cancelledError } = await admin
      .from('pregnancy_episode')
      .update({ status: 'Cancelled' })
      .eq('id', episodeId);
    expect(cancelledError).toBeNull();

    await admin.from('pregnancy_episode').update({ status: 'Active' }).eq('id', episodeId);
  });

  it('pregnancy_episode still rejects an invalid status after the extension', async () => {
    const { error } = await admin
      .from('pregnancy_episode')
      .update({ status: 'NotARealStatus' })
      .eq('id', episodeId);
    expect(error).not.toBeNull();
  });

  it('referral accepts a valid row and rejects an invalid urgency/status', async () => {
    const { error: goodError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      from_facility_id: originFacilityId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'urgent',
    });
    expect(goodError).toBeNull();

    const { error: badUrgencyError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'not-a-real-urgency',
    });
    expect(badUrgencyError).not.toBeNull();

    const { error: badStatusError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      to_facility_id: receivingFacilityId,
      reason_code: 'suspected_preeclampsia',
      urgency: 'urgent',
      status: 'NotARealStatus',
    });
    expect(badStatusError).not.toBeNull();
  });

  it('referral requires to_facility_id but allows a null from_facility_id', async () => {
    const { error } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      from_facility_id: null,
      to_facility_id: receivingFacilityId,
      reason_code: 'community_escalation',
      urgency: 'routine',
    });
    expect(error).toBeNull();

    const { error: missingToFacilityError } = await admin.from('referral').insert({
      pregnancy_episode_id: episodeId,
      reason_code: 'community_escalation',
      urgency: 'routine',
    });
    expect(missingToFacilityError).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- referral-schema.e2e-spec.ts`
Expected: FAIL if the migration wasn't applied yet, or already passes if Step 2 succeeded —
same "confirming, not introducing, the failure" caveat as Plan 1/2's own schema tasks.
Proceed regardless.

- [ ] **Step 5: Confirm pass**

Run: `cd backend && npm run test:e2e -- referral-schema.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/00000000000008_referral_schema.sql backend/test/referral-schema.e2e-spec.ts
git commit -m "feat: add referral table and extend pregnancy_episode.status with Admitted/Cancelled"
```

---

### Task 2: RLS policies for `referral`

**Files:**
- Create: `supabase/migrations/00000000000009_referral_rls_policies.sql`
- Test: `backend/test/referral-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `referral` table (Task 1), `private.auth_app_user()` helper (Plan 1, Task 4 —
  `private.` schema qualifier required after a real recursion/security-exposure bug found
  during Plan 1's execution; `public.auth_app_user()` no longer exists).
- Produces: tenant-isolation RLS policies on `referral`, joined through
  `pregnancy_episode_id -> pregnancy_episode.facility_id -> facility.tenant_id` per this
  plan's Global Constraints. Every later task in this plan relies on these policies already
  being in place.

- [ ] **Step 1: Write the failing RLS test**

Create `backend/test/referral-rls.e2e-spec.ts`:
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

describe('referral RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let originFacilityId: string; // tenant A
  let receivingFacilityId: string; // tenant A, a DIFFERENT facility than the origin
  let otherTenantFacilityId: string; // tenant B
  let clinicianAtReceivingId: string;
  let referralTenantAId: string;
  let referralTenantBId: string;

  beforeAll(async () => {
    const { data: originFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Origin Clinic', type: 'clinic' })
      .select()
      .single();
    originFacilityId = originFacility!.id;

    const { data: receivingFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Receiving Hospital', type: 'hospital', accepting_referrals: true })
      .select()
      .single();
    receivingFacilityId = receivingFacility!.id;

    const { data: otherTenantFacility } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'Other Tenant Facility', type: 'clinic' })
      .select()
      .single();
    otherTenantFacilityId = otherTenantFacility!.id;

    const { data: personA } = await admin
      .from('person')
      .insert({ tenant_id: tenantA, first_name: 'Amina', phone_primary: '+254700000030' })
      .select()
      .single();

    const { data: personB } = await admin
      .from('person')
      .insert({ tenant_id: tenantB, first_name: 'Beatrice', phone_primary: '+254700000040' })
      .select()
      .single();

    const { data: episodeA } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personA!.id, facility_id: originFacilityId, status: 'Active' })
      .select()
      .single();

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: otherTenantFacilityId, status: 'Active' })
      .select()
      .single();

    const { data: referralA } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeA!.id,
        from_facility_id: originFacilityId,
        to_facility_id: receivingFacilityId,
        reason_code: 'suspected_preeclampsia',
        urgency: 'urgent',
      })
      .select()
      .single();
    referralTenantAId = referralA!.id;

    const { data: referralB } = await admin
      .from('referral')
      .insert({
        pregnancy_episode_id: episodeB!.id,
        to_facility_id: otherTenantFacilityId,
        reason_code: 'suspected_preeclampsia',
        urgency: 'routine',
      })
      .select()
      .single();
    referralTenantBId = referralB!.id;

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `clinician-receiving-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    clinicianAtReceivingId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: clinicianAtReceivingId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'clinician',
      facility_id: receivingFacilityId, // staffs the RECEIVING facility, not the origin
      full_name: 'Clinician Receiving',
    });
  });

  it(
    "a clinician staffed at the receiving facility (not the episode's origin facility, " +
      'same tenant) can still see the referral sent to their facility (fails before ' +
      'policies exist: deny-all hides it too)',
    async () => {
      const userClient = createClient(SUPABASE_URL, ANON_KEY, {
        global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAtReceivingId)}` } },
      });

      const { data } = await userClient.from('referral').select('id').eq('id', referralTenantAId);
      const ids = (data ?? []).map((row) => row.id);
      expect(ids).toContain(referralTenantAId);
    },
  );

  it('the same clinician cannot see a referral belonging to a different tenant', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAtReceivingId)}` } },
    });

    const { data } = await userClient.from('referral').select('id');
    const ids = (data ?? []).map((row) => row.id);
    expect(ids).not.toContain(referralTenantBId);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- referral-rls.e2e-spec.ts`
Expected: FAIL — with RLS enabled and no policies yet, deny-all hides the first test's own
tenant-A row too, same signal Plan 1 Task 4 / Plan 2 Task 2 rely on.

- [ ] **Step 3: Write the RLS policies**

Create `supabase/migrations/00000000000009_referral_rls_policies.sql`:
```sql
-- referral RLS is tenant-scoped via a single join through pregnancy_episode -> facility,
-- the same pattern Plan 2 established for pregnancy_episode/encounter_note/care_task. A
-- referral references two facilities (from_facility_id/to_facility_id), but this MVP
-- assumes a single tenant per deployment (Plan 1's tenant model), so both facilities on any
-- given referral row are always in the same tenant as the episode's own facility. Also: RLS
-- granularity in this codebase is tenant-only, not facility-level (Plan 2's own documented
-- gap, "RLS granularity matches Plan 1's precedent, not the spec's full ambition") — so a
-- single tenant join already grants visibility to every staff member in the tenant
-- regardless of which facility they're at. That is exactly the behavior this table needs: a
-- receiving facility's clinician must see referrals sent TO their facility even though the
-- episode itself belongs to a different facility's caseload. No additional join through
-- to_facility_id is required to achieve that — it falls out of the existing tenant-only
-- granularity for free. A future facility-level RLS hardening pass (already deferred by
-- Plan 2) will need to explicitly OR across from_facility_id/to_facility_id when it
-- happens; noted here so that pass doesn't miss this table.
create policy "referral_select_tenant" on referral
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "referral_insert_tenant" on referral
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "referral_update_tenant" on referral
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
-- No delete policy: referrals are never deleted, only transitioned to a terminal status
-- (Completed/Failed/Cancelled), consistent with the audit-trail requirement that referral
-- history is never destroyed.
```

- [ ] **Step 4: Apply and run test to verify it passes**

Call the `apply_migration` MCP tool: `project_id: "wjgyivxvmqchlhgmxcxe"`,
`name: "referral_rls_policies"`, `query: <the exact SQL from Step 3>`. Then call the
`get_advisors` MCP tool with `project_id: "wjgyivxvmqchlhgmxcxe"`, `type: "security"` and
confirm it reports no findings for `referral` (no missing-policy findings) or for the
`pregnancy_episode` status constraint altered in Task 1. Then run:
```bash
cd backend && npm run test:e2e -- referral-rls.e2e-spec.ts
```
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/00000000000009_referral_rls_policies.sql backend/test/referral-rls.e2e-spec.ts
git commit -m "feat: add tenant-isolation RLS policies for referral"
```

---

### Task 3: Referral state machine — strict transition graph + `InvalidReferralStateError`

**Files:**
- Create: `backend/src/referral/referral-state-machine.ts`
- Test: `backend/src/referral/referral-state-machine.spec.ts`

**Interfaces:**
- Produces:
  - `type ReferralStatus = 'Created' | 'Sent' | 'Accepted' | 'Dispatched' | 'InTransit' | 'Arrived' | 'Completed' | 'Failed' | 'Cancelled'`
  - `REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]>` — the exact
    valid-transition graph (see below).
  - `TERMINAL_REFERRAL_STATUSES: ReferralStatus[]` — `['Completed', 'Failed', 'Cancelled']`.
  - `InvalidReferralStateError` (has `.currentStatus`, `.attemptedStatus`).
  - `assertValidReferralTransition(currentStatus: string, attemptedStatus: string): void` —
    throws `InvalidReferralStateError` if the transition isn't in the graph; used by
    `ReferralService.updateStatus()` (Task 4).
- Consumes: nothing — pure TypeScript, no Supabase/Nest dependency, testable in complete
  isolation.

The exact valid transition graph (per the design spec Section 4/Core User Flow #4 and
`docs/PRD.md`'s Feature: Referral Management state list):

```
Created    -> Sent, Cancelled
Sent       -> Accepted, Cancelled
Accepted   -> Dispatched, Cancelled
Dispatched -> InTransit, Failed
InTransit  -> Arrived, Failed
Arrived    -> Completed
Completed  -> (terminal, no exits)
Failed     -> (terminal, no exits)
Cancelled  -> (terminal, no exits)
```

- [ ] **Step 1: Write the failing test**

Create `backend/src/referral/referral-state-machine.spec.ts`:
```typescript
import {
  REFERRAL_STATUS_TRANSITIONS,
  TERMINAL_REFERRAL_STATUSES,
  InvalidReferralStateError,
  assertValidReferralTransition,
  ReferralStatus,
} from './referral-state-machine';

const ALL_STATUSES: ReferralStatus[] = [
  'Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled',
];

describe('referral state machine', () => {
  describe('valid transitions', () => {
    const validCases: Array<[ReferralStatus, ReferralStatus]> = [
      ['Created', 'Sent'],
      ['Created', 'Cancelled'],
      ['Sent', 'Accepted'],
      ['Sent', 'Cancelled'],
      ['Accepted', 'Dispatched'],
      ['Accepted', 'Cancelled'],
      ['Dispatched', 'InTransit'],
      ['Dispatched', 'Failed'],
      ['InTransit', 'Arrived'],
      ['InTransit', 'Failed'],
      ['Arrived', 'Completed'],
    ];

    it.each(validCases)('allows %s -> %s', (from, to) => {
      expect(() => assertValidReferralTransition(from, to)).not.toThrow();
    });

    it('the transition table has no valid transitions beyond these 11', () => {
      const total = Object.values(REFERRAL_STATUS_TRANSITIONS).reduce(
        (sum, targets) => sum + targets.length,
        0,
      );
      expect(total).toBe(validCases.length);
    });
  });

  describe('invalid transitions', () => {
    it('rejects the PRD example: Completed -> InTransit', () => {
      // Gherkin (docs/PRD.md "Invalid referral transition" scenario):
      //   Given a referral is in status Completed
      //   When a user attempts to change the status to InTransit
      //   Then the API shall reject the request (this unit proves the domain-level
      //   rejection; Task 5's e2e test proves the HTTP 409 + REFERRAL_INVALID_STATE
      //   contract on top of it)
      expect(() => assertValidReferralTransition('Completed', 'InTransit')).toThrow(
        InvalidReferralStateError,
      );
      try {
        assertValidReferralTransition('Completed', 'InTransit');
        fail('expected assertValidReferralTransition to throw');
      } catch (err) {
        expect(err).toBeInstanceOf(InvalidReferralStateError);
        const typed = err as InvalidReferralStateError;
        expect(typed.currentStatus).toBe('Completed');
        expect(typed.attemptedStatus).toBe('InTransit');
        expect(typed.message).toBe('Referral cannot transition from Completed to InTransit');
      }
    });

    const invalidCases: Array<[ReferralStatus, ReferralStatus]> = [
      ['Created', 'Accepted'], // skips Sent
      ['Created', 'Dispatched'],
      ['Sent', 'Dispatched'], // skips Accepted
      ['Accepted', 'InTransit'], // skips Dispatched
      ['Arrived', 'Failed'], // Arrived only allows Completed
      ['Dispatched', 'Arrived'], // skips InTransit
    ];

    it.each(invalidCases)('rejects %s -> %s', (from, to) => {
      expect(() => assertValidReferralTransition(from, to)).toThrow(InvalidReferralStateError);
    });
  });

  describe('terminal states have no exits', () => {
    it.each(TERMINAL_REFERRAL_STATUSES)('%s cannot transition to any other status', (terminal) => {
      for (const target of ALL_STATUSES) {
        expect(() => assertValidReferralTransition(terminal, target)).toThrow(
          InvalidReferralStateError,
        );
      }
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- referral-state-machine.spec.ts`
Expected: FAIL — cannot find module `./referral-state-machine`

- [ ] **Step 3: Implement the state machine**

Create `backend/src/referral/referral-state-machine.ts`:
```typescript
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

// Exact graph per the design spec (Section 4 / Core User Flow #4) and docs/PRD.md's
// "Feature: Referral Management" states list. Completed/Failed/Cancelled are terminal —
// no key for them means no outgoing transitions.
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

export class InvalidReferralStateError extends Error {
  constructor(
    public readonly currentStatus: string,
    public readonly attemptedStatus: string,
  ) {
    super(`Referral cannot transition from ${currentStatus} to ${attemptedStatus}`);
  }
}

export function assertValidReferralTransition(
  currentStatus: string,
  attemptedStatus: string,
): void {
  const allowed = REFERRAL_STATUS_TRANSITIONS[currentStatus as ReferralStatus];
  if (!allowed || !allowed.includes(attemptedStatus as ReferralStatus)) {
    throw new InvalidReferralStateError(currentStatus, attemptedStatus);
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- referral-state-machine.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/referral/referral-state-machine.ts backend/src/referral/referral-state-machine.spec.ts
git commit -m "feat: add referral state machine with strict transition graph"
```

---

### Task 4: `ReferralService` — create, updateStatus, getById, listForFacility

**Files:**
- Create: `backend/src/referral/dto/create-referral.dto.ts`
- Create: `backend/src/referral/dto/update-referral-status.dto.ts`
- Create: `backend/src/referral/dto/referral-response.dto.ts`
- Create: `backend/src/referral/referral.service.ts`
- Test: `backend/src/referral/referral.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService`, `AuditService` (Plan 1); `EpisodeService.updateStatus`
  (Plan 2); `assertValidReferralTransition`, `TERMINAL_REFERRAL_STATUSES`, `ReferralStatus`
  (Task 3); `facility`, `pregnancy_episode`, `referral` tables.
- Produces:
  - `ReferralService.create(jwt: string, actorUserId: string, tenantId: string, dto: CreateReferralDto): Promise<ReferralResponseDto>`
  - `ReferralService.updateStatus(jwt: string, actorUserId: string, referralId: string, newStatus: string): Promise<ReferralResponseDto>`
  - `ReferralService.getById(jwt: string, referralId: string): Promise<ReferralResponseDto>`
  - `ReferralService.listForFacility(jwt: string, facilityId: string, direction: 'incoming' | 'outgoing'): Promise<ReferralResponseDto[]>`
  - `ReferralNotFoundError` (has `.referralId`), `TargetFacilityNotAcceptingReferralsError`
    (has `.facilityId`) — both exported from `referral.service.ts`, caught by the controller
    (Task 5).

- [ ] **Step 1: Write the DTOs**

Create `backend/src/referral/dto/create-referral.dto.ts`:
```typescript
import { IsIn, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

export class CreateReferralDto {
  @IsUUID()
  pregnancyEpisodeId!: string;

  @IsUUID()
  toFacilityId!: string;

  @IsOptional()
  @IsUUID()
  fromFacilityId?: string;

  @IsString()
  @MaxLength(200)
  reasonCode!: string;

  @IsIn(['routine', 'urgent'])
  urgency!: 'routine' | 'urgent';
}
```

Create `backend/src/referral/dto/update-referral-status.dto.ts`:
```typescript
import { IsIn } from 'class-validator';

export class UpdateReferralStatusDto {
  @IsIn(['Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled'])
  status!: string;
}
```

Create `backend/src/referral/dto/referral-response.dto.ts`:
```typescript
export class ReferralResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  fromFacilityId!: string | null;
  toFacilityId!: string;
  reasonCode!: string;
  urgency!: string;
  status!: string;
  createdAt!: string;
  acceptedAt!: string | null;
  departedAt!: string | null;
  arrivedAt!: string | null;
  closedAt!: string | null;

  static fromRow(row: any): ReferralResponseDto {
    const dto = new ReferralResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.fromFacilityId = row.from_facility_id;
    dto.toFacilityId = row.to_facility_id;
    dto.reasonCode = row.reason_code;
    dto.urgency = row.urgency;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    dto.acceptedAt = row.accepted_at;
    dto.departedAt = row.departed_at;
    dto.arrivedAt = row.arrived_at;
    dto.closedAt = row.closed_at;
    return dto;
  }
}
```

- [ ] **Step 2: Write the failing test for `create()`**

Create `backend/src/referral/referral.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import {
  ReferralService,
  ReferralNotFoundError,
  TargetFacilityNotAcceptingReferralsError,
} from './referral.service';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { EpisodeService } from '../episode/episode.service';
import { InvalidReferralStateError } from './referral-state-machine';

function buildCreateClient(options: { facilityAccepting: boolean; facilityExists: boolean }) {
  return {
    from: (table: string) => {
      if (table === 'facility') {
        return {
          select: () => ({
            eq: () => ({
              single: async () =>
                options.facilityExists
                  ? { data: { id: 'f2', accepting_referrals: options.facilityAccepting }, error: null }
                  : { data: null, error: { message: 'no rows' } },
            }),
          }),
        };
      }
      if (table === 'referral') {
        return {
          insert: (row: any) => ({
            select: () => ({
              single: async () => ({
                data: {
                  id: 'r1',
                  pregnancy_episode_id: row.pregnancy_episode_id,
                  from_facility_id: row.from_facility_id,
                  to_facility_id: row.to_facility_id,
                  reason_code: row.reason_code,
                  urgency: row.urgency,
                  status: row.status,
                  created_at: '2026-08-01T00:00:00.000Z',
                  accepted_at: null,
                  departed_at: null,
                  arrived_at: null,
                  closed_at: null,
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

async function buildReferralService(
  supabaseService: SupabaseService,
  auditService: AuditService,
  episodeService: EpisodeService,
) {
  const module: TestingModule = await Test.createTestingModule({
    providers: [
      ReferralService,
      { provide: SupabaseService, useValue: supabaseService },
      { provide: AuditService, useValue: auditService },
      { provide: EpisodeService, useValue: episodeService },
    ],
  }).compile();
  return module.get<ReferralService>(ReferralService);
}

describe('ReferralService', () => {
  describe('create', () => {
    it('creates a referral, moves the episode to Referred, and logs an audit event', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: true, facilityExists: true }),
      } as unknown as SupabaseService;
      const auditLogMock = jest.fn().mockResolvedValue(undefined);
      const auditService = { log: auditLogMock } as unknown as AuditService;
      const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Referred' });
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.create('jwt', 'u1', 't1', {
        pregnancyEpisodeId: 'e1',
        toFacilityId: 'f2',
        reasonCode: 'suspected_preeclampsia',
        urgency: 'urgent',
      });

      expect(result.id).toBe('r1');
      expect(result.status).toBe('Created');
      expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Referred');
      expect(auditLogMock).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: 't1', entityType: 'referral', action: 'created' }),
      );
    });

    it('rejects with TargetFacilityNotAcceptingReferralsError when the target facility is not accepting referrals', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: false, facilityExists: true }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const updateStatusMock = jest.fn();
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(
        service.create('jwt', 'u1', 't1', {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'f2',
          reasonCode: 'suspected_preeclampsia',
          urgency: 'urgent',
        }),
      ).rejects.toThrow(TargetFacilityNotAcceptingReferralsError);
      expect(updateStatusMock).not.toHaveBeenCalled();
    });

    it('rejects with TargetFacilityNotAcceptingReferralsError when the target facility does not exist', async () => {
      const supabaseService = {
        getClientForUser: () => buildCreateClient({ facilityAccepting: true, facilityExists: false }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn() } as unknown as AuditService;
      const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);

      await expect(
        service.create('jwt', 'u1', 't1', {
          pregnancyEpisodeId: 'e1',
          toFacilityId: 'missing',
          reasonCode: 'suspected_preeclampsia',
          urgency: 'urgent',
        }),
      ).rejects.toThrow(TargetFacilityNotAcceptingReferralsError);
    });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: FAIL — cannot find module `./referral.service`

- [ ] **Step 4: Implement `ReferralService.create()`**

Create `backend/src/referral/referral.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { EpisodeService } from '../episode/episode.service';
import { CreateReferralDto } from './dto/create-referral.dto';
import { ReferralResponseDto } from './dto/referral-response.dto';
import {
  assertValidReferralTransition,
  TERMINAL_REFERRAL_STATUSES,
  ReferralStatus,
} from './referral-state-machine';

export class ReferralNotFoundError extends Error {
  constructor(public readonly referralId: string) {
    super(`Referral ${referralId} not found`);
  }
}

export class TargetFacilityNotAcceptingReferralsError extends Error {
  constructor(public readonly facilityId: string) {
    super(
      `Facility ${facilityId} is not accepting referrals (it either does not exist or ` +
        `accepting_referrals is false)`,
    );
  }
}

@Injectable()
export class ReferralService {
  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly episodeService: EpisodeService,
  ) {}

  async create(
    jwt: string,
    actorUserId: string,
    tenantId: string,
    dto: CreateReferralDto,
  ): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: facility, error: facilityError } = await client
      .from('facility')
      .select('id, accepting_referrals')
      .eq('id', dto.toFacilityId)
      .single();
    if (facilityError || !facility || facility.accepting_referrals !== true) {
      throw new TargetFacilityNotAcceptingReferralsError(dto.toFacilityId);
    }

    const { data, error } = await client
      .from('referral')
      .insert({
        pregnancy_episode_id: dto.pregnancyEpisodeId,
        from_facility_id: dto.fromFacilityId ?? null,
        to_facility_id: dto.toFacilityId,
        reason_code: dto.reasonCode,
        urgency: dto.urgency,
        status: 'Created',
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    // Episode side effect first, audit event second — this plan's consistent ordering for
    // both create() and updateStatus() (see Step 8 below).
    await this.episodeService.updateStatus(jwt, actorUserId, dto.pregnancyEpisodeId, 'Referred');

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'referral',
      entityId: data.id,
      action: 'created',
      metadata: {
        toFacilityId: dto.toFacilityId,
        fromFacilityId: dto.fromFacilityId ?? null,
        urgency: dto.urgency,
        reasonCode: dto.reasonCode,
      },
    });

    return ReferralResponseDto.fromRow(data);
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: PASS

- [ ] **Step 6: Write the failing tests for `updateStatus()`**

Append to `backend/src/referral/referral.service.spec.ts` (add this `describe` block
alongside `describe('create', ...)`):
```typescript
function buildUpdateStatusClient(options: { found: boolean; existingStatus?: string }) {
  const referralTable = {
    select: () => ({
      eq: () => ({
        single: async () =>
          options.found
            ? { data: { status: options.existingStatus }, error: null }
            : { data: null, error: { message: 'no rows' } },
      }),
    }),
    update: (patch: any) => ({
      eq: () => ({
        select: () => ({
          single: async () => ({
            data: {
              id: 'r1',
              pregnancy_episode_id: 'e1',
              from_facility_id: 'f1',
              to_facility_id: 'f2',
              reason_code: 'suspected_preeclampsia',
              urgency: 'urgent',
              status: patch.status,
              created_at: '2026-08-01T00:00:00.000Z',
              accepted_at: patch.accepted_at ?? null,
              departed_at: patch.departed_at ?? null,
              arrived_at: patch.arrived_at ?? null,
              closed_at: patch.closed_at ?? null,
              pregnancy_episode: { facility_id: 'f1', facility: { tenant_id: 't1' } },
            },
            error: null,
          }),
        }),
      }),
    }),
  };
  return { from: () => referralTable };
}

describe('updateStatus', () => {
  it('accepts a valid transition, stamps the milestone timestamp, and logs an audit event with from/to', async () => {
    const supabaseService = {
      getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Sent' }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn().mockResolvedValue(undefined);
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Active' });
    const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    const result = await service.updateStatus('jwt', 'u1', 'r1', 'Accepted');

    expect(result.status).toBe('Accepted');
    expect(result.acceptedAt).not.toBeNull();
    expect(auditLogMock).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        entityType: 'referral',
        action: 'status_changed',
        metadata: { from: 'Sent', to: 'Accepted' },
      }),
    );
    // Accepted is neither Arrived nor a terminal status, so no episode side effect fires
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it('reaching Arrived moves the linked episode to Admitted', async () => {
    const supabaseService = {
      getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'InTransit' }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Admitted' });
    const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    const result = await service.updateStatus('jwt', 'u1', 'r1', 'Arrived');

    expect(result.status).toBe('Arrived');
    expect(result.arrivedAt).not.toBeNull();
    expect(result.closedAt).toBeNull();
    expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Admitted');
  });

  it.each(['Failed', 'Cancelled'])(
    'reaching %s reverts the linked episode to Active and stamps closed_at',
    async (terminalStatus) => {
      const fromStatus = terminalStatus === 'Failed' ? 'InTransit' : 'Sent';
      const supabaseService = {
        getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: fromStatus }),
      } as unknown as SupabaseService;
      const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
      const updateStatusMock = jest.fn().mockResolvedValue({ id: 'e1', status: 'Active' });
      const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

      const service = await buildReferralService(supabaseService, auditService, episodeService);
      const result = await service.updateStatus('jwt', 'u1', 'r1', terminalStatus);

      expect(result.status).toBe(terminalStatus);
      expect(result.closedAt).not.toBeNull();
      expect(updateStatusMock).toHaveBeenCalledWith('jwt', 'u1', 'e1', 'Active');
    },
  );

  it('reaching Completed stamps closed_at but does not touch the episode status', async () => {
    const supabaseService = {
      getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Arrived' }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn().mockResolvedValue(undefined) } as unknown as AuditService;
    const updateStatusMock = jest.fn();
    const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    const result = await service.updateStatus('jwt', 'u1', 'r1', 'Completed');

    expect(result.status).toBe('Completed');
    expect(result.closedAt).not.toBeNull();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });

  it('throws ReferralNotFoundError when the referral does not exist', async () => {
    const supabaseService = {
      getClientForUser: () => buildUpdateStatusClient({ found: false }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);

    await expect(service.updateStatus('jwt', 'u1', 'missing', 'Sent')).rejects.toThrow(
      ReferralNotFoundError,
    );
  });

  it('throws InvalidReferralStateError for the PRD example Completed -> InTransit and never touches the row', async () => {
    const supabaseService = {
      getClientForUser: () => buildUpdateStatusClient({ found: true, existingStatus: 'Completed' }),
    } as unknown as SupabaseService;
    const auditLogMock = jest.fn();
    const auditService = { log: auditLogMock } as unknown as AuditService;
    const updateStatusMock = jest.fn();
    const episodeService = { updateStatus: updateStatusMock } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);

    await expect(service.updateStatus('jwt', 'u1', 'r1', 'InTransit')).rejects.toThrow(
      InvalidReferralStateError,
    );
    expect(auditLogMock).not.toHaveBeenCalled();
    expect(updateStatusMock).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 7: Run test to verify it fails**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: FAIL — `service.updateStatus is not a function`

- [ ] **Step 8: Implement `ReferralService.updateStatus()`**

Add this method to the `ReferralService` class in `backend/src/referral/referral.service.ts`
(after `create()`):
```typescript
  async updateStatus(
    jwt: string,
    actorUserId: string,
    referralId: string,
    newStatus: string,
  ): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: existing, error: fetchError } = await client
      .from('referral')
      .select('status')
      .eq('id', referralId)
      .single();
    if (fetchError || !existing) {
      throw new ReferralNotFoundError(referralId);
    }

    assertValidReferralTransition(existing.status, newStatus);

    const now = new Date().toISOString();
    const patch: Record<string, unknown> = { status: newStatus };
    if (newStatus === 'Accepted') patch.accepted_at = now;
    if (newStatus === 'Dispatched') patch.departed_at = now;
    if (newStatus === 'Arrived') patch.arrived_at = now;
    if (TERMINAL_REFERRAL_STATUSES.includes(newStatus as ReferralStatus)) patch.closed_at = now;

    const { data, error } = await client
      .from('referral')
      .update(patch)
      .eq('id', referralId)
      .select('*, pregnancy_episode(facility_id, facility(tenant_id))')
      .single();
    if (error || !data) {
      throw new ReferralNotFoundError(referralId);
    }
    const tenantId = (data as any).pregnancy_episode?.facility?.tenant_id;

    // Episode-status side effects (this plan's Global Constraints table) — Arrived means
    // she is now physically at the receiving facility; Failed/Cancelled means the referral
    // attempt didn't pan out and she reverts to ordinary active care. Completed and every
    // other status leave the episode's status untouched.
    if (newStatus === 'Arrived') {
      await this.episodeService.updateStatus(jwt, actorUserId, data.pregnancy_episode_id, 'Admitted');
    } else if (newStatus === 'Failed' || newStatus === 'Cancelled') {
      await this.episodeService.updateStatus(jwt, actorUserId, data.pregnancy_episode_id, 'Active');
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'referral',
      entityId: referralId,
      action: 'status_changed',
      metadata: { from: existing.status, to: newStatus },
    });

    return ReferralResponseDto.fromRow(data);
  }
```

- [ ] **Step 9: Run test to verify it passes**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: PASS

- [ ] **Step 10: Write the failing tests for `getById()` and `listForFacility()`**

Append to `backend/src/referral/referral.service.spec.ts`:
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
                    id: 'r1',
                    pregnancy_episode_id: 'e1',
                    from_facility_id: 'f1',
                    to_facility_id: 'f2',
                    reason_code: 'suspected_preeclampsia',
                    urgency: 'urgent',
                    status: 'Sent',
                    created_at: '2026-08-01T00:00:00.000Z',
                    accepted_at: null,
                    departed_at: null,
                    arrived_at: null,
                    closed_at: null,
                  },
                  error: null,
                }
              : { data: null, error: { message: 'no rows' } },
        }),
      }),
    }),
  };
}

function buildListClient(rows: any[]) {
  const eqMock = jest.fn();
  const builder: any = {
    eq: (...args: any[]) => {
      eqMock(...args);
      return builder;
    },
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  const selectMock = jest.fn().mockReturnValue(builder);
  return { client: { from: () => ({ select: selectMock }) }, eqMock };
}

describe('getById', () => {
  it('returns the referral when found', async () => {
    const supabaseService = {
      getClientForUser: () => buildGetByIdClient({ found: true }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    const result = await service.getById('jwt', 'r1');

    expect(result.status).toBe('Sent');
  });

  it('throws ReferralNotFoundError when missing', async () => {
    const supabaseService = {
      getClientForUser: () => buildGetByIdClient({ found: false }),
    } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);

    await expect(service.getById('jwt', 'missing')).rejects.toThrow(ReferralNotFoundError);
  });
});

describe('listForFacility', () => {
  it("direction 'incoming' filters by to_facility_id", async () => {
    const { client, eqMock } = buildListClient([
      {
        id: 'r1', pregnancy_episode_id: 'e1', from_facility_id: 'f1', to_facility_id: 'f2',
        reason_code: 'x', urgency: 'urgent', status: 'Sent', created_at: '2026-08-01T00:00:00.000Z',
        accepted_at: null, departed_at: null, arrived_at: null, closed_at: null,
      },
    ]);
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    const result = await service.listForFacility('jwt', 'f2', 'incoming');

    expect(eqMock).toHaveBeenCalledWith('to_facility_id', 'f2');
    expect(result).toHaveLength(1);
  });

  it("direction 'outgoing' filters by from_facility_id", async () => {
    const { client, eqMock } = buildListClient([]);
    const supabaseService = { getClientForUser: () => client } as unknown as SupabaseService;
    const auditService = { log: jest.fn() } as unknown as AuditService;
    const episodeService = { updateStatus: jest.fn() } as unknown as EpisodeService;

    const service = await buildReferralService(supabaseService, auditService, episodeService);
    await service.listForFacility('jwt', 'f1', 'outgoing');

    expect(eqMock).toHaveBeenCalledWith('from_facility_id', 'f1');
  });
});
```

- [ ] **Step 11: Run test to verify it fails**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: FAIL — `service.getById is not a function` (and `listForFacility`)

- [ ] **Step 12: Implement `ReferralService.getById()` and `ReferralService.listForFacility()`**

Add these two methods to `ReferralService`, after `updateStatus()`:
```typescript
  async getById(jwt: string, referralId: string): Promise<ReferralResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client.from('referral').select('*').eq('id', referralId).single();
    if (error || !data) {
      throw new ReferralNotFoundError(referralId);
    }
    return ReferralResponseDto.fromRow(data);
  }

  async listForFacility(
    jwt: string,
    facilityId: string,
    direction: 'incoming' | 'outgoing',
  ): Promise<ReferralResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const column = direction === 'incoming' ? 'to_facility_id' : 'from_facility_id';
    const { data, error } = await client
      .from('referral')
      .select('*')
      .eq(column, facilityId)
      .order('created_at', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []).map(ReferralResponseDto.fromRow);
  }
```

- [ ] **Step 13: Run test to verify it passes**

Run: `cd backend && npm test -- referral.service.spec.ts`
Expected: PASS — all `ReferralService` tests green.

- [ ] **Step 14: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/referral/dto/ backend/src/referral/referral.service.ts backend/src/referral/referral.service.spec.ts
git commit -m "feat: add ReferralService with create, status transitions, reads, and episode side effects"
```

---

### Task 5: `ReferralController`, module wiring, end-to-end tests

**Files:**
- Create: `backend/src/referral/referral.controller.ts`
- Create: `backend/src/referral/referral.module.ts`
- Test: `backend/test/referral.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `ReferralService` (Task 4), `AuthGuard`/`CurrentUser` (Plan 1),
  `InvalidReferralStateError` (Task 3), `EpisodeModule` (Plan 2, imported so
  `ReferralModule` can inject `EpisodeService` transitively through `ReferralService`).
- Produces:
  - `POST /api/v1/referrals` (any authenticated role, RLS scopes visibility — no
    `@Roles()` restriction, matching this plan's brief)
  - `PATCH /api/v1/referrals/:id/status` — body `{ status: string }`; on
    `InvalidReferralStateError`, returns HTTP 409 with
    `{ "error": { "code": "REFERRAL_INVALID_STATE", "message": "Referral cannot transition from <current> to <attempted>", "details": [], "correlationId": "<uuid>" } }`
  - `GET /api/v1/referrals/:id`
  - `GET /api/v1/referrals?facilityId=<id>&direction=incoming|outgoing`

- [ ] **Step 1: Write the controller**

Create `backend/src/referral/referral.controller.ts`:
```typescript
import { randomUUID } from 'crypto';
import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpException,
  HttpStatus,
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
import {
  ReferralService,
  ReferralNotFoundError,
  TargetFacilityNotAcceptingReferralsError,
} from './referral.service';
import { InvalidReferralStateError } from './referral-state-machine';
import { CreateReferralDto } from './dto/create-referral.dto';
import { UpdateReferralStatusDto } from './dto/update-referral-status.dto';

@Controller('referrals')
@UseGuards(AuthGuard)
export class ReferralController {
  constructor(private readonly referralService: ReferralService) {}

  @Post()
  async create(@CurrentUser() user: CurrentUserPayload, @Body() dto: CreateReferralDto) {
    try {
      return await this.referralService.create(user.jwt, user.id, user.tenantId, dto);
    } catch (err) {
      if (err instanceof TargetFacilityNotAcceptingReferralsError) {
        throw new HttpException(
          {
            error: {
              code: 'REFERRAL_TARGET_FACILITY_NOT_ACCEPTING',
              message: err.message,
              details: [],
              correlationId: randomUUID(),
            },
          },
          HttpStatus.UNPROCESSABLE_ENTITY,
        );
      }
      throw err;
    }
  }

  @Patch(':id/status')
  async updateStatus(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: UpdateReferralStatusDto,
  ) {
    try {
      return await this.referralService.updateStatus(user.jwt, user.id, id, dto.status);
    } catch (err) {
      if (err instanceof InvalidReferralStateError) {
        throw new HttpException(
          {
            error: {
              code: 'REFERRAL_INVALID_STATE',
              message: err.message,
              details: [],
              correlationId: randomUUID(),
            },
          },
          HttpStatus.CONFLICT,
        );
      }
      if (err instanceof ReferralNotFoundError) {
        throw new NotFoundException({
          error: {
            code: 'REFERRAL_NOT_FOUND',
            message: err.message,
            details: [],
            correlationId: randomUUID(),
          },
        });
      }
      throw err;
    }
  }

  @Get(':id')
  async getById(@CurrentUser() user: CurrentUserPayload, @Param('id') id: string) {
    try {
      return await this.referralService.getById(user.jwt, id);
    } catch (err) {
      if (err instanceof ReferralNotFoundError) {
        throw new NotFoundException({
          error: {
            code: 'REFERRAL_NOT_FOUND',
            message: err.message,
            details: [],
            correlationId: randomUUID(),
          },
        });
      }
      throw err;
    }
  }

  @Get()
  list(
    @CurrentUser() user: CurrentUserPayload,
    @Query('facilityId') facilityId: string,
    @Query('direction') direction: string,
  ) {
    if (direction !== 'incoming' && direction !== 'outgoing') {
      throw new BadRequestException({
        error: {
          code: 'INVALID_REFERRAL_DIRECTION',
          message: `direction must be 'incoming' or 'outgoing', got '${direction}'`,
          details: [],
          correlationId: randomUUID(),
        },
      });
    }
    return this.referralService.listForFacility(user.jwt, facilityId, direction);
  }
}
```

- [ ] **Step 2: Write the e2e tests**

Create `backend/test/referral.e2e-spec.ts`. This mirrors Plan 1/2's own precedent (401-only
baseline coverage for auth) for the first three tests, plus one addition: unlike Plan 1/2's
controllers, this plan's acceptance criteria explicitly requires proving the
`REFERRAL_INVALID_STATE` HTTP contract with a real request/response round trip, not just an
auth check. That needs a valid "authenticated" request without standing up real Supabase
JWTs/seed data, so the second `describe` block below overrides `AuthGuard` and
`ReferralService` at the Nest DI level (`overrideGuard`/`overrideProvider`) — a
self-contained technique using only NestJS's own testing APIs, no new dependency:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';
import { AuthGuard } from '../src/common/auth/auth.guard';
import { ReferralService } from '../src/referral/referral.service';
import { InvalidReferralStateError } from '../src/referral/referral-state-machine';

describe('ReferralController (e2e)', () => {
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

  it('rejects referral creation with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/referrals')
      .send({
        pregnancyEpisodeId: '11111111-1111-1111-1111-111111111111',
        toFacilityId: '11111111-1111-1111-1111-111111111111',
        reasonCode: 'suspected_preeclampsia',
        urgency: 'urgent',
      })
      .expect(401);
  });

  it('rejects referral status update with no auth token', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/referrals/11111111-1111-1111-1111-111111111111/status')
      .send({ status: 'Sent' })
      .expect(401);
  });

  it('rejects referral listing with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/referrals?facilityId=11111111-1111-1111-1111-111111111111&direction=incoming')
      .expect(401);
  });
});

describe('ReferralController (e2e) — REFERRAL_INVALID_STATE contract', () => {
  let app: INestApplication;
  const fakeReferralService = { updateStatus: jest.fn() };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AuthGuard)
      .useValue({
        canActivate: (context: any) => {
          const req = context.switchToHttp().getRequest();
          req.currentUser = { id: 'u1', tenantId: 't1', role: 'clinician', facilityId: 'f1', jwt: 'fake-jwt' };
          return true;
        },
      })
      .overrideProvider(ReferralService)
      .useValue(fakeReferralService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    fakeReferralService.updateStatus.mockReset();
  });

  it('rejects Completed -> InTransit with HTTP 409 and the REFERRAL_INVALID_STATE contract', async () => {
    // Gherkin (docs/PRD.md "Invalid referral transition" scenario):
    //   Given a referral is in status Completed
    //   When a user attempts to change the status to InTransit
    //   Then the API shall reject the request with HTTP 409
    //   And return the error code REFERRAL_INVALID_STATE
    const referralId = '22222222-2222-2222-2222-222222222222';
    fakeReferralService.updateStatus.mockRejectedValue(
      new InvalidReferralStateError('Completed', 'InTransit'),
    );

    const response = await request(app.getHttpServer())
      .patch(`/api/v1/referrals/${referralId}/status`)
      .send({ status: 'InTransit' })
      .expect(409);

    expect(response.body.error.code).toBe('REFERRAL_INVALID_STATE');
    expect(response.body.error.message).toBe(
      'Referral cannot transition from Completed to InTransit',
    );
    expect(response.body.error.details).toEqual([]);
    expect(typeof response.body.error.correlationId).toBe('string');
    expect(response.body.error.correlationId.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 3: Run the e2e tests to verify they pass**

Run: `cd backend && npm run test:e2e -- referral.e2e-spec.ts`
Expected: PASS

- [ ] **Step 4: Wire the module and commit**

Create `backend/src/referral/referral.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { ReferralController } from './referral.controller';
import { ReferralService } from './referral.service';
import { EpisodeModule } from '../episode/episode.module';

@Module({
  imports: [EpisodeModule],
  controllers: [ReferralController],
  providers: [ReferralService],
  exports: [ReferralService],
})
export class ReferralModule {}
```

Add `ReferralModule` to the `imports` array in `backend/src/app.module.ts`.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/referral/referral.controller.ts backend/src/referral/referral.module.ts backend/test/referral.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add referral controller and wire referral module into app"
```

---

## Handoff to Plan 6 (Clinician Dashboard) and Plan 7 (Supervisor Dashboard)

### Tables

**`referral`**
```
id uuid pk
pregnancy_episode_id uuid fk -> pregnancy_episode, not null
from_facility_id uuid fk -> facility, nullable (null = originated from community/CHW context)
to_facility_id uuid fk -> facility, not null (chosen by the clinician at creation time)
reason_code text not null
urgency text not null, in ('routine', 'urgent')
status text not null, in ('Created','Sent','Accepted','Dispatched','InTransit','Arrived','Completed','Failed','Cancelled'), default 'Created'
created_at timestamptz not null, default now()
accepted_at timestamptz nullable   -- set when status reaches Accepted
departed_at timestamptz nullable   -- set when status reaches Dispatched
arrived_at timestamptz nullable    -- set when status reaches Arrived
closed_at timestamptz nullable     -- set on any terminal status (Completed/Failed/Cancelled)
```
No `updated_at` (see this plan's Global Constraints for why). Tenant scope is derived via
`pregnancy_episode_id -> pregnancy_episode.facility_id -> facility.tenant_id`; visibility is
tenant-wide (not restricted to the origin facility), so a receiving facility's clinician
sees referrals sent to them too.

**`pregnancy_episode.status`** (extended by this plan) now has 9 values:
`Draft, Active, Referred, Admitted, Delivered, PostnatalActive, Closed, Archived, Cancelled`.
This plan is the only writer of `Admitted`/`Cancelled` (via `ReferralService`'s internal
calls to `EpisodeService.updateStatus()`); the direct
`PATCH /api/v1/pregnancy-episodes/:id/status` endpoint from Plan 2 still cannot set those
two values by hand (its `UpdateEpisodeStatusDto` `@IsIn` list wasn't extended — see this
plan's Global Constraints "Known cross-plan follow-up").

### `ReferralService` (`backend/src/referral/referral.service.ts`)

- `create(jwt: string, actorUserId: string, tenantId: string, dto: CreateReferralDto): Promise<ReferralResponseDto>` — rejects if the target facility isn't accepting referrals (`TargetFacilityNotAcceptingReferralsError`); moves the episode to `Referred`.
- `updateStatus(jwt: string, actorUserId: string, referralId: string, newStatus: string): Promise<ReferralResponseDto>` — validates against the strict state graph (throws `InvalidReferralStateError` on violation, has `.currentStatus`/`.attemptedStatus`); stamps the relevant milestone timestamp; triggers the episode-status side effects (`Arrived` -> episode `Admitted`; `Failed`/`Cancelled` -> episode `Active`).
- `getById(jwt: string, referralId: string): Promise<ReferralResponseDto>` — throws `ReferralNotFoundError` (has `.referralId`).
- `listForFacility(jwt: string, facilityId: string, direction: 'incoming' | 'outgoing'): Promise<ReferralResponseDto[]>` — `incoming` = `to_facility_id` match (what a receiving facility's clinician dashboard shows), `outgoing` = `from_facility_id` match (what the origin facility's caseload shows), ordered newest-first.

### Referral state machine (`backend/src/referral/referral-state-machine.ts`)

- `type ReferralStatus` — the 9-value union.
- `REFERRAL_STATUS_TRANSITIONS: Record<ReferralStatus, ReferralStatus[]>` — the full valid graph, importable if a dashboard wants to render "what can this referral become next" (e.g. only showing valid next-status buttons in the Clinician dashboard's referral card, rather than hardcoding the graph a second time in the frontend).
- `TERMINAL_REFERRAL_STATUSES: ReferralStatus[]` — `['Completed', 'Failed', 'Cancelled']`, useful for a Supervisor dashboard's "open referrals" filter (`status not in (...)`).
- `assertValidReferralTransition(currentStatus, attemptedStatus): void`, `InvalidReferralStateError` (has `.currentStatus`/`.attemptedStatus`).

### DTOs (all under `backend/src/referral/dto/`)

- `CreateReferralDto { pregnancyEpisodeId: string (uuid); toFacilityId: string (uuid, required); fromFacilityId?: string (uuid); reasonCode: string; urgency: 'routine' | 'urgent' }`
- `UpdateReferralStatusDto { status: string }` (validated against the 9-value set at the DTO layer; the state-machine graph check happens in the service, not here)
- `ReferralResponseDto { id, pregnancyEpisodeId, fromFacilityId, toFacilityId, reasonCode, urgency, status, createdAt, acceptedAt, departedAt, arrivedAt, closedAt }` with `static fromRow(row): ReferralResponseDto`

### REST endpoints

- `POST /api/v1/referrals` — any authenticated role; 422 `REFERRAL_TARGET_FACILITY_NOT_ACCEPTING` if the target facility isn't accepting referrals.
- `PATCH /api/v1/referrals/:id/status` — body `{ status: string }`; 409 `REFERRAL_INVALID_STATE` on an illegal transition (exact PRD contract); 404 `REFERRAL_NOT_FOUND` if the id doesn't exist/isn't visible under RLS.
- `GET /api/v1/referrals/:id` — 404 `REFERRAL_NOT_FOUND` if missing.
- `GET /api/v1/referrals?facilityId=<id>&direction=incoming|outgoing` — 400 `INVALID_REFERRAL_DIRECTION` if `direction` isn't exactly `incoming` or `outgoing`.

All error bodies use `{ "error": { "code", "message", "details": [], "correlationId" } }`
with a real generated `correlationId`.

### What Plan 6 (Clinician) needs

- The **referral creation form**: `GET /api/v1/facilities?acceptingReferrals=true` (Plan 1's
  `FacilityService.list`) to populate the receiving-facility picker, then
  `POST /api/v1/referrals` with the episode already in context (clinician is on an episode's
  detail page per the design spec's Core User Flow #3).
- The **referral list/status view** on an episode: `GET /api/v1/referrals?facilityId=<clinician's facility>&direction=outgoing` for referrals this facility sent, and `direction=incoming` for referrals sent to this facility (the receiving side's own dashboard). `PATCH .../status` drives the accept/dispatch/arrive/complete/fail/cancel buttons — use `REFERRAL_STATUS_TRANSITIONS[currentStatus]` client-side to only show valid next actions, since the server will reject anything else with 409 anyway.

### What Plan 7 (Supervisor) needs

- **SLA-adherence-style queries** the Supervisor dashboard might want (none of this is built
  by this plan — just documenting that the schema already supports it without new columns):
  - "Referrals still open past N hours": `select * from referral where status not in ('Completed','Failed','Cancelled') and created_at < now() - interval 'N hours'` (or `Accepted`/`Dispatched`-relative windows using `accepted_at`/`departed_at` instead of `created_at`, for a more precise "time since acceptance" or "time in transit" SLA metric).
  - Referral volume/outcome breakdown by `status`, `urgency`, and `to_facility_id`/`from_facility_id` for cohort/facility-level reporting — all plain columns, no joins beyond `facility` for names.
  - None of these are exposed as a dedicated endpoint by this plan (per the design spec Section 5, Supervisor KPIs are "via SQL queries/views, no new schema needed for MVP" — this plan's job was only to make sure the underlying `referral` rows and timestamps exist and are queryable, which they now are).

### Not built in this plan (explicitly deferred)

- Any transition to `pregnancy_episode.status` values `Delivered`, `PostnatalActive`,
  `Closed`, or `Archived` — no delivery-recording feature exists yet in the 8-plan MVP set;
  this is a known, deliberate gap, not an oversight.
- Facility-level RLS scoping for `referral` (tenant-only, matching Plan 1/2's precedent).
- Automated SLA-breach alerting/notifications on stalled referrals — the data is queryable
  (see above); nothing runs on a schedule to alert anyone.
- Extending Plan 2's `UpdateEpisodeStatusDto` to allow manually setting `Admitted`/
  `Cancelled` via the direct HTTP endpoint (see Global Constraints).
- Idempotency handling on `POST /api/v1/referrals` (the PRD's idempotency note in Section 13
  is attached to pregnancy-episode/mobile-retry creation, not referral creation from an
  always-online staff web UI — not carried over here).
