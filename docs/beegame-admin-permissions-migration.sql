-- Align the Supabase owner permission contract with the BeeGame API.
-- Safe to run repeatedly.

create or replace function public.beegame_role_permissions(role_name text)
returns text[]
language sql
security definer
set search_path = public
stable
as $$
  select case role_name
    when 'owner' then array[
      'workspace.read',
      'workspace.manage',
      'workspace.manage_members',
      'project.read',
      'project.create',
      'project.delete',
      'project.export',
      'agent.send_message',
      'agent.cancel',
      'agent.approve_tool',
      'preview.manage',
      'deployment.manage',
      'assets.upload',
      'assets.integrate',
      'model_config.manage',
      'mcp.manage',
      'skills.manage',
      'runtime_settings.manage',
      'secrets.manage',
      'credits.admin',
      'lifecycle.admin',
      'audit.read'
    ]
    when 'developer' then array[
      'workspace.read',
      'project.read',
      'project.create',
      'project.export',
      'agent.send_message',
      'agent.cancel',
      'agent.approve_tool',
      'preview.manage',
      'deployment.manage',
      'assets.upload',
      'assets.integrate',
      'skills.manage'
    ]
    when 'reviewer' then array[
      'workspace.read',
      'project.read',
      'project.export',
      'skills.manage'
    ]
    else array[
      'workspace.read',
      'project.read',
      'skills.manage'
    ]
  end
$$;

revoke execute on function public.beegame_role_permissions(text) from public;
grant execute on function public.beegame_role_permissions(text) to authenticated;
grant execute on function public.beegame_role_permissions(text) to service_role;
