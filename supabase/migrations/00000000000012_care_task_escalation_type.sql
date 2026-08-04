-- Widen care_task.task_type to add 'danger_sign_escalation', for the WhatsApp bot's urgent
-- escalation tasks (docs/superpowers/plans/2026-08-01-whatsapp-ai-assistant-escalation.md).
-- Uses the exact same technique the Referral Lifecycle plan used to widen
-- pregnancy_episode.status in supabase/migrations/00000000000008_referral_schema.sql: the
-- existing CHECK constraint was created unnamed by the Episode/Task Schema plan's migration
-- (00000000000004_episode_task_schema.sql), so this looks up its real name from the system
-- catalog and drops it dynamically rather than guessing Postgres's default naming
-- convention.
do $$
declare
  task_type_check_constraint text;
begin
  select con.conname into task_type_check_constraint
  from pg_constraint con
  join pg_class rel on rel.oid = con.conrelid
  join pg_attribute att on att.attrelid = rel.oid and att.attnum = any(con.conkey)
  where rel.relname = 'care_task'
    and con.contype = 'c'
    and att.attname = 'task_type';

  if task_type_check_constraint is not null then
    execute format('alter table care_task drop constraint %I', task_type_check_constraint);
  end if;
end $$;

alter table care_task add constraint care_task_task_type_check
  check (task_type in ('anc_visit', 'pnc_visit', 'newborn_check', 'danger_sign_escalation'));
