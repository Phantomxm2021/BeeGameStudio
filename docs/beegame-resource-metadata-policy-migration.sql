begin;

alter table public.beegame_resource_packs
  add column if not exists element_defaults jsonb not null default '{}'::jsonb;

alter table public.beegame_resource_folders
  add column if not exists element_defaults jsonb not null default '{}'::jsonb;

alter table public.beegame_resource_elements
  add column if not exists usage_tags_mode text not null default 'inherit';

-- Existing non-empty tags were authored before inheritance existed and must
-- remain explicit overrides. Empty legacy rows become eligible to inherit.
update public.beegame_resource_elements
set usage_tags_mode = 'override'
where usage_tags_mode = 'inherit' and cardinality(usage_tags) > 0;

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_usage_tags_mode_check;
alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_usage_tags_mode_check
  check (usage_tags_mode in ('inherit', 'override', 'manual-only'));

alter table public.beegame_resource_packs
  drop constraint if exists beegame_resource_packs_element_defaults_check;
alter table public.beegame_resource_packs
  add constraint beegame_resource_packs_element_defaults_check
  check (jsonb_typeof(element_defaults) = 'object');

alter table public.beegame_resource_folders
  drop constraint if exists beegame_resource_folders_element_defaults_check;
alter table public.beegame_resource_folders
  add constraint beegame_resource_folders_element_defaults_check
  check (jsonb_typeof(element_defaults) = 'object');

commit;
