-- Extend pregnancy_episode.status to include Admitted and Cancelled, completing the PRD's
-- full pregnancy-episode state diagram (docs/PRD.md Section 16: Draft -> Active -> Referred
-- -> Admitted -> Delivered -> PostnatalActive -> Closed -> Archived, plus Active ->
-- Cancelled). Plan 2 deliberately shipped only the approved design spec's narrower 7-value
-- set and left this decision to whichever plan needed the missing states explicitly (see
-- Plan 2's Global Constraints) — this plan needs both, per this plan's own Global
-- Constraints (episode-status side effects table).
--
-- The existing CHECK constraint on the status column was created unnamed by Plan 2's
-- migration (00000000000004_episode_task_schema.sql), so rather than hardcode Postgres's
-- default constraint-naming convention, this looks up the actual constraint name from the
-- system catalog and drops it dynamically.
do $$
declare
  status_check_constraint text;
begin
  select con.conname into status_check_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'pregnancy_episode'
    and con.contype = 'c'
    and att.attname = 'status';

  if status_check_constraint is not null then
    execute format('alter table pregnancy_episode drop constraint %I', status_check_constraint);
  end if;
end $$;

alter table pregnancy_episode add constraint pregnancy_episode_status_check
  check (status in (
    'Draft', 'Active', 'Referred', 'Admitted', 'Delivered', 'PostnatalActive', 'Closed',
    'Archived', 'Cancelled'
  ));

-- referral: created directly by clinicians/nurses through the web UI (no bot involved, per
-- the approved design spec Section 2). to_facility_id is required at creation time — see
-- this plan's Global Constraints for why that diverges from docs/DECISIONS.md #13's
-- null-then-pick-later pattern (that decision is for a different, deferred feature).
create table referral (
  id uuid primary key default gen_random_uuid(),
  pregnancy_episode_id uuid not null references pregnancy_episode (id),
  from_facility_id uuid references facility (id),
  to_facility_id uuid not null references facility (id),
  reason_code text not null,
  urgency text not null check (urgency in ('routine', 'urgent')),
  status text not null default 'Created' check (
    status in ('Created', 'Sent', 'Accepted', 'Dispatched', 'InTransit', 'Arrived', 'Completed', 'Failed', 'Cancelled')
  ),
  created_at timestamptz not null default now(),
  accepted_at timestamptz,
  departed_at timestamptz,
  arrived_at timestamptz,
  closed_at timestamptz
);
create index referral_pregnancy_episode_id_idx on referral (pregnancy_episode_id);
create index referral_from_facility_id_idx on referral (from_facility_id);
create index referral_to_facility_id_idx on referral (to_facility_id);
create index referral_status_idx on referral (status);

alter table referral enable row level security;
