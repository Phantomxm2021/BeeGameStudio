begin;

alter table public.beegame_portal_games
  add column play_count bigint not null default 0 check (play_count >= 0),
  add column featured_position smallint unique check (featured_position between 1 and 5);

create table public.beegame_portal_events (
  project_id text not null references public.beegame_portal_games(project_id) on delete cascade,
  kind text not null check (kind in ('visit','play','banner_impression','banner_click')),
  dedup_id uuid not null,
  visitor_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (project_id, kind, dedup_id)
);
create index beegame_portal_events_time on public.beegame_portal_events(created_at, project_id);
create table public.beegame_portal_event_limits (
  client_hash text not null,
  minute timestamptz not null,
  requests integer not null,
  primary key (client_hash, minute)
);
alter table public.beegame_portal_events enable row level security;
alter table public.beegame_portal_event_limits enable row level security;
revoke all on public.beegame_portal_events, public.beegame_portal_event_limits from anon, authenticated;

-- Only the Portal Worker may ingest events. Counters and deduplication are atomic.
create function public.beegame_portal_record_event(
  p_project_id text, p_kind text, p_dedup_id uuid, p_visitor_id uuid, p_client_hash text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare n integer; inserted integer; total bigint;
begin
  if p_kind is null or p_kind not in ('visit','play','banner_impression','banner_click')
     or p_dedup_id is null or p_visitor_id is null or p_client_hash !~ '^[a-f0-9]{64}$' or p_client_hash is null then
    raise exception 'Invalid event' using errcode = '22023';
  end if;
  if not exists (select 1 from public.beegame_portal_games where project_id = p_project_id) then
    return jsonb_build_object('status','not_found');
  end if;
  insert into public.beegame_portal_event_limits values(p_client_hash, date_trunc('minute', now()), 1)
    on conflict (client_hash, minute) do update set requests = least(public.beegame_portal_event_limits.requests + 1, 121)
    returning requests into n;
  if n > 120 then return jsonb_build_object('status','rate_limited'); end if;
  delete from public.beegame_portal_event_limits where minute < now() - interval '2 hours';
  insert into public.beegame_portal_events(project_id, kind, dedup_id, visitor_id)
    values(p_project_id, p_kind, p_dedup_id, p_visitor_id) on conflict do nothing;
  get diagnostics inserted = row_count;
  if p_kind = 'play' and inserted = 1 then
    update public.beegame_portal_games set play_count = play_count + 1 where project_id = p_project_id;
  end if;
  select play_count into total from public.beegame_portal_games where project_id = p_project_id;
  return jsonb_build_object('status','ok','counted',inserted = 1,'playCount',total);
end;
$$;
revoke all on function public.beegame_portal_record_event(text,text,uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.beegame_portal_record_event(text,text,uuid,uuid,text) to service_role;

create function public.beegame_admin_portal_featured(p_project_ids text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
begin
  if not public.beegame_is_platform_owner() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_project_ids is null or cardinality(p_project_ids) > 5
     or exists(select 1 from unnest(p_project_ids) id where id is null)
     or (select count(distinct id) from unnest(p_project_ids) id) <> cardinality(p_project_ids) then
    raise exception 'Choose up to five distinct published games' using errcode = '22023';
  end if;
  -- Serialize the small editorial list without locking event ingestion.
  perform pg_advisory_xact_lock(hashtext('beegame_portal_featured'));
  perform 1 from public.beegame_portal_games where project_id = any(p_project_ids) for key share;
  if (select count(*) from public.beegame_portal_games where project_id = any(p_project_ids)) <> cardinality(p_project_ids) then
    raise exception 'A selected game is no longer published' using errcode = '22023';
  end if;
  update public.beegame_portal_games set featured_position = null where featured_position is not null;
  update public.beegame_portal_games g set featured_position = s.position
    from unnest(p_project_ids) with ordinality as s(id,position) where g.project_id = s.id;
  return jsonb_build_object('projectIds',p_project_ids);
end;
$$;
revoke all on function public.beegame_admin_portal_featured(text[]) from public, anon;
grant execute on function public.beegame_admin_portal_featured(text[]) to authenticated;

create function public.beegame_admin_portal_overview(
  p_from date, p_to date, p_query text default '', p_page integer default 0, p_project_id text default null
) returns jsonb language plpgsql security definer set search_path = '' stable as $$
declare result jsonb;
begin
  if not public.beegame_is_platform_owner() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if p_from is null or p_to is null or p_to < p_from or p_to - p_from > 92 or p_page < 0 or p_page > 10000
     or p_page is null or length(coalesce(p_query,'')) > 100 then
    raise exception 'Invalid statistics range' using errcode = '22023';
  end if;
  with events as materialized (
    select * from public.beegame_portal_events
    where created_at >= p_from::timestamp at time zone 'UTC'
      and created_at < (p_to + 1)::timestamp at time zone 'UTC'
  ), metrics as (
    select project_id,
      count(*) filter(where kind='visit') as visits, count(*) filter(where kind='play') as plays,
      count(distinct visitor_id) filter(where kind in ('visit','play')) as visitors,
      count(*) filter(where kind='banner_impression') as impressions,
      count(*) filter(where kind='banner_click') as clicks
    from events group by project_id
  ), filtered_games as (
    select g.*, coalesce(m.visits,0) as visits, coalesce(m.plays,0) as plays,
      coalesce(m.visitors,0) as visitors, coalesce(m.impressions,0) as impressions, coalesce(m.clicks,0) as clicks
    from public.beegame_portal_games g left join metrics m using(project_id)
    where coalesce(p_query,'') = '' or strpos(lower(g.title || ' ' || g.author_name || ' ' || coalesce(g.public_description,'')),lower(p_query)) > 0
  ), selected_events as (
    select * from events where p_project_id is null or project_id = p_project_id
  ), daily as (
    select (created_at at time zone 'UTC')::date as day,
      count(*) filter(where kind='visit') as visits, count(*) filter(where kind='play') as plays,
      count(distinct visitor_id) filter(where kind in ('visit','play')) as visitors,
      count(*) filter(where kind='banner_impression') as impressions, count(*) filter(where kind='banner_click') as clicks
    from selected_events group by day
  )
  select jsonb_build_object(
    'games',coalesce((select jsonb_agg(to_jsonb(g) order by updated_at desc,project_id) from
      (select * from filtered_games order by updated_at desc,project_id limit 24 offset p_page * 24) g),'[]'::jsonb),
    'totalGames',(select count(*) from filtered_games),
    'featured',coalesce((select jsonb_agg(jsonb_build_object('project_id',project_id,'title',title,'public_description',public_description) order by featured_position)
      from public.beegame_portal_games where featured_position is not null),'[]'::jsonb),
    'totals',(select jsonb_build_object('visits',count(*) filter(where kind='visit'),'plays',count(*) filter(where kind='play'),
      'visitors',count(distinct visitor_id) filter(where kind in ('visit','play')),'impressions',count(*) filter(where kind='banner_impression'),
      'clicks',count(*) filter(where kind='banner_click')) from selected_events),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;
revoke all on function public.beegame_admin_portal_overview(date,date,text,integer,text) from public, anon;
grant execute on function public.beegame_admin_portal_overview(date,date,text,integer,text) to authenticated;
-- Keep project-level counters, events and recommendations when a failed release falls back.
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
    perform 1 from public.beegame_portal_games where deployment_id = new.id for update;
    if not found then return new; end if;
    select * into release from public.beegame_deployments
      where project_id = new.project_id and status = 'succeeded' and portal_published_at is not null
      order by portal_published_at desc, id desc limit 1;
    if not found then
      delete from public.beegame_portal_games where deployment_id = new.id;
      return new;
    end if;
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
    where new.status = 'failed' or excluded.updated_at >= public.beegame_portal_games.updated_at;
  return new;
end;
$$;
notify pgrst, 'reload schema';
commit;
