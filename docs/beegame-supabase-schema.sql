-- BeeGame dashboard Supabase schema.
-- Run this in the Supabase SQL editor or package it as a migration before
-- enabling Supabase-backed repositories in production.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('beegame-assets', 'beegame-assets', false)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "beegame avatar public read" on storage.objects;
create policy "beegame avatar public read" on storage.objects
  for select
  using (bucket_id = 'avatars');

drop policy if exists "beegame avatar owner insert" on storage.objects;
create policy "beegame avatar owner insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'avatars' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame avatar owner update" on storage.objects;
create policy "beegame avatar owner update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'avatars' and
    (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame avatar owner delete" on storage.objects;
create policy "beegame avatar owner delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'avatars' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame asset public read" on storage.objects;
drop policy if exists "beegame asset owner read" on storage.objects;
create policy "beegame asset owner read" on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'beegame-assets' and
    (storage.foldername(name))[1] = 'projects' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame asset owner insert" on storage.objects;
create policy "beegame asset owner insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'beegame-assets' and
    (storage.foldername(name))[1] = 'projects' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame asset owner update" on storage.objects;
create policy "beegame asset owner update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'beegame-assets' and
    (storage.foldername(name))[1] = 'projects' and
    (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'beegame-assets' and
    (storage.foldername(name))[1] = 'projects' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame asset owner delete" on storage.objects;
create policy "beegame asset owner delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'beegame-assets' and
    (storage.foldername(name))[1] = 'projects' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

create table if not exists public.beegame_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  email text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.beegame_profiles
  add column if not exists email text,
  add column if not exists avatar_url text;

create table if not exists public.beegame_workspaces (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id)
);

create table if not exists public.beegame_workspace_members (
  workspace_id uuid not null references public.beegame_workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner', 'developer', 'reviewer', 'viewer')),
  created_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);

create table if not exists public.beegame_projects (
  id text primary key,
  workspace_id uuid not null references public.beegame_workspaces(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  root_path text,
  runtime_snapshot jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_sessions (
  id text primary key,
  project_id text not null references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_path text not null,
  status text not null default 'idle',
  transcript_path text,
  model_config_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_model_configs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text not null,
  base_url text,
  -- Historical column name. BeeGame stores an RLS-protected secret here; the
  -- local runtime host must not require or use a Supabase service-role key.
  api_key_ciphertext text,
  models jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

with ranked_model_defaults as (
  select
    id,
    row_number() over (
      partition by owner_id
      order by updated_at desc, created_at desc, id desc
    ) as default_rank
  from public.beegame_model_configs
  where is_default = true
)
update public.beegame_model_configs configs
set is_default = false,
    updated_at = now()
from ranked_model_defaults ranked
where configs.id = ranked.id
  and ranked.default_rank > 1;

create unique index if not exists beegame_model_configs_one_default_per_owner
  on public.beegame_model_configs (owner_id)
  where is_default = true;

create table if not exists public.beegame_runtime_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_web_tools (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_mcp_servers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  -- Historical column name. Environment values are protected by RLS and are
  -- released only to the authenticated user's runtime session.
  env_ciphertext jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_assets (
  id text primary key,
  project_id text not null references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_previews (
  id text primary key,
  project_id text not null references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'stopped',
  url text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  included_credits integer not null default 300,
  consumed_credits integer not null default 0,
  reserved_credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_credit_ledger (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text,
  reservation_id text,
  kind text not null check (kind in ('estimate', 'reserve', 'settle', 'grant', 'refund')),
  credits integer not null,
  weighted_tokens integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table public.beegame_credit_ledger
  drop constraint if exists beegame_credit_ledger_project_id_fkey;

alter table public.beegame_credit_ledger
  add column if not exists reservation_id text;

create table if not exists public.beegame_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.beegame_workspaces(id) on delete set null,
  project_id text references public.beegame_projects(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.beegame_platform_owner_invites (
  email text primary key,
  created_at timestamptz not null default now(),
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);

create or replace function public.beegame_workspace_role(target_workspace_id uuid)
returns text
language sql
security definer
set search_path = public
stable
as $$
  select m.role
  from public.beegame_workspace_members m
  where m.workspace_id = target_workspace_id
    and m.user_id = auth.uid()
  limit 1
$$;

create or replace function public.beegame_is_workspace_owner(target_workspace_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce(public.beegame_workspace_role(target_workspace_id) = 'owner', false)
    or exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.raw_app_meta_data->>'beegame_role' = 'owner'
    )
$$;

create or replace function public.beegame_is_platform_owner()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.raw_app_meta_data->>'beegame_role' = 'owner'
  ) or exists (
    select 1
    from public.beegame_platform_owner_invites i
    where i.claimed_user_id = auth.uid()
      and i.claimed_at is not null
  )
$$;

create or replace function public.beegame_model_config_owner_id(target_user_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  workspace_owner uuid;
  workspace_owner_with_default uuid;
  platform_owner_with_default uuid;
begin
  if target_user_id is null then
    return null;
  end if;

  select w.owner_id
  into workspace_owner
  from public.beegame_workspaces w
  join public.beegame_workspace_members m on m.workspace_id = w.id
  where m.user_id = target_user_id
  order by
    case when w.owner_id = target_user_id then 0 else 1 end,
    w.created_at asc
  limit 1;

  select c.owner_id
  into workspace_owner_with_default
  from public.beegame_model_configs c
  where c.owner_id = coalesce(workspace_owner, target_user_id)
    and c.is_default = true
  order by c.updated_at desc, c.created_at desc, c.id desc
  limit 1;

  select c.owner_id
  into platform_owner_with_default
  from public.beegame_model_configs c
  join auth.users u on u.id = c.owner_id
  where (
      u.raw_app_meta_data->>'beegame_role' = 'owner'
      or exists (
        select 1
        from public.beegame_platform_owner_invites i
        where i.claimed_user_id = u.id
          and i.claimed_at is not null
      )
    )
    and c.is_default = true
  order by c.updated_at desc, c.created_at desc, c.id desc
  limit 1;

  return coalesce(
    workspace_owner_with_default,
    platform_owner_with_default
  );
end
$$;

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
      'assets.upload',
      'assets.integrate',
      'model_config.manage',
      'mcp.manage',
      'runtime_settings.manage',
      'secrets.manage',
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
      'assets.upload',
      'assets.integrate'
    ]
    when 'reviewer' then array[
      'workspace.read',
      'project.read',
      'project.export'
    ]
    else array[
      'workspace.read',
      'project.read'
    ]
  end
$$;

create or replace function public.beegame_current_user_context()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  current_user_id uuid;
  profile_row public.beegame_profiles%rowtype;
  workspace_row public.beegame_workspaces%rowtype;
  member_role text;
  account_role text;
  model_config_owner_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return null;
  end if;

  select *
  into profile_row
  from public.beegame_profiles
  where user_id = current_user_id
  limit 1;

  select w.*
  into workspace_row
  from public.beegame_workspaces w
  join public.beegame_workspace_members m on m.workspace_id = w.id
  where m.user_id = current_user_id
  order by
    case when w.owner_id = current_user_id then 0 else 1 end,
    w.created_at asc
  limit 1;

  if workspace_row.id is null then
    return jsonb_build_object(
      'id', current_user_id,
      'role', 'viewer',
      'permissions', public.beegame_role_permissions('viewer')
    );
  end if;

  select coalesce(m.role, 'viewer')
  into member_role
  from public.beegame_workspace_members m
  where m.workspace_id = workspace_row.id
    and m.user_id = current_user_id
  limit 1;

  select nullif(u.raw_app_meta_data->>'beegame_role', '')
  into account_role
  from auth.users u
  where u.id = current_user_id
  limit 1;

  member_role := coalesce(member_role, 'viewer');
  if account_role = 'owner' then
    member_role := 'owner';
  end if;

  model_config_owner_id := public.beegame_model_config_owner_id(current_user_id);

  return jsonb_build_object(
    'id', current_user_id,
    'email', profile_row.email,
    'displayName', profile_row.display_name,
    'avatarUrl', profile_row.avatar_url,
    'workspaceId', workspace_row.id,
    'workspaceOwnerId', workspace_row.owner_id,
    'modelConfigOwnerId', model_config_owner_id,
    'role', member_role,
    'permissions', public.beegame_role_permissions(member_role)
  );
end;
$$;

create or replace function public.beegame_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  created_workspace_id uuid;
  profile_name text;
  profile_avatar_url text;
  initial_role text;
  invited_platform_owner boolean;
begin
  invited_platform_owner := exists (
    select 1
    from public.beegame_platform_owner_invites i
    where lower(i.email) = lower(new.email)
      and (i.claimed_user_id is null or i.claimed_user_id = new.id)
  );
  profile_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'user_name', ''),
    nullif(split_part(new.email, '@', 1), '')
  );
  profile_avatar_url := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', ''),
    nullif(new.raw_user_meta_data->>'image', ''),
    nullif(new.raw_user_meta_data->>'photo_url', '')
  );
  initial_role := case
    when new.raw_app_meta_data->>'beegame_role' = 'owner' or invited_platform_owner then 'owner'
    else 'developer'
  end;

  insert into public.beegame_profiles (user_id, display_name, email, avatar_url)
  values (new.id, profile_name, new.email, profile_avatar_url)
  on conflict (user_id) do update
  set display_name = coalesce(public.beegame_profiles.display_name, excluded.display_name),
      email = coalesce(excluded.email, public.beegame_profiles.email),
      avatar_url = coalesce(public.beegame_profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

  insert into public.beegame_workspaces (name, owner_id)
  values (
    coalesce(profile_name, 'BeeGame Workspace'),
    new.id
  )
  on conflict (owner_id) do update
  set updated_at = now()
  returning id into created_workspace_id;

  insert into public.beegame_workspace_members (workspace_id, user_id, role)
  values (created_workspace_id, new.id, initial_role)
  on conflict (workspace_id, user_id) do update
  set role = case
    when new.raw_app_meta_data->>'beegame_role' = 'owner' or invited_platform_owner then 'owner'
    else excluded.role
  end;

  if invited_platform_owner then
    update public.beegame_platform_owner_invites
    set claimed_user_id = new.id,
        claimed_at = coalesce(claimed_at, now())
    where lower(email) = lower(new.email)
      and (claimed_user_id is null or claimed_user_id = new.id);
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end
$$;

drop trigger if exists beegame_after_auth_user_created on auth.users;
create trigger beegame_after_auth_user_created
  after insert or update of email, raw_user_meta_data, raw_app_meta_data on auth.users
  for each row execute function public.beegame_handle_new_user();

insert into public.beegame_profiles (user_id, display_name, email, avatar_url)
select
  u.id,
  coalesce(
    nullif(u.raw_user_meta_data->>'display_name', ''),
    nullif(u.raw_user_meta_data->>'full_name', ''),
    nullif(u.raw_user_meta_data->>'name', ''),
    nullif(u.raw_user_meta_data->>'user_name', ''),
    nullif(split_part(u.email, '@', 1), '')
  ),
  u.email,
  coalesce(
    nullif(u.raw_user_meta_data->>'avatar_url', ''),
    nullif(u.raw_user_meta_data->>'picture', ''),
    nullif(u.raw_user_meta_data->>'image', ''),
    nullif(u.raw_user_meta_data->>'photo_url', '')
  )
from auth.users u
on conflict (user_id) do update
set display_name = coalesce(public.beegame_profiles.display_name, excluded.display_name),
    email = coalesce(excluded.email, public.beegame_profiles.email),
    avatar_url = coalesce(public.beegame_profiles.avatar_url, excluded.avatar_url),
    updated_at = now();

insert into public.beegame_workspaces (name, owner_id)
select
  coalesce(p.display_name, split_part(u.email, '@', 1), 'BeeGame Workspace'),
  u.id
from auth.users u
left join public.beegame_profiles p on p.user_id = u.id
on conflict (owner_id) do update
set updated_at = now();

insert into public.beegame_workspace_members (workspace_id, user_id, role)
select
  w.id,
  u.id,
  case
    when u.raw_app_meta_data->>'beegame_role' = 'owner' then 'owner'
    else 'developer'
  end
from auth.users u
join public.beegame_workspaces w on w.owner_id = u.id
on conflict (workspace_id, user_id) do update
set role = case
  when excluded.role = 'owner' then 'owner'
  else public.beegame_workspace_members.role
end;

insert into public.beegame_credit_accounts (user_id)
select u.id
from auth.users u
on conflict (user_id) do nothing;

update public.beegame_platform_owner_invites i
set claimed_user_id = u.id,
    claimed_at = coalesce(i.claimed_at, now())
from auth.users u
where lower(i.email) = lower(u.email)
  and (i.claimed_user_id is null or i.claimed_user_id = u.id);

update public.beegame_workspace_members m
set role = 'owner'
from public.beegame_workspaces w,
     public.beegame_platform_owner_invites i
where m.workspace_id = w.id
  and m.user_id = w.owner_id
  and i.claimed_user_id = m.user_id
  and i.claimed_at is not null;

update public.beegame_workspace_members m
set role = 'developer'
from public.beegame_workspaces w,
     auth.users u
where m.workspace_id = w.id
  and m.user_id = u.id
  and m.user_id = w.owner_id
  and m.role = 'owner'
  and coalesce(u.raw_app_meta_data->>'beegame_role', '') <> 'owner'
  and not exists (
    select 1
    from public.beegame_platform_owner_invites i
    where i.claimed_user_id = u.id
      and i.claimed_at is not null
  );

create or replace function public.beegame_runtime_env(
  p_user_id uuid,
  p_data_dir text default null,
  p_model_config_id text default null
)
returns jsonb
language plpgsql
security invoker
set search_path = public
stable
as $$
declare
  model_row public.beegame_model_configs%rowtype;
  web_row public.beegame_web_tools%rowtype;
  settings_row public.beegame_runtime_settings%rowtype;
  model_env jsonb := '{}'::jsonb;
  web_env jsonb := '{}'::jsonb;
  settings_env jsonb := '{}'::jsonb;
  runtime_env jsonb := '{}'::jsonb;
  base_config_dir text;
  config_owner_id uuid;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  config_owner_id := public.beegame_model_config_owner_id(p_user_id);

  base_config_dir := trim(trailing '/' from coalesce(p_data_dir, ''));
  if base_config_dir <> '' then
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_CONFIG_DIR', base_config_dir || '/beegame-config',
      'BEEGAME_PROJECT_CONFIG_DIR_NAME', '.beegame'
    );
  else
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_PROJECT_CONFIG_DIR_NAME', '.beegame'
    );
  end if;

  select *
  into model_row
  from public.beegame_model_configs
  where owner_id = config_owner_id
    and (
      (p_model_config_id is not null and id = p_model_config_id) or
      (p_model_config_id is null and is_default = true)
    )
  order by is_default desc, updated_at desc
  limit 1;

  if found then
    case model_row.provider
      when 'anthropic-compatible' then
        model_env := jsonb_build_object(
          'ANTHROPIC_BASE_URL', model_row.base_url,
          'ANTHROPIC_AUTH_TOKEN', model_row.api_key_ciphertext,
          'ANTHROPIC_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'ANTHROPIC_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'ANTHROPIC_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'openai-compatible' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_OPENAI', '1',
          'OPENAI_BASE_URL', model_row.base_url,
          'OPENAI_API_KEY', model_row.api_key_ciphertext,
          'OPENAI_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'OPENAI_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'OPENAI_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'gemini' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_GEMINI', '1',
          'GEMINI_BASE_URL', model_row.base_url,
          'GEMINI_API_KEY', model_row.api_key_ciphertext,
          'GEMINI_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'GEMINI_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'GEMINI_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'grok' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_GROK', '1',
          'GROK_BASE_URL', model_row.base_url,
          'GROK_API_KEY', model_row.api_key_ciphertext,
          'GROK_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'GROK_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'GROK_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      else
        model_env := '{}'::jsonb;
    end case;
  end if;

  select *
  into web_row
  from public.beegame_web_tools
  where owner_id = config_owner_id
  limit 1;

  if found then
    web_env := jsonb_build_object(
      'WEB_SEARCH_ADAPTER', web_row.config->>'webSearchAdapter',
      'WEB_FETCH_ADAPTER', web_row.config->>'webFetchAdapter',
      'BRAVE_SEARCH_API_KEY', web_row.config->>'braveApiKey',
      'EXA_API_KEY', web_row.config->>'exaApiKey'
    );
  end if;

  select *
  into settings_row
  from public.beegame_runtime_settings
  where owner_id = config_owner_id
  limit 1;

  if found then
    if settings_row.settings ? 'skillSearchEnabled' then
      settings_env := settings_env || jsonb_build_object(
        'SKILL_SEARCH_ENABLED',
        case when (settings_row.settings->>'skillSearchEnabled')::boolean then '1' else '0' end
      );
    end if;
    if settings_row.settings ? 'autoMemoryEnabled' then
      settings_env := settings_env || jsonb_build_object(
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
        case when (settings_row.settings->>'autoMemoryEnabled')::boolean then '0' else '1' end
      );
      if base_config_dir <> '' then
        settings_env := settings_env || jsonb_build_object(
          'CLAUDE_CONFIG_DIR',
          base_config_dir || '/claude-config'
        );
      end if;
    end if;
    if (settings_row.settings->>'treeSitterBashEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_TREE_SITTER_BASH', '1');
    end if;
    if (settings_row.settings->>'webBrowserToolEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_WEB_BROWSER_TOOL', '1');
    end if;
    if (settings_row.settings->>'bashClassifierEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_BASH_CLASSIFIER', '1');
    end if;
    if (settings_row.settings->>'mcpSkillsEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_MCP_SKILLS', '1');
    end if;
  end if;

  return jsonb_strip_nulls(runtime_env || model_env || web_env || settings_env);
end
$$;

create or replace function public.beegame_set_default_model_config(
  p_user_id uuid,
  p_model_config_id text
)
returns public.beegame_model_configs
language plpgsql
security invoker
set search_path = public
as $$
declare
  selected_config public.beegame_model_configs%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if p_model_config_id is null or trim(p_model_config_id) = '' then
    raise exception 'Model config id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;

  select *
  into selected_config
  from public.beegame_model_configs
  where owner_id = p_user_id
    and id = p_model_config_id
  for update;

  if not found then
    raise exception 'Model config not found';
  end if;

  update public.beegame_model_configs
  set is_default = false,
      updated_at = now()
  where owner_id = p_user_id
    and is_default = true
    and id <> p_model_config_id;

  update public.beegame_model_configs
  set is_default = true,
      updated_at = now()
  where owner_id = p_user_id
    and id = p_model_config_id
  returning * into selected_config;

  return selected_config;
end
$$;

create or replace function public.beegame_reserve_credits(
  p_user_id uuid,
  p_credits integer,
  p_kind text default null,
  p_project_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_uuid uuid;
  available_credits integer;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  available_credits :=
    account_row.included_credits -
    account_row.consumed_credits -
    account_row.reserved_credits;

  if available_credits < p_credits then
    raise exception 'Insufficient credits';
  end if;

  reservation_uuid := gen_random_uuid();

  update public.beegame_credit_accounts
  set reserved_credits = reserved_credits + p_credits,
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    id,
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    reservation_uuid,
    p_user_id,
    p_project_id,
    reservation_uuid::text,
    'reserve',
    p_credits,
    null,
    coalesce(p_metadata, '{}'::jsonb) ||
      case
        when p_kind is null or p_kind = '' then '{}'::jsonb
        else jsonb_build_object('kind', p_kind)
      end
  );

  return jsonb_build_object(
    'reservation_id', reservation_uuid::text,
    'reserved_credits', p_credits,
    'account', to_jsonb(account_row)
  );
end
$$;

create or replace function public.beegame_settle_credit_reservation(
  p_user_id uuid,
  p_reservation_id text,
  p_weighted_tokens integer,
  p_credit_unit_weighted_tokens integer default 10000,
  p_project_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_row public.beegame_credit_ledger%rowtype;
  reservation_credits integer;
  weighted_tokens integer;
  credit_unit integer;
  settled_credits integer;
  refunded_credits integer;
  target_project_id text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  if nullif(trim(coalesce(p_reservation_id, '')), '') is null then
    raise exception 'Reservation id is required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  select *
  into reservation_row
  from public.beegame_credit_ledger
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and kind = 'reserve'
  order by created_at asc
  limit 1;

  if not found then
    raise exception 'Credit reservation not found';
  end if;

  if exists (
    select 1
    from public.beegame_credit_ledger
    where user_id = p_user_id
      and reservation_id = p_reservation_id
      and kind in ('settle', 'refund')
  ) then
    raise exception 'Credit reservation already settled';
  end if;

  reservation_credits := reservation_row.credits;
  weighted_tokens := greatest(coalesce(p_weighted_tokens, 0), 0);
  credit_unit := greatest(coalesce(p_credit_unit_weighted_tokens, 10000), 1);
  settled_credits := least(
    reservation_credits,
    greatest(1, ceil(weighted_tokens::numeric / credit_unit::numeric)::integer)
  );
  refunded_credits := greatest(0, reservation_credits - settled_credits);
  target_project_id := coalesce(p_project_id, reservation_row.project_id);

  update public.beegame_credit_accounts
  set consumed_credits = consumed_credits + settled_credits,
      reserved_credits = greatest(
        0,
        public.beegame_credit_accounts.reserved_credits - reservation_credits
      ),
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    p_user_id,
    target_project_id,
    p_reservation_id,
    'settle',
    settled_credits,
    weighted_tokens,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if refunded_credits > 0 then
    insert into public.beegame_credit_ledger (
      user_id,
      project_id,
      reservation_id,
      kind,
      credits,
      weighted_tokens,
      metadata
    )
    values (
      p_user_id,
      target_project_id,
      p_reservation_id,
      'refund',
      refunded_credits,
      null,
      jsonb_build_object('reason', 'unused_reservation')
    );
  end if;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'reserved_credits', reservation_credits,
    'settled_credits', settled_credits,
    'refunded_credits', refunded_credits,
    'account', to_jsonb(account_row)
  );
end
$$;

create or replace function public.beegame_refund_credit_reservation(
  p_user_id uuid,
  p_reservation_id text,
  p_project_id text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_row public.beegame_credit_ledger%rowtype;
  target_project_id text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  if nullif(trim(coalesce(p_reservation_id, '')), '') is null then
    raise exception 'Reservation id is required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  select *
  into reservation_row
  from public.beegame_credit_ledger
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and kind = 'reserve'
  order by created_at asc
  limit 1;

  if not found then
    raise exception 'Credit reservation not found';
  end if;

  if exists (
    select 1
    from public.beegame_credit_ledger
    where user_id = p_user_id
      and reservation_id = p_reservation_id
      and kind in ('settle', 'refund')
  ) then
    raise exception 'Credit reservation already settled';
  end if;

  target_project_id := coalesce(p_project_id, reservation_row.project_id);

  update public.beegame_credit_accounts
  set reserved_credits = greatest(0, reserved_credits - reservation_row.credits),
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    p_user_id,
    target_project_id,
    p_reservation_id,
    'refund',
    reservation_row.credits,
    null,
    coalesce(p_metadata, jsonb_build_object('reason', 'reservation_refunded'))
  );

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'reserved_credits', reservation_row.credits,
    'settled_credits', 0,
    'refunded_credits', reservation_row.credits,
    'account', to_jsonb(account_row)
  );
end
$$;

create or replace function public.beegame_delete_current_user()
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.beegame_audit_events (actor_id, action, metadata)
  values (
    current_user_id,
    'account.delete',
    jsonb_build_object('source', 'beegame_delete_current_user')
  );

  delete from auth.users
  where id = current_user_id;
end
$$;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'beegame_workspaces_owner_id_key'
      and conrelid = 'public.beegame_workspaces'::regclass
  ) then
    alter table public.beegame_workspaces
      add constraint beegame_workspaces_owner_id_key unique (owner_id);
  end if;
end $$;

alter table public.beegame_profiles enable row level security;
alter table public.beegame_workspaces enable row level security;
alter table public.beegame_workspace_members enable row level security;
alter table public.beegame_projects enable row level security;
alter table public.beegame_sessions enable row level security;
alter table public.beegame_model_configs enable row level security;
alter table public.beegame_runtime_settings enable row level security;
alter table public.beegame_web_tools enable row level security;
alter table public.beegame_mcp_servers enable row level security;
alter table public.beegame_assets enable row level security;
alter table public.beegame_previews enable row level security;
alter table public.beegame_credit_accounts enable row level security;
alter table public.beegame_credit_ledger enable row level security;
alter table public.beegame_audit_events enable row level security;
alter table public.beegame_platform_owner_invites enable row level security;

drop policy if exists "profile owner access" on public.beegame_profiles;
create policy "profile owner access" on public.beegame_profiles
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "workspace member access" on public.beegame_workspaces;
create policy "workspace member access" on public.beegame_workspaces
  for all using (
    exists (
      select 1 from public.beegame_workspace_members m
      where m.workspace_id = id and m.user_id = auth.uid()
    )
  ) with check (owner_id = auth.uid());

drop policy if exists "workspace membership access" on public.beegame_workspace_members;
create policy "workspace membership access" on public.beegame_workspace_members
  for select using (
    user_id = auth.uid() or public.beegame_is_workspace_owner(workspace_id)
  );

drop policy if exists "workspace owner manages membership" on public.beegame_workspace_members;
create policy "workspace owner manages membership" on public.beegame_workspace_members
  for all using (public.beegame_is_workspace_owner(workspace_id))
  with check (public.beegame_is_workspace_owner(workspace_id));

drop policy if exists "project owner access" on public.beegame_projects;
create policy "project owner access" on public.beegame_projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "session owner access" on public.beegame_sessions;
create policy "session owner access" on public.beegame_sessions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "model config owner access" on public.beegame_model_configs;
drop policy if exists "model config readable by effective owner" on public.beegame_model_configs;
drop policy if exists "model config managed by platform owner" on public.beegame_model_configs;
create policy "model config readable by effective owner" on public.beegame_model_configs
  for select using (
    owner_id = auth.uid() or
    owner_id = public.beegame_model_config_owner_id(auth.uid())
  );
create policy "model config managed by platform owner" on public.beegame_model_configs
  for all using (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  )
  with check (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  );

drop policy if exists "runtime settings owner access" on public.beegame_runtime_settings;
drop policy if exists "runtime settings readable by effective owner" on public.beegame_runtime_settings;
drop policy if exists "runtime settings managed by platform owner" on public.beegame_runtime_settings;
create policy "runtime settings readable by effective owner" on public.beegame_runtime_settings
  for select using (
    owner_id = auth.uid() or
    owner_id = public.beegame_model_config_owner_id(auth.uid())
  );
create policy "runtime settings managed by platform owner" on public.beegame_runtime_settings
  for all using (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  )
  with check (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  );

drop policy if exists "web tools owner access" on public.beegame_web_tools;
drop policy if exists "web tools readable by effective owner" on public.beegame_web_tools;
drop policy if exists "web tools managed by platform owner" on public.beegame_web_tools;
create policy "web tools readable by effective owner" on public.beegame_web_tools
  for select using (
    owner_id = auth.uid() or
    owner_id = public.beegame_model_config_owner_id(auth.uid())
  );
create policy "web tools managed by platform owner" on public.beegame_web_tools
  for all using (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  )
  with check (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  );

drop policy if exists "mcp server owner access" on public.beegame_mcp_servers;
create policy "mcp server owner access" on public.beegame_mcp_servers
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "asset owner access" on public.beegame_assets;
create policy "asset owner access" on public.beegame_assets
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "preview owner access" on public.beegame_previews;
create policy "preview owner access" on public.beegame_previews
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "credit account owner access" on public.beegame_credit_accounts;
create policy "credit account owner access" on public.beegame_credit_accounts
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "credit ledger owner access" on public.beegame_credit_ledger;
create policy "credit ledger owner access" on public.beegame_credit_ledger
  for select using (user_id = auth.uid());

drop policy if exists "audit owner access" on public.beegame_audit_events;
create policy "audit owner access" on public.beegame_audit_events
  for select using (actor_id = auth.uid());

revoke execute on function public.beegame_current_user_context() from public;
grant execute on function public.beegame_current_user_context() to authenticated;

revoke execute on function public.beegame_is_platform_owner() from public;
grant execute on function public.beegame_is_platform_owner() to authenticated;

revoke execute on function public.beegame_model_config_owner_id(uuid) from public;
grant execute on function public.beegame_model_config_owner_id(uuid) to authenticated;

revoke execute on function public.beegame_runtime_env(uuid, text, text) from public;
grant execute on function public.beegame_runtime_env(uuid, text, text) to authenticated;

revoke execute on function public.beegame_set_default_model_config(uuid, text) from public;
grant execute on function public.beegame_set_default_model_config(uuid, text) to authenticated;

revoke execute on function public.beegame_reserve_credits(uuid, integer, text, text, jsonb) from public;
grant execute on function public.beegame_reserve_credits(uuid, integer, text, text, jsonb) to authenticated;

revoke execute on function public.beegame_settle_credit_reservation(uuid, text, integer, integer, text, jsonb) from public;
grant execute on function public.beegame_settle_credit_reservation(uuid, text, integer, integer, text, jsonb) to authenticated;

revoke execute on function public.beegame_refund_credit_reservation(uuid, text, text, jsonb) from public;
grant execute on function public.beegame_refund_credit_reservation(uuid, text, text, jsonb) to authenticated;

revoke execute on function public.beegame_delete_current_user() from public;
grant execute on function public.beegame_delete_current_user() to authenticated;
