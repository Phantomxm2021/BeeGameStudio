-- Resource library governance. Apply after beegame-supabase-schema.sql and
-- beegame-resource-authoring-migration.sql.

alter table public.beegame_resource_packs
  add column if not exists created_by uuid references auth.users(id) on delete set null,
  add column if not exists archived_at timestamptz;

create index if not exists beegame_resource_packs_created_by_idx
  on public.beegame_resource_packs (created_by, status, updated_at desc);

create table if not exists public.beegame_resource_audit_events (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid references auth.users(id) on delete set null,
  pack_id text references public.beegame_resource_packs(id) on delete set null,
  element_id text references public.beegame_resource_elements(id) on delete set null,
  action text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists beegame_resource_audit_events_pack_created_idx
  on public.beegame_resource_audit_events (pack_id, created_at desc);

alter table public.beegame_resource_audit_events enable row level security;

drop policy if exists "resource audit platform owner read" on public.beegame_resource_audit_events;
create policy "resource audit platform owner read" on public.beegame_resource_audit_events
  for select using (public.beegame_is_platform_owner());

-- The resource API writes through service-role credentials after resolving the
-- caller server-side. Direct browser writes remain denied by RLS.
revoke insert, update, delete on public.beegame_resource_audit_events from anon, authenticated;
