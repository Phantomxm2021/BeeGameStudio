alter table public.beegame_resource_processing_jobs
  add column if not exists provider_batch_id text,
  add column if not exists provider_batch_status text;

alter table public.beegame_resource_processing_jobs
  drop constraint if exists beegame_resource_processing_jobs_provider_batch_status_check;

alter table public.beegame_resource_processing_jobs
  add constraint beegame_resource_processing_jobs_provider_batch_status_check
  check (provider_batch_status is null or provider_batch_status in ('submitting', 'processing', 'ended', 'unknown'));

create index if not exists beegame_resource_processing_jobs_provider_batch_idx
  on public.beegame_resource_processing_jobs (provider_batch_id)
  where provider_batch_id is not null and status in ('queued', 'running');

comment on column public.beegame_resource_processing_jobs.provider_batch_id is
  'Durable native provider Batch identity. Recovery polls this id and never silently submits a second Batch.';

comment on column public.beegame_resource_processing_jobs.provider_batch_status is
  'Native provider Batch lifecycle. unknown is an ambiguous submission state and must not be resubmitted automatically.';
