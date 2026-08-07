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
