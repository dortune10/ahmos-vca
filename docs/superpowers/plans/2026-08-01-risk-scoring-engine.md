# Risk Scoring Engine Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the `risk` module: a deterministic rules engine over structured clinical
vitals (explicitly **provisional**, pending clinical sign-off — see Global Constraints), an
ML-assisted advisory score via the Claude API that can only enrich or raise the rule
engine's band, never downgrade it, and a clinician override path — so that every pregnancy
episode's `risk_band` is computed automatically on registration and on every clinical data
update (via Plan 2's `episode.created` / `episode.clinical_data_updated` events), with any
model-call failure degrading gracefully to rule-only scoring rather than ever blocking care.

**Architecture:** One new NestJS module, `risk`, following Plan 1/2's modular-monolith
pattern. It has no compile-time dependency on `episode`/`tasks` beyond importing the
`EpisodeLifecycleEventPayload` *type* for its event-listener signatures — Plan 2 emits,
this plan only listens, keeping the dependency inverted exactly as Plan 2 designed it (see
that plan's Architecture section and its "Handoff to Plan 3, 4, 5" section). Internally the
module splits into three collaborators:
- `RiskRulesEngineService` — pure, deterministic, provisional-threshold scoring. No I/O, no
  Supabase, no Claude — just a function of structured vitals in, a band + reason codes out.
- `RiskMlService` — the Claude API wrapper, isolated behind a DI token
  (`ANTHROPIC_CLIENT`) specifically so it is fully mockable in tests with zero real network
  calls.
- `RiskService` — orchestrates both, persists `risk_assessment` rows, keeps
  `pregnancy_episode.risk_band` denormalized in sync, writes `audit_event` rows, and is the
  target of the two `@OnEvent` listeners as well as the manual REST trigger and the
  override/read endpoints.

Same no-ORM approach as Plans 1–2: `@supabase/supabase-js` clients scoped to the caller's
JWT, Postgres RLS as the actual enforcement mechanism (`docs/DECISIONS.md` #21) — except
`RiskService.assess()`, which is a documented, deliberate service-role exception (see Global
Constraints below).

**Tech Stack:** Same as Plans 1–2 (Node.js 20 LTS, NestJS 10.x, TypeScript 5.x,
`@supabase/supabase-js` v2, `@nestjs/event-emitter`, Jest + Supertest, Supabase CLI), plus
this plan's own new dependency: `@anthropic-ai/sdk` (Claude API client for the ML-assisted
advisory score).

## Global Constraints

Same as Plan 1 (Backend Foundation) — see that plan for the full list (API base path,
`X-Correlation-Id`, error response shape, no-ORM/RLS-as-source-of-truth, plain-SQL
migrations via `supabase db reset`, `created_at`/`updated_at` convention, the local-vs-cloud
Supabase project split) — and Plan 2 (Episode & Task Management) for the RLS join pattern
via `facility_id`/`pregnancy_episode_id` and the tenant-only (not facility-level) RLS
granularity precedent. This plan adds:

- **Migration numbering.** Plan 2's Task 2 confirms its last two migrations were
  `00000000000004_episode_task_schema.sql` and
  `00000000000005_episode_task_rls_policies.sql`. This plan's migrations continue that
  sequence: `00000000000006_risk_assessment_schema.sql` (Task 1) and
  `00000000000007_risk_assessment_rls_policies.sql` (Task 2).
- **Rule thresholds are PROVISIONAL, not clinically validated.** `docs/DECISIONS.md`'s
  "Still Open" section says outright: "Actual clinical rule thresholds for the risk rules
  engine (decision #19) — needs clinical input, not something to define unilaterally." The
  design spec's own Section 10 Open Question #1 says the same. The thresholds implemented
  in Task 3 below (BP ≥160/110 severe, ≥140/90 elevated; hemoglobin <7 severe, <11 anemia;
  temperature ≥38 possible fever) are real, working, widely-cited obstetric reference
  ranges — not placeholder numbers — but they are going into this codebase **without
  clinical sign-off**, exactly as flagged in `docs/DECISIONS.md`. `RiskRulesEngineService`'s
  file-level comment says this explicitly, and this plan's Handoff section repeats it, so
  nobody downstream (including whoever builds the clinician dashboard in Plan 6) mistakes
  "the code runs" for "a clinician approved these numbers."
- **`risk_assessment` has no `updated_at`; override mutates the row in place.** The spec's
  own Section 4 field list puts `overridden_by`/`override_reason` directly on
  `risk_assessment`, not on a separate override-event table — so this plan mutates the same
  row in place on override (`status` flips to `Overridden`, `final_risk_band` is replaced,
  `overridden_by`/`override_reason` are set) rather than writing a new row that references
  the old one. This is simpler, matches the spec's literal field list, and is consistent
  with how `pregnancy_episode.risk_band` is *also* just overwritten on every new assessment
  — there is already no expectation of an immutable per-field history elsewhere in this
  data model. The full history of assessments is still preserved at the row level (one row
  per `assess()` run, never deleted), so "what did assessment #3 originally say before it
  was overridden" is only answerable from that one row's current state, not from a
  pre-override snapshot — an accepted trade-off of the simpler design, called out here
  rather than silently.
- **Claude API timeout + fallback policy.** Every `RiskMlService.assess()` call is wrapped
  in an 8-second `Promise.race` timeout (the design spec's Section 5/6 language cites the
  PRD's "2 to 10 seconds" dependency-timeout guidance; 8s is chosen as a firm value inside
  that range). `Promise.race` against a `setTimeout`-based rejection is used instead of the
  Anthropic SDK's own per-request `timeout` option specifically so the timeout behavior is
  deterministic and testable with Jest fake timers, and so every failure mode (timeout, API
  error, network error, malformed/missing tool-call) funnels through exactly one `catch`
  block into exactly one `RiskMlResult` shape — `RiskMlService.assess()` **never throws**;
  it always resolves to `{ ok: true, riskBand, reasoning }` or `{ ok: false, errorReason }`.
  On any failure, `RiskService.assess()` sets `ml_score = null`,
  `status = 'FallbackRuleOnly'`, `final_risk_band` = the rule engine's band alone, and logs
  the failure reason into `explanation_json.mlError` — it never throws out of the pipeline
  on the model's account.
- **Rule/ML combination — rules take precedence on disagreement (`docs/DECISIONS.md`
  #19).** Both `rule_score` and `ml_score` are stored as the same 0 (low) / 1 (medium) / 2
  (high) ordinal encoding of the highest contributing band (`RISK_BAND_SCORE` in
  `risk-rules-engine.service.ts`, reused for the ML band too) so they are directly
  comparable. When the ML call succeeds: if `RISK_BAND_SCORE[mlBand] < RISK_BAND_SCORE[ruleBand]`
  (the model wants to go *lower* than the rules), the rule band wins and the disagreement is
  recorded in `explanation_json.mlDisagreement` — rules never get downgraded by the model.
  Otherwise (the model agrees or wants to go *higher*), the ML band becomes
  `final_risk_band` — going up in caution on the model's say-so is safe, going down is not.
  `status = 'Computed'` in both of these ML-succeeded branches; `FallbackRuleOnly` is
  reserved solely for ML *failure*, not for ML disagreement.
- **`RiskService.assess()` always uses `getServiceClient()`, never a user JWT — one of Plan
  1's documented service-role exceptions.** `assess()`'s signature is
  `assess(tenantId, actorUserId, pregnancyEpisodeId)` — no `jwt` parameter — and this is
  deliberate, not an oversight: the computation itself (run the rules, call the model,
  write the row, denormalize the episode) is a system operation regardless of *what*
  triggered it. The two `@OnEvent` listeners are obviously system-triggered (there is no
  request/JWT in scope inside an event handler). The manual-trigger REST endpoint is
  user-initiated, but it still calls the *same* `assess()` — a clinician forcing a
  re-assessment doesn't change the nature of the computation, it just changes who asked for
  it, and `actorUserId` (passed straight through to the `audit_event` row) already captures
  that. `RiskService.override()`, by contrast, uses the caller's JWT
  (`getClientForUser(jwt)`) throughout, because overriding a risk band with a clinical
  reason *is* a genuine user-authored write and should be RLS-scoped like every other
  user-initiated write in this codebase.
- **Missing/no encounter data never crashes the pipeline.** A brand-new episode reaching
  `RiskService.assess()` via `'episode.created'` has no `encounter_note` row yet. The
  pipeline treats that as an empty vitals object (`{}`), and the rule engine's per-factor
  evaluation is designed to mark a factor's band as `null` ("insufficient data") rather than
  defaulting it to `'low'` — a missing hemoglobin reading is not evidence of a healthy
  hemoglobin level. If *every* factor is `null` (no data at all), the overall band
  conservatively defaults to `'low'` with that fact recorded in the explanation, since there
  is no reading of any kind to justify anything higher — this default is itself part of the
  provisional/needs-clinical-review flag above, not an authoritative clinical claim.
- **`RiskVitalsInput` is defined independently in this module**, mirroring
  `encounter_note.vitals_json`'s documented shape (`bpSystolic?`, `bpDiastolic?`,
  `temperatureC?`, `hemoglobinGdl?`, all numbers) from Plan 2's Handoff section, rather than
  importing Plan 2's `VitalsDto` class. This keeps the two modules decoupled beyond the
  event-payload and table contracts Plan 2 explicitly published for this purpose.
- **Numeric columns come back as strings — a real gotcha, not a style choice.**
  `rule_score`/`ml_score` are Postgres `numeric(10,4)`. PostgREST (which
  `@supabase/supabase-js` talks to) serializes `numeric` as a JSON *string*, not a native
  number, to avoid floating-point precision loss on arbitrary-precision values. Every read
  path in this plan (`RiskAssessmentResponseDto.fromRow`) explicitly wraps these fields in
  `Number(...)` — omitting that would silently hand the frontend a string where it expects
  a number.
- **Data-model gap, noted rather than silently worked around:** the design spec's Section 2
  scope line mentions the rules engine running over "BP, anemia markers, prior
  complications, etc." — but Plan 2's actual `encounter_note.vitals_json` only carries
  `bpSystolic`/`bpDiastolic`/`temperatureC`/`hemoglobinGdl`; there is no structured "prior
  complications" field anywhere in the approved data model. This plan's rules engine scores
  exactly the fields that exist (BP, hemoglobin, temperature) and does not invent a
  complications field to fill the gap — consistent with the standing precedent set by
  `docs/DECISIONS.md` #22 (flag data-model gaps found during planning rather than
  silently patching around them). If a future plan adds structured complication/history
  data to `encounter_note` or elsewhere, `RiskRulesEngineService` should be extended with a
  fourth factor at that point, not before.
- **Fire-and-forget event dispatch already guarantees risk assessment can't block care.**
  Plan 2's `EpisodeService` calls `this.eventEmitter.emit(...)` (not `emitAsync`), so
  episode creation and encounter-note recording return their HTTP response without waiting
  for any listener — including this plan's — to finish. Combined with this plan's own
  try/catch around both `@OnEvent` handlers (Task 5), a total pipeline failure (a DB error,
  not just an ML failure) is logged and swallowed, never surfaced as an unhandled rejection
  and never delays the caller. The manual REST trigger is the one path where a failure
  *should* surface to the caller (a clinician directly asked for a re-assessment and
  deserves to know it failed), so that path does not swallow errors.

---

### Task 1: Schema migration — `risk_assessment` table

**Files:**
- Create: `supabase/migrations/00000000000006_risk_assessment_schema.sql`
- Test: `backend/test/risk-assessment-schema.e2e-spec.ts`

**Interfaces:**
- Consumes: `pregnancy_episode`, `app_user` tables (Plan 1 Task 3, Plan 2 Task 1).
- Produces: `risk_assessment(id uuid pk, pregnancy_episode_id uuid fk -> pregnancy_episode
  not null, assessment_time timestamptz not null default now(), rule_score numeric(10,4)
  not null, ml_score numeric(10,4) nullable, final_risk_band text not null check in
  ('low','medium','high'), explanation_json jsonb not null default '{}', overridden_by uuid
  fk -> app_user nullable, override_reason text nullable, status text not null check in
  ('Pending','Computed','Overridden','Failed','FallbackRuleOnly'), created_at timestamptz)`
  — no `updated_at` (see Global Constraints). Every later task in this plan queries this
  table.

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/00000000000006_risk_assessment_schema.sql`:
```sql
create table risk_assessment (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  assessment_time timestamptz not null default now(),
  rule_score numeric(10, 4) not null,
  ml_score numeric(10, 4),
  final_risk_band text not null check (final_risk_band in ('low', 'medium', 'high')),
  explanation_json jsonb not null default '{}'::jsonb,
  overridden_by uuid references app_user (id),
  override_reason text,
  status text not null check (
    status in ('Pending', 'Computed', 'Overridden', 'Failed', 'FallbackRuleOnly')
  ),
  created_at timestamptz not null default now()
);
create index risk_assessment_pregnancy_episode_id_idx on risk_assessment (pregnancy_episode_id);
create index risk_assessment_assessment_time_idx on risk_assessment (assessment_time);
create index risk_assessment_status_idx on risk_assessment (status);

alter table risk_assessment enable row level security;
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db reset`
Expected: migration applies cleanly, no errors printed.

- [ ] **Step 3: Write the failing verification test**

Create `backend/test/risk-assessment-schema.e2e-spec.ts`:
```typescript
import { createClient } from '@supabase/supabase-js';

describe('risk_assessment schema', () => {
  const admin = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );
  const tenantId = '11111111-1111-1111-1111-111111111111';
  let episodeId: string;

  beforeAll(async () => {
    const { data: facility, error: facilityError } = await admin
      .from('facility')
      .insert({ tenant_id: tenantId, name: 'Risk Schema Test Clinic', type: 'clinic' })
      .select()
      .single();
    expect(facilityError).toBeNull();

    const { data: person, error: personError } = await admin
      .from('person')
      .insert({ tenant_id: tenantId, first_name: 'Risk', phone_primary: '+254700000098' })
      .select()
      .single();
    expect(personError).toBeNull();

    const { data: episode, error: episodeError } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: person!.id, facility_id: facility!.id, status: 'Active' })
      .select()
      .single();
    expect(episodeError).toBeNull();
    episodeId = episode!.id;
  });

  it('accepts a valid risk_assessment row', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 2,
      ml_score: 2,
      final_risk_band: 'high',
      explanation_json: { ruleFactors: [] },
      status: 'Computed',
    });
    expect(error).toBeNull();
  });

  it('rejects an invalid final_risk_band', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 0,
      final_risk_band: 'catastrophic',
      explanation_json: {},
      status: 'Computed',
    });
    expect(error).not.toBeNull();
  });

  it('rejects an invalid status', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'NotARealStatus',
    });
    expect(error).not.toBeNull();
  });

  it('rejects a missing pregnancy_episode_id foreign key', async () => {
    const { error } = await admin.from('risk_assessment').insert({
      pregnancy_episode_id: '99999999-9999-9999-9999-999999999999',
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });
    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- risk-assessment-schema.e2e-spec.ts`
Expected: FAIL — table `risk_assessment` doesn't exist yet if Step 2 wasn't run, or already
passes if it was. If it already passes here, that's correct (Steps 1–2 already made this
green); this step just confirms it, matching Plan 1/2's own precedent for schema tasks.

- [ ] **Step 5: Confirm pass (no new code needed — the migration in Step 1 is the implementation)**

Run: `cd backend && npm run test:e2e -- risk-assessment-schema.e2e-spec.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/risk-assessment-schema.e2e-spec.ts
git commit -m "feat: add risk_assessment schema migration"
```

---

### Task 2: RLS policies for `risk_assessment`

**Files:**
- Create: `supabase/migrations/00000000000007_risk_assessment_rls_policies.sql`
- Test: `backend/test/risk-assessment-rls.e2e-spec.ts`

**Interfaces:**
- Consumes: `risk_assessment` table (Task 1), the `auth_app_user()` helper function (Plan 1
  Task 4), the `pregnancy_episode -> facility -> tenant_id` join pattern (Plan 2 Task 2).
- Produces: a tenant-isolation `select` policy and a tenant-isolation `update` policy on
  `risk_assessment`. **Deliberately no `insert` policy** for the authenticated/anon role —
  see the code comment in Step 3 for why.

- [ ] **Step 1: Write the failing RLS test**

Create `backend/test/risk-assessment-rls.e2e-spec.ts`:
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

describe('risk_assessment RLS', () => {
  const admin = createClient(SUPABASE_URL, SERVICE_KEY);
  const tenantA = '11111111-1111-1111-1111-111111111111';
  const tenantB = '22222222-2222-2222-2222-222222222222';
  let clinicianAId: string;
  let episodeAId: string;
  let episodeBId: string;
  let assessmentAId: string;

  beforeAll(async () => {
    const { data: facilityA } = await admin
      .from('facility')
      .insert({ tenant_id: tenantA, name: 'Risk RLS A Clinic', type: 'clinic' })
      .select()
      .single();
    const { data: facilityB } = await admin
      .from('facility')
      .insert({ tenant_id: tenantB, name: 'Risk RLS B Clinic', type: 'clinic' })
      .select()
      .single();

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
      .insert({ person_id: personA!.id, facility_id: facilityA!.id, status: 'Active' })
      .select()
      .single();
    episodeAId = episodeA!.id;

    const { data: episodeB } = await admin
      .from('pregnancy_episode')
      .insert({ person_id: personB!.id, facility_id: facilityB!.id, status: 'Active' })
      .select()
      .single();
    episodeBId = episodeB!.id;

    const { data: assessmentA } = await admin
      .from('risk_assessment')
      .insert({
        pregnancy_episode_id: episodeAId,
        rule_score: 1,
        final_risk_band: 'medium',
        explanation_json: {},
        status: 'Computed',
      })
      .select()
      .single();
    assessmentAId = assessmentA!.id;

    await admin.from('risk_assessment').insert({
      pregnancy_episode_id: episodeBId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });

    const { data: authUser } = await admin.auth.admin.createUser({
      email: `clinician-a-${Date.now()}@example.com`,
      password: 'test-password-123',
      email_confirm: true,
    });
    clinicianAId = authUser.user!.id;

    await admin.from('app_user').insert({
      id: clinicianAId,
      tenant_id: tenantA,
      email: authUser.user!.email,
      role: 'clinician',
      facility_id: facilityA!.id,
      full_name: 'Clinician A',
    });
  });

  it('a clinician in tenant A only sees tenant A risk_assessment rows (fails before policies exist: deny-all hides tenant A too)', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { data } = await userClient.from('risk_assessment').select('id, pregnancy_episode_id');
    const episodeIds = (data ?? []).map((row) => row.pregnancy_episode_id);
    expect(episodeIds).toContain(episodeAId);
    expect(episodeIds).not.toContain(episodeBId);
  });

  it("a clinician in tenant A can update (override) their own tenant's risk_assessment row", async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { data, error } = await userClient
      .from('risk_assessment')
      .update({
        final_risk_band: 'low',
        overridden_by: clinicianAId,
        override_reason: 'reviewed on triage',
        status: 'Overridden',
      })
      .eq('id', assessmentAId)
      .select()
      .single();

    expect(error).toBeNull();
    expect(data?.final_risk_band).toBe('low');
  });

  it('no insert policy exists for the authenticated role: a clinician cannot directly insert a risk_assessment row', async () => {
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: `Bearer ${tokenFor(clinicianAId)}` } },
    });

    const { error } = await userClient.from('risk_assessment').insert({
      pregnancy_episode_id: episodeAId,
      rule_score: 0,
      final_risk_band: 'low',
      explanation_json: {},
      status: 'Computed',
    });

    expect(error).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm run test:e2e -- risk-assessment-rls.e2e-spec.ts`
Expected: the first test FAILS (deny-all with RLS enabled and zero policies hides tenant
A's own row too, same signal Plan 1 Task 4 / Plan 2 Task 2 rely on), and the second test
FAILS (no update policy yet, so the update returns 0 rows and `.single()` errors). The
third test (insert denial) already PASSES at this point — RLS-enabled-with-no-policies is
already deny-all for inserts too, so this is a vacuous pass, not evidence the real policy
set is correct yet; it stays green through Step 4 for the right reason instead.

- [ ] **Step 3: Write the RLS policies**

Create `supabase/migrations/00000000000007_risk_assessment_rls_policies.sql`:
```sql
create policy "risk_assessment_select_tenant" on risk_assessment
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from auth_app_user())
    )
  );

create policy "risk_assessment_update_tenant" on risk_assessment
  for update using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from auth_app_user())
    )
  )
  with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from auth_app_user())
    )
  );
-- Deliberately no insert policy for the anon-key/authenticated role: the only insert path
-- into this table is RiskService.assess(), which always writes via the service-role client
-- (see this plan's Global Constraints) regardless of whether it was triggered by a
-- background event or the manual REST endpoint. This mirrors audit_event's precedent
-- (00000000000003_audit_event.sql) of a table that end users can read (and, here, update
-- via the one legitimate user action — override) but never directly insert into.
```

- [ ] **Step 4: Apply and run test to verify it passes**

Run:
```bash
npx supabase db reset
cd backend && npm run test:e2e -- risk-assessment-rls.e2e-spec.ts
```
Expected: PASS — all three tests green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add supabase/migrations/ backend/test/risk-assessment-rls.e2e-spec.ts
git commit -m "feat: add tenant-isolation RLS policies for risk_assessment"
```

---

### Task 3: `RiskRulesEngineService` — provisional deterministic rules engine

**Files:**
- Create: `backend/src/risk/risk-rules-engine.service.ts`
- Test: `backend/src/risk/risk-rules-engine.service.spec.ts`

**Interfaces:**
- Produces: `RiskRulesEngineService.evaluate(vitals: RiskVitalsInput): RuleEngineResult`,
  plus the exported types `RiskBand`, `RISK_BAND_SCORE`, `RiskVitalsInput`,
  `RuleFactorEvaluation`, `RuleEngineResult` — all consumed by `RiskMlService` (Task 4) and
  `RiskService` (Tasks 5–6). Pure logic, no Supabase/Nest DI dependencies beyond
  `@Injectable()` itself.
- **PROVISIONAL — see Global Constraints.** These thresholds are real, working obstetric
  reference ranges, not placeholders, but they have not received clinical sign-off
  (`docs/DECISIONS.md`, "Still Open").

- [ ] **Step 1: Write the failing test**

Create `backend/src/risk/risk-rules-engine.service.spec.ts`:
```typescript
import { RiskRulesEngineService, RISK_BAND_SCORE } from './risk-rules-engine.service';

describe('RiskRulesEngineService', () => {
  let engine: RiskRulesEngineService;

  beforeEach(() => {
    engine = new RiskRulesEngineService();
  });

  describe('blood pressure factor', () => {
    it('marks high when systolic is exactly at the severe threshold (160)', () => {
      const result = engine.evaluate({ bpSystolic: 160, bpDiastolic: 70 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('marks high when diastolic is exactly at the severe threshold (110)', () => {
      const result = engine.evaluate({ bpSystolic: 120, bpDiastolic: 110 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('marks medium when systolic is exactly at the elevated threshold (140) but below severe', () => {
      const result = engine.evaluate({ bpSystolic: 140, bpDiastolic: 70 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks medium when diastolic is exactly at the elevated threshold (90) but below severe', () => {
      const result = engine.evaluate({ bpSystolic: 120, bpDiastolic: 90 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks low when both readings are just under the elevated thresholds', () => {
      const result = engine.evaluate({ bpSystolic: 139, bpDiastolic: 89 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('low');
    });

    it('evaluates using diastolic alone when systolic is missing', () => {
      const result = engine.evaluate({ bpDiastolic: 115 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('high');
    });

    it('evaluates using systolic alone when diastolic is missing', () => {
      const result = engine.evaluate({ bpSystolic: 145 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBe('medium');
    });

    it('marks insufficient data (null band) when neither systolic nor diastolic is present', () => {
      const result = engine.evaluate({ hemoglobinGdl: 12 });
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      expect(bp?.band).toBeNull();
    });
  });

  describe('hemoglobin factor', () => {
    it('marks high (severe anemia) when strictly below 7', () => {
      const result = engine.evaluate({ hemoglobinGdl: 6.9 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('high');
    });

    it('marks medium (anemia) at exactly 7 (7 is not < 7, but is < 11)', () => {
      const result = engine.evaluate({ hemoglobinGdl: 7 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('medium');
    });

    it('marks medium (anemia) just under 11', () => {
      const result = engine.evaluate({ hemoglobinGdl: 10.9 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('medium');
    });

    it('marks low at exactly 11 (11 is not < 11)', () => {
      const result = engine.evaluate({ hemoglobinGdl: 11 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBe('low');
    });

    it('marks insufficient data (null band, NOT low) when hemoglobinGdl is missing', () => {
      const result = engine.evaluate({ bpSystolic: 110 });
      const hb = result.factors.find((f) => f.factor === 'hemoglobin');
      expect(hb?.band).toBeNull();
    });
  });

  describe('temperature factor', () => {
    it('marks medium (possible fever) at exactly 38', () => {
      const result = engine.evaluate({ temperatureC: 38 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBe('medium');
    });

    it('marks low just under 38', () => {
      const result = engine.evaluate({ temperatureC: 37.9 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBe('low');
    });

    it('marks insufficient data (null band) when temperatureC is missing', () => {
      const result = engine.evaluate({ bpSystolic: 110 });
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(temp?.band).toBeNull();
    });
  });

  describe('overall aggregation (highest contributing factor wins)', () => {
    it('returns high overall when only one factor is high and the others are low', () => {
      const result = engine.evaluate({
        bpSystolic: 165,
        bpDiastolic: 70,
        hemoglobinGdl: 13,
        temperatureC: 36.5,
      });
      expect(result.band).toBe('high');
      expect(result.score).toBe(RISK_BAND_SCORE.high);
      expect(result.score).toBe(2);
    });

    it('returns medium overall when the highest contributing factor is medium', () => {
      const result = engine.evaluate({
        bpSystolic: 120,
        bpDiastolic: 70,
        hemoglobinGdl: 13,
        temperatureC: 38.5,
      });
      expect(result.band).toBe('medium');
      expect(result.score).toBe(1);
    });

    it('returns low overall when every evaluated factor is low', () => {
      const result = engine.evaluate({
        bpSystolic: 118,
        bpDiastolic: 76,
        hemoglobinGdl: 13,
        temperatureC: 36.8,
      });
      expect(result.band).toBe('low');
      expect(result.score).toBe(0);
    });

    it('ignores factors with insufficient data when picking the highest band', () => {
      const result = engine.evaluate({ hemoglobinGdl: 6 });
      expect(result.band).toBe('high');
      const bp = result.factors.find((f) => f.factor === 'bloodPressure');
      const temp = result.factors.find((f) => f.factor === 'temperature');
      expect(bp?.band).toBeNull();
      expect(temp?.band).toBeNull();
    });

    it('defaults to low with every factor marked insufficient data when no vitals are provided at all', () => {
      const result = engine.evaluate({});
      expect(result.band).toBe('low');
      expect(result.score).toBe(0);
      expect(result.factors.every((f) => f.band === null)).toBe(true);
    });

    it('always returns exactly three factor evaluations, one per clinical input, regardless of which data is present', () => {
      const result = engine.evaluate({ bpSystolic: 150 });
      expect(result.factors.map((f) => f.factor).sort()).toEqual(
        ['bloodPressure', 'hemoglobin', 'temperature'].sort(),
      );
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- risk-rules-engine.service.spec.ts`
Expected: FAIL — cannot find module `./risk-rules-engine.service`

- [ ] **Step 3: Implement `RiskRulesEngineService`**

Create `backend/src/risk/risk-rules-engine.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';

// PROVISIONAL THRESHOLDS — see this plan's Global Constraints and docs/DECISIONS.md's
// "Still Open" section. These are real, widely-cited obstetric reference ranges (not
// placeholder numbers), but they have NOT received clinical sign-off. Do not treat this
// engine's output as clinically validated; a clinician's own judgment and the override
// path in RiskService always take precedence in practice.

export type RiskBand = 'low' | 'medium' | 'high';

export const RISK_BAND_SCORE: Record<RiskBand, number> = { low: 0, medium: 1, high: 2 };

export interface RiskVitalsInput {
  bpSystolic?: number;
  bpDiastolic?: number;
  temperatureC?: number;
  hemoglobinGdl?: number;
}

export interface RuleFactorEvaluation {
  factor: 'bloodPressure' | 'hemoglobin' | 'temperature';
  band: RiskBand | null; // null = insufficient data; this factor does not contribute
  detail: string;
}

export interface RuleEngineResult {
  score: number; // 0 (low) | 1 (medium) | 2 (high) — ordinal encoding of `band`
  band: RiskBand; // highest band among factors that had data; 'low' if none had data
  factors: RuleFactorEvaluation[];
}

function higherBand(a: RiskBand, b: RiskBand): RiskBand {
  return RISK_BAND_SCORE[b] > RISK_BAND_SCORE[a] ? b : a;
}

@Injectable()
export class RiskRulesEngineService {
  evaluate(vitals: RiskVitalsInput): RuleEngineResult {
    const factors: RuleFactorEvaluation[] = [
      this.evaluateBloodPressure(vitals),
      this.evaluateHemoglobin(vitals),
      this.evaluateTemperature(vitals),
    ];

    const contributing = factors.filter(
      (f): f is RuleFactorEvaluation & { band: RiskBand } => f.band !== null,
    );
    const band: RiskBand =
      contributing.length === 0
        ? 'low'
        : contributing.reduce<RiskBand>((acc, f) => higherBand(acc, f.band), 'low');

    return { score: RISK_BAND_SCORE[band], band, factors };
  }

  private evaluateBloodPressure(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { bpSystolic, bpDiastolic } = vitals;
    if (bpSystolic === undefined && bpDiastolic === undefined) {
      return {
        factor: 'bloodPressure',
        band: null,
        detail: 'insufficient data: no bpSystolic or bpDiastolic recorded',
      };
    }

    const systolicText = bpSystolic === undefined ? 'n/a' : `${bpSystolic}`;
    const diastolicText = bpDiastolic === undefined ? 'n/a' : `${bpDiastolic}`;

    const isSevere =
      (bpSystolic !== undefined && bpSystolic >= 160) ||
      (bpDiastolic !== undefined && bpDiastolic >= 110);
    if (isSevere) {
      return {
        factor: 'bloodPressure',
        band: 'high',
        detail: `severe hypertension: systolic ${systolicText} mmHg (>=160) or diastolic ${diastolicText} mmHg (>=110)`,
      };
    }

    const isElevated =
      (bpSystolic !== undefined && bpSystolic >= 140) ||
      (bpDiastolic !== undefined && bpDiastolic >= 90);
    if (isElevated) {
      return {
        factor: 'bloodPressure',
        band: 'medium',
        detail: `hypertension: systolic ${systolicText} mmHg (>=140) or diastolic ${diastolicText} mmHg (>=90)`,
      };
    }

    return {
      factor: 'bloodPressure',
      band: 'low',
      detail: `systolic ${systolicText} mmHg and diastolic ${diastolicText} mmHg within normal range`,
    };
  }

  private evaluateHemoglobin(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { hemoglobinGdl } = vitals;
    if (hemoglobinGdl === undefined) {
      return { factor: 'hemoglobin', band: null, detail: 'insufficient data: no hemoglobinGdl recorded' };
    }
    if (hemoglobinGdl < 7) {
      return { factor: 'hemoglobin', band: 'high', detail: `severe anemia: hemoglobin ${hemoglobinGdl} g/dL < 7` };
    }
    if (hemoglobinGdl < 11) {
      return { factor: 'hemoglobin', band: 'medium', detail: `anemia: hemoglobin ${hemoglobinGdl} g/dL < 11` };
    }
    return { factor: 'hemoglobin', band: 'low', detail: `hemoglobin ${hemoglobinGdl} g/dL >= 11` };
  }

  private evaluateTemperature(vitals: RiskVitalsInput): RuleFactorEvaluation {
    const { temperatureC } = vitals;
    if (temperatureC === undefined) {
      return { factor: 'temperature', band: null, detail: 'insufficient data: no temperatureC recorded' };
    }
    if (temperatureC >= 38) {
      return {
        factor: 'temperature',
        band: 'medium',
        detail: `possible infection/fever: temperature ${temperatureC} C >= 38`,
      };
    }
    return { factor: 'temperature', band: 'low', detail: `temperature ${temperatureC} C < 38` };
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npm test -- risk-rules-engine.service.spec.ts`
Expected: PASS — all boundary and aggregation cases green.

- [ ] **Step 5: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/risk/risk-rules-engine.service.ts backend/src/risk/risk-rules-engine.service.spec.ts
git commit -m "feat: add provisional deterministic risk rules engine"
```

---

### Task 4: `RiskMlService` — Claude API ML-assisted advisory score

**Files:**
- Create: `backend/src/risk/risk-ml.service.ts`
- Test: `backend/src/risk/risk-ml.service.spec.ts`
- Modify: `backend/package.json` (add `@anthropic-ai/sdk`)
- Modify: `backend/.env.example` (add `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`)

**Interfaces:**
- Consumes: `RiskBand`, `RiskVitalsInput` (Task 3); `ANTHROPIC_API_KEY`, `ANTHROPIC_MODEL`
  env vars; a DI-injected `Anthropic` client under the `ANTHROPIC_CLIENT` token.
- Produces: `RiskMlService.assess(input: RiskMlInput): Promise<RiskMlResult>` — **never
  throws**; every failure mode resolves to `{ ok: false, errorReason: string }`. Consumed
  by `RiskService.assess()` (Task 5).

- [ ] **Step 1: Install the SDK**

Run: `cd backend && npm install @anthropic-ai/sdk`

- [ ] **Step 2: Add env vars to `.env.example`**

Read `backend/.env.example` first (it currently has `SUPABASE_URL`, `SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `PORT` from Plan 1 Task 1), then append:
```
ANTHROPIC_API_KEY=
ANTHROPIC_MODEL=claude-sonnet-5
```

- [ ] **Step 3: Write the failing test**

Create `backend/src/risk/risk-ml.service.spec.ts`:
```typescript
import { RiskMlService, RiskMlInput } from './risk-ml.service';

const SAMPLE_INPUT: RiskMlInput = {
  pregnancyEpisodeId: 'e1',
  vitals: { bpSystolic: 150, bpDiastolic: 95, temperatureC: 37.2, hemoglobinGdl: 10.5 },
  ruleBand: 'medium',
  ruleFactors: [
    { factor: 'bloodPressure', band: 'medium', detail: 'hypertension: systolic 150 mmHg (>=140)' },
    { factor: 'hemoglobin', band: 'medium', detail: 'anemia: hemoglobin 10.5 g/dL < 11' },
    { factor: 'temperature', band: 'low', detail: 'temperature 37.2 C < 38' },
  ],
};

function buildToolUseMessage(input: unknown) {
  return {
    id: 'msg_1',
    type: 'message',
    role: 'assistant',
    content: [
      {
        type: 'tool_use',
        id: 'toolu_1',
        name: 'submit_risk_assessment',
        input,
      },
    ],
  };
}

describe('RiskMlService', () => {
  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns an ok result with the model riskBand and reasoning on a well-formed tool response', async () => {
    const fakeClient = {
      messages: {
        create: jest
          .fn()
          .mockResolvedValue(
            buildToolUseMessage({ riskBand: 'high', reasoning: 'Elevated BP combined with anemia.' }),
          ),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result).toEqual({ ok: true, riskBand: 'high', reasoning: 'Elevated BP combined with anemia.' });
    expect(fakeClient.messages.create).toHaveBeenCalledWith(
      expect.objectContaining({
        tool_choice: { type: 'tool', name: 'submit_risk_assessment' },
      }),
    );
  });

  it('falls back with errorReason "timeout" when the call exceeds the timeout window', async () => {
    jest.useFakeTimers();
    const neverResolves = new Promise(() => {});
    const fakeClient = { messages: { create: jest.fn().mockReturnValue(neverResolves) } };
    const service = new RiskMlService(fakeClient as any);

    const resultPromise = service.assess(SAMPLE_INPUT);
    jest.advanceTimersByTime(8000);
    const result = await resultPromise;

    expect(result).toEqual({ ok: false, errorReason: 'timeout' });
  });

  it('falls back with a malformed_response reason when no tool_use block is returned', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockResolvedValue({
          id: 'msg_2',
          type: 'message',
          role: 'assistant',
          content: [{ type: 'text', text: 'I cannot comply.' }],
        }),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with a malformed_response reason when the tool input has an invalid riskBand', async () => {
    const fakeClient = {
      messages: {
        create: jest
          .fn()
          .mockResolvedValue(buildToolUseMessage({ riskBand: 'severe', reasoning: 'not a valid band' })),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with a malformed_response reason when reasoning is missing', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockResolvedValue(buildToolUseMessage({ riskBand: 'low' })),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result.ok).toBe(false);
    expect((result as { ok: false; errorReason: string }).errorReason).toMatch(/^malformed_response/);
  });

  it('falls back with an api_error reason when the SDK call rejects', async () => {
    const fakeClient = {
      messages: {
        create: jest.fn().mockRejectedValue(new Error('connection reset')),
      },
    };
    const service = new RiskMlService(fakeClient as any);

    const result = await service.assess(SAMPLE_INPUT);

    expect(result).toEqual({ ok: false, errorReason: 'api_error: connection reset' });
  });
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `cd backend && npm test -- risk-ml.service.spec.ts`
Expected: FAIL — cannot find module `./risk-ml.service`

- [ ] **Step 5: Implement `RiskMlService`**

Create `backend/src/risk/risk-ml.service.ts`:
```typescript
import { Inject, Injectable } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { RiskBand } from './risk-rules-engine.service';

export const ANTHROPIC_CLIENT = 'ANTHROPIC_CLIENT';
export const RISK_ML_TIMEOUT_MS = 8000;

export interface RiskMlInput {
  pregnancyEpisodeId: string;
  vitals: {
    bpSystolic?: number;
    bpDiastolic?: number;
    temperatureC?: number;
    hemoglobinGdl?: number;
  };
  ruleBand: RiskBand;
  ruleFactors: Array<{ factor: string; band: RiskBand | null; detail: string }>;
}

export interface RiskMlSuccess {
  ok: true;
  riskBand: RiskBand;
  reasoning: string;
}

export interface RiskMlFailure {
  ok: false;
  errorReason: string;
}

export type RiskMlResult = RiskMlSuccess | RiskMlFailure;

// Advisory-only, structured-input-only system prompt — see this plan's design notes
// (docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md Section 6): the model
// never sees free-text notes or PII, only the same structured vitals fields already
// computed by the rule engine.
const SYSTEM_PROMPT = [
  'You are an advisory clinical risk-classification assistant for a maternal health platform.',
  'You are NOT providing a diagnosis and your output does not replace clinical judgment — a',
  "qualified clinician always makes the final risk determination.",
  '',
  "You will be given a JSON object describing a pregnancy episode's structured vitals and the",
  'output of a deterministic rules engine that already ran over the same data. Using this',
  'structured data only (do not assume any information not present in the JSON), call the',
  'submit_risk_assessment tool exactly once with your own advisory classification ("low",',
  '"medium", or "high") plus a short, one-or-two-sentence, plain-language reasoning string.',
].join('\n');

const RISK_ASSESSMENT_TOOL = {
  name: 'submit_risk_assessment',
  description:
    'Submit an advisory maternal-health risk classification (low, medium, or high) with a short reasoning string, based only on the structured clinical data provided in the user message.',
  input_schema: {
    type: 'object',
    properties: {
      riskBand: { type: 'string', enum: ['low', 'medium', 'high'] },
      reasoning: { type: 'string' },
    },
    required: ['riskBand', 'reasoning'],
  },
} as const;

class RiskMlTimeoutError extends Error {}

@Injectable()
export class RiskMlService {
  private readonly model = process.env.ANTHROPIC_MODEL ?? 'claude-sonnet-5';

  constructor(@Inject(ANTHROPIC_CLIENT) private readonly client: Anthropic) {}

  async assess(input: RiskMlInput): Promise<RiskMlResult> {
    try {
      const response = await Promise.race([
        this.client.messages.create({
          model: this.model,
          max_tokens: 512,
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: JSON.stringify(input) }],
          tools: [RISK_ASSESSMENT_TOOL],
          tool_choice: { type: 'tool', name: 'submit_risk_assessment' },
        }),
        this.timeout(),
      ]);

      const content = (response as any).content ?? [];
      const toolUse = content.find((block: any) => block.type === 'tool_use');
      if (!toolUse || toolUse.name !== 'submit_risk_assessment') {
        return { ok: false, errorReason: 'malformed_response: no submit_risk_assessment tool_use block' };
      }

      const toolInput = toolUse.input as { riskBand?: unknown; reasoning?: unknown };
      const riskBand = toolInput?.riskBand;
      const reasoning = toolInput?.reasoning;

      if (riskBand !== 'low' && riskBand !== 'medium' && riskBand !== 'high') {
        return { ok: false, errorReason: 'malformed_response: riskBand missing or invalid' };
      }
      if (typeof reasoning !== 'string' || reasoning.length === 0) {
        return { ok: false, errorReason: 'malformed_response: reasoning missing or empty' };
      }

      return { ok: true, riskBand, reasoning };
    } catch (err) {
      if (err instanceof RiskMlTimeoutError) {
        return { ok: false, errorReason: 'timeout' };
      }
      const message = err instanceof Error ? err.message : 'unknown error';
      return { ok: false, errorReason: `api_error: ${message}` };
    }
  }

  private timeout(): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(
        () => reject(new RiskMlTimeoutError('Claude API call exceeded the 8s timeout')),
        RISK_ML_TIMEOUT_MS,
      );
    });
  }
}
```

- [ ] **Step 6: Run test to verify it passes**

Run: `cd backend && npm test -- risk-ml.service.spec.ts`
Expected: PASS — success, timeout, both malformed-response cases, and the api_error case
all green.

- [ ] **Step 7: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/package.json backend/package-lock.json backend/.env.example backend/src/risk/risk-ml.service.ts backend/src/risk/risk-ml.service.spec.ts
git commit -m "feat: add Claude API ML-assisted risk advisory service"
```

---

### Task 5: `RiskService.assess()` — pipeline, denormalization, audit, event listeners

**Files:**
- Create: `backend/src/risk/dto/risk-assessment-response.dto.ts`
- Create: `backend/src/risk/risk.service.ts`
- Test: `backend/src/risk/risk.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getServiceClient()` (Plan 1 Task 2), `AuditService.log()`
  (Plan 1 Task 7), `RiskRulesEngineService.evaluate()` (Task 3), `RiskMlService.assess()`
  (Task 4), `pregnancy_episode`/`encounter_note`/`risk_assessment` tables,
  `EpisodeLifecycleEventPayload` type (Plan 2, exported from `episode.service.ts`).
- Produces:
  - `RiskService.assess(tenantId: string, actorUserId: string, pregnancyEpisodeId: string): Promise<RiskAssessmentResponseDto>`
  - `@OnEvent('episode.created')` and `@OnEvent('episode.clinical_data_updated')` handlers
    that call `assess()` with the event payload's fields and swallow (log, don't rethrow)
    any failure — see Global Constraints on why this must never block care.
  - `RiskEpisodeNotFoundError` (has `.episodeId`), exported from `risk.service.ts`.
  - `RiskAssessmentResponseDto` with `static fromRow(row): RiskAssessmentResponseDto`.

- [ ] **Step 1: Write the failing test for `assess()`**

Create `backend/src/risk/risk.service.spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { RiskService, RiskEpisodeNotFoundError } from './risk.service';
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- risk.service.spec.ts`
Expected: FAIL — cannot find module `./risk.service`

- [ ] **Step 3: Implement `RiskAssessmentResponseDto`**

Create `backend/src/risk/dto/risk-assessment-response.dto.ts`:
```typescript
export class RiskAssessmentResponseDto {
  id!: string;
  pregnancyEpisodeId!: string;
  assessmentTime!: string;
  ruleScore!: number;
  mlScore!: number | null;
  finalRiskBand!: string;
  explanation!: Record<string, unknown>;
  overriddenBy!: string | null;
  overrideReason!: string | null;
  status!: string;
  createdAt!: string;

  // rule_score / ml_score are Postgres `numeric` columns; PostgREST serializes numeric as a
  // JSON string (not a native number) to avoid floating-point precision loss, so every read
  // path must explicitly coerce with Number(...) rather than assume the driver already did.
  static fromRow(row: any): RiskAssessmentResponseDto {
    const dto = new RiskAssessmentResponseDto();
    dto.id = row.id;
    dto.pregnancyEpisodeId = row.pregnancy_episode_id;
    dto.assessmentTime = row.assessment_time;
    dto.ruleScore = Number(row.rule_score);
    dto.mlScore = row.ml_score === null || row.ml_score === undefined ? null : Number(row.ml_score);
    dto.finalRiskBand = row.final_risk_band;
    dto.explanation = row.explanation_json;
    dto.overriddenBy = row.overridden_by;
    dto.overrideReason = row.override_reason;
    dto.status = row.status;
    dto.createdAt = row.created_at;
    return dto;
  }
}
```

- [ ] **Step 4: Implement `RiskService.assess()` and the event listeners**

Create `backend/src/risk/risk.service.ts`:
```typescript
import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { SupabaseService } from '../common/supabase/supabase.service';
import { AuditService } from '../audit/audit.service';
import { RiskRulesEngineService, RISK_BAND_SCORE, RiskBand, RiskVitalsInput } from './risk-rules-engine.service';
import { RiskMlService } from './risk-ml.service';
import { RiskAssessmentResponseDto } from './dto/risk-assessment-response.dto';
import type { EpisodeLifecycleEventPayload } from '../episode/episode.service';

export class RiskEpisodeNotFoundError extends Error {
  constructor(public readonly episodeId: string) {
    super(`Pregnancy episode ${episodeId} not found`);
  }
}

@Injectable()
export class RiskService {
  private readonly logger = new Logger(RiskService.name);

  constructor(
    private readonly supabaseService: SupabaseService,
    private readonly auditService: AuditService,
    private readonly rulesEngine: RiskRulesEngineService,
    private readonly mlService: RiskMlService,
  ) {}

  async assess(
    tenantId: string,
    actorUserId: string,
    pregnancyEpisodeId: string,
  ): Promise<RiskAssessmentResponseDto> {
    const client = this.supabaseService.getServiceClient();

    const { data: episode, error: episodeError } = await client
      .from('pregnancy_episode')
      .select('id')
      .eq('id', pregnancyEpisodeId)
      .single();
    if (episodeError || !episode) {
      throw new RiskEpisodeNotFoundError(pregnancyEpisodeId);
    }

    const { data: latestNote, error: noteError } = await client
      .from('encounter_note')
      .select('vitals_json')
      .eq('pregnancy_episode_id', pregnancyEpisodeId)
      .order('recorded_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (noteError) {
      throw noteError;
    }
    const vitals: RiskVitalsInput = (latestNote?.vitals_json as RiskVitalsInput) ?? {};

    const ruleResult = this.rulesEngine.evaluate(vitals);

    const mlResult = await this.mlService.assess({
      pregnancyEpisodeId,
      vitals,
      ruleBand: ruleResult.band,
      ruleFactors: ruleResult.factors,
    });

    const explanation: Record<string, unknown> = { ruleFactors: ruleResult.factors };
    let finalBand: RiskBand;
    let mlScoreValue: number | null;
    let status: string;

    if (!mlResult.ok) {
      finalBand = ruleResult.band;
      mlScoreValue = null;
      status = 'FallbackRuleOnly';
      explanation.mlError = mlResult.errorReason;
    } else {
      mlScoreValue = RISK_BAND_SCORE[mlResult.riskBand];
      explanation.mlReasoning = mlResult.reasoning;
      if (RISK_BAND_SCORE[mlResult.riskBand] < RISK_BAND_SCORE[ruleResult.band]) {
        finalBand = ruleResult.band;
        explanation.mlDisagreement = {
          ruleBand: ruleResult.band,
          mlBand: mlResult.riskBand,
          resolution:
            'rule band retained; rules take precedence on disagreement (docs/DECISIONS.md #19)',
        };
      } else {
        finalBand = mlResult.riskBand;
      }
      status = 'Computed';
    }

    const { data, error } = await client
      .from('risk_assessment')
      .insert({
        pregnancy_episode_id: pregnancyEpisodeId,
        rule_score: ruleResult.score,
        ml_score: mlScoreValue,
        final_risk_band: finalBand,
        explanation_json: explanation,
        status,
      })
      .select()
      .single();
    if (error) {
      throw error;
    }

    const { error: updateError } = await client
      .from('pregnancy_episode')
      .update({ risk_band: finalBand, updated_at: new Date().toISOString() })
      .eq('id', pregnancyEpisodeId);
    if (updateError) {
      throw updateError;
    }

    // Section 6 of the design spec requires every model call and response to be traceable
    // alongside the risk_assessment row, so a clinician can review exactly what the model
    // saw (mlInput) and returned (mlOutcome) — not just the final combined result.
    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'risk_assessment',
      entityId: data.id,
      action: 'computed',
      metadata: {
        finalRiskBand: finalBand,
        status,
        mlInput: { vitals, ruleBand: ruleResult.band, ruleFactors: ruleResult.factors },
        mlOutcome: mlResult,
      },
    });

    return RiskAssessmentResponseDto.fromRow(data);
  }

  @OnEvent('episode.created')
  async handleEpisodeCreated(payload: EpisodeLifecycleEventPayload): Promise<void> {
    try {
      await this.assess(payload.tenantId, payload.actorUserId, payload.episodeId);
    } catch (err) {
      this.logger.error(
        `Risk assessment failed for episode ${payload.episodeId} after episode.created: ${
          (err as Error).message
        }`,
      );
    }
  }

  @OnEvent('episode.clinical_data_updated')
  async handleClinicalDataUpdated(payload: EpisodeLifecycleEventPayload): Promise<void> {
    try {
      await this.assess(payload.tenantId, payload.actorUserId, payload.episodeId);
    } catch (err) {
      this.logger.error(
        `Risk assessment failed for episode ${payload.episodeId} after episode.clinical_data_updated: ${
          (err as Error).message
        }`,
      );
    }
  }
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- risk.service.spec.ts`
Expected: PASS — all `RiskService.assess` and event-listener tests green. (`override`,
`getLatestForEpisode`, `listHistoryForEpisode` do not exist yet — that's Task 6; this
spec file does not reference them yet.)

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/risk/risk.service.ts backend/src/risk/risk.service.spec.ts backend/src/risk/dto/risk-assessment-response.dto.ts
git commit -m "feat: add RiskService assessment pipeline and episode-event listeners"
```

---

### Task 6: `RiskService.override()`, `getLatestForEpisode()`, `listHistoryForEpisode()`

**Files:**
- Create: `backend/src/risk/dto/override-risk-assessment.dto.ts`
- Modify: `backend/src/risk/risk.service.ts`
- Modify: `backend/src/risk/risk.service.spec.ts`

**Interfaces:**
- Consumes: `SupabaseService.getClientForUser(jwt)` (Plan 1 Task 2), `AuditService.log()`
  (Plan 1 Task 7), the `pregnancy_episode_update_tenant` RLS policy (Plan 2 Task 2, already
  permits any tenant-matching update — no new RLS needed here for `pregnancy_episode`).
- Produces:
  - `RiskService.override(jwt: string, actorUserId: string, assessmentId: string, dto: OverrideRiskAssessmentDto): Promise<RiskAssessmentResponseDto>`
  - `RiskService.getLatestForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto | null>`
  - `RiskService.listHistoryForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto[]>`
  - `RiskAssessmentNotFoundError` (has `.assessmentId`), exported from `risk.service.ts`.
  - `OverrideRiskAssessmentDto { finalRiskBand: 'low' | 'medium' | 'high'; overrideReason: string }`

- [ ] **Step 1: Write the failing tests**

Append to `backend/src/risk/risk.service.spec.ts` (add these imports to the top alongside
the existing ones — `RiskAssessmentNotFoundError` joins the existing `RiskEpisodeNotFoundError`
import):
```typescript
import { RiskService, RiskEpisodeNotFoundError, RiskAssessmentNotFoundError } from './risk.service';
```

Then append these `describe` blocks at the end of the file:
```typescript
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npm test -- risk.service.spec.ts`
Expected: FAIL — `service.override is not a function`, `service.getLatestForEpisode is not a
function`, `service.listHistoryForEpisode is not a function`, and
`RiskAssessmentNotFoundError` is not exported yet.

- [ ] **Step 3: Implement `OverrideRiskAssessmentDto`**

Create `backend/src/risk/dto/override-risk-assessment.dto.ts`:
```typescript
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';

export class OverrideRiskAssessmentDto {
  @IsIn(['low', 'medium', 'high'])
  finalRiskBand!: 'low' | 'medium' | 'high';

  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  overrideReason!: string;
}
```

- [ ] **Step 4: Implement the three methods on `RiskService`**

Add `RiskAssessmentNotFoundError` next to `RiskEpisodeNotFoundError` at the top of
`backend/src/risk/risk.service.ts`:
```typescript
export class RiskAssessmentNotFoundError extends Error {
  constructor(public readonly assessmentId: string) {
    super(`Risk assessment ${assessmentId} not found`);
  }
}
```

Add these three methods to the `RiskService` class, after `assess()` and before the
`@OnEvent` handlers:
```typescript
  async override(
    jwt: string,
    actorUserId: string,
    assessmentId: string,
    dto: OverrideRiskAssessmentDto,
  ): Promise<RiskAssessmentResponseDto> {
    const client = this.supabaseService.getClientForUser(jwt);

    const { data: existing, error: fetchError } = await client
      .from('risk_assessment')
      .select('id, pregnancy_episode_id, pregnancy_episode(facility(tenant_id))')
      .eq('id', assessmentId)
      .single();
    if (fetchError || !existing) {
      throw new RiskAssessmentNotFoundError(assessmentId);
    }
    const tenantId = (existing as any).pregnancy_episode?.facility?.tenant_id;
    const pregnancyEpisodeId = (existing as any).pregnancy_episode_id;

    const { data, error } = await client
      .from('risk_assessment')
      .update({
        final_risk_band: dto.finalRiskBand,
        overridden_by: actorUserId,
        override_reason: dto.overrideReason,
        status: 'Overridden',
      })
      .eq('id', assessmentId)
      .select()
      .single();
    if (error) {
      throw error;
    }

    const { error: episodeUpdateError } = await client
      .from('pregnancy_episode')
      .update({ risk_band: dto.finalRiskBand, updated_at: new Date().toISOString() })
      .eq('id', pregnancyEpisodeId);
    if (episodeUpdateError) {
      throw episodeUpdateError;
    }

    await this.auditService.log({
      tenantId,
      actorUserId,
      entityType: 'risk_assessment',
      entityId: assessmentId,
      action: 'overridden',
      metadata: { finalRiskBand: dto.finalRiskBand, overrideReason: dto.overrideReason },
    });

    return RiskAssessmentResponseDto.fromRow(data);
  }

  async getLatestForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto | null> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('risk_assessment')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('assessment_time', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) {
      throw error;
    }
    return data ? RiskAssessmentResponseDto.fromRow(data) : null;
  }

  async listHistoryForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto[]> {
    const client = this.supabaseService.getClientForUser(jwt);
    const { data, error } = await client
      .from('risk_assessment')
      .select('*')
      .eq('pregnancy_episode_id', episodeId)
      .order('assessment_time', { ascending: false });
    if (error) {
      throw error;
    }
    return (data ?? []).map(RiskAssessmentResponseDto.fromRow);
  }
```

Add the corresponding import at the top of `risk.service.ts`:
```typescript
import { OverrideRiskAssessmentDto } from './dto/override-risk-assessment.dto';
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && npm test -- risk.service.spec.ts`
Expected: PASS — all `RiskService` tests (assess, event listeners, override,
getLatestForEpisode, listHistoryForEpisode) green.

- [ ] **Step 6: Commit**

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/risk/risk.service.ts backend/src/risk/risk.service.spec.ts backend/src/risk/dto/override-risk-assessment.dto.ts
git commit -m "feat: add risk assessment override and read methods"
```

---

### Task 7: Controllers, module wiring, end-to-end tests

**Files:**
- Create: `backend/src/risk/risk-assessment.controller.ts`
- Create: `backend/src/risk/risk-override.controller.ts`
- Create: `backend/src/risk/risk.module.ts`
- Test: `backend/test/risk-assessment.e2e-spec.ts`
- Modify: `backend/src/app.module.ts`

**Interfaces:**
- Consumes: `RiskService` (Tasks 5–6), `AuthGuard`/`RolesGuard`/`@Roles()`/`CurrentUser`
  (Plan 1 Tasks 5–6).
- Produces:
  - `POST /api/v1/pregnancy-episodes/:episodeId/risk-assessments` — manual re-assessment
    trigger, any authenticated role (RLS/service-role split already governs who can *see*
    the episode in the first place elsewhere; this plan does not add a `@Roles()`
    restriction here — a nurse or CHW forcing a re-check after recording new vitals is a
    legitimate use, not just a clinician's).
  - `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments` — history, latest-first.
  - `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments/latest` — most recent
    assessment, or `null` if none exist yet (not a 404 — "no assessment yet" is a normal
    state, e.g. immediately after episode creation before the event listener has run).
  - `PATCH /api/v1/risk-assessments/:id/override` — `@Roles('clinician', 'admin')` per the
    spec's "clinician has final say" framing; CHW/nurse/supervisor are excluded because they
    don't carry the clinical authority the spec assigns to this specific action (unlike the
    manual trigger above, which anyone with clinical-data-entry access may reasonably want).

- [ ] **Step 1: Write the controllers**

Create `backend/src/risk/risk-assessment.controller.ts`:
```typescript
import { Controller, Get, NotFoundException, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { RiskService, RiskEpisodeNotFoundError } from './risk.service';

@Controller('pregnancy-episodes/:episodeId/risk-assessments')
@UseGuards(AuthGuard)
export class RiskAssessmentController {
  constructor(private readonly riskService: RiskService) {}

  @Post()
  async trigger(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    try {
      return await this.riskService.assess(user.tenantId, user.id, episodeId);
    } catch (err) {
      if (err instanceof RiskEpisodeNotFoundError) {
        throw new NotFoundException({
          error: { code: 'EPISODE_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }

  @Get()
  history(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    return this.riskService.listHistoryForEpisode(user.jwt, episodeId);
  }

  @Get('latest')
  latest(@CurrentUser() user: CurrentUserPayload, @Param('episodeId') episodeId: string) {
    return this.riskService.getLatestForEpisode(user.jwt, episodeId);
  }
}
```

Create `backend/src/risk/risk-override.controller.ts`:
```typescript
import { Body, Controller, NotFoundException, Param, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../common/auth/auth.guard';
import { RolesGuard } from '../common/auth/roles.guard';
import { Roles } from '../common/auth/roles.decorator';
import { CurrentUser } from '../common/auth/current-user.decorator';
import { CurrentUserPayload } from '../common/auth/auth.guard';
import { RiskService, RiskAssessmentNotFoundError } from './risk.service';
import { OverrideRiskAssessmentDto } from './dto/override-risk-assessment.dto';

@Controller('risk-assessments')
@UseGuards(AuthGuard, RolesGuard)
export class RiskOverrideController {
  constructor(private readonly riskService: RiskService) {}

  @Patch(':id/override')
  @Roles('clinician', 'admin')
  async override(
    @CurrentUser() user: CurrentUserPayload,
    @Param('id') id: string,
    @Body() dto: OverrideRiskAssessmentDto,
  ) {
    try {
      return await this.riskService.override(user.jwt, user.id, id, dto);
    } catch (err) {
      if (err instanceof RiskAssessmentNotFoundError) {
        throw new NotFoundException({
          error: { code: 'RISK_ASSESSMENT_NOT_FOUND', message: err.message, details: [] },
        });
      }
      throw err;
    }
  }
}
```

- [ ] **Step 2: Write the e2e tests**

Create `backend/test/risk-assessment.e2e-spec.ts`:
```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import * as request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Risk assessment endpoints (e2e)', () => {
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

  it('rejects a manual risk-assessment trigger with no auth token', () => {
    return request(app.getHttpServer())
      .post('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments')
      .expect(401);
  });

  it('rejects risk-assessment history listing with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments')
      .expect(401);
  });

  it('rejects fetching the latest risk assessment with no auth token', () => {
    return request(app.getHttpServer())
      .get('/api/v1/pregnancy-episodes/11111111-1111-1111-1111-111111111111/risk-assessments/latest')
      .expect(401);
  });

  it('rejects a risk-assessment override with no auth token', () => {
    return request(app.getHttpServer())
      .patch('/api/v1/risk-assessments/11111111-1111-1111-1111-111111111111/override')
      .send({ finalRiskBand: 'low', overrideReason: 'test' })
      .expect(401);
  });
});
```

Note: as with Plan 1's `facility.e2e-spec.ts` and Plan 2's `episode.e2e-spec.ts`, this stops
at the 401-on-missing-auth case rather than a full authenticated round trip — same
precedent, not a new gap introduced by this plan.

- [ ] **Step 3: Run the e2e tests to verify they pass**

Run: `cd backend && npm run test:e2e -- risk-assessment.e2e-spec.ts`
Expected: PASS

- [ ] **Step 4: Wire the module and commit**

Create `backend/src/risk/risk.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { RiskAssessmentController } from './risk-assessment.controller';
import { RiskOverrideController } from './risk-override.controller';
import { RiskService } from './risk.service';
import { RiskRulesEngineService } from './risk-rules-engine.service';
import { RiskMlService, ANTHROPIC_CLIENT } from './risk-ml.service';

@Module({
  controllers: [RiskAssessmentController, RiskOverrideController],
  providers: [
    RiskService,
    RiskRulesEngineService,
    RiskMlService,
    {
      provide: ANTHROPIC_CLIENT,
      // Falls back to a placeholder key when ANTHROPIC_API_KEY isn't set (local dev/CI
      // without a real key) so the app can still boot and every other endpoint keeps
      // working. Any real call attempted with a placeholder key simply fails Anthropic's
      // own auth check and is caught by RiskMlService's existing api_error fallback path —
      // this is intentional, not a bug: risk assessment must never be a hard dependency
      // for the app to even start, extending the same principle the design spec (Section
      // 6) applies to a single failed call.
      useFactory: () => new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'test-key-placeholder' }),
    },
  ],
  exports: [RiskService],
})
export class RiskModule {}
```

Add `RiskModule` to the `imports` array in `backend/src/app.module.ts`.

```bash
cd /Users/dot/Documents/Projects/VCA-Health
git add backend/src/risk/ backend/test/risk-assessment.e2e-spec.ts backend/src/app.module.ts
git commit -m "feat: add risk assessment controllers and wire risk module into app"
```

---

## Handoff to Plan 6 (Clinician Dashboard)

The clinician dashboard needs the following to display and override risk assessments on
the facility triage board (design spec Section 5, flow 3).

**Important caveat to surface in the UI, not just this doc:** the rule engine's thresholds
are **provisional and have not received clinical sign-off** (`docs/DECISIONS.md`, "Still
Open"; this plan's Global Constraints). Whatever the dashboard shows next to a risk band —
a badge, a tooltip, a footnote — should make this legible to the clinician viewing it, not
just to whoever reads this plan.

### `RiskService` (`backend/src/risk/risk.service.ts`)

- `assess(tenantId: string, actorUserId: string, pregnancyEpisodeId: string): Promise<RiskAssessmentResponseDto>` — also reachable via `POST /api/v1/pregnancy-episodes/:episodeId/risk-assessments`, for a "re-run assessment" button on the triage board.
- `override(jwt: string, actorUserId: string, assessmentId: string, dto: OverrideRiskAssessmentDto): Promise<RiskAssessmentResponseDto>` — also reachable via `PATCH /api/v1/risk-assessments/:id/override`, restricted to `clinician`/`admin` roles.
- `getLatestForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto | null>` — also reachable via `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments/latest`. Returns `null` (HTTP 200 with a `null` body), not a 404, when no assessment exists yet — a legitimate transient state right after episode creation.
- `listHistoryForEpisode(jwt: string, episodeId: string): Promise<RiskAssessmentResponseDto[]>` — also reachable via `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments` (newest first), for a risk-history timeline view on the episode detail screen.
- Throws `RiskEpisodeNotFoundError` (has `.episodeId`) and `RiskAssessmentNotFoundError` (has `.assessmentId`), both exported from `risk.service.ts`.

### DTOs (`backend/src/risk/dto/`)

- `RiskAssessmentResponseDto { id, pregnancyEpisodeId, assessmentTime, ruleScore, mlScore, finalRiskBand, explanation, overriddenBy, overrideReason, status, createdAt }` with `static fromRow(row): RiskAssessmentResponseDto`.
  - `ruleScore`/`mlScore` are already coerced to JS numbers (0/1/2, or `null` for `mlScore` when ML didn't run) — no further parsing needed on the frontend.
  - `finalRiskBand` is one of `'low' | 'medium' | 'high'`; `status` is one of `'Pending' | 'Computed' | 'Overridden' | 'Failed' | 'FallbackRuleOnly'`.
  - `explanation` is the JSON object described below — render `explanation.ruleFactors` as the primary reason-code list; if present, `explanation.mlReasoning` is the model's stated reasoning, `explanation.mlDisagreement` means the model wanted a lower band and was overruled by the rules, and `explanation.mlError` means ML enrichment didn't run at all (show this plainly — it's the difference between "the model agreed" and "the model never got a chance to weigh in").
- `OverrideRiskAssessmentDto { finalRiskBand: 'low' | 'medium' | 'high'; overrideReason: string }` — `overrideReason` is required, 3–1000 characters (enforced by the global `ValidationPipe` Plan 2 wired up).

### `explanation_json` shape

```typescript
{
  ruleFactors: Array<{
    factor: 'bloodPressure' | 'hemoglobin' | 'temperature';
    band: 'low' | 'medium' | 'high' | null; // null = insufficient data, factor didn't contribute
    detail: string; // human-readable reason, e.g. "severe hypertension: systolic 165 mmHg (>=160) ..."
  }>;
  mlReasoning?: string;        // present when the ML call succeeded
  mlDisagreement?: {           // present when ML succeeded but suggested a lower band than the rules
    ruleBand: 'low' | 'medium' | 'high';
    mlBand: 'low' | 'medium' | 'high';
    resolution: string;
  };
  mlError?: string;            // present when the ML call failed for any reason (e.g. "timeout")
}
```

### REST endpoints

- `POST /api/v1/pregnancy-episodes/:episodeId/risk-assessments` — any authenticated role
- `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments`
- `GET /api/v1/pregnancy-episodes/:episodeId/risk-assessments/latest`
- `PATCH /api/v1/risk-assessments/:id/override` — roles: `clinician`, `admin`

### Events this plan consumes (does not re-emit)

`RiskService` listens for Plan 2's `'episode.created'` and `'episode.clinical_data_updated'`
events and runs `assess()` automatically on both — the dashboard does not need to trigger
anything itself for the normal flow; the manual-trigger endpoint above exists only for a
clinician explicitly forcing a re-check.

### Not built in this plan (explicitly deferred)

- Clinical validation of the rule thresholds (see caveat above) — a standing open item in `docs/DECISIONS.md`, not something Plan 6 should attempt to resolve on its own either.
- A structured "prior complications" scoring factor — no such field exists yet in `encounter_note` (see this plan's Global Constraints); the rules engine only scores BP, hemoglobin, and temperature.
- Any notification/alerting when a `high` band is computed — the design spec's Section 5 flow 5 (Supervisor KPI dashboard) covers risk-band-distribution *reporting*, but nothing in this plan or Plan 2 pushes a real-time alert; the triage board is expected to be pulled/refreshed, not pushed to.
- Facility-level RLS scoping — `risk_assessment`'s RLS is tenant-only, matching Plan 1/2's own established precedent and limitation.
