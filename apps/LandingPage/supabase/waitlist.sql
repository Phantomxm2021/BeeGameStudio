-- Public waitlist intake is intentionally insert-only. Keep this migration safe
-- to re-run in the Supabase SQL editor during setup and deployment.
-- IF NOT EXISTS protects fresh setup/re-runs; review and migrate any existing
-- waitlist_signups table separately if its schema or constraints are weaker.
create extension if not exists pgcrypto;

create table if not exists public.waitlist_signups (
  id uuid primary key default gen_random_uuid(),
  name text not null check (
    name = btrim(name)
    and char_length(name) between 1 and 80
  ),
  email text not null check (
    email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
  ),
  persona text not null check (persona in ('idea', 'creator', 'investor')),
  locale text not null check (locale in ('zh-CN', 'en', 'ja', 'ko')),
  source text not null default 'landing-page' check (source = 'landing-page'),
  created_at timestamptz not null default now(),
  constraint waitlist_signups_email_key unique (email)
);

-- Safe to re-run for fresh setup and existing tables with the same index shape.
create index if not exists waitlist_signups_created_at_idx
  on public.waitlist_signups (created_at desc);

alter table public.waitlist_signups enable row level security;

revoke all on table public.waitlist_signups from public, anon, authenticated;
grant insert (name, email, persona, locale, source)
  on table public.waitlist_signups
  to anon, authenticated;

drop policy if exists "public can join waitlist" on public.waitlist_signups;
create policy "public can join waitlist"
  on public.waitlist_signups
  for insert
  to anon, authenticated
  with check (
    name = btrim(name)
    and char_length(name) between 1 and 80
    and email = lower(btrim(email))
    and char_length(email) between 3 and 320
    and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and persona in ('idea', 'creator', 'investor')
    and locale in ('zh-CN', 'en', 'ja', 'ko')
    and source = 'landing-page'
  );
