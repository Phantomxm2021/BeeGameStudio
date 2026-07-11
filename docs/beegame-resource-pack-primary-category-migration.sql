-- Adds the resource Pack primary category contract without changing categories or elements.

alter table public.beegame_resource_packs
  add column if not exists primary_category text;

update public.beegame_resource_packs
set primary_category = case
  when (
    select count(distinct category.value)
    from jsonb_array_elements_text(
      case when jsonb_typeof(categories) = 'array' then categories else '[]'::jsonb end
    ) as category(value)
    where category.value in ('ui', 'audio', 'fonts', 'vfx', 'scenes')
  ) = 1
  then case
    when categories ? 'ui' then 'ui-kit'
    when categories ? 'audio' then 'audio'
    when categories ? 'fonts' then 'fonts'
    when categories ? 'vfx' then 'vfx'
    when categories ? 'scenes' then 'world-scene'
  end
  else 'mixed'
end
where primary_category is null;

alter table public.beegame_resource_packs
  alter column primary_category set default 'mixed',
  alter column primary_category set not null;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'beegame_resource_packs_primary_category_check'
      and conrelid = 'public.beegame_resource_packs'::regclass
  ) then
    alter table public.beegame_resource_packs
      add constraint beegame_resource_packs_primary_category_check
      check (primary_category in ('2d-art', '3d-assets', 'animation-rig', 'ui-kit', 'vfx', 'audio', 'fonts', 'world-scene', 'mixed'));
  end if;
end
$$;
