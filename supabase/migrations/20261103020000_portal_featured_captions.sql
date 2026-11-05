begin;

alter table public.beegame_portal_games
  add column featured_caption text not null default '' check (char_length(featured_caption) <= 240);

create function public.beegame_admin_portal_featured(p_recommendations jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare project_ids text[]; result jsonb;
begin
  if not public.beegame_is_platform_owner() then raise exception 'Forbidden' using errcode = '42501'; end if;
  if jsonb_typeof(p_recommendations) is distinct from 'array' then
    raise exception 'Expected a recommendation list' using errcode = '22023';
  end if;
  if jsonb_array_length(p_recommendations) > 5 or exists (
    select 1 from jsonb_array_elements(p_recommendations) item
    where jsonb_typeof(item) is distinct from 'object'
      or jsonb_typeof(item->'project_id') is distinct from 'string'
      or (item ? 'featured_caption' and jsonb_typeof(item->'featured_caption') is distinct from 'string')
      or char_length(coalesce(item->>'featured_caption','')) > 240
  ) then raise exception 'Choose up to five games with captions of at most 240 characters' using errcode = '22023'; end if;
  select coalesce(array_agg(item->>'project_id' order by position),'{}'::text[])
    into project_ids from jsonb_array_elements(p_recommendations) with ordinality as entry(item,position);
  result := public.beegame_admin_portal_featured(project_ids);
  update public.beegame_portal_games game set featured_caption = btrim(coalesce(item->>'featured_caption',''))
    from jsonb_array_elements(p_recommendations) item where game.project_id = item->>'project_id';
  return result;
end;
$$;
revoke all on function public.beegame_admin_portal_featured(jsonb) from public, anon;
grant execute on function public.beegame_admin_portal_featured(jsonb) to authenticated;

create or replace function public.beegame_admin_portal_overview(
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
    'featured',coalesce((select jsonb_agg(jsonb_build_object('project_id',project_id,'title',title,'public_description',public_description,'featured_caption',featured_caption) order by featured_position)
      from public.beegame_portal_games where featured_position is not null),'[]'::jsonb),
    'totals',(select jsonb_build_object('visits',count(*) filter(where kind='visit'),'plays',count(*) filter(where kind='play'),
      'visitors',count(distinct visitor_id) filter(where kind in ('visit','play')),'impressions',count(*) filter(where kind='banner_impression'),
      'clicks',count(*) filter(where kind='banner_click')) from selected_events),
    'daily',coalesce((select jsonb_agg(to_jsonb(d) order by day) from daily d),'[]'::jsonb)
  ) into result;
  return result;
end;
$$;

notify pgrst, 'reload schema';
commit;
