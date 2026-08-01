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

### Frontend Build — Plan 5: Frontend Foundation + CHW/Nurse Dashboard (in progress)

- `3533b6c` — Next.js frontend scaffolded with Jest/RTL test harness.
- `6613229` — Supabase browser and server client factories.
- `d1230b3` — Typed `apiFetch` client with `ApiError`.
- *(updated as the build agent continues through Plan 5's remaining tasks; running in
  parallel with the backend build above, since it lives in a separate `frontend/` directory
  and its test suite mocks all backend calls)*
