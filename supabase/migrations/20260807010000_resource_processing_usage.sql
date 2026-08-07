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
