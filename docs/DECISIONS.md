# Decision Log — AMHOS Patient AI Assistant (WhatsApp Channel)

Chronological record of the decisions made while designing this feature, and why. See the
full design in
[`docs/superpowers/specs/2026-08-01-amhos-patient-ai-assistant-design.md`](superpowers/specs/2026-08-01-amhos-patient-ai-assistant-design.md).

---

### 1. Start from scratch in a new directory, ignore the prior AMHOS build
**Decision:** Build this in `/Users/dot/Documents/Projects/VCA-Health` against a different
PRD document, disregarding the existing `app`/`app_prod` hackathon repo at
`/Users/dot/Documents/Projects/AMHOS/`.
**Why:** Explicit user instruction. The prior repo is a judging-deadline hackathon demo
(`app/` frozen, `app_prod/` mid-build) with its own constraints; this is a separate,
platform-shaped effort.
**Open question:** Whether this supersedes or runs alongside the original AMHOS repo is
still unresolved.

### 2. Project scope: MVP slice of the real platform, not a prototype
**Decision:** Build the minimal real backend (Person/PregnancyEpisode/CareTask/etc.) the
bot depends on, rather than a bot shell against seeded mock data only.
**Alternatives considered:** Standalone prototype/demo with a throwaway data store.
**Why:** User wants this to be a genuine first slice of AMHOS, not a disposable demo.

### 3. Backend stack: TypeScript / NestJS
**Alternatives considered:** Java/Kotlin Spring Boot (PRD's enterprise-grade option); other
stacks.
**Why:** PRD itself lists NestJS as the faster-iteration option; one language across API and
bot logic; large ecosystem for WhatsApp/LLM SDKs.

### 4. WhatsApp channel: Meta Cloud API (direct)
**Alternatives considered:** Twilio WhatsApp API.
**Why:** No per-message markup on top of Meta's own fees. Trade-off accepted: Meta's own
app-review/business-verification process is more upfront friction than Twilio's sandbox.

### 5. LLM: Claude API
**Alternatives considered:** Other providers (not specified by user).
**Why:** Strong instruction-following for the advisory-only/no-diagnosis guardrails the PRD
requires.

### 6. Unregistered WhatsApp numbers: decline, don't engage
**Decision:** A message from a phone number not linked to any person gets a polite decline
pointing to the CHW/clinic for registration — no data lookup, no AI attempt.
**Alternatives considered:** Allow limited generic Q&A for unregistered numbers.
**Why:** User chose to keep the unregistered path simple and safe rather than offering a
degraded experience with no personalization.

### 7. Answer scope: profile data only, not general health education
**Decision:** The assistant answers questions about the woman's own records (appointments,
risk band in plain language, task/referral status) only. No general pregnancy-health Q&A.
**Alternatives considered:** Profile + general education (my initial recommendation).
**Why:** User explicitly chose the narrower scope to minimize clinical-safety/liability
surface for the MVP — matches the literal ask ("ask questions based on their profile").

### 8. Danger-sign messages: detect and escalate, even though general Q&A is out of scope
**Decision:** A deterministic keyword/pattern layer runs on every message before the AI.
Danger-sign language never reaches the LLM; it triggers escalation directly.
**Alternatives considered:** Treat symptom-like messages as out of scope entirely (generic
deflection only, no detection logic).
**Why:** Safety net that the user considered non-negotiable even after narrowing general
Q&A out of scope — an urgent symptom shouldn't get the same generic deflection as an
off-topic question.

### 9. Consent: bot enforces its own opt-in on first contact
**Decision:** The bot sends a one-time WhatsApp opt-in prompt to newly-linked numbers and
only answers after consent is recorded, rather than trusting a consent flag set during
CHW registration elsewhere.
**Alternatives considered:** Assume consent already captured at registration.
**Why:** User chose the safer default — don't assume another part of the system (not yet
built) correctly captured WhatsApp-specific consent.

### 10. Architecture style: modular monolith
**Decision:** Single NestJS app, modules per PRD bounded context (identity, episode,
whatsapp-bot, ai-assistant, audit, etc.), one Postgres database.
**Alternatives considered:** Microservices from day one (PRD's long-term target
architecture); serverless functions per endpoint.
**Why:** Matches the PRD's own explicit MVP guidance; fastest path to a working bot without
event-bus/service-mesh infrastructure that current traffic doesn't justify.

### 11. Data store: Supabase
**Decision:** Hosted Postgres via Supabase, using its built-in Auth and Row-Level Security.
**Alternatives considered:** Plain self-hosted Postgres (e.g. Docker or RDS) with hand-built
auth/RBAC.
**Why:** Already part of the user's stack on related projects; RLS maps cleanly onto the
PRD's per-tenant/per-role access rules with less custom code.

### 12. Danger-sign escalation creates a real Referral, not just an internal task
**Decision:** Escalation creates both an urgent `CareTask` and a `Referral` record, pulling
`Facility` and `Referral` tables into this feature's scope.
**Alternatives considered:** Internal urgent task only, leaving referral creation to
whatever process the CHW uses today (deferring Module 4 entirely).
**Why:** User judged an internal task alone an insufficient safety net once the question of
"why isn't Referral in the data model" surfaced during review — chose to expand scope
rather than leave escalation half-built.

### 13. Facility routing for auto-created referrals: manual, not auto-matched
**Decision:** The referral is created with `to_facility_id = null`; the assigned CHW/
clinician picks a facility from the accepting-referrals list, which then notifies that
facility.
**Alternatives considered:** Fixed default escalation facility per tenant/region
(deterministic auto-routing, no human step).
**Why:** User chose to avoid auto-routing a real emergency to a facility that might not
actually be able to take the case — real capacity-based matching is a separate, larger
feature (Module 6) not being built here.

### 14. No separate TransportRequest entity
**Decision:** Transport/dispatch status is folded into `Referral.status` rather than a
dedicated table.
**Why:** The PRD explicitly allows this as an MVP simplification ("Ambulance dispatch is
optional for MVP and can be represented as referral status + transport request
abstraction").

### 15. AMHOS is not a WhatsApp-first product
**Decision:** Documentation (README, design spec, decision log) now explicitly states AMHOS
is a multi-channel platform per the PRD — CHW/clinician mobile-web app, supervisor
dashboards, and WhatsApp as just one of several patient-engagement channels (alongside
SMS/IVR/in-app messaging, PRD Module 5). This build is one feature slice, not a
redefinition of AMHOS around WhatsApp. Followed through to naming: the design spec file
and its H1 were renamed from "WhatsApp AI Assistant" to
`2026-08-01-amhos-patient-ai-assistant-design.md` / "AMHOS Patient AI Assistant (WhatsApp
Channel)" — a file/heading that leads with WhatsApp sends the same wrong signal as prose
would, even once the body text is corrected.
**Why:** User flagged that earlier doc wording (and, in a follow-up, the filename itself)
read as if this were a WhatsApp-first solution. Correction: don't assume WhatsApp is how
any other role (CHW, clinician, supervisor) interacts with the platform, and don't let
naming/titles imply it either — this applies to every artifact, not just the ones with
prose to fix.

### 16. MVP scope pivot: descope the WhatsApp assistant, build the staff platform instead
**Decision:** The WhatsApp AI assistant (fully designed as of decision #15) is descoped
from active work. The MVP is now the core backend platform plus web dashboards for staff
roles (CHW/Nurse, Clinician, Supervisor, Admin). New spec:
[`2026-08-01-amhos-staff-platform-design.md`](superpowers/specs/2026-08-01-amhos-staff-platform-design.md).
The WhatsApp spec is kept, marked DEFERRED, not deleted — it's ready to build in a later
phase.
**Alternatives considered:** Building both the WhatsApp assistant and the staff platform
simultaneously for MVP (what the user first asked for, before this follow-up narrowed it).
**Why:** User asked directly to build the platform first and descope WhatsApp for now,
after initially asking for both — a real sequencing decision, not a misunderstanding to
resolve. No rationale beyond the direct instruction was given; worth confirming later
whether this is a permanent priority call or just "platform first, then WhatsApp."

### 17. Staff web frontend: React + Next.js
**Decision:** The four staff dashboards (CHW/Nurse, Clinician, Supervisor, Admin) are built
as a single React + Next.js application with role-based routing, not Angular.
**Alternatives considered:** Angular (the PRD's other listed enterprise option).
**Why:** Pairs naturally with the NestJS/TypeScript backend (one language across the
stack); larger ecosystem for Supabase Auth integration and role-gated routing.

### 18. Staff dashboard role coverage for MVP
**Decision:** All four staff-facing dashboards ship in this MVP: CHW/Nurse (combined
caseload view), Clinician (facility triage board), District Supervisor (KPI dashboard), and
Tenant Admin (config). Facility Admin, Program Manager, Support, and Integration Client
roles from the PRD's full RBAC list are not built yet.
**Why:** User selected all four when asked which roles need a dashboard for MVP, rather
than a narrower subset.

### 19. Risk scoring engine (Module 2) added to MVP: rule-based + ML-assisted
**Decision:** `pregnancy_episode.risk_band` is no longer a plain manually-set field — it's
computed by a new `risk` module: a deterministic rules engine runs first (always produces
`rule_score` + reason codes), an ML-assisted advisory score via the Claude API runs second
and enriches it, and a clinician can override the result with a logged reason. New
`risk_assessment` table added (per PRD's own entity definition). Model-call failure falls
back to rule-only scoring rather than blocking care workflows.
**Alternatives considered:** Rule-based only (my recommendation, no model dependency,
matches the PRD's P0-only story) — user chose the fuller rule+ML tier instead (PRD's P0+P1
combined).
**Why:** User asked directly to bring the risk scoring engine into MVP scope rather than
leave `risk_band` as a manual field, and chose the full two-tier version when asked to
narrow it. This reintroduces an AI/model dependency (Claude API) into a build that had
otherwise removed all AI usage when the WhatsApp assistant was descoped (decision #16) —
worth remembering this isn't a fully AI-free build anymore, just AI-free on the *messaging*
side.

### 20. CHW/Nurse dashboard: shared shell, role-aware content
**Decision:** CHW and Nurse share one `/frontline` route and page scaffolding; the
logged-in user's `role` controls which form/field set renders (CHW: simplified
quick-registration + visit checklist; Nurse: full encounter documentation). Both write to
the same `person`/`pregnancy_episode`/`care_task` tables.
**Alternatives considered:** Fully combined identical UI for both roles (what the spec
originally assumed, before this was raised as an open question) — risked not fitting
either role's actual workflow well, since the PRD treats CHW and Nurse/Midwife as distinct
personas and RBAC roles with different permission scope, literacy assumptions, and daily
tasks. Fully separate `/chw` and `/nurse` routes — most faithful to the PRD's role
distinction, but doubles MVP frontend work for two roles that share most of their
underlying data.
**Why:** User picked the middle-ground option after I laid out the PRD's actual persona/
RBAC distinction between the two roles (this had been glossed over when the dashboard was
first scoped) and the three concrete options with trade-offs.

### 21. Data access: `@supabase/supabase-js` directly, no separate ORM
**Decision:** NestJS services use `@supabase/supabase-js` clients (scoped to the requesting
user's JWT, not a service-role key) for all RLS-governed reads/writes, so Postgres RLS
enforces tenant/role/facility isolation exactly as designed, rather than adding an ORM
(Prisma/TypeORM) whose service-role connection would bypass RLS unless every query
manually re-implemented the same filtering in application code. Schema/migrations are
managed as SQL files via the Supabase CLI (`supabase/migrations/*.sql`), including RLS
policies written as plain SQL, rather than a separate ORM migration DSL. A service-role
client is used only where a system process legitimately needs to bypass RLS (e.g. the
`risk` module's automated assessment trigger, `audit` module writes).
**Alternatives considered:** Prisma or TypeORM with a service-role connection and
hand-written authorization checks in each service method.
**Why:** This is an implementation-level architectural decision (not previously specified
in the design spec, which only committed to "Supabase Postgres + RLS"), made during
implementation planning to keep RLS as the actual enforcement mechanism the spec describes,
rather than reimplementing the same access rules twice.

### 22. Add `encounter_note` table (spec gap found during implementation planning)
**Decision:** Added an `encounter_note` table (`id`, `pregnancy_episode_id`, `recorded_by`,
`recorded_at`, `note_text`, `vitals_json`) to the staff platform spec's data model.
**Why:** While planning the episode/task module, there was nowhere to actually store what
the spec's own flows require — "clinician records an encounter note" (Section 5) and the
risk rules engine needs clinical inputs like BP/anemia markers to score against (Section 2)
— but no such table existed in the approved spec's Data Model section. This is a genuine
gap in the reviewed spec, not a new scope decision, so it's being filled in directly rather
than re-litigated as a choice; flagging here per the standing "log all decisions" rule
since it does change the data model after spec approval.

---

## Still Open

- Relationship between this VCA-Health build and the original AMHOS repo (decision #1).
- Whether the WhatsApp-assistant descope (decision #16) is permanent or just a build-order
  choice — not yet confirmed.
- Actual clinical rule thresholds for the risk rules engine (decision #19) — needs clinical
  input, not something to define unilaterally.
- Language/localization beyond the PRD's English-first default.
- Clinical validation of risk-band language and any future danger-sign keyword list (needs
  a clinical advisor — same gap noted against the original AMHOS build).
- Whether the partner NGO's target population has reliable WhatsApp access (relevant again
  once/if the deferred WhatsApp spec is picked back up).
