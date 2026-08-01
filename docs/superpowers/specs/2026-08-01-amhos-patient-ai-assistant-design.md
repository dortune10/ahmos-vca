# AMHOS Patient AI Assistant (WhatsApp Channel) — Design Spec

- **Status:** DEFERRED (2026-08-01) — descoped in favor of the staff platform MVP; kept as
  a ready-to-build spec for a later phase. See
  [`2026-08-01-amhos-staff-platform-design.md`](2026-08-01-amhos-staff-platform-design.md)
  for the current active MVP scope, and `docs/DECISIONS.md` #16 for why.
- **Date:** 2026-08-01
- **Source PRD:** `Bridget Ukeni_Vibe Code Africa Project_AI_Maternal Health_OS_PRD.pdf` (AMHOS PRD/SRS)
- **Project:** VCA-Health — fresh build, independent of the prior `AMHOS`/`app_prod` hackathon repo

## 1. Purpose

Let a registered pregnant woman message a WhatsApp number and get answers about **her own
platform data** — next appointment, task status, risk band, referral status — from an AI
assistant. This is the first working slice of AMHOS: it is not a UI mockup or a chatbot
against fake data, it includes the minimal real backend the bot needs to be genuinely
useful.

**AMHOS is not a WhatsApp-first product.** Per the PRD, CHWs and clinicians work through a
mobile/web app and supervisors through web dashboards; WhatsApp is one of several
patient-engagement channels (alongside SMS, IVR, and in-app messaging — PRD Module 5), used
here specifically because it's the channel this feature targets. Nothing in this design
assumes WhatsApp is how staff-facing roles interact with the platform.

## 2. Scope

**In scope**
- WhatsApp inbound/outbound messaging via Meta Cloud API, as the patient-facing channel for
  this feature specifically
- Identity matching by phone number, WhatsApp opt-in consent capture
- Profile-data-only Q&A (appointments, tasks, risk band, referral status) via Claude
- Deterministic danger-sign detection that bypasses the AI entirely
- Full referral creation (with manual facility selection) as the escalation path
- Immutable audit trail of every inbound/outbound message and state change

**Explicitly out of scope for this slice** (see [Section 10](#10-out-of-scope--future-work))
- CHW/clinician/supervisor-facing interfaces (mobile app, web dashboards) — separate,
  not-yet-built parts of AMHOS, not something this slice replaces
- Other patient-engagement channels (SMS, IVR, in-app messaging) — WhatsApp only for now
- Computing risk scores (rule engine / ML) — we only *read* an existing `risk_band`
- Capacity-based facility auto-routing
- General health education Q&A (only profile-data questions are answered)
- Ambulance/transport dispatch integration
- Non-English language support
- Supervisor dashboards, DHIS2/EMR integration, reporting — all separate PRD modules

## 3. Architecture

**Style:** Modular monolith — a single NestJS application with modules aligned to PRD
bounded contexts, rather than microservices or serverless. This matches the PRD's own MVP
guidance ("use a modular monolith only if funding, speed, or team maturity demands a
simplified MVP") and avoids standing up event-bus/service-mesh infrastructure before there
is real traffic to justify it.

**Modules:**
- `identity` — Person lookup/match by phone
- `episode` — PregnancyEpisode, CareTask
- `facility` — Facility directory
- `referral` — Referral lifecycle/state machine
- `whatsapp-bot` — webhook, message send/receive, consent gate, danger-sign pre-filter
- `ai-assistant` — Claude integration, prompt construction, profile-context assembly
- `audit` — immutable audit event writer

**External services:**
- **Supabase** — hosted Postgres, Auth, Row-Level Security, storage
- **Meta WhatsApp Cloud API** — messaging channel (chosen over Twilio to avoid a
  per-message markup on top of Meta's own fees)
- **Claude API (Anthropic)** — LLM for profile-data Q&A

## 4. Data Model

Minimal slice of the PRD's domain model — only what the bot and its escalation path need.

| Table | Key fields | Notes |
|---|---|---|
| `person` | `id`, `tenant_id`, `first_name`, `phone_primary` (unique, indexed), `date_of_birth`, `whatsapp_consent`, `whatsapp_consent_at` | `phone_primary` is how an inbound WhatsApp number resolves to a profile |
| `pregnancy_episode` | `id`, `person_id`, `facility_id`, `lmp_date`, `estimated_delivery_date`, `gestational_age_weeks`, `risk_band`, `status` | `status`: Draft/Active/Referred/Delivered/Closed/Archived per PRD lifecycle |
| `care_task` | `id`, `pregnancy_episode_id`, `task_type`, `assigned_user_id`, `due_at`, `completed_at`, `status`, `priority` | Drives "when's my next appointment/visit" answers. `assigned_user_id` for an escalation task defaults to the CHW/clinician linked to the woman's registered facility (`pregnancy_episode.facility_id`); if none is linked, it falls back to a facility-level notification list rather than being left unassigned |
| `facility` | `id`, `tenant_id`, `name`, `type`, `contact_phone`, `accepting_referrals` | Bed/service-readiness tracking is out of scope — just a boolean accept flag |
| `referral` | `id`, `pregnancy_episode_id`, `from_facility_id` (nullable), `to_facility_id` (nullable until selected), `reason_code`, `urgency`, `status`, milestone timestamps | `status`: Created→Sent→Accepted→Dispatched→InTransit→Arrived→Completed/Failed/Cancelled. No separate `TransportRequest` table — transport is folded into `status`, which the PRD allows as an MVP simplification |
| `conversation` / `message` | conversation per person; messages with direction, body, timestamp | Gives the LLM short context and a compliance record |
| `audit_event` | `id`, `tenant_id`, `actor_type`, `entity_type`, `entity_id`, `action`, `event_time`, `metadata_json` | Immutable; every inbound message, outbound reply, consent change, and escalation is logged here |

**Access control:** Supabase Row-Level Security scoped by `tenant_id` and role, rather than
hand-rolled RBAC checks in application code.

## 5. Conversation Flow

1. **Inbound webhook** — Meta posts to a NestJS endpoint; verify webhook signature; extract
   sender phone number and message text.
2. **Identity lookup** — find `person` by `phone_primary`.
   - Not found → send a polite decline pointing to her CHW/clinic for registration; log
     audit event; stop. No AI call, no data lookup.
3. **Consent gate** — found but `whatsapp_consent` is false → send a one-time opt-in prompt
   ("Reply YES to receive AI assistant replies"); wait for confirmation; log the consent
   event. Already consented → continue.
4. **Danger-sign pre-filter** — a deterministic keyword/pattern check (bleeding, severe
   pain, no fetal movement, seizure, etc.) runs on every message **before** the AI.
   - Match → skip the AI entirely. Create an urgent `care_task` assigned to her CHW/
     clinician. Create a `referral` (`status=Created`, `to_facility_id=null`,
     `reason_code=danger_sign`, `urgency=high`, `from_facility_id` = her registered
     facility if any). Notify the assigned CHW/clinician that a referral needs a facility
     picked from the accepting-referrals list — picking one moves `status` to `Sent` and
     notifies that facility. Send the woman a fixed urgent-care message. Log all of this to
     `audit_event`. Stop — the AI is never in this path.
5. **AI answer (profile-data-only)** — for everything else, fetch the person's current
   profile snapshot (episode status, risk band, upcoming/overdue tasks, referral status)
   from Postgres and pass it to Claude as structured context. No tool-use/function-calling
   into the database — this keeps the safety boundary simple and fully auditable.
6. **Reply + log** — send the AI's reply via the Cloud API; store both inbound and outbound
   messages on the `conversation`; write an `audit_event`.

## 6. AI / LLM Integration

- **Model:** Claude API (Anthropic Messages API).
- **System prompt** hard-constrains the assistant to answer only from the supplied profile
  context (appointments, risk band framed in plain language, task/referral status), and to
  use a fixed refusal template for anything else (symptoms, medication, diagnosis,
  general health education): *"I can't help with that — please contact your health worker
  at [CHW contact]."*
- No autonomous clinical decision-making — matches the PRD's "AI risk score is advisory,
  not autonomous clinical decision-making" rule, extended here to the assistant generally.
- Every AI call and reply is logged with model version and prompt/response content in the
  audit trail so a clinician can review exactly what the bot told someone.

## 7. Safety Guardrails

- Danger-sign detection is deterministic and runs ahead of the LLM — the highest-stakes
  path never depends on model behavior.
- The AI cannot access the database directly; it only sees the context explicitly assembled
  and passed to it per turn.
- Full audit trail of AI responses, consent events, and escalations.

## 8. Security

- Meta webhook signature verification on every inbound request.
- Phone numbers and message content are PII: encrypted at rest, TLS in transit;
  `phone_primary` remains the only unencrypted indexed lookup field (required for matching
  incoming numbers).
- Supabase RLS scoped by `tenant_id` and role — a CHW only sees people/tasks/referrals
  within their own facility scope.
- Rate limiting on the webhook endpoint to bound Claude API cost exposure from abuse.

## 9. Testing Strategy

- **Unit tests** per module: identity lookup/matching, consent gate, danger-sign matcher,
  referral state machine transitions.
- **Integration tests** for the full webhook → reply flow, covering: known person with a
  normal question, unknown number, not-yet-consented number, danger-sign message.
- **Scenario tests** mirroring the PRD's own Gherkin examples (offline registration,
  invalid referral state transition, consent-blocked messaging) adapted to this flow, e.g.:
  - Registered woman without consent → routine question → no AI reply sent, opt-in prompt
    sent instead.
  - Danger-sign message → AI never invoked; urgent `care_task` and `referral` created;
    both logged to `audit_event`.
  - Attempt to move a `Completed` referral to `InTransit` → rejected, matching the PRD's
    `REFERRAL_INVALID_STATE` error contract.

## 10. Out of Scope / Future Work

Deliberately deferred — each is a distinct PRD module, not an oversight:

- **CHW/clinician/supervisor-facing interfaces** (mobile app, web dashboards) — AMHOS is a
  multi-channel platform per the PRD; this slice builds none of the staff-facing surfaces,
  only the WhatsApp patient channel and the minimal backend it needs.
- **Other patient-engagement channels** (SMS, IVR, in-app messaging) — PRD Module 5 defines
  several; only WhatsApp is built here.
- **Risk scoring engine** (Module 2) — rule-based + ML risk computation. This slice only
  reads an existing `risk_band` value.
- **Capacity-based facility routing** (Module 6) — referrals route to a facility a human
  picks, not an automated bed/service-availability match.
- **General health education Q&A** — the assistant answers profile-data questions only, per
  explicit product decision, to minimize clinical-safety surface for the MVP.
- **Ambulance/transport dispatch integration** — folded into `referral.status` for now.
- **Non-English language support** — PRD's "English-first MVP" assumption carried forward
  unchanged; not re-confirmed specifically for this feature.
- **Supervisor dashboards, DHIS2/EMR interoperability, reporting/analytics** — separate PRD
  modules untouched by this slice.

## 11. Assumptions Carried From the PRD

- MVP launches in one market with English-first UX (PRD default; not independently
  re-confirmed for this feature).
- AI is advisory-only; clinicians retain override authority (not directly exercised by this
  bot, but the audit trail supports future override workflows).
- Consent is required for outbound personal messaging — enforced here via the bot's own
  first-contact opt-in rather than assuming it was captured elsewhere.
