-- Repair OAuth accounts created before the BeeGame workspace provisioning
-- trigger was installed. Safe to run repeatedly in the Supabase SQL editor.
--
-- Prerequisite: docs/beegame-supabase-schema.sql (or its equivalent) has
-- already created public.beegame_handle_new_user and the auth trigger.
-- This deliberately targets non-email identities only; email accounts still
-- follow the invitation policy enforced by the normal provisioning trigger.

do $$
begin
  if not exists (
    select 1
    from pg_trigger trigger_row
    join pg_proc procedure_row on procedure_row.oid = trigger_row.tgfoid
    join pg_namespace namespace_row on namespace_row.oid = procedure_row.pronamespace
    where trigger_row.tgrelid = 'auth.users'::regclass
      and trigger_row.tgname = 'beegame_after_auth_user_created'
      and namespace_row.nspname = 'public'
      and procedure_row.proname = 'beegame_handle_new_user'
  ) then
    raise exception 'BeeGame OAuth provisioning trigger is missing; apply docs/beegame-supabase-schema.sql first';
  end if;
end
$$;

-- The trigger creates the profile, account link, workspace, developer member
-- role. Updating the JSON value to itself intentionally
-- invokes the existing secure trigger without granting browser clients any
-- provisioning privilege.
update auth.users as auth_user
set raw_user_meta_data = coalesce(auth_user.raw_user_meta_data, '{}'::jsonb)
where coalesce(auth_user.raw_app_meta_data ->> 'provider', 'email') <> 'email'
  and not exists (
    select 1
    from public.beegame_workspace_members as member
    where member.user_id = auth_user.id
  );

-- Verify: each OAuth user should now have a workspace role. A normal account
-- should be `developer`; only explicitly configured platform owners are owner.
select
  auth_user.id,
  auth_user.email,
  member.role,
  workspace.id as workspace_id
from auth.users as auth_user
left join public.beegame_workspace_members as member
  on member.user_id = auth_user.id
left join public.beegame_workspaces as workspace
  on workspace.id = member.workspace_id
where coalesce(auth_user.raw_app_meta_data ->> 'provider', 'email') <> 'email'
order by auth_user.created_at;
