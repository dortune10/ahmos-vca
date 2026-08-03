create policy "conversation_select_tenant" on conversation
  for select using (
    person_id in (
      select id from person where tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

create policy "message_select_tenant" on message
  for select using (
    conversation_id in (
      select c.id from conversation c
      join person p on p.id = c.person_id
      where p.tenant_id = (select tenant_id from private.auth_app_user())
    )
  );

-- Deliberately no insert/update/delete policy for anon/authenticated: every write goes
-- through ConversationService's service-role client (Task 4), the same append-only pattern
-- as audit_event (00000000000003_audit_event.sql). Nothing in this feature ever needs a
-- staff member or the anon key to write a conversation/message row directly.
