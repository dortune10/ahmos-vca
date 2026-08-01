# AMHOS Staff Platform (Backend + Web Dashboards) — Design Spec

- **Status:** Draft — pending user review of this document. **This is the active MVP scope**,
  replacing the earlier WhatsApp-first framing.
- **Date:** 2026-08-01
- **Source PRD:** `Bridget Ukeni_Vibe Code Africa Project_AI_Maternal Health_OS_PRD.pdf` (AMHOS PRD/SRS)
- **Project:** VCA-Health — fresh build, independent of the prior `AMHOS`/`app_prod` hackathon repo
- **Related:** [`2026-08-01-amhos-patient-ai-assistant-design.md`](2026-08-01-amhos-patient-ai-assistant-design.md)
  (WhatsApp patient assistant) — deferred, not part of this build; see `docs/DECISIONS.md` #16.

## 1. Purpose

Build the real AMHOS platform: the backend services and data model for maternal episode
management, plus web dashboards for the staff roles who run care delivery day to day —
CHWs/nurses, clinicians, district supervisors, and tenant admins. This replaces the
narrower "WhatsApp assistant only" MVP with the platform itself, per explicit user
direction (see `docs/DECISIONS.md` #16).

**AMHOS is a multi-channel platform.** This spec covers the staff-facing web side. The
WhatsApp patient assistant remains a fully-designed, ready-to-build feature for a later
phase — it is deferred, not abandoned.

## 2. Scope

**In scope**
- Core backend: identity/registration, pregnancy episodes, care tasks, referrals,
  facilities, audit trail (NestJS modular monolith, reused from the prior design)
- Staff authentication and role-based access via Supabase Auth + RLS
- Four staff-facing web dashboards:
  - **CHW / Nurse** — shared app shell with role-aware content (see Section 3): CHW gets a
    simplified quick-registration form and visit checklist, nurse gets fuller encounter
    documentation, both on the same caseload/task-list scaffolding
  - **Clinician** — facility triage board (case queue by risk/urgency), encounter notes,
    referral creation
  - **District Supervisor** — KPI dashboard, cohort views, SLA breach alerts
  - **Tenant Admin** — roles, facility hierarchy, tenant configuration
- Referral lifecycle end to end, created and managed by staff through the web UI (no bot
  involved — referrals are a direct clinician/nurse action here)
- **Risk scoring engine** (Module 2): a deterministic rules engine over clinical data (BP,
  anemia markers, prior complications, etc.) plus an ML-assisted advisory score layered on
  top, both feeding `risk_band` — see Sections 3–5 for how this works
- Immutable audit trail for all clinical and configuration actions

**Explicitly out of scope for this MVP**
- **WhatsApp AI assistant** (deferred — see the linked spec above)
- Other patient-engagement channels (SMS, IVR, in-app messaging) — no patient-facing
  channel is being built in this phase at all
- A separate patient-facing web portal — not requested; if needed later, it would reuse the
  same backend read APIs the WhatsApp assistant spec already defines
- Capacity-based facility auto-routing — referral creation lets staff pick any facility
  flagged `accepting_referrals`; no bed/service-availability matching
- DHIS2/EMR/insurance interoperability, SMS gateways — separate PRD modules
- Non-English language support

## 3. Architecture

**Backend:** NestJS modular monolith, modules per PRD bounded context (`identity`,
`episode`, `facility`, `referral`, `risk`, `audit`), one Supabase Postgres database. The
`whatsapp-bot` module is removed from this build (it lives in the deferred spec); the
`risk` module is new, added when risk scoring was pulled into MVP scope.

**Frontend:** React + Next.js single application, role-based routing:
- `/frontline` — shared CHW/Nurse shell. Same route and page scaffolding for both roles;
  the `role` on the logged-in `user` record controls which form/field set renders (CHW:
  simplified quick-registration + visit checklist; Nurse: full encounter documentation),
  not a separate app section. Chosen over a fully combined identical UI (doesn't fit either
  role's actual workflow well) or fully separate `/chw` + `/nurse` routes (real PRD role
  distinction, but doubles MVP frontend work for two roles that share most of their
  underlying data and task list).
- `/clinician` — clinician dashboard
- `/supervisor` — district supervisor dashboard
- `/admin` — tenant admin dashboard

Chosen over Angular per user preference; pairs naturally with the TypeScript backend
(shared language across the stack) and has the larger ecosystem for Supabase Auth
integration and role-gated routing.

**Auth & access control:**
- Supabase Auth for staff login (email/password to start; MFA for admin/supervisor roles
  per the PRD's security requirements, added once basic auth is working)
- Role stored on the `user` record (`chw`, `nurse`, `clinician`, `supervisor`, `admin`)
- Supabase Row-Level Security scoped by `tenant_id`, `role`, and `facility_id` — a CHW/
  nurse/clinician only sees people, tasks, and referrals within their own facility;
  supervisors see their district; admins see their tenant

**External services:**
- **Supabase** — hosted Postgres, Auth, Row-Level Security
- **Claude API** — used by the `risk` module for the ML-assisted advisory score (see
  Section 5). This is a distinct use from the deferred WhatsApp assistant's Claude usage —
  no conversational/messaging integration here, just a scoring call over structured
  clinical inputs.

## 4. Data Model

| Table | Key fields | Notes |
|---|---|---|
| `user` | `id`, `tenant_id`, `email`, `role`, `facility_id` (nullable — supervisors/admins may span facilities), `full_name` | Backed by Supabase Auth; `role` drives both UI routing and RLS |
| `person` | `id`, `tenant_id`, `first_name`, `last_name`, `phone_primary`, `date_of_birth`, `address_json` | Registered by CHW/nurse; `phone_primary` kept even though no WhatsApp channel is active yet, for forward compatibility with the deferred assistant |
| `pregnancy_episode` | `id`, `person_id`, `facility_id`, `lmp_date`, `estimated_delivery_date`, `gestational_age_weeks`, `risk_band`, `status` | `status`: Draft/Active/Referred/Delivered/Closed/Archived. `risk_band` is a denormalized copy of the latest `risk_assessment.final_risk_band`, kept on the episode so lists/dashboards can sort/filter without a join |
| `care_task` | `id`, `pregnancy_episode_id`, `task_type`, `assigned_user_id`, `due_at`, `completed_at`, `status`, `priority` | Populates the CHW/Nurse task list and clinician triage board |
| `encounter_note` | `id`, `pregnancy_episode_id`, `recorded_by` (user id), `recorded_at`, `note_text`, `vitals_json` (BP, temperature, hemoglobin, etc.) | **Added during implementation planning** — the spec's own flows ("clinician records an encounter note", risk scoring needs clinical inputs) required this table but it was missed when this section was first written. This is what nurses/clinicians write during registration/triage, and what the risk rules engine reads as its scoring input |
| `risk_assessment` | `id`, `pregnancy_episode_id`, `assessment_time`, `rule_score`, `ml_score` (nullable), `final_risk_band`, `explanation_json`, `overridden_by` (nullable), `override_reason` (nullable), `status` | `status`: Pending/Computed/Overridden/Failed/FallbackRuleOnly, per PRD. One row per assessment run (triggered on registration and on clinical data updates), not just one-per-episode — gives a risk history |
| `facility` | `id`, `tenant_id`, `name`, `type`, `contact_phone`, `accepting_referrals` | Referenced by `user.facility_id` and referral routing |
| `referral` | `id`, `pregnancy_episode_id`, `from_facility_id`, `to_facility_id`, `reason_code`, `urgency`, `status`, milestone timestamps | Created directly by clinicians/nurses through the web UI; `status`: Created→Sent→Accepted→Dispatched→InTransit→Arrived→Completed/Failed/Cancelled |
| `audit_event` | `id`, `tenant_id`, `actor_user_id`, `entity_type`, `entity_id`, `action`, `event_time`, `metadata_json` | Every create/update/config change, every risk assessment/override, and every referral state transition is logged |

No `conversation`/`message` tables in this build — those were WhatsApp-specific and move
with the deferred spec.

## 5. Core User Flows

1. **Registration (CHW/Nurse, shared `/frontline` shell):** search for existing person →
   create person + pregnancy episode if new → assign initial care tasks (ANC schedule) → a
   risk assessment is triggered automatically (see step 2) → episode appears on their
   caseload list. A CHW sees a simplified quick-registration form (minimum required fields,
   large tap targets, per the PRD's low-literacy/field-conditions UX guidance); a nurse sees
   the fuller facility-documentation form (encounter details, structured clinical fields).
   Both write to the same `person`/`pregnancy_episode`/`care_task` tables.
2. **Risk assessment (system, surfaced to Clinician):** triggered on registration and on
   any subsequent clinical data update (vitals, encounter notes). The rules engine runs
   first and always produces a `rule_score` and reason codes; the ML-assisted score
   (Claude API call over the same structured clinical inputs) runs second and is advisory
   only — if the model call fails or times out, the assessment falls back to the rule score
   alone (`status=FallbackRuleOnly`) rather than blocking. `final_risk_band` combines both
   (rules take precedence on disagreement) and is shown with its reason codes on the
   episode. A clinician can override `final_risk_band` directly, which is always logged
   with `overridden_by` + `override_reason` — the AI/rules output is advisory, the
   clinician has final say, per the PRD's "advisory-only AI" rule.
3. **Triage (Clinician):** facility triage board lists active episodes at that facility,
   sorted by `risk_band`/urgency → clinician opens an episode, records an encounter note
   (which can re-trigger step 2), reviews or overrides the risk assessment → creates a
   referral if escalation is needed, picking a receiving facility from the
   accepting-referrals list.
4. **Referral tracking:** receiving facility (via their own clinician dashboard) accepts/
   rejects; status updates flow through the state machine; invalid transitions (e.g.
   `Completed` → `InTransit`) are rejected with `REFERRAL_INVALID_STATE`, matching the
   PRD's error contract.
5. **Supervision (District Supervisor):** KPI dashboard computed from existing tables —
   registered pregnancies, ANC coverage proxy (task completion), referral SLA adherence,
   high-risk case counts, risk-band distribution — via SQL queries/views, no new schema
   needed for MVP.
6. **Administration (Tenant Admin):** manage facilities, assign staff to facilities/roles,
   view audit log.

## 6. Security

- Supabase Auth + RLS as described in Section 3.
- Full audit trail for clinical actions, risk assessments/overrides, and configuration
  changes, per the PRD's auditability requirement.
- TLS in transit; Supabase's at-rest encryption for the database.
- PII (names, phone, address) access limited by RLS to staff with a legitimate facility/
  tenant relationship to the record.
- Risk assessment inputs sent to the Claude API are the same structured clinical fields
  already visible to the requesting clinician via RLS — no cross-tenant data ever leaves
  in a single call. Every model call and response is logged to `audit_event` alongside the
  `risk_assessment` row, so a clinician can review what the model saw and returned.
- Model unavailability degrades to rule-only scoring (`FallbackRuleOnly`) rather than
  blocking registration or triage — risk assessment must never be a hard dependency for
  care to proceed.

## 7. Testing Strategy

- Unit tests per backend module (identity matching, rules engine scoring logic, referral
  state machine transitions, RLS policy behavior via integration tests against a real
  Supabase instance).
- Integration tests per core flow in Section 5 (registration → risk assessment → task
  generation, referral creation → invalid transition rejection, ML call failure →
  `FallbackRuleOnly` rather than a blocked registration).
- Frontend: component tests for each dashboard's core views; a small set of end-to-end
  tests covering one golden path per role (register a patient as CHW, triage/override risk
  and refer as clinician, view KPIs as supervisor, configure a facility as admin).

## 8. Out of Scope / Future Work

- **WhatsApp AI assistant** — fully designed, deferred; see the linked spec.
- **Capacity-based facility routing, DHIS2/EMR integration, other patient channels,
  non-English support** — unchanged from the deferred spec's reasoning, still out of scope.

## 9. Assumptions Carried From the PRD

- MVP launches in one market with English-first UX (PRD default, not independently
  re-confirmed).
- AI (the risk-scoring ML enrichment) is advisory-only; clinicians retain override
  authority, per the PRD's "AI risk score is advisory, not autonomous clinical
  decision-making" rule.
- Staff roles for MVP are CHW, Nurse, Clinician, District Supervisor, and Tenant Admin —
  narrower than the PRD's full RBAC role list (which also includes Facility Admin, Program
  Manager, Support, Integration Client); those can be added later without a schema change
  (just new `role` enum values + RLS policies). CHW and Nurse share a `/frontline` app
  shell with role-aware content rather than either an identical UI or fully separate routes
  (see Section 3).

## 10. Open Questions

1. **Rule engine content:** the actual clinical rules (which vitals/history combinations
   map to which risk band, and the specific thresholds) still need definition — likely with
   clinical input, not something to guess at in this design.
2. Relationship between this VCA-Health build and the original AMHOS repo
   (`/Users/dot/Documents/Projects/AMHOS/`) is still unresolved (carried over from the
   deferred spec's open questions).
