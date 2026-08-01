create policy "risk_assessment_select_tenant" on risk_assessment
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "risk_assessment_update_tenant" on risk_assessment
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
-- Deliberately no insert policy for the anon-key/authenticated role: the only insert path
-- into this table is RiskService.assess(), which always writes via the service-role client
-- (see this plan's Global Constraints) regardless of whether it was triggered by a
-- background event or the manual REST endpoint. This mirrors audit_event's precedent
-- (00000000000003_audit_event.sql) of a table that end users can read (and, here, update
-- via the one legitimate user action — override) but never directly insert into.
