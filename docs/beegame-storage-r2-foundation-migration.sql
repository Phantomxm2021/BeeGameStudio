-- BeeGame project-domain object storage foundation.
--
-- This migration does not alter existing Supabase Storage buckets, objects or
-- policies. New R2-backed business paths opt in by storing storage_object_id;
-- existing paths remain valid legacy locators during migration.

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
  constraint beegame_storage_objects_r2_role check (
    provider <> 'r2' or bucket_role is not null
  )
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
  constraint beegame_storage_upload_intents_multipart_id check (
    upload_mode = 'multipart' or multipart_upload_id is null
  )
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
  constraint beegame_storage_migration_jobs_distinct_objects check (
    source_storage_object_id <> destination_storage_object_id
  ),
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

-- Migration jobs are a service/admin concern. Authenticated end users can see
-- only jobs for objects they own, while writes use a scoped backend service.
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
