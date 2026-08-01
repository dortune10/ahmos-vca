# Plan 1 (Backend Foundation) — Execution Report

- **Plan:** [`docs/superpowers/plans/2026-08-01-backend-foundation.md`](../plans/2026-08-01-backend-foundation.md)
- **Status:** ✅ Complete — all 10 tasks, all tests genuinely passing
- **Executed:** 2026-08-01, by an autonomous build agent following the plan task-by-task
  (write failing test → confirm fail → implement → confirm pass → commit)
- **Target database:** hosted Supabase project `amhos` (`wjgyivxvmqchlhgmxcxe`), real commands,
  real commits, real schema changes — not a simulation

## Final Verification

- `npm test` (backend): **8 suites, 15 tests, all passing**
- `npm run test:e2e` (backend): **4 suites, 5 tests, all passing**, run against the real
  hosted project
- `get_advisors` (security): only one pre-existing, unrelated finding remains —
  `auth_leaked_password_protection` (a project-level Auth dashboard toggle, not touchable
  via migration, not introduced by this plan)

## Commits

```
28d90f8 feat: scaffold NestJS backend with health check endpoint
23226a3 feat: link Supabase project and add connection service
70ad191 feat: add core schema migration for facility, person, app_user
b062b6c feat: add tenant-isolation RLS policies for facility, person, app_user
d71569e feat: add JWT auth guard and CurrentUser decorator
09a9a3e feat: add role-based access guard
9d42911 feat: add immutable audit event log
15a5e90 feat: add facility module with create and list-by-accepting-referrals
067ba07 feat: add identity module with duplicate-detecting person registration
d6738e9 feat: add admin-only staff user creation
```

## Real Bugs Found and Fixed During Execution

These were not caught by the plan's own mocked unit tests — they only surfaced when the
code ran for real against the live database. Each is a legitimate finding, not a
transcription error.

1. **RLS infinite recursion (serious).** The `auth_app_user()` helper selected from
   `app_user`, but `app_user`'s own RLS policy also called `auth_app_user()` — recursing
   infinitely (Postgres `54001 stack depth limit exceeded`). Fixed per Supabase's documented
   pattern: made the helper `SECURITY DEFINER` with an explicit `auth.uid()` filter inside,
   so the internal lookup bypasses RLS for just that one row.
2. **`SECURITY DEFINER` function exposed via the REST API.** Fixing #1 made the function
   directly callable over `/rest/v1/rpc/auth_app_user` by any authenticated client —
   `get_advisors` flagged this (`anon_security_definer_function_executable` /
   `authenticated_security_definer_function_executable`). Fixed by moving the function into
   a non-exposed `private` schema (PostgREST only exposes `public` by default). **This is
   the reason the function is now `private.auth_app_user()`, not
   `public.auth_app_user()`** — see the follow-up section below, this rippled into every
   other plan.
3. **Mutable `search_path` on the helper function.** Fixed by pinning
   `set search_path = public` (Supabase advisor: `function_search_path_mutable`).
4. **Non-idempotent e2e test fixtures.** `schema.e2e-spec.ts` and `rls.e2e-spec.ts` insert
   fixed-ID/fixed-email rows with no cleanup — broke on re-run against the persistent shared
   database. Added idempotent delete-before-insert cleanup to both.
5. **`@supabase/supabase-js` version mismatch.** The plan's `SupabaseService` test asserted
   on `client.rest.headers['Authorization']`/`['apikey']` as plain-object bracket access;
   the installed v2.111.0 uses a real Fetch `Headers` instance there and never statically
   stores `apikey`. Rewrote assertions to use `client.headers['Authorization']` and
   `client.supabaseKey`.
6. **Missing `client.auth.getUser` mock.** The plan's own (corrected) `AuthGuard`
   implementation calls `client.auth.getUser(jwt)`, but its test fixture never mocked it,
   throwing a `TypeError`. Added the mock.
7. **`import * as request from 'supertest'` fails under `esModuleInterop`.** Runtime
   `TypeError: request is not a function`. Fixed to a default import, matching the Nest
   scaffold's own convention.
8. **Task-ordering bug.** The plan ran the facility e2e test (Step 7) before wiring
   `FacilityModule` into `AppModule` (Step 8) — without the module registered,
   `POST /api/v1/facilities` 404s instead of 401ing, so the test would have passed for the
   wrong reason. Wired the module in first so the test genuinely exercises the auth guard.
9. **Jest parallel-worker flakiness against the single shared remote database.** Running the
   full e2e suite with Jest's default multi-worker parallelism intermittently timed out
   hitting the same remote project concurrently. Added `"maxWorkers": 1` to
   `backend/test/jest-e2e.json`. **This matters for every later plan** — they share this
   same database and same e2e test command; don't remove this setting.

## Deviations From the Plan's Literal Text

- `private.auth_app_user()` instead of `public.auth_app_user()` (required by bug fix #2).
  **No public interface or method name changed** — `AuthGuard`, `CurrentUserPayload`,
  `SupabaseService`, `AuditService`, `FacilityService`, `IdentityService`, `UsersService` all
  match the plan's exact signatures.
- Installed `jsonwebtoken`/`@types/jsonwebtoken` (Task 4) and `class-validator`/
  `class-transformer` (Task 8) — required by the plan's own test/DTO code but never listed
  as an explicit install step.
- Fixed the Nest scaffold's default `test/app.e2e-spec.ts` (tested `GET /` →
  `'Hello World!'`) to test the real `GET /api/v1/health` endpoint instead, since Task 1's
  changes made the original generated test permanently fail.

## Follow-up Impact on Other Plans

The `private.auth_app_user()` rename rippled outward: every plan that writes its own RLS
policies referencing this helper (Plans 2, 3, 4, 6, 8) had written `auth_app_user()`
unqualified, copying Plan 1's *original* (buggy) plan document before it was corrected. Left
as-is, every one of those plans' migrations would have failed outright once executed (the
function no longer exists in `public` at all). **Fixed in a follow-up pass** — see commit
`a963958` and `docs/DECISIONS.md` for the cross-plan consistency work this triggered. Plan
1's own plan document was also updated to show the corrected SQL, so it no longer documents
a version of itself that was never actually shipped.

## Not Fixed (Deliberately Out of Scope)

`auth_leaked_password_protection` (Supabase advisor, WARN) — a project-level Auth dashboard
toggle, unrelated to this plan's schema/RLS work, not touchable via `apply_migration`, and
pre-existing rather than introduced by anything in this plan.
