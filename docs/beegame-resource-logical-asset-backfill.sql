-- Run only when beegame-resource-typed-assets-migration.sql was already
-- applied before its objective technical-kind backfill was added.
--
-- This migration does not classify characters, weapons, environments,
-- animation purposes, styles, or other semantic meaning. It maps only the
-- existing technical `kind` field and leaves ambiguous rows for Admin review.

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
