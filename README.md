# VCA-Health — AMHOS

AMHOS (AI Maternal Health Operating System) is a multi-channel maternal/newborn care
coordination platform per the source PRD — CHWs and clinicians work through a mobile/web
app, supervisors through web dashboards, and pregnant women are reached through whichever
patient-engagement channel fits (SMS, IVR, WhatsApp, or app messaging). **This is not a
WhatsApp-first product** — WhatsApp is one patient-facing engagement channel among several
the PRD defines (Module 5), not the platform's architecture.

This directory is a fresh build, independent of the earlier AMHOS hackathon prototype.
**Current MVP scope is the core platform:** backend services plus web dashboards for staff
roles (CHW/Nurse, Clinician, District Supervisor, Tenant Admin). A WhatsApp AI assistant
for patients was fully designed first, then deliberately descoped to build the platform
first — it's kept as a ready-to-build spec for a later phase, not abandoned. See
`docs/DECISIONS.md` #16 for why.

## Status

All 8 implementation plans for the staff platform MVP are written. **Plan 1 (Backend
Foundation) is fully executed** — real code, real tests, real commits against the hosted
Supabase project; see its execution report for what actually happened, including real bugs
found and fixed along the way. Plan 5 (Frontend Foundation) is executing now. See
[`CHANGELOG.md`](CHANGELOG.md) for what's actually landed so far.

## Documents

- **Source PRD:** [`Bridget Ukeni_Vibe Code Africa Project_AI_Maternal Health_OS_PRD.pdf`](Bridget%20Ukeni_Vibe%20Code%20Africa%20Project_AI_Maternal%20Health_OS_PRD.pdf)
  — the full Product Requirements Document / Software Requirements Specification this
  build is scoped from. A Markdown copy for easier reference/linking is at
  [`docs/PRD.md`](docs/PRD.md).
- **Active design spec:** [`docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md`](docs/superpowers/specs/2026-08-01-amhos-staff-platform-design.md)
  — the current MVP: backend + staff web dashboards.
- **Deferred design spec:** [`docs/superpowers/specs/2026-08-01-amhos-patient-ai-assistant-design.md`](docs/superpowers/specs/2026-08-01-amhos-patient-ai-assistant-design.md)
  — the WhatsApp patient assistant, fully designed, paused for a later phase.
- **Decision log:** [`docs/DECISIONS.md`](docs/DECISIONS.md) — every scope/architecture
  decision made on this project, with rationale and alternatives considered, kept current
  as the project progresses.
- **Changelog:** [`CHANGELOG.md`](CHANGELOG.md) — what's actually landed, in order.
- **Implementation plans:** [`docs/superpowers/plans/`](docs/superpowers/plans/) — 8 plans
  covering the whole MVP: Backend Foundation, Episode & Task Management, Risk Scoring
  Engine, Referral Lifecycle, Frontend Foundation + CHW/Nurse Dashboard, Clinician
  Dashboard, Supervisor Dashboard, Admin Dashboard.
- **Execution reports:** [`docs/superpowers/executions/`](docs/superpowers/executions/) —
  one report per plan once it's actually built (not just planned): which tasks completed,
  real bugs found and fixed, deviations from the plan's literal text and why, and final
  verification results. The plan documents describe what *should* be built; these describe
  what *was* built.

## Stack

- **Backend:** TypeScript / NestJS, modular monolith, `@supabase/supabase-js` directly (no
  ORM — RLS is the real access-control layer, see `docs/DECISIONS.md` #21)
- **Frontend:** React + Next.js App Router, Tailwind CSS (staff web dashboards)
- **Data:** Supabase (Postgres + Auth + Row-Level Security) — hosted project `amhos`
  (`wjgyivxvmqchlhgmxcxe`), used directly for dev/test for now; see `docs/DECISIONS.md` #23
  for why, and the "Still Open" note about moving off it before real patient data exists
- **AI:** Claude API (Anthropic) — used for the risk-scoring engine's ML-assisted advisory
  score (rules engine runs first; the model enriches, never gates, care workflows)
- **Messaging (deferred feature):** Meta WhatsApp Cloud API — part of the deferred WhatsApp
  assistant, a separate use of Claude API from the one above

## Next Steps

1. Finish executing Plan 1 (Backend Foundation).
2. Run the cross-plan consistency pass (migration numbering, a couple of small DTO/gap
   fixes surfaced while writing later plans) across Plans 2–8.
3. Execute Plans 2–8 in dependency order.
