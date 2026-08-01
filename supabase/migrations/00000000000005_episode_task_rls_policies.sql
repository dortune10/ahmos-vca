create policy "pregnancy_episode_select_tenant" on pregnancy_episode
  for select using (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "pregnancy_episode_insert_tenant" on pregnancy_episode
  for insert with check (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "pregnancy_episode_update_tenant" on pregnancy_episode
  for update using (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  )
  with check (
    facility_id in (select id from facility where tenant_id = (select tenant_id from private.auth_app_user()))
  );

create policy "encounter_note_select_tenant" on encounter_note
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "encounter_note_insert_tenant" on encounter_note
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );
-- No update/delete policy: encounter notes are append-only from the application's
-- perspective, same rationale as audit_event (00000000000003_audit_event.sql).

create policy "care_task_select_tenant" on care_task
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "care_task_insert_tenant" on care_task
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "care_task_update_tenant" on care_task
  for update using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  )
  with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );
