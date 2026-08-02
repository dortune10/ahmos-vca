# Changelog

All notable changes to this project, in chronological order. This tracks *what* changed —
see [`docs/DECISIONS.md`](docs/DECISIONS.md) for *why*, and
[`docs/superpowers/plans/`](docs/superpowers/plans/) for the detailed implementation plans
each build phase follows. Kept up to date as work lands, same as the decision log.

## 2026-08-01

### Documentation & Planning

- `b3e6fd9` — Initial project setup: source PRD, README, initial design docs.
- `a188dd8` — Resolved the CHW/Nurse dashboard split as a shared shell with role-aware
  content (decision #20).
- `1b5f424` — Backend Foundation implementation plan (Plan 1) written; found and fixed a
  real data-model gap (no table for encounter notes/vitals — decision #22).
- `8a8cc92` — Documented the cloud Supabase project for deployment.
- `b937593` — Plans 2 (Episode & Task Management), 3 (Risk Scoring Engine), 4 (Referral
  Lifecycle), and 8 (Admin Dashboard) written; switched dev/test database to the hosted
  `amhos` Supabase project rather than local Docker or a paid branch (decision #23).
- `704ba19` — Switched Plan 1's migration steps to the Supabase MCP's `apply_migration`
  tool, removing the local CLI's interactive database-password requirement.
- Plans 5 (Frontend Foundation + CHW/Nurse Dashboard), 6 (Clinician Dashboard), and 7
  (Supervisor Dashboard) written — **all 8 implementation plans for the staff platform MVP
  are now complete.**
- `acf8eef` — Added `CHANGELOG.md` (this file); refreshed `README.md` to reflect that
  planning is complete and the build is underway.
- `04b81fa` — Cross-plan consistency pass across Plans 2, 3, 4, and 8: fixed a DTO gap
  (episode status couldn't be manually set to `Admitted`/`Cancelled` via the HTTP endpoint
  Plan 4 needed), resolved a migration-number collision between Plans 3 and 4, removed
  Plan 8's now-redundant facility RLS migration (Plan 1 covers it directly), and brought
  all four plans' database-workflow instructions in line with Plan 1's `apply_migration`
  MCP-based approach.

### Backend Build — Plan 1: Backend Foundation — ✅ Complete

- `28d90f8` — NestJS project scaffolded with a health check endpoint.
- `23226a3` — Supabase project connection service (`SupabaseService`) added.
- `70ad191` — Core schema migration applied to the live `amhos` project: `facility`,
  `person`, `app_user` tables.
- `b062b6c` — Tenant-isolation RLS policies added. **Found and fixed two real bugs**: an
  RLS-policy infinite recursion (Postgres `54001`) and, once fixed, the helper function
  being unintentionally exposed over the REST API — moved to a non-exposed `private` schema.
  See the full [execution report](docs/superpowers/executions/2026-08-01-backend-foundation-execution.md)
  for all bugs found/fixed and deviations from the plan's literal text.
- `d71569e` — JWT auth guard + `CurrentUser` decorator.
- `09a9a3e` — Role-based access guard.
- `9d42911` — Immutable audit event log.
- `15a5e90` — Facility module (create, list-by-accepting-referrals).
- `067ba07` — Identity module with duplicate-detecting person registration.
- `d6738e9` — Admin-only staff user creation.
- `a963958` — Fixed `auth_app_user()` references across all 8 plan documents to match what
  was actually built (`private.auth_app_user()`), since the rename from `b062b6c` above
  rippled into every plan that writes its own RLS policies against this helper.
- **All 10 tasks complete.** 15 unit tests + 5 e2e tests passing against the real `amhos`
  project. Full details: [execution report](docs/superpowers/executions/2026-08-01-backend-foundation-execution.md).

### Frontend Build — Plan 5: Frontend Foundation + CHW/Nurse Dashboard — ✅ Complete

- `3533b6c` — Next.js frontend scaffolded with Jest/RTL test harness.
- `6613229` — Supabase browser and server client factories.
- `d1230b3` — Typed `apiFetch` client with `ApiError`.
- `51b691b` — `Button`, `Input`, `Card`, `Table` shared UI primitives.
- `0c38348` — `getCurrentAppUser` and `CurrentUserProvider`/`useCurrentUser`.
- `b2e1ebe` — Staff login page.
- `561e43f` — Shared dashboard shell with role-based routing and nav.
- `1d8853b` — CHW/Nurse caseload list.
- `7d5cbef` — Role-aware quick registration form.
- `b6101cb` — Visit checklist.
- `bdf1954` — Role-aware encounter note form.
- **All 11 tasks complete.** 43 tests passing (16 suites), built entirely in parallel with
  the backend build above — no file conflicts, no runtime dependency. Full details:
  [execution report](docs/superpowers/executions/2026-08-01-frontend-foundation-execution.md).

### First Real Preview

- `9bc2428` — Fixed a real startup bug (`import type` needed for `CurrentUserPayload` in
  three controllers — `nest start --watch` enforces `isolatedModules`, which `npm test`
  didn't). Both dev servers started (`.claude/launch.json`: backend on :3000, frontend on
  :3001) and confirmed working: backend health check returns `{"status":"ok"}`, frontend
  correctly redirects unauthenticated visitors to the login page.
- Created a one-time bootstrap admin account (`entravabot@gmail.com`) directly via the
  Supabase Auth Admin API + a matching `app_user` insert, since no plan currently provides a
  way to create the *first* admin (`POST /api/v1/users` requires being an admin already).
  Verified the account can actually log in via a real Supabase Auth password-grant call
  before handing off credentials.
- User reported the login page didn't work in their own browser. Live-debugged in an
  automated browser and found two real, distinct bugs (neither was a test-suite gap — both
  only surfaced by actually running the app):
  1. The sign-in button relied on the native `<form>` `submit` event bubbling up to reach
     React's `onSubmit` — unreliable in practice (confirmed React had hydrated correctly and
     the handler was properly wired, but clicking fell through to the browser's native
     full-page form submission instead of invoking it). Fixed by calling the handler
     directly from the button's `onClick`, with an explicit Enter-key handler added to
     preserve keyboard submission.
  2. The real one: `app/page.tsx`'s post-login redirect fell back to `/login` whenever the
     signed-in user's role had no entry in `ROLE_HOME_ROUTE` — since `admin` has no entry
     yet (Plan 8 not executed), a **successful** admin sign-in looked identical to a failed
     one. This is what actually made the bootstrap admin account appear broken. Fixed to
     show an honest "signed in, no dashboard yet for this role" message instead.
  Commit `8df1cb8`. User confirmed the fix in their own browser afterward.
- `backend/scripts/bootstrap-admin.js` (`npm run bootstrap:admin`) — turned the one-time
  manual bootstrap above into a proper reusable script per user request: idempotent (refuses
  to duplicate an existing email), reuses an existing tenant if one already has staff in it.
  Tested both paths (idempotency refusal, and a real create-then-delete round trip) before
  committing. Surfaced along the way: the shared dev database has some test-fixture rows
  mixed in with real data (a `tenant_id = 11111111-...` row from e2e test runs) — logged as
  a follow-up in `docs/DECISIONS.md`, not urgent since it's test junk not patient data.
  Decision #24.
- `68cb169` — Real bug: the backend never actually loaded `backend/.env` (NestJS's CLI
  doesn't do this automatically). Every unit/e2e test set env vars directly in the test
  code, and the health check never touches Supabase, so this stayed invisible through both
  "tests pass" and "the app starts and responds" verification — every real endpoint
  (`facilities`, `persons`, `users`) was silently throwing `supabaseUrl is required` the
  whole time. Found while creating a second (nurse) test account via the real
  `POST /api/v1/users` API. Fixed with `dotenv`; verified the same call now succeeds.
  Documented as Addendum 2 in Plan 1's execution report.
- Created `nurse-demo@example.com` via the real, now-working admin-authenticated API — the
  first fully real end-to-end account creation (login → admin session → API call → new
  account), not another manual bootstrap.

### Backend Build — Plan 2: Episode & Task Management — ✅ Complete

- `e97391f` / `b0b0f0d` — `pregnancy_episode`, `encounter_note`, `care_task` schema + RLS
  policies, applied to the live `amhos` project.
- `8a5eae8` — Event emitter (`episode.created` / `episode.clinical_data_updated`) + global
  `ValidationPipe` wiring (a real gap in Plan 1: DTOs had `class-validator` decorators that
  were never actually enforced at runtime).
- `b944e54` — `tasks` module: ANC schedule generation, listing, completion, overdue query.
- `d7efbc0` / `0c6855b` — `EpisodeService` (create, encounter notes, status updates,
  caseload reads) + controller.
- **All 6 tasks complete.** 36 unit tests + 17 e2e tests passing against the real project,
  clean build, live smoke test verified. No deviations from the plan's interfaces — Plans
  3, 4, 6, 7 can rely on the contract exactly as documented. Full details:
  [execution report](docs/superpowers/executions/2026-08-01-episode-task-management-execution.md).

### Backend Build — Plan 3: Risk Scoring Engine — ✅ Complete

- `4fbe605` / `e7e82e0` — `risk_assessment` schema + tenant-isolation RLS policies, applied
  to the live `amhos` project (scoped via `private.auth_app_user()` + a join through
  `pregnancy_episode`, matching Plans 1/2).
- `0f0ca9d` — Deterministic rules engine (`RiskRulesEngineService`). Thresholds are real
  obstetric reference ranges but **provisional / not clinically signed off** — that framing
  lives in the code (a header comment block), not just the plan, per user requirement.
- `b4840cf` — Claude API ML-assisted advisory tier (`RiskMlService`) with rule-only fallback.
  Found and fixed a real `TS2769` build bug invisible to Jest: `@anthropic-ai/sdk`'s
  `Tool.input_schema.required` is a mutable `string[]`, so the plan's `as const` tool
  definition didn't type-check — only `tsc` caught it.
- `a1c5edd` — `RiskService` pipeline (rules → optional ML → persist) + `@OnEvent` listeners
  that auto-score on `episode.created` / `episode.clinical_data_updated`.
- `b77b9c5` / `a31f23e` — Override + read methods, both controllers, `RiskModule` wired in.
- **All 7 tasks complete.** Independently re-verified from a clean tree: 78 unit + 28 e2e
  tests passing against the live project, clean build, no new security-advisor findings on
  `risk_assessment`. Executed **solo** (not in parallel) after the earlier concurrent-git
  lesson. **Caveat:** no real `ANTHROPIC_API_KEY` was available, so the ML tier has only run
  against a mocked client — every real call currently hits the rule-only fallback until a key
  is supplied. Full details:
  [execution report](docs/superpowers/executions/2026-08-01-risk-scoring-engine-execution.md).

### Backend Build — Plan 4: Referral Lifecycle — ✅ Complete

- `dcba203` — `referral` schema migration + widened `pregnancy_episode.status` `CHECK`
  constraint to add `Admitted`/`Cancelled`, applied to the live `amhos` project (migration
  `00000000000008`).
- `c30e106` — Tenant-isolation RLS policies for `referral` (select/insert/update, no delete),
  applied to the live project (migration `00000000000009`).
- `b066f5c` — Strict referral state machine (`referral-state-machine.ts`): 9-value
  `ReferralStatus` union, `REFERRAL_STATUS_TRANSITIONS` graph, `InvalidReferralStateError`.
- `4db5dd5` — `ReferralService`: create (facility-accepting check, episode side effect to
  `Referred`), status transitions (milestone timestamps, `Arrived→Admitted` /
  `Failed|Cancelled→Active` episode side effects), reads.
- `5d7ac53` — `ReferralController` + `ReferralModule` wired into `AppModule`.
- **All 5 tasks complete.** Independently re-verified: 114 unit + 38 e2e tests passing against
  the live project, clean build, no new security-advisor findings on `referral`, all 5 commits
  cleanly scoped. **Honest note:** the interface-deviation review found the documented
  contract (every method/DTO/error/route Plan 6 and 7 depend on) matches with zero deviation,
  but flagged three purely cosmetic differences from the plan's literal code text (an
  `import type` fix required by this repo's `tsconfig.json`, one comment reword, one
  default-vs-namespace import in a test file) — none affect behavior or the contract. Full
  details:
  [execution report](docs/superpowers/executions/2026-08-01-referral-lifecycle-execution.md).

### Full-Stack Build — Plan 8: Admin Dashboard — ✅ Complete

- `378470b` — Admin role added to `ROLE_HOME_ROUTE` + `/admin` landing page.
- `8fab99e` — `GET /api/v1/audit-events` (extends Plan 1's write-only audit module).
- `3962bde` — `PATCH /api/v1/facilities/:id` (uses the RLS policy Plan 1 already added
  after an earlier gap was found — zero new migrations needed for this whole plan).
- `673cd3b` / `24e0768` / `8202775` / `ce7bdf1` — staff management, audit log, and facility
  management admin pages, and the `GET /api/v1/users` endpoint backing the staff page.
- **All 7 tasks complete.** 36 backend unit + 17 backend e2e + 53 frontend tests passing.
  Full details, including one commit with a mismatched (but content-correct) message caused
  by a concurrent-agent git issue below: [execution report](docs/superpowers/executions/2026-08-01-admin-dashboard-execution.md).

### Full-Stack Build — Plan 6: Clinician Dashboard — ✅ Complete

- `99e3adb` — Batch person lookup (`GET /api/v1/persons?ids=`) added to the identity module,
  used by the triage board to resolve many person records in one call.
- `5da6a84` — Clinician "Referrals" nav link added to the shared `nav.tsx` (all 5 roles' links
  and the sign-out button confirmed still intact by this plan's verification).
- `a9eeb5d` — Clinician facility triage board, sorted by risk band then EDD.
- `f4edeeb` — Frontend mirror of Plan 4's referral state machine, plus an episode-eligibility
  rule for when a referral can be created — verified byte-for-byte identical to the backend's
  real state machine.
- `28ac0aa` / `1ee09cc` / `ab6d856` — Clinician episode detail page: risk assessment display,
  encounter note form, risk override control, and referral creation form.
- `a0dd3a1` — Clinician referral status view, with transitions gated by the state-machine
  mirror.
- `3f7a4f4` — Real bug fix, found via live-browser testing after the plan's own tasks were
  done, not by any test suite: the backend sends an empty HTTP body for "no risk assessment
  yet," which the frontend's `apiFetch` resolves to `undefined`, not the `null` the episode
  detail page's render check expected — normalized with `?? null` before the check.
- **Two real bugs found and fixed during this plan's own live-browser verification, neither
  caught by any test suite:** (1) an `err instanceof ApiError` check too narrow for real
  `Error` subclasses, widened to `instanceof Error` in the two handlers where it was found
  (confirmed safe: neither handler reads any `ApiError`-specific field); (2) the `undefined`-
  vs-`null` risk-assessment gap above (`3f7a4f4`). The independent review flagged that the
  same `apiFetch`-empty-body-resolves-to-`undefined` pattern could recur on any future page
  that checks `someValue === null` against an `apiFetch` result — logged as a watch item in
  `docs/DECISIONS.md`, not a current bug elsewhere (a full-codebase search found no other page
  with this exact issue today).
- **All 8 tasks complete.** Independently re-verified: 116 backend unit + 38 backend e2e + 81
  frontend tests passing, backend build/typecheck clean, frontend build's 14 ESLint errors
  confirmed 100% pre-existing (byte-identical to the commit before this plan started, none
  touching Plan 6 files), zero new migrations, `person` RLS policy unchanged and confirmed to
  cover the new batch-lookup query pattern, no new security-advisor findings, and the referral
  state-machine mirror matches the backend exactly. Full details: [execution report](docs/superpowers/executions/2026-08-01-clinician-dashboard-execution.md).

### Full-Stack Build — Plan 7: Supervisor Dashboard — ✅ Complete

- `bfea96f` — Reporting module added with episode-based KPI aggregates (registered
  pregnancies, ANC task completion rate, high-risk case count, referral SLA breach count,
  risk-band distribution, referral outcome breakdown), each query routed through the caller's
  own RLS-scoped Supabase client — no service-role bypass anywhere in the module.
- `2a51333` — ANC task completion rate and referral SLA/outcome-breakdown aggregates
  implemented for real (test-scaffolding fixes to `buildFakeClient`'s fixtures landed in the
  same commit as this production work).
- `ca81520` — Reporting controller (`GET /api/v1/reports/kpi-summary`,
  `GET /api/v1/reports/sla-breaches`) added and wired into `AppModule`, with e2e coverage.
- `30d535e` — Supervisor KPI dashboard page.
- `78b784b` — Supervisor SLA-breach referral cohort page (hours-open computation, truncated
  episode id, urgency/status display).
- `c098eca` — Supervisor "Referral SLA" nav link added to the shared `nav.tsx` (all 5 roles'
  links and the sign-out button confirmed still intact).
- **All tasks complete.** Independently re-verified: 128 backend unit + 42 backend e2e + 87
  frontend tests passing, clean backend/frontend builds (zero new ESLint errors or warnings),
  zero new migrations, and — most importantly — **no cross-tenant leak risk found** in the new
  cross-entity reporting queries: every aggregate goes through the caller's own JWT-scoped
  Supabase client, riding on the same tenant-scoped RLS policies every other module already
  uses. The independent review also corrected one inaccurate claim in the original report (an
  import described as type-only that is actually a regular value import — a documentation
  correction only, not a functional issue) and confirmed two pre-existing, platform-wide MVP
  gaps as genuinely real and previously unnoticed: no MFA on any role, and no browser-driven
  end-to-end tests exist anywhere in the repo (both now logged in `docs/DECISIONS.md`'s "Still
  Open" section). A third flagged gap (facility-level vs. tenant-level RLS granularity) turned
  out to already be documented in the referral RLS migration file itself, so no new decision
  entry was needed for it. Full details: [execution report](docs/superpowers/executions/2026-08-01-supervisor-dashboard-execution.md).

**All 8 implementation plans for the staff platform MVP are now complete and merged.** The
platform described in
[`docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md`](docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md)
is code-complete — with two confirmed, honestly-tracked gaps against that spec (no MFA, no
browser-driven e2e tests; see the execution report's "MVP Gap Check" section and the new
"Still Open" entries in `docs/DECISIONS.md`) rather than a claim that nothing remains to do.

### Post-Launch Fixes: Sign-Out and Input Contrast

- Added a working "Sign out" button to `frontend/components/nav.tsx` (previously missing
  entirely — a real gap the user found while using the live app). Calls
  `supabase.auth.signOut()`, then `router.push('/login')` + `router.refresh()` so the root
  layout re-reads the now-cleared session cookie. Verified live end-to-end (login → sign out
  → redirected to `/login`); 3/3 `nav.test.tsx` tests passing, 54/54 frontend suite passing.
- Fixed a real contrast bug: user reported typed text in login/form inputs was "very faint,"
  nearly invisible. Root cause was `app/globals.css`'s `prefers-color-scheme: dark` media
  query setting `body { color: var(--foreground) }` to near-white (`#ededed`), which every
  `<input>` inherited — but the shared `Input` component (`frontend/components/ui/input.tsx`)
  never set its own text/background color, so on a browser/OS in dark mode the input kept its
  native light background while the typed text rendered near-white-on-white. Fixed by giving
  `Input` an explicit `bg-white text-gray-900` (plus `placeholder:text-gray-400`), independent
  of system theme. Verified live with the browser's `prefers-color-scheme` forced to dark:
  confirmed via computed styles (`color: rgb(17, 24, 39)` on `background: rgb(255, 255, 255)`)
  before/after. Every text input in the app goes through this one shared component, so this
  was a single-source fix.

### Concurrent-Agent Build: Plans 2 and 8 Ran Together

Plans 2 and 8 were executed by two independent agents running **at the same time** against
the same `backend/` git repository (Plan 8 also touches `frontend/`, which Plan 2 never
does). This surfaced a real bug in the user's global `rtk` Claude Code hook
(`~/.claude/settings.json`): it rewrites `git add`/`git commit` for token savings but
doesn't reliably respect pathspec scoping under concurrent invocation, letting one
process's staged changes ride along into another's commit. Both agents caught and worked
around this (bypassing the hook via `/usr/bin/git` directly, verifying every commit with
`git show --stat`) — no data was lost, but one commit (`ce7bdf1`) ended up with a message
that doesn't match its actual content (deliberately left as-is rather than risking a
history rewrite). Logged as a standing memory
(`feedback-concurrent-agent-git-safety`) for future sessions. A PR (#1) was opened for this
combined work rather than pushing straight to `main`, since this was the first time this
session used a feature-branch workflow.
