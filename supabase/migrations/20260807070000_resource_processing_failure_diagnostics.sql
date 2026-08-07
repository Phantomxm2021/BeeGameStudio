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
