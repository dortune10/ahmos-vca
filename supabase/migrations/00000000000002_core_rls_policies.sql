-- Non-exposed schema for internal helper functions. PostgREST only exposes the `public`
-- schema by default, so functions living here are never reachable via `/rest/v1/rpc/...` —
-- required so `private.auth_app_user()` (SECURITY DEFINER, below) can't be called directly
-- over the API (Supabase security advisor: anon_security_definer_function_executable /
-- authenticated_security_definer_function_executable), while remaining callable from RLS
-- policies, which evaluate inside Postgres itself and aren't subject to that exposure rule.
create schema if not exists private;

-- Helper: read the caller's app_user row for their tenant/role/facility.
-- `set search_path = public` pins name resolution so this function can't be hijacked by an
-- attacker-controlled object earlier in a mutable search_path (Supabase security advisor:
-- function_search_path_mutable) — fixed here rather than deferred, per Global Constraints.
-- `security definer` is required because this function is itself called from app_user's own
-- RLS policy below (`app_user_self_and_tenant_admins`) — without it, evaluating that policy
-- would call this function, which selects from app_user, which re-evaluates the same
-- policy, recursing infinitely (confirmed via Postgres error 54001 "stack depth limit
-- exceeded" while testing Task 4). SECURITY DEFINER makes the internal SELECT run as the
-- function owner (postgres, which owns app_user), bypassing RLS for just that lookup —
-- safe because the function unconditionally filters to `where id = auth.uid()`, so it can
-- only ever return the caller's own row, never another user's or tenant's data.
create or replace function private.auth_app_user()
returns app_user
language sql stable
security definer
set search_path = public
as $$
  select * from app_user where id = auth.uid();
$$;

-- Roles evaluating RLS policies still need EXECUTE to call this from a policy's USING/CHECK
-- expression, even though the function isn't reachable directly via the REST API.
revoke execute on function private.auth_app_user() from public;
grant execute on function private.auth_app_user() to anon, authenticated, service_role;

create policy "facility_tenant_isolation" on facility
  for select using (tenant_id = (select tenant_id from private.auth_app_user()));

-- Facility create/update are admin-only actions (FacilityController restricts both routes
-- to the 'admin' role) — without these, FacilityService.create() and the admin dashboard's
-- facility-update endpoint would silently fail against real RLS despite passing their own
-- mocked-client unit tests. Found and would otherwise have been patched later, piecemeal,
-- by whichever plan needed facility writes first; fixed here at the source instead.
create policy "facility_insert_admin_only" on facility
  for insert with check (
    (select role from private.auth_app_user()) = 'admin'
    and tenant_id = (select tenant_id from private.auth_app_user())
  );

create policy "facility_update_admin_only" on facility
  for update using (
    (select role from private.auth_app_user()) = 'admin'
    and tenant_id = (select tenant_id from private.auth_app_user())
  );

create policy "person_tenant_isolation" on person
  for select using (tenant_id = (select tenant_id from private.auth_app_user()));

create policy "person_insert_own_tenant" on person
  for insert with check (tenant_id = (select tenant_id from private.auth_app_user()));

create policy "app_user_self_and_tenant_admins" on app_user
  for select using (
    id = auth.uid()
    or (select tenant_id from private.auth_app_user()) = tenant_id
       and (select role from private.auth_app_user()) = 'admin'
  );
