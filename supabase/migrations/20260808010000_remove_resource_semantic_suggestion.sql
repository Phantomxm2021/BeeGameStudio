begin;

drop view if exists public.beegame_resource_pack_catalog;

alter table public.beegame_resource_elements
  drop column if exists semantic_suggestion;

create view public.beegame_resource_pack_catalog
with (security_invoker = true)
as
with selectable_elements as (
  select
    e.id,
    e.pack_id,
    e.status,
    e.usage_tags_mode,
    e.usage_tags,
    e.asset_kind,
    e.specs,
    e.dependencies,
    e.dependency_bindings,
    e.relations,
    e.category,
    e.capabilities,
    e.path
  from public.beegame_resource_elements e
  where e.status = 'ready'
    and e.usage_tags_mode = 'override'
    and cardinality(e.usage_tags) > 0
    and e.asset_kind is not null
    and length(coalesce(e.specs ->> 'contentHash', '')) = 64
    and not exists (
      select 1
      from jsonb_array_elements_text(e.dependencies) dependency_id
      left join public.beegame_resource_elements dependency
        on dependency.id = dependency_id
      where dependency.id is null or dependency.status <> 'ready'
    )
    and not exists (
      select 1
      from jsonb_array_elements(e.dependency_bindings) binding
      left join public.beegame_resource_elements dependency
        on dependency.id = binding ->> 'dependencyElementId'
      where dependency.id is null or dependency.status <> 'ready'
    )
    and not exists (
      select 1
      from jsonb_array_elements(e.relations) relation
      left join public.beegame_resource_elements target
        on target.id = relation ->> 'targetElementId'
      where coalesce(relation ->> 'required', 'true') = 'true'
        and (target.id is null or target.status <> 'ready')
    )
)
select
  p.id as pack_id,
  p.version as pack_version,
  p.name as pack_name,
  p.styles,
  array(select jsonb_array_elements_text(p.game_types)) as game_types,
  p.dimension,
  p.primary_category,
  coalesce(array_agg(distinct e.category) filter (where e.id is not null), '{}') as categories,
  coalesce(p.tags, '{}') as tags,
  count(e.id)::integer as ready_element_count,
  coalesce(array_agg(distinct e.asset_kind) filter (where e.asset_kind is not null), '{}') as asset_kinds,
  coalesce(array(select distinct unnest(e2.usage_tags) from selectable_elements e2 where e2.pack_id = p.id), '{}') as usage_tags,
  coalesce(array(select distinct unnest(e3.capabilities) from selectable_elements e3 where e3.pack_id = p.id), '{}') as capabilities,
  coalesce(array_agg(distinct lower(reverse(split_part(reverse(e.path), '.', 1)))) filter (where e.id is not null and e.path like '%.%'), '{}') as formats,
  p.description,
  p.license,
  p.author,
  p.source,
  coalesce(p.compatible_engines, '{}') as compatible_engines
from public.beegame_resource_packs p
left join selectable_elements e on e.pack_id = p.id
where p.status = 'published'
group by p.id;

commit;
