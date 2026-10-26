-- Incremental migration for Pack authoring. Safe to run after the base BeeGame schema.

create table if not exists public.beegame_resource_folders (
  id text primary key,
  pack_id text not null references public.beegame_resource_packs(id) on delete cascade,
  name text not null,
  parent_id text references public.beegame_resource_folders(id) on delete cascade,
  path text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (pack_id, path)
);

create index if not exists beegame_resource_folders_pack_parent_idx
  on public.beegame_resource_folders (pack_id, parent_id, path);

alter table public.beegame_resource_folders enable row level security;
drop policy if exists "resource folder platform owner access" on public.beegame_resource_folders;
create policy "resource folder platform owner access" on public.beegame_resource_folders
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_status_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_status_check
  check (status in ('queued', 'uploading', 'ready', 'failed', 'hidden', 'archived'));

-- Keep the Pack summary authoritative for all insertion, deletion, and future
-- cross-Pack moves. The trigger makes count maintenance transactional instead
-- of relying on any individual HTTP handler to race a read-modify-write update.
create or replace function public.beegame_sync_resource_pack_element_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op <> 'INSERT' then
    update public.beegame_resource_packs
    set element_count = (select count(*) from public.beegame_resource_elements where pack_id = old.pack_id),
        updated_at = now()
    where id = old.pack_id;
  end if;

  if tg_op <> 'DELETE' then
    update public.beegame_resource_packs
    set element_count = (select count(*) from public.beegame_resource_elements where pack_id = new.pack_id),
        updated_at = now()
    where id = new.pack_id;
  end if;

  return null;
end;
$$;

drop trigger if exists beegame_resource_elements_sync_pack_count on public.beegame_resource_elements;
create trigger beegame_resource_elements_sync_pack_count
after insert or delete or update of pack_id on public.beegame_resource_elements
for each row execute function public.beegame_sync_resource_pack_element_count();

-- Rename a Resource folder and all dependent logical paths atomically. The
-- Resource server calls this service-only RPC instead of coordinating
-- independent REST updates for folders, elements, and storage metadata.
create or replace function public.beegame_rename_resource_folder(
  p_pack_id text,
  p_folder_id text,
  p_name text
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  target_folder public.beegame_resource_folders%rowtype;
  parent_path text;
  old_path text;
  new_path text;
begin
  if nullif(btrim(p_pack_id), '') is null or nullif(btrim(p_folder_id), '') is null then
    raise exception 'Pack id and folder id are required' using errcode = '22023';
  end if;
  if p_name is null or nullif(btrim(p_name), '') is null
     or strpos(p_name, '/') > 0 or strpos(p_name, chr(92)) > 0 then
    raise exception 'Folder name is invalid' using errcode = '22023';
  end if;

  select folder.* into target_folder
  from public.beegame_resource_folders folder
  where folder.id = p_folder_id and folder.pack_id = p_pack_id
  for update;
  if not found then return null; end if;

  if target_folder.parent_id is not null then
    select parent.path into parent_path
    from public.beegame_resource_folders parent
    where parent.id = target_folder.parent_id and parent.pack_id = p_pack_id;
    if parent_path is null then
      raise exception 'Parent folder is invalid' using errcode = '22023';
    end if;
  end if;

  old_path := target_folder.path;
  new_path := coalesce(parent_path || '/', '') || btrim(p_name);
  if exists (
    select 1
    from public.beegame_resource_folders folder
    where folder.pack_id = p_pack_id
      and folder.id <> p_folder_id
      and folder.path = new_path
  ) then
    raise exception 'Folder path already exists' using errcode = '23505';
  end if;

  -- Match updateLogicalPath's ready-object contract before changing any
  -- metadata. A missing, cross-Pack, non-R2, non-resource, pending, or
  -- deleted reference aborts the whole transaction instead of silently
  -- leaving storage and metadata on different paths.
  perform 1
  from public.beegame_resource_elements element
  where element.pack_id = p_pack_id
    and (element.path = old_path or left(element.path, length(old_path) + 1) = old_path || '/')
  for update;

  perform 1
  from public.beegame_storage_objects object
  where object.id in (
    select element.storage_object_id
    from public.beegame_resource_elements element
    where element.pack_id = p_pack_id
      and (element.path = old_path or left(element.path, length(old_path) + 1) = old_path || '/')
  )
  for update;

  if exists (
    select 1
    from public.beegame_resource_elements element
    left join public.beegame_storage_objects object
      on object.id = element.storage_object_id
     and object.scope_type = 'pack'
     and object.pack_id = p_pack_id
     and object.provider = 'r2'
     and object.object_kind = 'resource_element'
     and object.status = 'ready'
     and object.deleted_at is null
    where element.pack_id = p_pack_id
      and (element.path = old_path or left(element.path, length(old_path) + 1) = old_path || '/')
      and object.id is null
  ) then
    raise exception 'Ready R2 Resource object not found';
  end if;

  -- Capture the old element paths before changing them. Updating the storage
  -- metadata in this same transaction keeps R2 logical paths and resource
  -- metadata from observing different prefixes.
  with moved_elements as materialized (
    select element.storage_object_id, element.path
    from public.beegame_resource_elements element
    where element.pack_id = p_pack_id
      and (element.path = old_path or left(element.path, length(old_path) + 1) = old_path || '/')
  )
  update public.beegame_storage_objects object
  set logical_path = case
        when moved_elements.path = old_path then new_path
        else new_path || substr(moved_elements.path, length(old_path) + 1)
      end,
      updated_at = now()
  from moved_elements
  where object.id = moved_elements.storage_object_id
    and object.scope_type = 'pack'
    and object.pack_id = p_pack_id
    and object.provider = 'r2'
    and object.object_kind = 'resource_element'
    and object.status = 'ready'
    and object.deleted_at is null;

  update public.beegame_resource_folders folder
  set name = case when folder.id = p_folder_id then btrim(p_name) else folder.name end,
      path = case
        when folder.path = old_path then new_path
        else new_path || substr(folder.path, length(old_path) + 1)
      end,
      updated_at = now()
  where folder.pack_id = p_pack_id
    and (folder.path = old_path or left(folder.path, length(old_path) + 1) = old_path || '/');

  update public.beegame_resource_elements element
  set path = case
        when element.path = old_path then new_path
        else new_path || substr(element.path, length(old_path) + 1)
      end,
      updated_at = now()
  where element.pack_id = p_pack_id
    and (element.path = old_path or left(element.path, length(old_path) + 1) = old_path || '/');

  select folder.* into target_folder
  from public.beegame_resource_folders folder
  where folder.id = p_folder_id and folder.pack_id = p_pack_id;
  return jsonb_build_object(
    'id', target_folder.id,
    'pack_id', target_folder.pack_id,
    'name', target_folder.name,
    'parent_id', target_folder.parent_id,
    'path', target_folder.path
  );
end;
$$;

revoke all on function public.beegame_rename_resource_folder(text, text, text) from public, anon, authenticated;
grant execute on function public.beegame_rename_resource_folder(text, text, text) to service_role;
