-- WhatsApp channel: consent tracking on the existing person table, plus a conversation/
-- message log for the bot's own compliance record (design spec Section 4). Purely additive --
-- no existing person column, constraint, or index is touched.
alter table person add column whatsapp_consent boolean not null default false;
alter table person add column whatsapp_consent_at timestamptz;

create table conversation (
  id uuid primary key default gen_random_uuid(),
  person_id uuid not null references person (id),
  channel text not null default 'whatsapp' check (channel in ('whatsapp')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index conversation_person_id_idx on conversation (person_id);

create table message (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references conversation (id),
  direction text not null check (direction in ('inbound', 'outbound')),
  body text not null,
  -- UNIQUE is the idempotency key for Meta's webhook retries. Meta re-delivers any webhook
  -- that does not return 2xx, and its X-Hub-Signature-256 carries no timestamp or nonce, so a
  -- captured request stays replayable forever. Without this, one retried danger-sign message
  -- becomes N duplicate urgent care_tasks in a health worker's queue (Plan 2, Task 7).
  -- Postgres allows unlimited NULLs in a unique column, so outbound rows (which have no
  -- inbound wa message id at insert time) are unaffected.
  whatsapp_message_id text unique,
  created_at timestamptz not null default now()
);
create index message_conversation_id_idx on message (conversation_id);
create index message_created_at_idx on message (created_at);

alter table conversation enable row level security;
alter table message enable row level security;
