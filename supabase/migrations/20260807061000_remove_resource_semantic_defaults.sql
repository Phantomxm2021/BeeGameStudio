begin;

alter table public.beegame_resource_packs
  drop column if exists element_defaults;

alter table public.beegame_resource_folders
  drop column if exists element_defaults;

update public.beegame_resource_elements
set usage_tags = '{}',
    usage_tags_mode = 'inherit',
    updated_at = now()
where usage_tags_mode = 'inherit';

commit;
