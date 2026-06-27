-- BeeGame dashboard Supabase schema.
-- Run this in the Supabase SQL editor or package it as a migration before
-- enabling Supabase-backed repositories in production.

create extension if not exists pgcrypto;

create table if not exists public.beegame_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  api_key_ciphertext text,
  models jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

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
  project_id text references public.beegame_projects(id) on delete set null,
  kind text not null check (kind in ('estimate', 'reserve', 'settle', 'grant', 'refund')),
  credits integer not null,
  weighted_tokens integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.beegame_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.beegame_workspaces(id) on delete set null,
  project_id text references public.beegame_projects(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

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
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

drop policy if exists "project owner access" on public.beegame_projects;
create policy "project owner access" on public.beegame_projects
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "session owner access" on public.beegame_sessions;
create policy "session owner access" on public.beegame_sessions
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "model config owner access" on public.beegame_model_configs;
create policy "model config owner access" on public.beegame_model_configs
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "runtime settings owner access" on public.beegame_runtime_settings;
create policy "runtime settings owner access" on public.beegame_runtime_settings
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "web tools owner access" on public.beegame_web_tools;
create policy "web tools owner access" on public.beegame_web_tools
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

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
