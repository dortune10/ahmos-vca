-- WhatsApp channel verification (docs/DECISIONS.md #28).
--
-- Before this migration, an inbound WhatsApp message was matched to a person purely by
-- person.phone_primary, so possession of the handset was the entire credential. Shared and
-- borrowed phones are normal in this platform's deployment context, so that let anyone holding
-- the household handset be treated as the registered patient. These columns record which
-- handset has actually been PROVEN to belong to a person, and the table below holds the
-- one-time, staff-issued codes that prove it.
--
-- Purely additive: no existing column, constraint, index or RLS policy is changed. Numbered
-- 00000000000013 because 00000000000012 is claimed by the WhatsApp AI Assistant plan's
-- care_task_escalation_type migration, which is independent of this one.

-- Digits only, NO leading '+', matching the normalization IdentityService.findByPhoneAsSystem
-- already applies to Meta's wa_id. Storing one canonical form makes the per-message
-- verification check a plain string equality with no re-normalization at read time.
alter table person add column whatsapp_verified_phone text;
alter table person add column whatsapp_verified_at timestamptz;

-- The uniqueness guarantee this feature actually needs, and the only one that can be added
-- safely today. A blanket UNIQUE on person.phone_primary would fail outright: the shared amhos
-- project holds 150 person rows, 0 with a null phone, and 7 phone numbers duplicated across
-- ~137 of them (e2e-fixture pollution, docs/DECISIONS.md "Still Open"). This index is on a
-- column that is NULL for every existing row at the instant it is created, so it CANNOT fail,
-- and it enforces the invariant that carries the security weight: one handset can be the
-- verified channel for at most one person. Duplicate phone_primary values stay possible and
-- stay handled by IdentityService.findByPhoneAsSystem's AmbiguousPersonMatchError.
-- It doubles as the lookup index for the column, so no separate index is created.
create unique index person_whatsapp_verified_phone_unique_idx
  on person (whatsapp_verified_phone)
  where whatsapp_verified_phone is not null;

create table whatsapp_enrolment_code (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id),
  -- sha256('<this row id>:<the 6-digit code>'). The plaintext is returned exactly once, to the
  -- staff member who issued it, and is never stored, logged or retrievable again. The row's own
  -- id acts as the salt so two people issued the same 6 digits do not share a hash.
  code_hash text not null,
  expires_at timestamptz not null,
  attempts_remaining integer not null default 5 check (attempts_remaining >= 0),
  consumed_at timestamptz,
  issued_by uuid references app_user (id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index whatsapp_enrolment_code_person_id_idx on whatsapp_enrolment_code (person_id);

alter table whatsapp_enrolment_code enable row level security;
-- Deliberately NO policy of any kind for anon/authenticated -- not even SELECT. Every read and
-- write goes through IdentityService's service-role client. This is stricter than
-- audit_event/conversation/message, which all grant a tenant-scoped SELECT, and the difference
-- is intentional: the only data here is a credential hash and its attempt counter, and no
-- staff-facing screen ever needs to read it back. Supabase's security advisor reports an
-- INFORMATIONAL rls_enabled_no_policy lint for a table in this shape; that finding is expected
-- and correct. Do not "fix" it by adding a SELECT policy -- that would expose credential
-- hashes to every authenticated user in the tenant.
