-- referral RLS is tenant-scoped via a single join through pregnancy_episode -> facility,
-- the same pattern Plan 2 established for pregnancy_episode/encounter_note/care_task. A
-- referral references two facilities (from_facility_id/to_facility_id), but this MVP
-- assumes a single tenant per deployment (Plan 1's tenant model), so both facilities on any
-- given referral row are always in the same tenant as the episode's own facility. Also: RLS
-- granularity in this codebase is tenant-only, not facility-level (Plan 2's own documented
-- gap, "RLS granularity matches Plan 1's precedent, not the spec's full ambition") — so a
-- single tenant join already grants visibility to every staff member in the tenant
-- regardless of which facility they're at. That is exactly the behavior this table needs: a
-- receiving facility's clinician must see referrals sent TO their facility even though the
-- episode itself belongs to a different facility's caseload. No additional join through
-- to_facility_id is required to achieve that — it falls out of the existing tenant-only
-- granularity for free. A future facility-level RLS hardening pass (already deferred by
-- Plan 2) will need to explicitly OR across from_facility_id/to_facility_id when it
-- happens; noted here so that pass doesn't miss this table.
create policy "referral_select_tenant" on referral
  for select using (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "referral_insert_tenant" on referral
  for insert with check (
    pregnancy_episode_id in (
      select pe.id from pregnancy_episode pe
      join facility f on f.id = pe.facility_id
      where f.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "referral_update_tenant" on referral
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
-- No delete policy: referrals are never deleted, only transitioned to a terminal status
-- (Completed/Failed/Cancelled), consistent with the audit-trail requirement that referral
-- history is never destroyed.
