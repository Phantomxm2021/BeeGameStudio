begin;

-- Pack/folder defaults remain available as editor provenance, but they must not
-- act as a second semantic source for Resource Library matching. Element-level
-- curation owns the tags used by candidate selection.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_packs'
      and column_name = 'element_defaults'
  ) then
    update public.beegame_resource_packs
    set element_defaults = '{}'::jsonb,
        updated_at = now()
    where element_defaults <> '{}'::jsonb;
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_folders'
      and column_name = 'element_defaults'
  ) then
    update public.beegame_resource_folders
    set element_defaults = '{}'::jsonb,
        updated_at = now()
    where element_defaults <> '{}'::jsonb;
  end if;
end $$;

-- Do not manufacture semantic roles from the removed defaults. Elements that
-- still have no explicit override remain visible in the curation queue and are
-- excluded from matching until an evidence-backed decision is accepted.
update public.beegame_resource_elements
set usage_tags = '{}',
    usage_tags_mode = 'inherit',
    updated_at = now()
where usage_tags_mode = 'inherit';

commit;
