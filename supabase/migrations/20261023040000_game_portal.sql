-- Explicit public projection. Existing deployments are not backfilled: publishing
-- a new version is the author's consent to listing it in the Portal.
begin;
alter table public.beegame_deployments add column if not exists portal_published_at timestamptz;
create table if not exists public.beegame_portal_games (
  project_id text primary key references public.beegame_projects(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,
  deployment_id text not null references public.beegame_deployments(id) on delete cascade,
  title text not null,
  author_name text not null,
  game_url text not null,
  published_at timestamptz not null,
  updated_at timestamptz not null
);
create index if not exists beegame_portal_games_updated on public.beegame_portal_games(updated_at desc, project_id);
alter table public.beegame_portal_games enable row level security;
-- Browsers cannot write the projection, and it contains no private project data.
revoke all on public.beegame_portal_games from anon, authenticated;
grant select on public.beegame_portal_games to anon, authenticated;
create policy portal_public_read on public.beegame_portal_games for select to anon, authenticated using (true);

create or replace function public.beegame_project_portal_release() returns trigger
language plpgsql security definer set search_path = '' as $$
declare project_title text; author_title text; release public.beegame_deployments%rowtype;
begin
  if new.project_id is null then return new; end if;
  if new.status = 'succeeded' and new.portal_published_at is not null then
    release := new;
  elsif new.status = 'failed' then
    -- Also covers a final persistence response or local write failing after the
    -- database committed. Restore the prior verified public release atomically.
    delete from public.beegame_portal_games where deployment_id = new.id;
    if not found then return new; end if;
    select * into release from public.beegame_deployments
      where project_id = new.project_id and status = 'succeeded' and portal_published_at is not null
      order by portal_published_at desc, id desc limit 1;
    if not found then return new; end if;
  else return new;
  end if;
  select name into project_title from public.beegame_projects
    where id = release.project_id and owner_id = release.owner_id;
  if project_title is null then raise exception 'Portal project owner mismatch'; end if;
  select coalesce(nullif(btrim(raw_user_meta_data->>'display_name'), ''),
    nullif(btrim(raw_user_meta_data->>'full_name'), ''), nullif(btrim(raw_user_meta_data->>'name'), ''),
    nullif(btrim(raw_user_meta_data->>'username'), ''), 'BGS Creator') into author_title
    from auth.users where id = release.owner_id;
  insert into public.beegame_portal_games
    (project_id, owner_id, deployment_id, title, author_name, game_url, published_at, updated_at)
    values (release.project_id, release.owner_id, release.id, project_title, coalesce(author_title, 'BGS Creator'),
      release.url, release.portal_published_at, release.portal_published_at)
    on conflict (project_id) do update set
      deployment_id = excluded.deployment_id, title = excluded.title,
      author_name = excluded.author_name, game_url = excluded.game_url,
      updated_at = excluded.updated_at
    where excluded.updated_at >= public.beegame_portal_games.updated_at;
  return new;
end;
$$;
revoke all on function public.beegame_project_portal_release() from public;
create trigger beegame_project_portal_release after insert or update of status, portal_published_at
  on public.beegame_deployments for each row execute function public.beegame_project_portal_release();
notify pgrst, 'reload schema';
commit;
