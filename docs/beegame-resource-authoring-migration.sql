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
