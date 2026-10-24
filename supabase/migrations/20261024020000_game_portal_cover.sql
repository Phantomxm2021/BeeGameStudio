-- Creator-supplied release covers follow the same publication and rollback projection.
begin;
alter table public.beegame_deployments add column public_cover_url text check (char_length(public_cover_url) <= 2048);
alter table public.beegame_portal_games add column public_cover_url text check (char_length(public_cover_url) <= 2048);

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
    (project_id, owner_id, deployment_id, title, author_name, game_url, published_at, updated_at, public_description, public_cover_url)
    values (release.project_id, release.owner_id, release.id, project_title, coalesce(author_title, 'BGS Creator'),
      release.url, release.portal_published_at, release.portal_published_at, coalesce(release.public_description, ''), release.public_cover_url)
    on conflict (project_id) do update set
      deployment_id = excluded.deployment_id, title = excluded.title,
      author_name = excluded.author_name, game_url = excluded.game_url,
      updated_at = excluded.updated_at, public_description = excluded.public_description, public_cover_url = excluded.public_cover_url
    where excluded.updated_at >= public.beegame_portal_games.updated_at;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
