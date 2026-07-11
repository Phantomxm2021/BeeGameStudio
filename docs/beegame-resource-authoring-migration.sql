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
