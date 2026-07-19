begin;

alter table public.beegame_resource_packs
  add column if not exists styles text[] not null default '{}';

update public.beegame_resource_packs
set styles = array(
  select btrim(value)
  from unnest(string_to_array(style, '/')) as value
  where btrim(value) <> ''
)
where cardinality(styles) = 0 and btrim(style) <> '';

create or replace view public.beegame_resource_pack_catalog
with (security_invoker = true)
as
select
  p.id as pack_id,
  p.version as pack_version,
  p.name as pack_name,
  p.style,
  case when cardinality(p.styles) > 0 then p.styles else array[p.style] end as styles,
  array(select jsonb_array_elements_text(p.game_types)) as game_types,
  p.dimension,
  p.primary_category,
  coalesce(array_agg(distinct e.category) filter (where e.id is not null), '{}') as categories,
  coalesce(p.tags, '{}') as tags,
  count(e.id)::integer as ready_element_count,
  coalesce(array_agg(distinct e.asset_kind) filter (where e.asset_kind is not null), '{}') as asset_kinds,
  coalesce(array(select distinct unnest(e2.usage_tags) from public.beegame_resource_elements e2 where e2.pack_id = p.id and e2.status = 'ready'), '{}') as usage_tags,
  coalesce(array(select distinct unnest(e3.capabilities) from public.beegame_resource_elements e3 where e3.pack_id = p.id and e3.status = 'ready'), '{}') as capabilities,
  coalesce(array_agg(distinct lower(reverse(split_part(reverse(e.path), '.', 1)))) filter (where e.id is not null and e.path like '%.%'), '{}') as formats,
  p.description,
  p.license,
  p.author,
  p.source,
  coalesce(p.compatible_engines, '{}') as compatible_engines
from public.beegame_resource_packs p
left join public.beegame_resource_elements e on e.pack_id = p.id and e.status = 'ready'
where p.status = 'published'
group by p.id;

commit;
