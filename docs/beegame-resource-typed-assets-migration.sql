-- Platform-neutral logical-asset identity, inspected contents and external relations.
-- Existing rows remain valid; administrators can classify them incrementally.

alter table public.beegame_resource_elements
  add column if not exists asset_kind text,
  add column if not exists capabilities text[] not null default '{}',
  add column if not exists content_profile jsonb,
  add column if not exists relations jsonb not null default '[]'::jsonb;

-- Preserve values from the superseded mixed ontology without guessing a new
-- technical type. Administrators can reclassify them from the recorded fact.
update public.beegame_resource_elements
set specs = jsonb_set(specs, '{legacyAssetKind}', to_jsonb(asset_kind), true),
    asset_kind = null
where asset_kind in ('character', 'prop', 'environment-module', 'prefab', 'ui-component', 'ui-kit');

-- The existing file kind is an objective technical fact, so these mappings do
-- not infer subject matter from names or folders. Ambiguous kinds remain null.
update public.beegame_resource_elements
set asset_kind = case kind
  when 'model' then 'model'
  when 'audio' then 'audio-clip'
  when 'font' then 'font'
  when 'image' then 'image'
  when 'material' then 'material'
  when 'sprite' then 'sprite'
  else null
end
where asset_kind is null
  and kind in ('model', 'audio', 'font', 'image', 'material', 'sprite');

update public.beegame_resource_elements
set specs = jsonb_set(specs, '{legacyRootCapabilities}', to_jsonb(
      array(select unnest(capabilities) intersect select unnest(array['root-motion', 'loopable', 'retargetable']::text[]))
    ), true),
    capabilities = array(select unnest(capabilities) except select unnest(array['root-motion', 'loopable', 'retargetable']::text[]))
where capabilities && array['root-motion', 'loopable', 'retargetable']::text[];

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_asset_kind_check;

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_asset_kind_check
  check (asset_kind is null or asset_kind in (
    'image', 'texture', 'sprite', 'sprite-sheet', 'sprite-atlas',
    'frame-animation', 'tileset', 'tilemap',
    'mesh', 'model', 'scene', 'material', 'rig', 'animation-clip', 'animation-library',
    'ui-document', 'ui-screen',
    'font', 'audio-clip', 'audio-cue', 'audio-bank', 'music', 'ambience', 'voice',
    'vfx', 'shader', 'physical-material', 'collider', 'input-profile', 'data'
  ));

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_capabilities_check;

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_capabilities_check
  check (capabilities <@ array[
    'alpha', 'tileable', 'nine-slice', 'sprite-slicing', 'frame-sequence',
    'atlas-regions', 'tile-collision',
    'skinned', 'rigged', 'contains-animations', 'contains-materials',
    'contains-textures', 'morph-targets',
    'lod', 'collision', 'navigation', 'modular', 'connection-points',
    'scene-layout', 'spawn-markers', 'objective-markers',
    'ui-states', 'focus-navigation', 'safe-area',
    'particle', 'flipbook', 'trail',
    'spatial-audio', 'loop-points', 'audio-variants',
    'physical-properties', 'ragdoll',
    'input-actions', 'touch-controls', 'gamepad-controls'
  ]::text[]);

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_content_profile_check;

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_content_profile_check
  check (
    content_profile is null or (
      jsonb_typeof(content_profile) = 'object'
      and content_profile ?& array['packaging', 'components', 'inspection']
      and content_profile->>'packaging' in ('self-contained', 'external-dependencies', 'unknown')
      and jsonb_typeof(content_profile->'components') = 'array'
      and jsonb_typeof(content_profile->'inspection') = 'object'
      and content_profile->'inspection' ?& array['status', 'source']
      and content_profile->'inspection'->>'status' in ('complete', 'partial', 'unavailable')
      and content_profile->'inspection'->>'source' in ('server', 'client', 'admin')
    )
  );

create or replace function public.beegame_valid_resource_relations(value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) relation
      where jsonb_typeof(relation) <> 'object'
         or coalesce(relation->>'kind', '') not in (
           'uses-texture', 'uses-material', 'uses-rig', 'animation-for',
           'collision-for', 'lod-of', 'variant-of', 'component-of',
           'audio-for', 'vfx-for'
         )
         or coalesce(relation->>'targetElementId', '') = ''
         or (relation ? 'role' and coalesce(relation->>'role', '') = '')
         or (relation ? 'required' and jsonb_typeof(relation->'required') <> 'boolean')
    );
$$;

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_relations_check;

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_relations_check
  check (public.beegame_valid_resource_relations(relations));

create index if not exists beegame_resource_elements_asset_kind_idx
  on public.beegame_resource_elements (pack_id, asset_kind);

create index if not exists beegame_resource_elements_capabilities_idx
  on public.beegame_resource_elements using gin (capabilities);

create index if not exists beegame_resource_elements_relations_idx
  on public.beegame_resource_elements using gin (relations);
