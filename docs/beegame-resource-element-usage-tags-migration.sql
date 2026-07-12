-- First-class semantic capabilities for AI resource selection.
-- Existing elements intentionally start unclassified: do not infer meaning
-- from names, folders, or file formats. Classify them in the Pack inspector.

alter table public.beegame_resource_elements
  add column if not exists usage_tags text[] not null default '{}';

-- Carry forward only tags that were already explicitly set in the former
-- element specs field and already belong to the canonical vocabulary. This is
-- a data-shape migration, not an inference pass: names, file paths, folders,
-- formats, Pack tags, and categories are never used to classify an element.
with legacy_usage_tags as (
  select
    id,
    array(select jsonb_array_elements_text(specs -> 'usageTags')) as tags
  from public.beegame_resource_elements
  where usage_tags = '{}'
    and jsonb_typeof(specs -> 'usageTags') = 'array'
), valid_legacy_usage_tags as (
  select id, tags
  from legacy_usage_tags
  where not exists (
    select 1
    from unnest(tags) as tag
    where tag not in (
      'character', 'npc', 'creature',
      'weapon-equipment', 'prop', 'vehicle',
      'building', 'environment', 'terrain', 'vegetation',
      'scene', 'level-map', 'tile',
      'ui', 'icon', 'effect',
      'combat', 'interaction', 'narrative',
      'music', 'sound-effect', 'ambient-audio', 'voice'
    )
  )
)
update public.beegame_resource_elements as element
set usage_tags = legacy.tags
from valid_legacy_usage_tags as legacy
where element.id = legacy.id;

create index if not exists beegame_resource_elements_usage_tags_idx
  on public.beegame_resource_elements using gin (usage_tags);

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_usage_tags_check;

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_usage_tags_check
  check (usage_tags <@ array[
    'character', 'npc', 'creature',
    'weapon-equipment', 'prop', 'vehicle',
    'building', 'environment', 'terrain', 'vegetation',
    'scene', 'level-map', 'tile',
    'ui', 'icon', 'effect',
    'combat', 'interaction', 'narrative',
    'music', 'sound-effect', 'ambient-audio', 'voice'
  ]::text[]);
