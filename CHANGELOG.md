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

### Backend Build — Plan 1: Backend Foundation (in progress)

- `28d90f8` — NestJS project scaffolded with a health check endpoint.
- `23226a3` — Supabase project connection service (`SupabaseService`) added.
- `70ad191` — Core schema migration applied to the live `amhos` project: `facility`,
  `person`, `app_user` tables.
- *(updated as the build agent continues through Plan 1's remaining tasks)*
