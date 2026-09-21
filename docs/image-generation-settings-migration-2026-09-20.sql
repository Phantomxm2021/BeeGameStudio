-- Separate from generally readable platform settings: encrypted secrets remain admin-only.
create table if not exists public.beegame_image_generation_settings (
  id text primary key check (id = 'platform'),
  config jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.beegame_image_generation_settings enable row level security;
revoke all on public.beegame_image_generation_settings from anon;
grant select, insert, update, delete on public.beegame_image_generation_settings to authenticated;
grant all on public.beegame_image_generation_settings to service_role;
drop policy if exists "image generation platform owner" on public.beegame_image_generation_settings;
create policy "image generation platform owner" on public.beegame_image_generation_settings
  for all to authenticated using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());
