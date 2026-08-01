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

Design complete for the staff platform (active MVP scope), not yet implemented. No
application code exists in this repo yet.

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

## Planned Stack

- **Backend:** TypeScript / NestJS, modular monolith
- **Frontend:** React + Next.js (staff web dashboards)
- **Data:** Supabase (Postgres + Auth + Row-Level Security)
- **AI:** Claude API (Anthropic) — used now for the risk-scoring engine's ML-assisted
  advisory score (rules engine runs first; the model enriches, never gates, care workflows)
- **Messaging (deferred feature):** Meta WhatsApp Cloud API — part of the deferred WhatsApp
  assistant, a separate use of Claude API from the one above

## Next Steps

1. User review of the staff platform design spec.
2. Implementation plan (`superpowers:writing-plans`).
3. Build.
