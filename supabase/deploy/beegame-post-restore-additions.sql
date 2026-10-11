-- BeeGame post-restore additions
-- Execute only AFTER beegame-legacy-schema-baseline.sql and the old-server data dump.
-- This script is additive: it creates worktree-only contracts. It never drops old tables, columns, or functions.

-- Credit-system tables referenced by parallel worktrees.
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
  kind text not null check (kind in ('estimate', 'reserve', 'settle', 'grant', 'refund', 'usage')),
  credits integer not null,
  weighted_tokens integer,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Confirmed Brief contracts from current-code-snapshot-20260725.
-- BEGIN SOURCE: beegame-confirmed-brief-revisions-migration.sql
-- M1-03a: immutable Confirmed Brief revisions and project-local current heads.
--
-- Run after docs/beegame-supabase-schema.sql. This migration creates only the
-- database contract. It deliberately does not create a browser-write RPC,
-- modify Session prompts, recover Briefs from transcripts, or mark evidence
-- stale. Those responsibilities belong to M1-03b through M1-04/M3/M9.

-- The composite key lets the Brief row prove that its originating Session
-- belongs to the same owner and project. The existing primary key remains the
-- Session identity used elsewhere.
do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'beegame_sessions_id_project_owner_key'
      and conrelid = 'public.beegame_sessions'::regclass
  ) then
    alter table public.beegame_sessions
      add constraint beegame_sessions_id_project_owner_key
      unique (id, project_id, owner_id);
  end if;
end $$;

create table if not exists public.beegame_confirmed_brief_revisions (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  origin_session_id text,
  revision integer not null check (revision > 0),
  schema_version integer not null check (schema_version > 0),
  content jsonb not null,
  content_digest text not null,
  idempotency_key text,
  supersedes_brief_id uuid,
  created_at timestamptz not null default now(),
  unique (project_id, revision),
  unique (id, project_id, owner_id),
  unique (owner_id, project_id, idempotency_key),
  foreign key (origin_session_id, project_id, owner_id)
    references public.beegame_sessions(id, project_id, owner_id)
    on delete set null (origin_session_id),
  foreign key (supersedes_brief_id, project_id, owner_id)
    references public.beegame_confirmed_brief_revisions(id, project_id, owner_id)
    on delete restrict
);

create index if not exists beegame_confirmed_brief_revisions_project_created_idx
  on public.beegame_confirmed_brief_revisions (project_id, revision desc);
create index if not exists beegame_confirmed_brief_revisions_origin_session_idx
  on public.beegame_confirmed_brief_revisions (origin_session_id, created_at desc)
  where origin_session_id is not null;

-- The head is a pointer only. It carries no duplicate content or revision
-- ordinal, so its referenced immutable row remains the single source of truth.
create table if not exists public.beegame_confirmed_brief_heads (
  project_id text primary key references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  current_brief_id uuid not null,
  updated_at timestamptz not null default now(),
  foreign key (current_brief_id, project_id, owner_id)
    references public.beegame_confirmed_brief_revisions(id, project_id, owner_id)
    on delete cascade
);

-- Reconcile the initial inline FK on already-created test databases. A project
-- deletion cascades to both tables, so the head must be removable with the
-- immutable revision row rather than immediately restricting that cascade.
alter table public.beegame_confirmed_brief_heads
  drop constraint if exists beegame_confirmed_brief_heads_current_brief_id_project_id_owner_id_fkey;
alter table public.beegame_confirmed_brief_heads
  drop constraint if exists beegame_confirmed_brief_heads_current_brief_scope_fkey;
alter table public.beegame_confirmed_brief_heads
  add constraint beegame_confirmed_brief_heads_current_brief_scope_fkey
  foreign key (current_brief_id, project_id, owner_id)
  references public.beegame_confirmed_brief_revisions(id, project_id, owner_id)
  on delete cascade;

alter table public.beegame_confirmed_brief_revisions enable row level security;
alter table public.beegame_confirmed_brief_heads enable row level security;

-- Project membership is intentionally not inferred here. Existing M1 project
-- access is owner-only; M11 will introduce any member-role expansion together
-- with the project-wide RLS contract.
drop policy if exists "confirmed brief revision owner read" on public.beegame_confirmed_brief_revisions;
create policy "confirmed brief revision owner read" on public.beegame_confirmed_brief_revisions
  for select using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.beegame_projects project
      where project.id = beegame_confirmed_brief_revisions.project_id
        and project.owner_id = auth.uid()
    )
  );

drop policy if exists "confirmed brief head owner read" on public.beegame_confirmed_brief_heads;
create policy "confirmed brief head owner read" on public.beegame_confirmed_brief_heads
  for select using (
    owner_id = auth.uid()
    and exists (
      select 1
      from public.beegame_projects project
      where project.id = beegame_confirmed_brief_heads.project_id
        and project.owner_id = auth.uid()
    )
  );

-- Revision creation and head advancement are server-owned transactional facts.
-- M1-03b will add a narrowly scoped trusted writer; browser roles can only
-- read rows granted by the policies above.
revoke all on table public.beegame_confirmed_brief_revisions from anon;
revoke all on table public.beegame_confirmed_brief_heads from anon;
revoke insert, update, delete on table public.beegame_confirmed_brief_revisions from authenticated;
revoke insert, update, delete on table public.beegame_confirmed_brief_heads from authenticated;
grant select on table public.beegame_confirmed_brief_revisions to authenticated;
grant select on table public.beegame_confirmed_brief_heads to authenticated;
-- END SOURCE: beegame-confirmed-brief-revisions-migration.sql

-- BEGIN SOURCE: beegame-confirmed-brief-repository-migration.sql
-- M1-03b: trusted, transactional Confirmed Brief revision repository.
--
-- Run after docs/beegame-confirmed-brief-revisions-migration.sql. Browser
-- roles remain read-only: only a dedicated server-side project-contract
-- service may hold the service-role credential required for these functions.
-- This file neither exposes HTTP routes nor sends any Claude Code message.

create or replace function public.beegame_append_confirmed_brief_revision(
  p_owner_id uuid,
  p_project_id text,
  p_origin_session_id text,
  p_schema_version integer,
  p_content jsonb,
  p_content_digest text,
  p_idempotency_key text,
  p_expected_current_brief_id uuid
)
returns table (
  id uuid,
  owner_id uuid,
  project_id text,
  origin_session_id text,
  revision integer,
  schema_version integer,
  content jsonb,
  content_digest text,
  idempotency_key text,
  supersedes_brief_id uuid,
  created_at timestamptz,
  previous_brief_id uuid,
  idempotent boolean
)
language plpgsql
security invoker
set search_path = public, pg_temp
as $$
declare
  current_head public.beegame_confirmed_brief_heads;
  existing_revision public.beegame_confirmed_brief_revisions;
  inserted_revision public.beegame_confirmed_brief_revisions;
  next_revision integer;
begin
  if p_owner_id is null or nullif(trim(p_project_id), '') is null
    or nullif(trim(p_idempotency_key), '') is null
    or p_schema_version is null or p_schema_version < 1
    or p_content is null or jsonb_typeof(p_content) <> 'object'
    or nullif(trim(p_content_digest), '') is null then
    raise exception using errcode = '22023';
  end if;

  -- Serializes first writes as well as head replacement without relying on a
  -- missing-row lock. The key is project-scoped, not content- or user-derived.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id, 0));

  if not exists (
    select 1 from public.beegame_projects project
    where project.id = p_project_id and project.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0002';
  end if;

  if p_origin_session_id is not null and not exists (
    select 1 from public.beegame_sessions session
    where session.id = p_origin_session_id
      and session.project_id = p_project_id
      and session.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0002';
  end if;

  select * into existing_revision
  from public.beegame_confirmed_brief_revisions brief
  where brief.owner_id = p_owner_id
    and brief.project_id = p_project_id
    and brief.idempotency_key = p_idempotency_key;

  if existing_revision.id is not null then
    if existing_revision.content_digest <> p_content_digest then
      raise exception using errcode = '23505';
    end if;
    return query select
      existing_revision.id,
      existing_revision.owner_id,
      existing_revision.project_id,
      existing_revision.origin_session_id,
      existing_revision.revision,
      existing_revision.schema_version,
      existing_revision.content,
      existing_revision.content_digest,
      existing_revision.idempotency_key,
      existing_revision.supersedes_brief_id,
      existing_revision.created_at,
      existing_revision.supersedes_brief_id,
      true;
    return;
  end if;

  select * into current_head
  from public.beegame_confirmed_brief_heads head
  where head.project_id = p_project_id and head.owner_id = p_owner_id
  for update;

  if p_expected_current_brief_id is distinct from current_head.current_brief_id then
    raise exception using errcode = '40001';
  end if;

  select coalesce(max(brief.revision), 0) + 1 into next_revision
  from public.beegame_confirmed_brief_revisions brief
  where brief.project_id = p_project_id;

  insert into public.beegame_confirmed_brief_revisions (
    project_id,
    owner_id,
    origin_session_id,
    revision,
    schema_version,
    content,
    content_digest,
    idempotency_key,
    supersedes_brief_id
  ) values (
    p_project_id,
    p_owner_id,
    p_origin_session_id,
    next_revision,
    p_schema_version,
    p_content,
    p_content_digest,
    p_idempotency_key,
    current_head.current_brief_id
  ) returning * into inserted_revision;

  insert into public.beegame_confirmed_brief_heads (
    project_id,
    owner_id,
    current_brief_id,
    updated_at
  ) values (
    p_project_id,
    p_owner_id,
    inserted_revision.id,
    now()
  ) on conflict on constraint beegame_confirmed_brief_heads_pkey do update
    set current_brief_id = excluded.current_brief_id,
        updated_at = excluded.updated_at
    where public.beegame_confirmed_brief_heads.owner_id = excluded.owner_id;

  if not found then
    raise exception using errcode = 'P0002';
  end if;

  -- The mutation and its user-visible audit fact are one transaction. A
  -- service-level follow-up write would permit a committed revision without a
  -- corresponding audit record when the process or network fails mid-request.
  insert into public.beegame_audit_events (actor_id, project_id, action, metadata)
  values (
    p_owner_id,
    p_project_id,
    case when current_head.current_brief_id is null
      then 'confirmed_brief.created'
      else 'confirmed_brief.revised'
    end,
    jsonb_build_object(
      'targetType', 'confirmed_brief',
      'targetId', inserted_revision.id,
      'revision', inserted_revision.revision,
      'previousBriefId', current_head.current_brief_id,
      'originSessionId', inserted_revision.origin_session_id,
      'schemaVersion', inserted_revision.schema_version
    )
  );

  return query select
    inserted_revision.id,
    inserted_revision.owner_id,
    inserted_revision.project_id,
    inserted_revision.origin_session_id,
    inserted_revision.revision,
    inserted_revision.schema_version,
    inserted_revision.content,
    inserted_revision.content_digest,
    inserted_revision.idempotency_key,
    inserted_revision.supersedes_brief_id,
    inserted_revision.created_at,
    current_head.current_brief_id,
    false;
end
$$;

create or replace function public.beegame_read_current_confirmed_brief(
  p_owner_id uuid,
  p_project_id text
)
returns table (
  id uuid,
  owner_id uuid,
  project_id text,
  origin_session_id text,
  revision integer,
  schema_version integer,
  content jsonb,
  content_digest text,
  idempotency_key text,
  supersedes_brief_id uuid,
  created_at timestamptz
)
language sql
security invoker
stable
set search_path = public, pg_temp
as $$
  select
    brief.id,
    brief.owner_id,
    brief.project_id,
    brief.origin_session_id,
    brief.revision,
    brief.schema_version,
    brief.content,
    brief.content_digest,
    brief.idempotency_key,
    brief.supersedes_brief_id,
    brief.created_at
  from public.beegame_confirmed_brief_heads head
  join public.beegame_confirmed_brief_revisions brief
    on brief.id = head.current_brief_id
   and brief.project_id = head.project_id
   and brief.owner_id = head.owner_id
  where head.owner_id = p_owner_id and head.project_id = p_project_id
$$;

revoke all on function public.beegame_append_confirmed_brief_revision(uuid, text, text, integer, jsonb, text, text, uuid) from public;
revoke all on function public.beegame_read_current_confirmed_brief(uuid, text) from public;
revoke all on function public.beegame_append_confirmed_brief_revision(uuid, text, text, integer, jsonb, text, text, uuid) from anon, authenticated;
revoke all on function public.beegame_read_current_confirmed_brief(uuid, text) from anon, authenticated;
grant execute on function public.beegame_append_confirmed_brief_revision(uuid, text, text, integer, jsonb, text, text, uuid) to service_role;
grant execute on function public.beegame_read_current_confirmed_brief(uuid, text) to service_role;
-- END SOURCE: beegame-confirmed-brief-repository-migration.sql

-- Usage-only credit RPC; legacy reservation RPCs are intentionally retained.
-- BeeGame usage-only credit billing migration.
-- Apply this migration to an existing Supabase project after the base schema.
-- Historical reservation ledger rows are retained for audit; reservation RPCs
-- are removed so new callers can only charge confirmed token usage.

create or replace function public.beegame_charge_credit_usage(
  p_user_id uuid,
  p_usage_event_id text,
  p_input_tokens integer,
  p_cached_input_tokens integer,
  p_output_tokens integer,
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
  existing_row public.beegame_credit_ledger%rowtype;
  weighted_tokens integer;
  charged_credits integer;
  available_credits integer;
  usage_metadata jsonb;
begin
  if p_user_id is null or coalesce(trim(p_usage_event_id), '') = '' then
    raise exception 'User id and usage event id are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if coalesce(p_input_tokens, -1) < 0 or
    coalesce(p_cached_input_tokens, -1) < 0 or
    coalesce(p_output_tokens, -1) < 0 then
    raise exception 'Token counts must be non-negative';
  end if;

  select * into existing_row
  from public.beegame_credit_ledger
  where user_id = p_user_id
    and kind = 'usage'
    and metadata ->> 'usageEventId' = p_usage_event_id
  order by created_at asc
  limit 1;
  if existing_row.id is not null then
    select * into account_row
    from public.beegame_credit_accounts
    where user_id = p_user_id;
    return jsonb_build_object(
      'usage_event_id', p_usage_event_id,
      'input_tokens', coalesce(existing_row.metadata ->> 'inputTokens', '0')::integer,
      'cached_input_tokens', coalesce(existing_row.metadata ->> 'cachedInputTokens', '0')::integer,
      'output_tokens', coalesce(existing_row.metadata ->> 'outputTokens', '0')::integer,
      'weighted_tokens', coalesce(existing_row.weighted_tokens, 0),
      'charged_credits', existing_row.credits,
      'account', to_jsonb(account_row)
    );
  end if;

  weighted_tokens := ceil(
    p_input_tokens::numeric +
    p_cached_input_tokens::numeric * 0.6 +
    p_output_tokens::numeric * 5
  );
  charged_credits := case
    when weighted_tokens > 0 then greatest(1, ceil(weighted_tokens::numeric / 10000))
    else 0
  end;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select * into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  available_credits := account_row.included_credits - account_row.consumed_credits;
  if charged_credits > available_credits then
    raise exception 'Insufficient credits for confirmed token usage';
  end if;

  usage_metadata := coalesce(p_metadata, '{}'::jsonb) || jsonb_build_object(
    'usageEventId', p_usage_event_id,
    'inputTokens', p_input_tokens,
    'cachedInputTokens', p_cached_input_tokens,
    'outputTokens', p_output_tokens
  );
  update public.beegame_credit_accounts
  set consumed_credits = consumed_credits + charged_credits,
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    user_id, project_id, kind, credits, weighted_tokens, metadata
  ) values (
    p_user_id, p_project_id, 'usage', charged_credits, weighted_tokens, usage_metadata
  );

  return jsonb_build_object(
    'usage_event_id', p_usage_event_id,
    'input_tokens', p_input_tokens,
    'cached_input_tokens', p_cached_input_tokens,
    'output_tokens', p_output_tokens,
    'weighted_tokens', weighted_tokens,
    'charged_credits', charged_credits,
    'account', to_jsonb(account_row)
  );
end
$$;

