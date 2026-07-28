-- BeeGame dashboard Supabase schema.
-- Run this in the Supabase SQL editor or package it as a migration before
-- enabling Supabase-backed repositories in production.

create extension if not exists pgcrypto;

insert into storage.buckets (id, name, public)
values
  ('avatars', 'avatars', true),
  ('beegame-assets', 'beegame-assets', false),
  ('beegame-resource-packs', 'beegame-resource-packs', false),
  ('beegame-deployments', 'beegame-deployments', true)
on conflict (id) do update
set public = excluded.public;

drop policy if exists "beegame resource pack platform read" on storage.objects;
create policy "beegame resource pack platform read" on storage.objects
  for select using (bucket_id = 'beegame-resource-packs' and public.beegame_is_platform_owner());

drop policy if exists "beegame resource pack platform write" on storage.objects;
create policy "beegame resource pack platform write" on storage.objects
  for all using (bucket_id = 'beegame-resource-packs' and public.beegame_is_platform_owner())
  with check (bucket_id = 'beegame-resource-packs' and public.beegame_is_platform_owner());

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

drop policy if exists "beegame deployment public read" on storage.objects;
create policy "beegame deployment public read" on storage.objects
  for select
  to anon, authenticated
  using (bucket_id = 'beegame-deployments');

drop policy if exists "beegame deployment owner insert" on storage.objects;
create policy "beegame deployment owner insert" on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'beegame-deployments' and
    (storage.foldername(name))[1] = 'deployments' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame deployment owner update" on storage.objects;
create policy "beegame deployment owner update" on storage.objects
  for update
  to authenticated
  using (
    bucket_id = 'beegame-deployments' and
    (storage.foldername(name))[1] = 'deployments' and
    (storage.foldername(name))[2] = auth.uid()::text
  )
  with check (
    bucket_id = 'beegame-deployments' and
    (storage.foldername(name))[1] = 'deployments' and
    (storage.foldername(name))[2] = auth.uid()::text
  );

drop policy if exists "beegame deployment owner delete" on storage.objects;
create policy "beegame deployment owner delete" on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'beegame-deployments' and
    (storage.foldername(name))[1] = 'deployments' and
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

create table if not exists public.beegame_platform_settings (
  key text primary key,
  config jsonb not null default '{}'::jsonb,
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

create table if not exists public.beegame_user_skills (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  slug text not null,
  name text not null,
  description text not null,
  enabled boolean not null default true,
  content text not null,
  "references" jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_id, slug)
);

create table if not exists public.beegame_assets (
  id text primary key,
  project_id text not null references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  manifest jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_resource_packs (
  id text primary key,
  name text not null,
  style text not null,
  styles text[] not null default '{}',
  primary_category text not null default 'mixed' check (primary_category in ('2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx', 'audio', 'fonts', 'world-scene', 'mixed')),
  game_types jsonb not null default '[]'::jsonb,
  dimension text not null check (dimension in ('2D', '3D', 'agnostic')),
  categories jsonb not null default '[]'::jsonb,
  license text not null,
  version text not null,
  status text not null default 'draft' check (status in ('draft', 'published', 'archived')),
  element_defaults jsonb not null default '{}'::jsonb,
  cover_path text,
  element_count integer not null default 0 check (element_count >= 0),
  description text,
  tags text[] not null default '{}',
  source text,
  author text,
  license_evidence text,
  compatible_engines text[] not null default '{}',
  deprecated_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_resource_elements (
  id text primary key,
  pack_id text not null references public.beegame_resource_packs(id) on delete cascade,
  name text not null,
  path text not null,
  category text not null,
  kind text not null,
  preview jsonb,
  specs jsonb not null default '{}'::jsonb,
  usage_tags text[] not null default '{}',
  usage_tags_mode text not null default 'inherit' check (usage_tags_mode in ('inherit', 'override', 'manual-only')),
  asset_kind text,
  capabilities text[] not null default '{}',
  content_profile jsonb,
  relations jsonb not null default '[]'::jsonb,
  dependencies jsonb not null default '[]'::jsonb,
  dependency_bindings jsonb not null default '[]'::jsonb,
  status text not null default 'ready' check (status in ('ready', 'hidden', 'archived')),
  style_override text,
  dimension_override text check (dimension_override is null or dimension_override in ('2D', '3D', 'agnostic')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, path)
);

create table if not exists public.beegame_resource_folders (
  id text primary key,
  pack_id text not null references public.beegame_resource_packs(id) on delete cascade,
  name text not null,
  parent_id text references public.beegame_resource_folders(id) on delete cascade,
  path text not null,
  element_defaults jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, path)
);

create table if not exists public.beegame_resource_processing_jobs (
  id text primary key,
  pack_id text not null references public.beegame_resource_packs(id) on delete cascade,
  kind text not null check (kind in ('inspect-elements')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  total_items integer not null default 0 check (total_items >= 0),
  completed_items integer not null default 0 check (completed_items >= 0),
  failed_items integer not null default 0 check (failed_items >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_resource_processing_items (
  id text primary key,
  job_id text not null references public.beegame_resource_processing_jobs(id) on delete cascade,
  element_id text not null references public.beegame_resource_elements(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, element_id)
);

create index if not exists beegame_resource_processing_jobs_pack_status_idx
  on public.beegame_resource_processing_jobs (pack_id, status, created_at desc);
create index if not exists beegame_resource_processing_items_job_status_idx
  on public.beegame_resource_processing_items (job_id, status, created_at);

alter table public.beegame_resource_packs
  add column if not exists element_defaults jsonb not null default '{}'::jsonb;
alter table public.beegame_resource_packs
  add column if not exists styles text[] not null default '{}';
alter table public.beegame_resource_packs
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists source text,
  add column if not exists author text,
  add column if not exists license_evidence text,
  add column if not exists compatible_engines text[] not null default '{}',
  add column if not exists deprecated_at timestamptz;
update public.beegame_resource_packs
set styles = array(
  select btrim(value)
  from unnest(string_to_array(style, '/')) as value
  where btrim(value) <> ''
)
where cardinality(styles) = 0 and btrim(style) <> '';

drop view if exists public.beegame_resource_pack_catalog;

create view public.beegame_resource_pack_catalog
with (security_invoker = true)
as
select
  p.id as pack_id,
  p.version as pack_version,
  p.name as pack_name,
  p.style,
  case when cardinality(p.styles) > 0 then p.styles else array[p.style] end as styles,
  array(select jsonb_array_elements_text(p.game_types)) as game_types,
  p.dimension,
  p.primary_category,
  coalesce(array_agg(distinct e.category) filter (where e.id is not null), '{}') as categories,
  coalesce(p.tags, '{}') as tags,
  count(e.id)::integer as ready_element_count,
  coalesce(array_agg(distinct e.asset_kind) filter (where e.asset_kind is not null), '{}') as asset_kinds,
  coalesce(array(select distinct unnest(e2.usage_tags) from public.beegame_resource_elements e2 where e2.pack_id = p.id and e2.status = 'ready'), '{}') as usage_tags,
  coalesce(array(select distinct unnest(e3.capabilities) from public.beegame_resource_elements e3 where e3.pack_id = p.id and e3.status = 'ready'), '{}') as capabilities,
  coalesce(array_agg(distinct lower(reverse(split_part(reverse(e.path), '.', 1)))) filter (where e.id is not null and e.path like '%.%'), '{}') as formats,
  p.description,
  p.license,
  p.author,
  p.source,
  coalesce(p.compatible_engines, '{}') as compatible_engines
from public.beegame_resource_packs p
left join public.beegame_resource_elements e on e.pack_id = p.id and e.status = 'ready'
where p.status = 'published'
group by p.id;
alter table public.beegame_resource_folders
  add column if not exists element_defaults jsonb not null default '{}'::jsonb;
alter table public.beegame_resource_elements
  add column if not exists usage_tags_mode text not null default 'inherit';
update public.beegame_resource_elements
set usage_tags_mode = 'override'
where usage_tags_mode = 'inherit' and cardinality(usage_tags) > 0;
alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_usage_tags_mode_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_usage_tags_mode_check
  check (usage_tags_mode in ('inherit', 'override', 'manual-only'));

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_status_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_status_check
  check (status in ('queued', 'uploading', 'ready', 'failed', 'hidden', 'archived'));

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_asset_kind_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_asset_kind_check
  check (asset_kind is null or asset_kind in (
    'image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas', 'frame-animation',
    'tileset', 'tilemap', 'mesh', 'model', 'scene', 'material', 'rig', 'animation-clip',
    'animation-library', 'ui-document', 'ui-screen', 'font', 'audio-clip', 'audio-cue',
    'audio-bank', 'music', 'ambience', 'voice', 'vfx', 'shader', 'physical-material',
    'collider', 'input-profile', 'data'
  ));

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_capabilities_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_capabilities_check
  check (capabilities <@ array[
    'alpha', 'tileable', 'nine-slice', 'sprite-slicing', 'frame-sequence', 'atlas-regions',
    'tile-collision', 'skinned', 'rigged', 'contains-animations', 'contains-materials',
    'contains-textures', 'morph-targets',
    'lod', 'collision', 'navigation', 'modular', 'connection-points', 'scene-layout',
    'spawn-markers', 'objective-markers', 'ui-states', 'focus-navigation', 'safe-area',
    'particle', 'flipbook', 'trail', 'spatial-audio', 'loop-points', 'audio-variants',
    'physical-properties', 'ragdoll', 'input-actions', 'touch-controls', 'gamepad-controls'
  ]::text[]);

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_content_profile_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_content_profile_check
  check (
    content_profile is null or (
      jsonb_typeof(content_profile) = 'object'
      and content_profile ?& array['packaging', 'components', 'inspection']
      and content_profile->>'packaging' in ('self-contained', 'external-dependencies', 'unknown')
      and jsonb_typeof(content_profile->'components') = 'array'
      and jsonb_typeof(content_profile->'inspection') = 'object'
      and content_profile->'inspection' ?& array['status', 'source']
      and content_profile->'inspection'->>'status' in ('complete', 'partial', 'unavailable')
      and content_profile->'inspection'->>'source' in ('server', 'client', 'admin')
    )
  );

create or replace function public.beegame_valid_resource_relations(value jsonb)
returns boolean language sql immutable as $$
  select jsonb_typeof(value) = 'array' and not exists (
    select 1 from jsonb_array_elements(value) relation
    where jsonb_typeof(relation) <> 'object'
       or coalesce(relation->>'kind', '') not in (
         'uses-texture', 'uses-material', 'uses-rig', 'animation-for', 'collision-for',
         'lod-of', 'variant-of', 'component-of', 'audio-for', 'vfx-for'
       )
       or coalesce(relation->>'targetElementId', '') = ''
       or (relation ? 'role' and coalesce(relation->>'role', '') = '')
       or (relation ? 'required' and jsonb_typeof(relation->'required') <> 'boolean')
  );
$$;

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_relations_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_relations_check
  check (public.beegame_valid_resource_relations(relations));

create index if not exists beegame_resource_elements_asset_kind_idx
  on public.beegame_resource_elements (pack_id, asset_kind);
create index if not exists beegame_resource_elements_capabilities_idx
  on public.beegame_resource_elements using gin (capabilities);
create index if not exists beegame_resource_elements_relations_idx
  on public.beegame_resource_elements using gin (relations);

create index if not exists beegame_resource_folders_pack_parent_idx
  on public.beegame_resource_folders (pack_id, parent_id, path);

create table if not exists public.beegame_resource_dependencies (
  element_id text not null references public.beegame_resource_elements(id) on delete cascade,
  dependency_path text not null,
  dependency_kind text,
  primary key (element_id, dependency_path)
);

create index if not exists beegame_resource_elements_pack_category_idx
  on public.beegame_resource_elements (pack_id, category, path);

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

create table if not exists public.beegame_deployments (
  id text primary key,
  session_id text not null references public.beegame_sessions(id) on delete cascade,
  project_id text references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_path text not null,
  status text not null check (status in ('queued', 'building', 'publishing', 'succeeded', 'failed')),
  url text not null default '',
  build_command text,
  build_log text,
  entrypoint text,
  output_dir text,
  artifact_path text,
  artifact_hash text,
  message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deployed_at timestamptz
);

alter table public.beegame_deployments
  add column if not exists session_id text references public.beegame_sessions(id) on delete cascade,
  add column if not exists project_id text references public.beegame_projects(id) on delete cascade,
  add column if not exists owner_id uuid references auth.users(id) on delete cascade,
  add column if not exists workspace_path text,
  add column if not exists status text,
  add column if not exists url text,
  add column if not exists build_command text,
  add column if not exists build_log text,
  add column if not exists entrypoint text,
  add column if not exists output_dir text,
  add column if not exists artifact_path text,
  add column if not exists artifact_hash text,
  add column if not exists message text,
  add column if not exists created_at timestamptz default now(),
  add column if not exists updated_at timestamptz default now(),
  add column if not exists deployed_at timestamptz;

create index if not exists beegame_deployments_owner_session_idx
  on public.beegame_deployments (owner_id, session_id, created_at desc);

create table if not exists public.beegame_credit_accounts (
  user_id uuid primary key references auth.users(id) on delete cascade,
  plan text not null default 'free',
  included_credits integer not null default 300,
  consumed_credits integer not null default 0,
  reserved_credits integer not null default 0,
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_account_links (
  user_id uuid primary key references auth.users(id) on delete cascade,
  account_id uuid not null references auth.users(id) on delete cascade,
  email text not null,
  updated_at timestamptz not null default now()
);

create index if not exists beegame_account_links_email_idx
  on public.beegame_account_links (lower(email));

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

create table if not exists public.beegame_billing_credit_packs (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  price_id text not null,
  credits integer not null check (credits > 0),
  display_name text,
  enabled boolean not null default true,
  sort_order integer not null default 0,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, price_id)
);

create table if not exists public.beegame_shadow_usage_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id text not null,
  turn_id text,
  project_id text,
  idempotency_key text not null,
  pricing_version text not null default 'weighted-v1',
  usage_source text not null check (usage_source in ('runtime_snapshot', 'model_runtime_host')),
  prompt_tokens bigint not null default 0 check (prompt_tokens >= 0),
  completion_tokens bigint not null default 0 check (completion_tokens >= 0),
  cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  cache_creation_tokens bigint not null default 0 check (cache_creation_tokens >= 0),
  total_tokens bigint not null default 0 check (total_tokens >= 0),
  prompt_tokens_delta bigint not null default 0 check (prompt_tokens_delta >= 0),
  completion_tokens_delta bigint not null default 0 check (completion_tokens_delta >= 0),
  cache_read_tokens_delta bigint not null default 0 check (cache_read_tokens_delta >= 0),
  cache_creation_tokens_delta bigint not null default 0 check (cache_creation_tokens_delta >= 0),
  total_tokens_delta bigint not null default 0 check (total_tokens_delta >= 0),
  weighted_tokens bigint not null default 0 check (weighted_tokens >= 0),
  weighted_tokens_delta bigint not null default 0 check (weighted_tokens_delta >= 0),
  shadow_credits_micro bigint not null default 0 check (shadow_credits_micro >= 0),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create index if not exists beegame_shadow_usage_events_session_idx
  on public.beegame_shadow_usage_events (user_id, session_id, created_at desc);
create index if not exists beegame_shadow_usage_events_project_idx
  on public.beegame_shadow_usage_events (user_id, project_id, created_at desc);

create table if not exists public.beegame_usage_wallets (
  user_id uuid primary key references auth.users(id) on delete cascade,
  included_credits_micro bigint not null default 300000000 check (included_credits_micro >= 0),
  consumed_credits_micro bigint not null default 0 check (consumed_credits_micro >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_usage_debit_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  idempotency_key text not null,
  amount_credits_micro bigint not null check (amount_credits_micro >= 0),
  result jsonb not null,
  created_at timestamptz not null default now(),
  unique (user_id, idempotency_key)
);

create or replace function public.beegame_migrate_usage_wallet(
  p_user_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  legacy_account public.beegame_credit_accounts%rowtype;
  wallet_row public.beegame_usage_wallets%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  select * into legacy_account
  from public.beegame_credit_accounts
  where user_id = p_user_id;
  insert into public.beegame_usage_wallets (
    user_id, included_credits_micro, consumed_credits_micro
  ) values (
    p_user_id,
    greatest(0, coalesce(legacy_account.included_credits, 300) - coalesce(legacy_account.consumed_credits, 0)) * 1000000,
    0
  ) on conflict (user_id) do nothing;
  select * into wallet_row
  from public.beegame_usage_wallets
  where user_id = p_user_id;
  return jsonb_build_object(
    'user_id', wallet_row.user_id,
    'included_credits_micro', wallet_row.included_credits_micro,
    'consumed_credits_micro', wallet_row.consumed_credits_micro,
    'balance_credits_micro', wallet_row.included_credits_micro - wallet_row.consumed_credits_micro
  );
end
$$;

create index if not exists beegame_billing_credit_packs_enabled_idx
  on public.beegame_billing_credit_packs (provider, enabled, sort_order, credits);

create table if not exists public.beegame_billing_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null default 'stripe',
  event_type text not null,
  status text not null check (status in ('received', 'ignored', 'succeeded', 'failed')),
  user_id uuid references auth.users(id) on delete set null,
  price_id text,
  credits integer check (credits is null or credits >= 0),
  provider_event_id text,
  checkout_session_id text,
  metadata jsonb not null default '{}'::jsonb,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists beegame_billing_events_provider_created_idx
  on public.beegame_billing_events (provider, created_at desc);

create index if not exists beegame_billing_events_provider_event_idx
  on public.beegame_billing_events (provider, provider_event_id);

create table if not exists public.beegame_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  workspace_id uuid references public.beegame_workspaces(id) on delete set null,
  project_id text references public.beegame_projects(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- Existing installations may predate the ON DELETE SET NULL declaration.
-- CREATE TABLE IF NOT EXISTS does not reconcile an already-created foreign
-- key, so replace it explicitly to preserve audit history when projects are
-- deleted.
alter table public.beegame_audit_events
  drop constraint if exists beegame_audit_events_project_id_fkey;
alter table public.beegame_audit_events
  add constraint beegame_audit_events_project_id_fkey
  foreign key (project_id) references public.beegame_projects(id) on delete set null;

create table if not exists public.beegame_platform_owner_invites (
  email text primary key,
  created_at timestamptz not null default now(),
  claimed_user_id uuid references auth.users(id) on delete set null,
  claimed_at timestamptz
);

create or replace function public.beegame_claim_platform_owner_invite()
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  current_email text;
  invite_claimed boolean;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return false;
  end if;

  select u.email
  into current_email
  from auth.users u
  where u.id = current_user_id
  limit 1;

  if nullif(trim(coalesce(current_email, '')), '') is null then
    return false;
  end if;

  update public.beegame_platform_owner_invites
  set claimed_user_id = current_user_id,
      claimed_at = coalesce(claimed_at, now())
  where lower(email) = lower(current_email)
    and (claimed_user_id is null or claimed_user_id = current_user_id)
  returning true into invite_claimed;

  if coalesce(invite_claimed, false) is false then
    return false;
  end if;

  update public.beegame_workspace_members m
  set role = 'owner'
  from public.beegame_workspaces w
  where m.workspace_id = w.id
    and m.user_id = current_user_id
    and w.owner_id = current_user_id;

  return true;
end
$$;

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

create or replace function public.beegame_is_platform_owner_id(target_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from auth.users u
    where u.id = target_user_id
      and u.raw_app_meta_data->>'beegame_role' = 'owner'
  ) or exists (
    select 1
    from public.beegame_platform_owner_invites i
    where i.claimed_user_id = target_user_id
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

insert into public.beegame_platform_settings (key, config, updated_at)
select 'runtime_settings', s.settings, s.updated_at
from public.beegame_runtime_settings s
where public.beegame_is_platform_owner_id(s.owner_id)
order by s.updated_at desc, s.owner_id
limit 1
on conflict (key) do nothing;

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

create or replace function public.beegame_account_id(p_user_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (
      select account_id
      from public.beegame_account_links
      where user_id = p_user_id
      limit 1
    ),
    p_user_id
  )
$$;

create or replace function public.beegame_current_user_context()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  profile_row public.beegame_profiles%rowtype;
  workspace_row public.beegame_workspaces%rowtype;
  member_role text;
  account_role text;
  account_user_id uuid;
  model_config_owner_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return null;
  end if;

  perform public.beegame_claim_platform_owner_invite();
  account_user_id := public.beegame_account_id(current_user_id);

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

  model_config_owner_id := public.beegame_model_config_owner_id(current_user_id);

  if workspace_row.id is null then
    return jsonb_build_object(
      'id', current_user_id,
      'accountId', account_user_id,
      'email', profile_row.email,
      'displayName', profile_row.display_name,
      'avatarUrl', profile_row.avatar_url,
      'modelConfigOwnerId', model_config_owner_id,
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
  if account_role = 'owner' or public.beegame_is_platform_owner() then
    member_role := 'owner';
  end if;

  return jsonb_build_object(
    'id', current_user_id,
    'accountId', account_user_id,
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
  canonical_account_id uuid;
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
  canonical_account_id := new.id;
  if nullif(new.email, '') is not null and new.email_confirmed_at is not null then
    select l.account_id
    into canonical_account_id
    from public.beegame_account_links l
    where lower(l.email) = lower(new.email)
    order by
      case when l.account_id = l.user_id then 0 else 1 end,
      l.updated_at asc,
      l.account_id::text asc
    limit 1;
    canonical_account_id := coalesce(canonical_account_id, new.id);
  end if;

  insert into public.beegame_account_links (user_id, account_id, email)
  values (new.id, canonical_account_id, coalesce(new.email, new.id::text))
  on conflict (user_id) do update
  set account_id = excluded.account_id,
      email = excluded.email,
      updated_at = now();

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
  values (canonical_account_id)
  on conflict (user_id) do nothing;

  return new;
end
$$;

drop trigger if exists beegame_after_auth_user_created on auth.users;
create trigger beegame_after_auth_user_created
  after insert or update of email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data on auth.users
  for each row execute function public.beegame_handle_new_user();

insert into public.beegame_account_links (user_id, account_id, email)
select
  u.id,
  first_value(u.id) over (
    partition by case
      when nullif(u.email, '') is not null and u.email_confirmed_at is not null
        then lower(u.email)
      else u.id::text
    end
    order by u.created_at asc, u.id::text asc
  ) as account_id,
  coalesce(u.email, u.id::text) as email
from auth.users u
on conflict (user_id) do update
set account_id = excluded.account_id,
    email = excluded.email,
    updated_at = now();

update public.beegame_credit_ledger l
set user_id = a.account_id
from public.beegame_account_links a
where l.user_id = a.user_id
  and a.account_id <> a.user_id;

with grouped_credit_accounts as (
  select
    a.account_id as user_id,
    max(c.included_credits) as included_credits,
    sum(c.consumed_credits) as consumed_credits,
    sum(c.reserved_credits) as reserved_credits
  from public.beegame_credit_accounts c
  join public.beegame_account_links a on a.user_id = c.user_id
  group by a.account_id
)
insert into public.beegame_credit_accounts (
  user_id,
  included_credits,
  consumed_credits,
  reserved_credits,
  updated_at
)
select
  user_id,
  included_credits,
  consumed_credits,
  reserved_credits,
  now()
from grouped_credit_accounts
on conflict (user_id) do update
set included_credits = excluded.included_credits,
    consumed_credits = excluded.consumed_credits,
    reserved_credits = excluded.reserved_credits,
    updated_at = now();

delete from public.beegame_credit_accounts c
using public.beegame_account_links a
where c.user_id = a.user_id
  and a.account_id <> a.user_id;

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
select distinct a.account_id
from public.beegame_account_links a
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
  platform_settings jsonb := '{}'::jsonb;
  model_env jsonb := '{}'::jsonb;
  web_env jsonb := '{}'::jsonb;
  settings_env jsonb := '{}'::jsonb;
  runtime_env jsonb := '{}'::jsonb;
  base_config_dir text;
  runtime_root_dir text;
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
    runtime_root_dir := base_config_dir || '/.runtime';
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_CONFIG_DIR', runtime_root_dir || '/app',
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

  select coalesce(config, '{}'::jsonb)
  into platform_settings
  from public.beegame_platform_settings
  where key = 'runtime_settings'
  limit 1;

  if platform_settings = '{}'::jsonb then
    select *
    into settings_row
    from public.beegame_runtime_settings
    where owner_id = config_owner_id
    limit 1;

    if found then
      platform_settings := coalesce(settings_row.settings, '{}'::jsonb);
    end if;
  end if;

  if platform_settings <> '{}'::jsonb then
    settings_env := settings_env || jsonb_build_object(
      'BEEGAME_RUNTIME_SETTINGS_JSON',
      platform_settings::text
    );
    if platform_settings ? 'autoMemoryEnabled' then
      settings_env := settings_env || jsonb_build_object(
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
        case when (platform_settings->>'autoMemoryEnabled')::boolean then '0' else '1' end
      );
      if base_config_dir <> '' then
        settings_env := settings_env || jsonb_build_object(
          'CLAUDE_CONFIG_DIR',
          runtime_root_dir || '/core'
        );
      end if;
    end if;
    if platform_settings ? 'autoDreamEnabled' and base_config_dir <> '' then
      settings_env := settings_env || jsonb_build_object(
        'CLAUDE_CONFIG_DIR',
        runtime_root_dir || '/core'
      );
    end if;
    if (platform_settings->>'treeSitterBashEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_TREE_SITTER_BASH', '1');
    end if;
    if (platform_settings->>'webBrowserToolEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_WEB_BROWSER_TOOL', '1');
    end if;
    if (platform_settings->>'bashClassifierEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_BASH_CLASSIFIER', '1');
    end if;
    if (platform_settings->>'mcpSkillsEnabled')::boolean is true then
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

create or replace function public.beegame_record_shadow_usage(
  p_user_id uuid,
  p_session_id text,
  p_turn_id text default null,
  p_project_id text default null,
  p_idempotency_key text default null,
  p_usage jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_pricing_version text default 'weighted-v1',
  p_usage_source text default 'runtime_snapshot'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_row public.beegame_shadow_usage_events%rowtype;
  event_row public.beegame_shadow_usage_events%rowtype;
  duplicate_event boolean := false;
  reset_epoch boolean := false;
  current_prompt bigint := greatest(0, coalesce((p_usage->>'prompt_tokens')::bigint, 0));
  current_completion bigint := greatest(0, coalesce((p_usage->>'completion_tokens')::bigint, 0));
  current_cache_read bigint := greatest(0, coalesce((p_usage->>'cache_read_tokens')::bigint, 0));
  current_cache_creation bigint := greatest(0, coalesce((p_usage->>'cache_creation_tokens')::bigint, 0));
  current_total bigint := greatest(0, coalesce((p_usage->>'total_tokens')::bigint, 0));
  current_weighted bigint;
  delta_prompt bigint;
  delta_completion bigint;
  delta_cache_read bigint;
  delta_cache_creation bigint;
  delta_total bigint;
  delta_weighted bigint;
  cumulative_prompt bigint;
  cumulative_completion bigint;
  cumulative_cache_read bigint;
  cumulative_cache_creation bigint;
  cumulative_total bigint;
  cumulative_weighted bigint;
  cumulative_credits bigint;
begin
  if p_user_id is null or nullif(trim(p_session_id), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'User id, session id, and idempotency key are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if p_usage_source not in ('runtime_snapshot', 'model_runtime_host') then
    raise exception 'Invalid usage source';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_session_id));
  select * into event_row
  from public.beegame_shadow_usage_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if event_row.id is not null then
    duplicate_event := true;
  else
    select * into previous_row
    from public.beegame_shadow_usage_events
    where user_id = p_user_id and session_id = p_session_id
    order by created_at desc, id desc
    limit 1;

    current_weighted := ceil((current_prompt * 100 + current_cache_read * 10 + current_cache_creation * 125 + current_completion * 500)::numeric / 100)::bigint;
    reset_epoch := previous_row.id is null or
      current_prompt < previous_row.prompt_tokens or
      current_completion < previous_row.completion_tokens or
      current_cache_read < previous_row.cache_read_tokens or
      current_cache_creation < previous_row.cache_creation_tokens or
      current_total < previous_row.total_tokens;
    delta_prompt := case when reset_epoch then current_prompt else greatest(0, current_prompt - previous_row.prompt_tokens) end;
    delta_completion := case when reset_epoch then current_completion else greatest(0, current_completion - previous_row.completion_tokens) end;
    delta_cache_read := case when reset_epoch then current_cache_read else greatest(0, current_cache_read - previous_row.cache_read_tokens) end;
    delta_cache_creation := case when reset_epoch then current_cache_creation else greatest(0, current_cache_creation - previous_row.cache_creation_tokens) end;
    delta_total := case when reset_epoch then current_total else greatest(0, current_total - previous_row.total_tokens) end;
    delta_weighted := case when reset_epoch then current_weighted else greatest(0, current_weighted - previous_row.weighted_tokens) end;

    insert into public.beegame_shadow_usage_events (
      user_id, session_id, turn_id, project_id, idempotency_key, pricing_version, usage_source,
      prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
      prompt_tokens_delta, completion_tokens_delta, cache_read_tokens_delta, cache_creation_tokens_delta,
      total_tokens_delta, weighted_tokens, weighted_tokens_delta, shadow_credits_micro, metadata
    ) values (
      p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key, coalesce(nullif(trim(p_pricing_version), ''), 'weighted-v1'), p_usage_source,
      current_prompt, current_completion, current_cache_read, current_cache_creation, current_total,
      delta_prompt, delta_completion, delta_cache_read, delta_cache_creation,
      delta_total, current_weighted, delta_weighted, delta_weighted * 100, coalesce(p_metadata, '{}'::jsonb)
    ) returning * into event_row;
  end if;

  select coalesce(sum(prompt_tokens_delta), 0), coalesce(sum(completion_tokens_delta), 0),
    coalesce(sum(cache_read_tokens_delta), 0), coalesce(sum(cache_creation_tokens_delta), 0),
    coalesce(sum(total_tokens_delta), 0), coalesce(sum(weighted_tokens_delta), 0),
    coalesce(sum(shadow_credits_micro), 0)
  into cumulative_prompt, cumulative_completion, cumulative_cache_read,
    cumulative_cache_creation, cumulative_total, cumulative_weighted, cumulative_credits
  from public.beegame_shadow_usage_events
  where user_id = p_user_id and session_id = p_session_id;

  return jsonb_build_object(
    'duplicate', duplicate_event,
    'event', jsonb_build_object(
      'id', event_row.id, 'idempotency_key', event_row.idempotency_key,
      'user_id', event_row.user_id, 'session_id', event_row.session_id,
      'turn_id', event_row.turn_id, 'project_id', event_row.project_id,
      'pricing_version', event_row.pricing_version, 'usage_source', event_row.usage_source,
      'prompt_tokens', event_row.prompt_tokens, 'completion_tokens', event_row.completion_tokens,
      'cache_read_tokens', event_row.cache_read_tokens, 'cache_creation_tokens', event_row.cache_creation_tokens,
      'total_tokens', event_row.total_tokens, 'prompt_tokens_delta', event_row.prompt_tokens_delta,
      'completion_tokens_delta', event_row.completion_tokens_delta, 'cache_read_tokens_delta', event_row.cache_read_tokens_delta,
      'cache_creation_tokens_delta', event_row.cache_creation_tokens_delta, 'total_tokens_delta', event_row.total_tokens_delta,
      'weighted_tokens', event_row.weighted_tokens, 'weighted_tokens_delta', event_row.weighted_tokens_delta,
      'shadow_credits_micro', event_row.shadow_credits_micro, 'created_at', event_row.created_at,
      'metadata', event_row.metadata
    ),
    'cumulative_usage', jsonb_build_object(
      'prompt_tokens', cumulative_prompt, 'completion_tokens', cumulative_completion,
      'cache_read_tokens', cumulative_cache_read, 'cache_creation_tokens', cumulative_cache_creation,
      'total_tokens', cumulative_total
    ),
    'cumulative_weighted_tokens', cumulative_weighted,
    'shadow_credits_micro', cumulative_credits
  );
end
$$;

create or replace function public.beegame_debit_realtime_usage(
  p_user_id uuid,
  p_session_id text,
  p_turn_id text default null,
  p_project_id text default null,
  p_idempotency_key text default null,
  p_usage jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_pricing_version text default 'weighted-v1',
  p_usage_source text default 'runtime_snapshot'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row public.beegame_usage_wallets%rowtype;
  debit_row public.beegame_usage_debit_events%rowtype;
  shadow_row public.beegame_shadow_usage_events%rowtype;
  previous_shadow_row public.beegame_shadow_usage_events%rowtype;
  result_payload jsonb;
  amount_micro bigint;
  prompt_tokens bigint := greatest(0, coalesce((p_usage->>'prompt_tokens')::bigint, 0));
  completion_tokens bigint := greatest(0, coalesce((p_usage->>'completion_tokens')::bigint, 0));
  cache_read_tokens bigint := greatest(0, coalesce((p_usage->>'cache_read_tokens')::bigint, 0));
  cache_creation_tokens bigint := greatest(0, coalesce((p_usage->>'cache_creation_tokens')::bigint, 0));
  weighted_tokens bigint;
  previous_weighted_tokens bigint := 0;
  reset_epoch boolean := false;
begin
  if p_user_id is null or nullif(trim(p_session_id), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'User id, session id, and idempotency key are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  select * into debit_row
  from public.beegame_usage_debit_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if debit_row.id is not null then
    return jsonb_set(debit_row.result, '{duplicate}', 'true'::jsonb);
  end if;

  select * into shadow_row
  from public.beegame_shadow_usage_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  perform public.beegame_migrate_usage_wallet(p_user_id);
  select * into wallet_row
  from public.beegame_usage_wallets
  where user_id = p_user_id
  for update;

  weighted_tokens := ceil((prompt_tokens * 100 + cache_read_tokens * 25 + cache_creation_tokens * 125 + completion_tokens * 500)::numeric / 100)::bigint;
  if shadow_row.id is not null then
    amount_micro := shadow_row.weighted_tokens_delta * 100;
  else
    select * into previous_shadow_row
    from public.beegame_shadow_usage_events
    where user_id = p_user_id and session_id = p_session_id
    order by created_at desc, id desc
    limit 1;
    if previous_shadow_row.id is not null then
      reset_epoch := prompt_tokens < previous_shadow_row.prompt_tokens or
        completion_tokens < previous_shadow_row.completion_tokens or
        cache_read_tokens < previous_shadow_row.cache_read_tokens or
        cache_creation_tokens < previous_shadow_row.cache_creation_tokens or
        coalesce((p_usage->>'total_tokens')::bigint, 0) < previous_shadow_row.total_tokens;
      previous_weighted_tokens := previous_shadow_row.weighted_tokens;
    end if;
    amount_micro := case
      when reset_epoch or previous_shadow_row.id is null then weighted_tokens * 100
      else greatest(0, weighted_tokens - previous_weighted_tokens) * 100
    end;
  end if;
  if wallet_row.included_credits_micro - wallet_row.consumed_credits_micro < amount_micro then
    raise exception 'Insufficient realtime usage credits';
  end if;

  result_payload := public.beegame_record_shadow_usage(
    p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key,
    p_usage, p_metadata, p_pricing_version, p_usage_source
  );
  insert into public.beegame_usage_debit_events (
    user_id, idempotency_key, amount_credits_micro, result
  ) values (
    p_user_id, p_idempotency_key, amount_micro, result_payload
  );
  update public.beegame_usage_wallets
  set consumed_credits_micro = consumed_credits_micro + amount_micro,
      updated_at = now()
  where user_id = p_user_id;
  return result_payload;
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
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
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
  available_unreserved_credits integer;
  settled_credits integer;
  refunded_credits integer;
  target_project_id text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
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
  settled_credits := greatest(
    1,
    ceil(weighted_tokens::numeric / credit_unit::numeric)::integer
  );
  available_unreserved_credits := greatest(
    0,
    coalesce(account_row.included_credits, 0) -
      coalesce(account_row.consumed_credits, 0) -
      coalesce(account_row.reserved_credits, 0)
  );
  if greatest(0, settled_credits - reservation_credits) > available_unreserved_credits then
    raise exception 'Insufficient credits to settle actual token usage';
  end if;
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
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
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

create or replace function public.beegame_expire_stale_credit_reservations(
  p_user_id uuid,
  p_older_than timestamptz,
  p_project_id text default null,
  p_metadata jsonb default '{"reason":"stale_reservation_expired"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  expired_ids text[];
  refunded_credits integer;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if p_older_than is null then
    raise exception 'Expiry cutoff is required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  with stale_reservations as (
    select reserve.reservation_id, reserve.project_id, reserve.credits
    from public.beegame_credit_ledger reserve
    where reserve.user_id = p_user_id
      and reserve.kind = 'reserve'
      and reserve.created_at < p_older_than
      and (p_project_id is null or reserve.project_id = p_project_id)
      and not exists (
        select 1
        from public.beegame_credit_ledger completed
        where completed.user_id = reserve.user_id
          and completed.reservation_id = reserve.reservation_id
          and completed.kind in ('settle', 'refund')
      )
  ),
  inserted_refunds as (
    insert into public.beegame_credit_ledger (
      user_id,
      project_id,
      reservation_id,
      kind,
      credits,
      weighted_tokens,
      metadata
    )
    select
      p_user_id,
      stale_reservations.project_id,
      stale_reservations.reservation_id,
      'refund',
      stale_reservations.credits,
      null,
      coalesce(p_metadata, '{"reason":"stale_reservation_expired"}'::jsonb)
    from stale_reservations
    returning reservation_id, credits
  )
  select
    coalesce(array_agg(reservation_id), '{}'::text[]),
    coalesce(sum(credits), 0)::integer
  into expired_ids, refunded_credits
  from inserted_refunds;

  if refunded_credits > 0 then
    update public.beegame_credit_accounts
    set reserved_credits = greatest(0, reserved_credits - refunded_credits),
        updated_at = now()
    where user_id = p_user_id
    returning * into account_row;
  end if;

  return jsonb_build_object(
    'expired_reservation_ids', expired_ids,
    'refunded_credits', refunded_credits,
    'account', to_jsonb(account_row)
  );
end
$$;

create or replace function public.beegame_admin_grant_credits(
  p_target_user_id uuid,
  p_credits integer,
  p_metadata jsonb default '{"source":"manual"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
begin
  if auth.uid() is null or public.beegame_is_platform_owner() is false then
    raise exception 'Forbidden';
  end if;
  if p_target_user_id is null then
    raise exception 'Target user id is required';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_target_user_id)
  on conflict (user_id) do nothing;

  update public.beegame_credit_accounts
  set included_credits = included_credits + p_credits,
      updated_at = now()
  where user_id = p_target_user_id
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
    p_target_user_id,
    null,
    null,
    'grant',
    p_credits,
    null,
    coalesce(p_metadata, '{"source":"manual"}'::jsonb) ||
      jsonb_build_object('granted_by', auth.uid())
  );

  return jsonb_build_object(
    'granted_credits', p_credits,
    'account', to_jsonb(account_row)
  );
end
$$;

drop function if exists public.beegame_admin_upsert_stripe_webhook_secret(text);
drop function if exists public.beegame_admin_upsert_payment_provider_secret(text, text);
drop function if exists public.beegame_payment_provider_grant_credits(uuid, integer, text, jsonb);
drop table if exists public.beegame_payment_provider_secrets;

create or replace function public.beegame_payment_provider_grant_credits(
  p_target_user_id uuid,
  p_credits integer,
  p_metadata jsonb default '{"source":"payment_provider"}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  provider_name text;
  provider_reference text;
begin
  provider_name := coalesce(nullif(trim(p_metadata->>'provider'), ''), '');
  provider_reference := coalesce(nullif(trim(p_metadata->>'providerReference'), ''), '');

  if p_target_user_id is null then
    raise exception 'Target user id is required';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;
  if provider_name = '' or provider_reference = '' then
    raise exception 'Payment provider and provider reference are required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_target_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_target_user_id
  for update;

  if exists (
    select 1
    from public.beegame_credit_ledger
    where user_id = p_target_user_id
      and kind = 'grant'
      and metadata->>'provider' = provider_name
      and metadata->>'providerReference' = provider_reference
  ) then
    return jsonb_build_object(
      'granted_credits', 0,
      'account', to_jsonb(account_row)
    );
  end if;

  update public.beegame_credit_accounts
  set included_credits = included_credits + p_credits,
      updated_at = now()
  where user_id = p_target_user_id
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
    p_target_user_id,
    null,
    null,
    'grant',
    p_credits,
    null,
    coalesce(p_metadata, '{"source":"payment_provider"}'::jsonb)
  );

  return jsonb_build_object(
    'granted_credits', p_credits,
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
alter table public.beegame_platform_settings enable row level security;
alter table public.beegame_web_tools enable row level security;
alter table public.beegame_mcp_servers enable row level security;
alter table public.beegame_user_skills enable row level security;
alter table public.beegame_assets enable row level security;
alter table public.beegame_resource_packs enable row level security;
alter table public.beegame_resource_elements enable row level security;
alter table public.beegame_resource_folders enable row level security;
alter table public.beegame_resource_processing_jobs enable row level security;
alter table public.beegame_resource_processing_items enable row level security;
alter table public.beegame_resource_dependencies enable row level security;
alter table public.beegame_previews enable row level security;
alter table public.beegame_deployments enable row level security;
alter table public.beegame_account_links enable row level security;
alter table public.beegame_credit_accounts enable row level security;
alter table public.beegame_credit_ledger enable row level security;
alter table public.beegame_billing_credit_packs enable row level security;
alter table public.beegame_billing_events enable row level security;
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
    owner_id = public.beegame_model_config_owner_id(auth.uid()) or
    public.beegame_is_platform_owner_id(owner_id)
  );
create policy "runtime settings managed by platform owner" on public.beegame_runtime_settings
  for all using (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  )
  with check (
    owner_id = auth.uid() and public.beegame_is_platform_owner()
  );

drop policy if exists "platform settings authenticated read" on public.beegame_platform_settings;
drop policy if exists "platform settings managed by platform owner" on public.beegame_platform_settings;
create policy "platform settings authenticated read" on public.beegame_platform_settings
  for select using (auth.uid() is not null);
create policy "platform settings managed by platform owner" on public.beegame_platform_settings
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

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

drop policy if exists "user skill owner access" on public.beegame_user_skills;
create policy "user skill owner access" on public.beegame_user_skills
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "asset owner access" on public.beegame_assets;
create policy "asset owner access" on public.beegame_assets
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "resource Pack platform owner access" on public.beegame_resource_packs;
create policy "resource Pack platform owner access" on public.beegame_resource_packs
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource element platform owner access" on public.beegame_resource_elements;
create policy "resource element platform owner access" on public.beegame_resource_elements
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource folder platform owner access" on public.beegame_resource_folders;
create policy "resource folder platform owner access" on public.beegame_resource_folders
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource processing job platform owner access" on public.beegame_resource_processing_jobs;
create policy "resource processing job platform owner access" on public.beegame_resource_processing_jobs
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource processing item platform owner access" on public.beegame_resource_processing_items;
create policy "resource processing item platform owner access" on public.beegame_resource_processing_items
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource dependency platform owner access" on public.beegame_resource_dependencies;
create policy "resource dependency platform owner access" on public.beegame_resource_dependencies
  for all using (exists (select 1 from public.beegame_resource_elements e where e.id = element_id and public.beegame_is_platform_owner()))
  with check (exists (select 1 from public.beegame_resource_elements e where e.id = element_id and public.beegame_is_platform_owner()));

drop policy if exists "preview owner access" on public.beegame_previews;
create policy "preview owner access" on public.beegame_previews
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "deployment owner access" on public.beegame_deployments;
create policy "deployment owner access" on public.beegame_deployments
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists "account link owner access" on public.beegame_account_links;
create policy "account link owner access" on public.beegame_account_links
  for select using (user_id = auth.uid() or account_id = public.beegame_account_id(auth.uid()));

drop policy if exists "credit account owner access" on public.beegame_credit_accounts;
create policy "credit account owner access" on public.beegame_credit_accounts
  for all using (user_id = public.beegame_account_id(auth.uid()))
  with check (user_id = public.beegame_account_id(auth.uid()));

drop policy if exists "credit ledger owner access" on public.beegame_credit_ledger;
create policy "credit ledger owner access" on public.beegame_credit_ledger
  for select using (user_id = public.beegame_account_id(auth.uid()));

drop policy if exists "billing credit packs owner read" on public.beegame_billing_credit_packs;
create policy "billing credit packs owner read" on public.beegame_billing_credit_packs
  for select using (public.beegame_is_platform_owner());

drop policy if exists "billing credit packs owner manage" on public.beegame_billing_credit_packs;
create policy "billing credit packs owner manage" on public.beegame_billing_credit_packs
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "billing events owner read" on public.beegame_billing_events;
create policy "billing events owner read" on public.beegame_billing_events
  for select using (public.beegame_is_platform_owner());

drop policy if exists "audit owner access" on public.beegame_audit_events;
create policy "audit owner access" on public.beegame_audit_events
  for select using (actor_id = auth.uid());

drop policy if exists "audit actor insert" on public.beegame_audit_events;
create policy "audit actor insert" on public.beegame_audit_events
  for insert with check (actor_id = auth.uid());

revoke execute on function public.beegame_current_user_context() from public;
grant execute on function public.beegame_current_user_context() to authenticated;

revoke execute on function public.beegame_claim_platform_owner_invite() from public;
grant execute on function public.beegame_claim_platform_owner_invite() to authenticated;

revoke execute on function public.beegame_is_platform_owner() from public;
grant execute on function public.beegame_is_platform_owner() to authenticated;

revoke execute on function public.beegame_is_platform_owner_id(uuid) from public;
grant execute on function public.beegame_is_platform_owner_id(uuid) to authenticated;

revoke execute on function public.beegame_account_id(uuid) from public;
grant execute on function public.beegame_account_id(uuid) to authenticated;

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

revoke execute on function public.beegame_expire_stale_credit_reservations(uuid, timestamptz, text, jsonb) from public;
grant execute on function public.beegame_expire_stale_credit_reservations(uuid, timestamptz, text, jsonb) to authenticated;

revoke execute on function public.beegame_admin_grant_credits(uuid, integer, jsonb) from public;
grant execute on function public.beegame_admin_grant_credits(uuid, integer, jsonb) to authenticated;

revoke execute on function public.beegame_payment_provider_grant_credits(uuid, integer, jsonb) from public;
grant execute on function public.beegame_payment_provider_grant_credits(uuid, integer, jsonb) to service_role;

revoke execute on function public.beegame_delete_current_user() from public;
grant execute on function public.beegame_delete_current_user() to authenticated;

-- Project-domain object storage. Supabase remains the metadata and RLS source;
-- object bytes may be stored in R2. Account media keeps its existing Storage
-- tables and policies.
create table if not exists public.beegame_storage_objects (
  id uuid primary key default gen_random_uuid(),
  scope_type text not null check (scope_type in ('user', 'studio', 'platform', 'project', 'pack', 'deployment', 'session')),
  scope_id text not null,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  project_id text references public.beegame_projects(id) on delete cascade,
  pack_id text references public.beegame_resource_packs(id) on delete cascade,
  deployment_id text references public.beegame_deployments(id) on delete cascade,
  session_id text references public.beegame_sessions(id) on delete cascade,
  provider text not null check (provider in ('supabase', 'r2')),
  bucket_role text check (bucket_role in ('project-private', 'resource-private', 'delivery', 'log-private')),
  bucket text not null,
  object_key text not null,
  logical_path text,
  original_filename text,
  mime_type text,
  byte_size bigint check (byte_size is null or byte_size >= 0),
  checksum_algorithm text,
  checksum_value text,
  etag text,
  object_kind text not null,
  version_id text,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'verifying', 'ready', 'failed', 'deleted')),
  visibility text not null default 'private' check (visibility in ('private', 'project', 'organization', 'public')),
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  constraint beegame_storage_objects_checksum_pair check (
    (checksum_algorithm is null and checksum_value is null)
    or (nullif(btrim(checksum_algorithm), '') is not null and nullif(btrim(checksum_value), '') is not null)
  ),
  constraint beegame_storage_objects_r2_role check (provider <> 'r2' or bucket_role is not null)
);

create unique index if not exists beegame_storage_objects_live_locator_idx
  on public.beegame_storage_objects (provider, bucket, object_key)
  where deleted_at is null;
create index if not exists beegame_storage_objects_owner_scope_idx
  on public.beegame_storage_objects (owner_user_id, scope_type, scope_id, created_at desc);
create index if not exists beegame_storage_objects_project_idx
  on public.beegame_storage_objects (project_id, status, object_kind)
  where project_id is not null and deleted_at is null;
create index if not exists beegame_storage_objects_pack_idx
  on public.beegame_storage_objects (pack_id, status, object_kind)
  where pack_id is not null and deleted_at is null;

create table if not exists public.beegame_storage_upload_intents (
  id uuid primary key default gen_random_uuid(),
  storage_object_id uuid not null references public.beegame_storage_objects(id) on delete cascade,
  owner_user_id uuid not null references auth.users(id) on delete cascade,
  upload_mode text not null default 'single' check (upload_mode in ('single', 'multipart')),
  multipart_upload_id text,
  idempotency_key text not null,
  expected_byte_size bigint check (expected_byte_size is null or expected_byte_size >= 0),
  expected_mime_type text,
  expected_checksum_algorithm text,
  expected_checksum_value text,
  status text not null default 'pending' check (status in ('pending', 'uploading', 'verifying', 'completed', 'failed', 'aborted', 'expired')),
  expires_at timestamptz not null,
  completed_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beegame_storage_upload_intents_checksum_pair check (
    (expected_checksum_algorithm is null and expected_checksum_value is null)
    or (nullif(btrim(expected_checksum_algorithm), '') is not null and nullif(btrim(expected_checksum_value), '') is not null)
  ),
  constraint beegame_storage_upload_intents_multipart_id check (upload_mode = 'multipart' or multipart_upload_id is null)
);

create unique index if not exists beegame_storage_upload_intents_idempotency_idx
  on public.beegame_storage_upload_intents (owner_user_id, idempotency_key);
create index if not exists beegame_storage_upload_intents_recovery_idx
  on public.beegame_storage_upload_intents (status, expires_at)
  where status in ('pending', 'uploading', 'verifying');

create table if not exists public.beegame_storage_migration_jobs (
  id uuid primary key default gen_random_uuid(),
  source_storage_object_id uuid not null references public.beegame_storage_objects(id) on delete restrict,
  destination_storage_object_id uuid not null references public.beegame_storage_objects(id) on delete restrict,
  status text not null default 'queued' check (status in ('queued', 'copying', 'verifying', 'ready_to_cutover', 'cutover_complete', 'source_deleted', 'copy_failed', 'verification_failed', 'cutover_failed', 'delete_source_failed')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  started_at timestamptz,
  verified_at timestamptz,
  cutover_at timestamptz,
  source_deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint beegame_storage_migration_jobs_distinct_objects check (source_storage_object_id <> destination_storage_object_id),
  unique (source_storage_object_id, destination_storage_object_id)
);

create index if not exists beegame_storage_migration_jobs_work_idx
  on public.beegame_storage_migration_jobs (status, updated_at);

alter table public.beegame_resource_packs
  add column if not exists cover_storage_object_id uuid references public.beegame_storage_objects(id) on delete set null;
alter table public.beegame_resource_elements
  add column if not exists storage_object_id uuid references public.beegame_storage_objects(id) on delete set null;
alter table public.beegame_deployments
  add column if not exists manifest_storage_object_id uuid references public.beegame_storage_objects(id) on delete set null;

alter table public.beegame_storage_objects enable row level security;
alter table public.beegame_storage_upload_intents enable row level security;
alter table public.beegame_storage_migration_jobs enable row level security;

drop policy if exists "storage object owner read" on public.beegame_storage_objects;
create policy "storage object owner read" on public.beegame_storage_objects
  for select using (
    owner_user_id = auth.uid()
    or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
    or public.beegame_is_platform_owner()
  );

drop policy if exists "storage object owner insert" on public.beegame_storage_objects;
create policy "storage object owner insert" on public.beegame_storage_objects
  for insert with check (
    owner_user_id = auth.uid()
    and (
      (scope_type = 'user' and scope_id = auth.uid()::text)
      or (scope_type = 'project' and project_id is not null and exists (
        select 1 from public.beegame_projects project
        where project.id = beegame_storage_objects.project_id
          and project.owner_id = auth.uid()
      ))
      or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
      or (scope_type = 'deployment' and deployment_id is not null and exists (
        select 1 from public.beegame_deployments deployment
        where deployment.id = beegame_storage_objects.deployment_id
          and deployment.owner_id = auth.uid()
      ))
      or (scope_type = 'session' and session_id is not null and exists (
        select 1 from public.beegame_sessions session
        where session.id = beegame_storage_objects.session_id
          and session.owner_id = auth.uid()
      ))
      or (scope_type in ('studio', 'platform') and public.beegame_is_platform_owner())
    )
  );

drop policy if exists "storage object owner update" on public.beegame_storage_objects;
create policy "storage object owner update" on public.beegame_storage_objects
  for update using (
    owner_user_id = auth.uid()
    or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
    or public.beegame_is_platform_owner()
  ) with check (
    public.beegame_is_platform_owner()
    or (
      owner_user_id = auth.uid()
      and (
        (scope_type = 'user' and scope_id = auth.uid()::text)
        or (scope_type = 'project' and project_id is not null and exists (
          select 1 from public.beegame_projects project
          where project.id = beegame_storage_objects.project_id
            and project.owner_id = auth.uid()
        ))
        or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
        or (scope_type = 'deployment' and deployment_id is not null and exists (
          select 1 from public.beegame_deployments deployment
          where deployment.id = beegame_storage_objects.deployment_id
            and deployment.owner_id = auth.uid()
        ))
        or (scope_type = 'session' and session_id is not null and exists (
          select 1 from public.beegame_sessions session
          where session.id = beegame_storage_objects.session_id
            and session.owner_id = auth.uid()
        ))
      )
    )
  );

drop policy if exists "storage upload intent owner access" on public.beegame_storage_upload_intents;
create policy "storage upload intent owner access" on public.beegame_storage_upload_intents
  for all using (owner_user_id = auth.uid() or public.beegame_is_platform_owner())
  with check (
    (owner_user_id = auth.uid() or public.beegame_is_platform_owner())
    and exists (
      select 1 from public.beegame_storage_objects object
      where object.id = storage_object_id
        and (object.owner_user_id = auth.uid() or public.beegame_is_platform_owner())
    )
  );

drop policy if exists "storage migration owner read" on public.beegame_storage_migration_jobs;
create policy "storage migration owner read" on public.beegame_storage_migration_jobs
  for select using (
    public.beegame_is_platform_owner()
    or exists (
      select 1 from public.beegame_storage_objects source
      where source.id = source_storage_object_id and source.owner_user_id = auth.uid()
    )
  );

revoke all on table public.beegame_storage_objects from anon;
revoke all on table public.beegame_storage_upload_intents from anon;
revoke all on table public.beegame_storage_migration_jobs from anon;
grant select, insert, update on table public.beegame_storage_objects to authenticated;
grant select, insert, update on table public.beegame_storage_upload_intents to authenticated;
grant select on table public.beegame_storage_migration_jobs to authenticated;
