alter table public.beegame_resource_processing_jobs
  add column if not exists analysis_mode text not null default 'missing'
  check (analysis_mode in ('missing', 'all'));

comment on column public.beegame_resource_processing_jobs.analysis_mode is
  'Durable semantic curation scope: missing labels only or all non-manual resources.';
