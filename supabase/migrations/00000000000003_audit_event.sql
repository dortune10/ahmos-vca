create table audit_event (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null,
  actor_user_id uuid references app_user (id),
  entity_type text not null,
  entity_id uuid not null,
  action text not null,
  event_time timestamptz not null default now(),
  metadata_json jsonb not null default '{}'::jsonb
);
create index audit_event_tenant_id_idx on audit_event (tenant_id);
create index audit_event_entity_idx on audit_event (entity_type, entity_id);

alter table audit_event enable row level security;

create policy "audit_event_tenant_read" on audit_event
  for select using (tenant_id = (select tenant_id from private.auth_app_user()));
-- Deliberately no insert/update/delete policy for the anon-key/authenticated role:
-- all writes go through the service-role client in AuditService, so the table is
-- append-only from the application's perspective and immutable to end users.
