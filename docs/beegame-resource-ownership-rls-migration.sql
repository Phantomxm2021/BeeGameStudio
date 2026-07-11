-- Resource-library ownership boundaries. Apply after
-- beegame-resource-governance-migration.sql.
--
-- Service-role writes bypass RLS; this policy protects direct authenticated
-- access and keeps a Pack's rows and Storage prefix under the same owner.

create or replace function public.beegame_can_manage_resource_pack(target_pack_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.beegame_is_platform_owner()
      or exists (
        select 1 from public.beegame_resource_packs pack
        where pack.id = target_pack_id and pack.created_by = auth.uid()
      );
$$;

revoke execute on function public.beegame_can_manage_resource_pack(text) from public;
grant execute on function public.beegame_can_manage_resource_pack(text) to authenticated;

alter table public.beegame_resource_packs enable row level security;
alter table public.beegame_resource_elements enable row level security;
alter table public.beegame_resource_folders enable row level security;

drop policy if exists "resource Pack platform owner access" on public.beegame_resource_packs;
drop policy if exists "resource Pack owner access" on public.beegame_resource_packs;
create policy "resource Pack owner access" on public.beegame_resource_packs
  for all using (public.beegame_is_platform_owner() or created_by = auth.uid())
  with check (public.beegame_is_platform_owner() or created_by = auth.uid());

drop policy if exists "resource element platform owner access" on public.beegame_resource_elements;
drop policy if exists "resource element owner access" on public.beegame_resource_elements;
create policy "resource element owner access" on public.beegame_resource_elements
  for all using (public.beegame_can_manage_resource_pack(pack_id))
  with check (public.beegame_can_manage_resource_pack(pack_id));

drop policy if exists "resource folder platform owner access" on public.beegame_resource_folders;
drop policy if exists "resource folder owner access" on public.beegame_resource_folders;
create policy "resource folder owner access" on public.beegame_resource_folders
  for all using (public.beegame_can_manage_resource_pack(pack_id))
  with check (public.beegame_can_manage_resource_pack(pack_id));

drop policy if exists "resource dependency platform owner access" on public.beegame_resource_dependencies;
drop policy if exists "resource dependency owner access" on public.beegame_resource_dependencies;
create policy "resource dependency owner access" on public.beegame_resource_dependencies
  for all using (
    exists (select 1 from public.beegame_resource_elements element where element.id = element_id and public.beegame_can_manage_resource_pack(element.pack_id))
  ) with check (
    exists (select 1 from public.beegame_resource_elements element where element.id = element_id and public.beegame_can_manage_resource_pack(element.pack_id))
  );

drop policy if exists "beegame resource pack platform read" on storage.objects;
drop policy if exists "beegame resource pack platform write" on storage.objects;
drop policy if exists "beegame resource pack owner access" on storage.objects;
create policy "beegame resource pack owner access" on storage.objects
  for all using (
    bucket_id = 'beegame-resource-packs'
    and public.beegame_can_manage_resource_pack((storage.foldername(name))[1])
  ) with check (
    bucket_id = 'beegame-resource-packs'
    and public.beegame_can_manage_resource_pack((storage.foldername(name))[1])
  );
