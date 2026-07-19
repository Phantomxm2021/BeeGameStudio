begin;

create table if not exists public.beegame_resource_processing_jobs (
  id text primary key,
  pack_id text not null references public.beegame_resource_packs(id) on delete cascade,
  kind text not null check (kind in ('inspect-elements')),
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  total_items integer not null default 0 check (total_items >= 0),
  completed_items integer not null default 0 check (completed_items >= 0),
  failed_items integer not null default 0 check (failed_items >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_resource_processing_items (
  id text primary key,
  job_id text not null references public.beegame_resource_processing_jobs(id) on delete cascade,
  element_id text not null references public.beegame_resource_elements(id) on delete cascade,
  status text not null check (status in ('queued', 'running', 'completed', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts >= 0),
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (job_id, element_id)
);

create index if not exists beegame_resource_processing_jobs_pack_status_idx
  on public.beegame_resource_processing_jobs (pack_id, status, created_at desc);
create index if not exists beegame_resource_processing_items_job_status_idx
  on public.beegame_resource_processing_items (job_id, status, created_at);

alter table public.beegame_resource_processing_jobs enable row level security;
alter table public.beegame_resource_processing_items enable row level security;

drop policy if exists "resource processing job platform owner access" on public.beegame_resource_processing_jobs;
create policy "resource processing job platform owner access" on public.beegame_resource_processing_jobs
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "resource processing item platform owner access" on public.beegame_resource_processing_items;
create policy "resource processing item platform owner access" on public.beegame_resource_processing_items
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

commit;
