begin;

-- Pack/folder defaults remain available as editor provenance, but they must not
-- act as a second semantic source for Resource Library matching. Element-level
-- curation owns the tags used by candidate selection.
update public.beegame_resource_packs
set element_defaults = '{}'::jsonb,
    updated_at = now()
where element_defaults <> '{}'::jsonb;

update public.beegame_resource_folders
set element_defaults = '{}'::jsonb,
    updated_at = now()
where element_defaults <> '{}'::jsonb;

-- Do not manufacture semantic roles from the removed defaults. Elements that
-- still have no explicit override remain visible in the curation queue and are
-- excluded from matching until an evidence-backed decision is accepted.
update public.beegame_resource_elements
set usage_tags = '{}',
    usage_tags_mode = 'inherit',
    updated_at = now()
where usage_tags_mode = 'inherit';

commit;
