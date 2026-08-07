alter table public.beegame_resource_processing_jobs
  add column if not exists retry_of_job_id text references public.beegame_resource_processing_jobs(id) on delete set null;

create index if not exists beegame_resource_processing_jobs_retry_of_idx
  on public.beegame_resource_processing_jobs (retry_of_job_id);
