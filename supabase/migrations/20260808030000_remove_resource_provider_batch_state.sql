begin;

drop index if exists public.beegame_resource_processing_jobs_provider_batch_idx;

alter table public.beegame_resource_processing_jobs
  drop constraint if exists beegame_resource_processing_jobs_provider_batch_status_check;

alter table public.beegame_resource_processing_jobs
  drop column if exists provider_batch_id,
  drop column if exists provider_batch_status;

commit;
