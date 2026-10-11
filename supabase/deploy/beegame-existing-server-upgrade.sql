-- BeeGame existing-server upgrade
--
-- Use only on an existing BeeGame database. Do not use this for an empty
-- Supabase project; use beegame-fresh-install.sql instead.
--
-- This script preserves values that later migrations clear or remove in
-- public.beegame_upgrade_backup_20260902. Keep that table until validation is
-- complete, then export or remove it manually under your retention policy.

begin;

create table if not exists public.beegame_upgrade_backup_20260902 (
  source_table text not null,
  record_id text not null,
  fields jsonb not null,
  backed_up_at timestamptz not null default now(),
  primary key (source_table, record_id)
);

-- The guards make the backup safe for databases at different migration stages.
do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_packs'
      and column_name = 'element_defaults'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_packs', id,
           jsonb_build_object('element_defaults', element_defaults)
    from public.beegame_resource_packs
    where element_defaults is not null
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_folders'
      and column_name = 'element_defaults'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_folders', id,
           jsonb_build_object('element_defaults', element_defaults)
    from public.beegame_resource_folders
    where element_defaults is not null
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_elements'
      and column_name = 'semantic_suggestion'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_elements', id,
           jsonb_build_object('semantic_suggestion', semantic_suggestion)
    from public.beegame_resource_elements
    where semantic_suggestion is not null
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_processing_jobs'
      and column_name = 'provider_batch_id'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_processing_jobs', id,
           jsonb_build_object('provider_batch_id', provider_batch_id)
    from public.beegame_resource_processing_jobs
    where provider_batch_id is not null
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_processing_jobs'
      and column_name = 'provider_batch_status'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_processing_jobs', id,
           jsonb_build_object('provider_batch_status', provider_batch_status)
    from public.beegame_resource_processing_jobs
    where provider_batch_status is not null
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;

  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'beegame_resource_elements'
      and column_name = 'usage_tags_mode'
  ) then
    insert into public.beegame_upgrade_backup_20260902 (source_table, record_id, fields)
    select 'beegame_resource_elements', id,
           jsonb_build_object(
             'usage_tags', usage_tags,
             'usage_tags_mode', usage_tags_mode
           )
    from public.beegame_resource_elements
    where usage_tags_mode = 'inherit'
    on conflict (source_table, record_id) do update
      set fields = public.beegame_upgrade_backup_20260902.fields || excluded.fields,
          backed_up_at = now();
  end if;
end $$;

commit;

-- BEGIN SOURCE: 20260806000000_resource_curation_semantic_suggestion.sql
alter table public.beegame_resource_elements
  add column if not exists semantic_suggestion jsonb;

comment on column public.beegame_resource_elements.semantic_suggestion is
  'Temporary administrator curation input. It is never used by catalog search or Workflow matching and is cleared when accepted or rejected.';
-- END SOURCE: 20260806000000_resource_curation_semantic_suggestion.sql

-- BEGIN SOURCE: 20260807000000_ai_resource_semantic_curation.sql
alter table public.beegame_resource_processing_jobs
  add column if not exists owner_id uuid,
  add column if not exists model_config_id text;

alter table public.beegame_resource_processing_jobs
  drop constraint if exists beegame_resource_processing_jobs_kind_check;

alter table public.beegame_resource_processing_jobs
  add constraint beegame_resource_processing_jobs_kind_check
  check (kind in ('inspect-elements', 'semantic-curate-elements'));

alter table public.beegame_resource_processing_items
  add column if not exists source_content_hash text,
  add column if not exists curator_revision text;

comment on column public.beegame_resource_processing_items.source_content_hash is
  'Content hash frozen when the durable processing item is created; semantic results must match it.';

comment on column public.beegame_resource_processing_items.curator_revision is
  'Semantic curator contract revision used for this item; accepted results are idempotent by hash and revision.';
-- END SOURCE: 20260807000000_ai_resource_semantic_curation.sql

-- BEGIN SOURCE: 20260807010000_resource_processing_usage.sql
alter table public.beegame_resource_processing_jobs
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  add column if not exists cache_creation_tokens bigint not null default 0 check (cache_creation_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists total_tokens bigint not null default 0 check (total_tokens >= 0),
  add column if not exists credits_micro bigint not null default 0 check (credits_micro >= 0);

alter table public.beegame_resource_processing_items
  add column if not exists input_tokens bigint not null default 0 check (input_tokens >= 0),
  add column if not exists cache_read_tokens bigint not null default 0 check (cache_read_tokens >= 0),
  add column if not exists cache_creation_tokens bigint not null default 0 check (cache_creation_tokens >= 0),
  add column if not exists output_tokens bigint not null default 0 check (output_tokens >= 0),
  add column if not exists total_tokens bigint not null default 0 check (total_tokens >= 0),
  add column if not exists credits_micro bigint not null default 0 check (credits_micro >= 0);

comment on column public.beegame_resource_processing_jobs.total_tokens is
  'Cumulative provider token usage across every processing item, including failed and retried calls.';

comment on column public.beegame_resource_processing_jobs.credits_micro is
  'Cumulative billed Credit in micro-credits across every processing item.';
-- END SOURCE: 20260807010000_resource_processing_usage.sql

-- BEGIN SOURCE: 20260807020000_resource_processing_batch_receipts.sql
alter table public.beegame_resource_processing_items
  add column if not exists batch_id text,
  add column if not exists batch_receipt_id text;

comment on column public.beegame_resource_processing_items.batch_id is
  'Stable durable identity of the semantic batch currently processing this item.';

comment on column public.beegame_resource_processing_items.batch_receipt_id is
  'Accepted batch acknowledgement shared by all items completed from one provider call.';
-- END SOURCE: 20260807020000_resource_processing_batch_receipts.sql

-- BEGIN SOURCE: 20260807030000_resource_semantic_analysis_mode.sql
alter table public.beegame_resource_processing_jobs
  add column if not exists analysis_mode text not null default 'missing'
  check (analysis_mode in ('missing', 'all'));

comment on column public.beegame_resource_processing_jobs.analysis_mode is
  'Durable semantic curation scope: missing labels only or all non-manual resources.';
-- END SOURCE: 20260807030000_resource_semantic_analysis_mode.sql

-- BEGIN SOURCE: 20260807040000_resource_element_semantic_ownership.sql
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
-- END SOURCE: 20260807040000_resource_element_semantic_ownership.sql

-- BEGIN SOURCE: 20260807050000_resource_catalog_selection_counts.sql
begin;

drop view if exists public.beegame_resource_pack_catalog;

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
-- END SOURCE: 20260807050000_resource_catalog_selection_counts.sql

-- BEGIN SOURCE: 20260807060000_resource_processing_retry_scope.sql
alter table public.beegame_resource_processing_jobs
  add column if not exists retry_of_job_id text references public.beegame_resource_processing_jobs(id) on delete set null;

create index if not exists beegame_resource_processing_jobs_retry_of_idx
  on public.beegame_resource_processing_jobs (retry_of_job_id);
-- END SOURCE: 20260807060000_resource_processing_retry_scope.sql

-- BEGIN SOURCE: 20260807061000_remove_resource_semantic_defaults.sql
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
-- END SOURCE: 20260807061000_remove_resource_semantic_defaults.sql

-- BEGIN SOURCE: 20260807070000_resource_processing_failure_diagnostics.sql
alter table public.beegame_resource_processing_items
  add column if not exists failure_stage text,
  add column if not exists failure_trace_id text;

alter table public.beegame_resource_processing_items
  drop constraint if exists beegame_resource_processing_items_failure_stage_check;

alter table public.beegame_resource_processing_items
  add constraint beegame_resource_processing_items_failure_stage_check
  check (
    failure_stage is null
    or failure_stage in ('runtime_transport', 'model_request', 'model_response', 'usage_billing')
  );

comment on column public.beegame_resource_processing_items.failure_stage is
  'Canonical stage that produced the latest durable processing failure.';

comment on column public.beegame_resource_processing_items.failure_trace_id is
  'Trace identifier for the external runtime failure; safe diagnostic only.';
-- END SOURCE: 20260807070000_resource_processing_failure_diagnostics.sql

-- BEGIN SOURCE: 20260808010000_remove_resource_semantic_suggestion.sql
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
-- END SOURCE: 20260808010000_remove_resource_semantic_suggestion.sql

-- BEGIN SOURCE: 20260808030000_remove_resource_provider_batch_state.sql
begin;

drop index if exists public.beegame_resource_processing_jobs_provider_batch_idx;

alter table public.beegame_resource_processing_jobs
  drop constraint if exists beegame_resource_processing_jobs_provider_batch_status_check;

alter table public.beegame_resource_processing_jobs
  drop column if exists provider_batch_id,
  drop column if exists provider_batch_status;

commit;
-- END SOURCE: 20260808030000_remove_resource_provider_batch_state.sql
