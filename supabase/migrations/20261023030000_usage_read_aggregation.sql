-- Keep usage summaries in the billing database so a dashboard read does not
-- fetch and reduce the complete per-event ledger on every request.
create index if not exists beegame_usage_events_user_created_idx
  on public.beegame_usage_events (user_id, created_at asc, id asc);

create or replace function public.beegame_usage_summary(
  p_user_id uuid,
  p_project_id text default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object(
    'events_count', count(*)::bigint,
    'prompt_tokens', coalesce(sum(prompt_tokens_delta), 0)::bigint,
    'completion_tokens', coalesce(sum(completion_tokens_delta), 0)::bigint,
    'cache_read_tokens', coalesce(sum(cache_read_tokens_delta), 0)::bigint,
    'cache_creation_tokens', coalesce(sum(cache_creation_tokens_delta), 0)::bigint,
    'total_tokens', coalesce(sum(total_tokens_delta), 0)::bigint,
    'weighted_tokens', coalesce(sum(weighted_tokens_delta), 0)::bigint,
    'credits_micro', coalesce(sum(credits_micro), 0)::bigint
  )
  from public.beegame_usage_events
  where user_id = p_user_id
    and (p_project_id is null or project_id = p_project_id)
    and (p_from is null or created_at >= p_from)
    and (p_to is null or created_at <= p_to);
$$;

revoke all on function public.beegame_usage_summary(uuid, text, timestamptz, timestamptz)
  from public, anon, authenticated;
grant execute on function public.beegame_usage_summary(uuid, text, timestamptz, timestamptz)
  to service_role;
