-- Auxiliary model calls are request deltas; native agent turns remain session cumulative.
-- No historical usage, wallet balance or debit is rewritten.
create or replace function public.beegame_record_usage(
  p_user_id uuid, p_session_id text, p_turn_id text default null,
  p_project_id text default null, p_idempotency_key text default null,
  p_usage jsonb default '{}'::jsonb, p_metadata jsonb default '{}'::jsonb,
  p_pricing_version text default 'weighted-v1', p_usage_source text default 'runtime_snapshot'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  previous_row public.beegame_usage_events%rowtype;
  event_row public.beegame_usage_events%rowtype;
  duplicate_event boolean := false;
  reset_epoch boolean := false;
  current_prompt bigint := greatest(0, coalesce((p_usage->>'prompt_tokens')::bigint, 0));
  current_completion bigint := greatest(0, coalesce((p_usage->>'completion_tokens')::bigint, 0));
  current_cache_read bigint := greatest(0, coalesce((p_usage->>'cache_read_tokens')::bigint, 0));
  current_cache_creation bigint := greatest(0, coalesce((p_usage->>'cache_creation_tokens')::bigint, 0));
  current_total bigint := greatest(0, coalesce((p_usage->>'total_tokens')::bigint, 0));
  current_weighted bigint;
  delta_prompt bigint;
  delta_completion bigint;
  delta_cache_read bigint;
  delta_cache_creation bigint;
  delta_total bigint;
  delta_weighted bigint;
  cumulative_prompt bigint;
  cumulative_completion bigint;
  cumulative_cache_read bigint;
  cumulative_cache_creation bigint;
  cumulative_total bigint;
  cumulative_weighted bigint;
  cumulative_credits bigint;
begin
  if p_user_id is null or nullif(trim(p_session_id), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'User id, session id, and idempotency key are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then raise exception 'Forbidden'; end if;
  if p_usage_source not in ('runtime_snapshot', 'model_runtime_host') then
    raise exception 'Invalid usage source';
  end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_session_id));
  select * into event_row from public.beegame_usage_events
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if event_row.id is not null then
    duplicate_event := true;
  else
    select * into previous_row from public.beegame_usage_events
      where user_id = p_user_id and session_id = p_session_id
      order by created_at desc, id desc limit 1;
    -- The legacy sender retained its real cumulative snapshot in metadata.
    -- Change only the comparison baseline, never the persisted old charge.
    if p_usage_source = 'runtime_snapshot' and p_metadata->>'usageBasis' = 'session-cumulative-v1'
       and previous_row.id is not null and previous_row.usage_source = 'runtime_snapshot' then
      if jsonb_typeof(previous_row.metadata->'providerCumulativeUsage') is distinct from 'object' then
        raise exception 'Legacy runtime usage baseline is unknown; reconcile before resuming billing';
      end if;
      previous_row.prompt_tokens := (previous_row.metadata->'providerCumulativeUsage'->>'prompt_tokens')::bigint;
      previous_row.completion_tokens := (previous_row.metadata->'providerCumulativeUsage'->>'completion_tokens')::bigint;
      previous_row.cache_read_tokens := (previous_row.metadata->'providerCumulativeUsage'->>'cache_read_tokens')::bigint;
      previous_row.cache_creation_tokens := (previous_row.metadata->'providerCumulativeUsage'->>'cache_creation_tokens')::bigint;
      previous_row.total_tokens := (previous_row.metadata->'providerCumulativeUsage'->>'total_tokens')::bigint;
      if previous_row.prompt_tokens is null or previous_row.completion_tokens is null or previous_row.cache_read_tokens is null
         or previous_row.cache_creation_tokens is null or previous_row.total_tokens is null then
        raise exception 'Legacy runtime usage baseline is incomplete; reconcile before resuming billing';
      end if;
      previous_row.weighted_tokens := ceil((previous_row.prompt_tokens * 100 + previous_row.cache_read_tokens * 10
        + previous_row.cache_creation_tokens * 125 + previous_row.completion_tokens * 500)::numeric / 100)::bigint;
    end if;
    current_weighted := ceil((current_prompt * 100 + current_cache_read * 10 + current_cache_creation * 125 + current_completion * 500)::numeric / 100)::bigint;
    -- Auxiliary usage is per physical request; agent snapshots remain cumulative.
    reset_epoch := p_usage_source = 'model_runtime_host' or previous_row.id is null or
      current_prompt < previous_row.prompt_tokens or current_completion < previous_row.completion_tokens or
      current_cache_read < previous_row.cache_read_tokens or current_cache_creation < previous_row.cache_creation_tokens or
      current_total < previous_row.total_tokens;
    delta_prompt := case when reset_epoch then current_prompt else greatest(0, current_prompt - previous_row.prompt_tokens) end;
    delta_completion := case when reset_epoch then current_completion else greatest(0, current_completion - previous_row.completion_tokens) end;
    delta_cache_read := case when reset_epoch then current_cache_read else greatest(0, current_cache_read - previous_row.cache_read_tokens) end;
    delta_cache_creation := case when reset_epoch then current_cache_creation else greatest(0, current_cache_creation - previous_row.cache_creation_tokens) end;
    delta_total := case when reset_epoch then current_total else greatest(0, current_total - previous_row.total_tokens) end;
    delta_weighted := case when reset_epoch then current_weighted else greatest(0, current_weighted - previous_row.weighted_tokens) end;
    insert into public.beegame_usage_events (
      user_id, session_id, turn_id, project_id, idempotency_key, pricing_version, usage_source,
      prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
      prompt_tokens_delta, completion_tokens_delta, cache_read_tokens_delta, cache_creation_tokens_delta,
      total_tokens_delta, weighted_tokens, weighted_tokens_delta, credits_micro, metadata
    ) values (
      p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key,
      coalesce(nullif(trim(p_pricing_version), ''), 'weighted-v1'), p_usage_source,
      current_prompt, current_completion, current_cache_read, current_cache_creation, current_total,
      delta_prompt, delta_completion, delta_cache_read, delta_cache_creation, delta_total,
      current_weighted, delta_weighted, delta_weighted * 100, coalesce(p_metadata, '{}'::jsonb)
    ) returning * into event_row;
  end if;
  select coalesce(sum(prompt_tokens_delta), 0), coalesce(sum(completion_tokens_delta), 0),
    coalesce(sum(cache_read_tokens_delta), 0), coalesce(sum(cache_creation_tokens_delta), 0),
    coalesce(sum(total_tokens_delta), 0), coalesce(sum(weighted_tokens_delta), 0), coalesce(sum(credits_micro), 0)
  into cumulative_prompt, cumulative_completion, cumulative_cache_read, cumulative_cache_creation,
    cumulative_total, cumulative_weighted, cumulative_credits
  from public.beegame_usage_events where user_id = p_user_id and session_id = p_session_id;
  return jsonb_build_object(
    'duplicate', duplicate_event,
    'event', jsonb_build_object(
      'id', event_row.id, 'idempotency_key', event_row.idempotency_key,
      'user_id', event_row.user_id, 'session_id', event_row.session_id,
      'turn_id', event_row.turn_id, 'project_id', event_row.project_id,
      'pricing_version', event_row.pricing_version, 'usage_source', event_row.usage_source,
      'prompt_tokens', event_row.prompt_tokens, 'completion_tokens', event_row.completion_tokens,
      'cache_read_tokens', event_row.cache_read_tokens, 'cache_creation_tokens', event_row.cache_creation_tokens,
      'total_tokens', event_row.total_tokens, 'prompt_tokens_delta', event_row.prompt_tokens_delta,
      'completion_tokens_delta', event_row.completion_tokens_delta, 'cache_read_tokens_delta', event_row.cache_read_tokens_delta,
      'cache_creation_tokens_delta', event_row.cache_creation_tokens_delta, 'total_tokens_delta', event_row.total_tokens_delta,
      'weighted_tokens', event_row.weighted_tokens, 'weighted_tokens_delta', event_row.weighted_tokens_delta,
      'credits_micro', event_row.credits_micro, 'created_at', event_row.created_at, 'metadata', event_row.metadata
    ),
    'cumulative_usage', jsonb_build_object(
      'prompt_tokens', cumulative_prompt, 'completion_tokens', cumulative_completion,
      'cache_read_tokens', cumulative_cache_read, 'cache_creation_tokens', cumulative_cache_creation, 'total_tokens', cumulative_total
    ),
    'cumulative_weighted_tokens', cumulative_weighted, 'credits_micro', cumulative_credits
  );
end
$$;

create or replace function public.beegame_debit_realtime_usage(
  p_user_id uuid,
  p_session_id text,
  p_turn_id text default null,
  p_project_id text default null,
  p_idempotency_key text default null,
  p_usage jsonb default '{}'::jsonb,
  p_metadata jsonb default '{}'::jsonb,
  p_pricing_version text default 'weighted-v1',
  p_usage_source text default 'runtime_snapshot'
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  wallet_row public.beegame_usage_wallets%rowtype;
  debit_row public.beegame_usage_debit_events%rowtype;
  usage_row public.beegame_usage_events%rowtype;
  previous_usage_row public.beegame_usage_events%rowtype;
  result_payload jsonb;
  amount_micro bigint;
  prompt_tokens bigint := greatest(0, coalesce((p_usage->>'prompt_tokens')::bigint, 0));
  completion_tokens bigint := greatest(0, coalesce((p_usage->>'completion_tokens')::bigint, 0));
  cache_read_tokens bigint := greatest(0, coalesce((p_usage->>'cache_read_tokens')::bigint, 0));
  cache_creation_tokens bigint := greatest(0, coalesce((p_usage->>'cache_creation_tokens')::bigint, 0));
  weighted_tokens bigint;
  previous_weighted_tokens bigint := 0;
  reset_epoch boolean := false;
begin
  if p_user_id is null or nullif(trim(p_session_id), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'User id, session id, and idempotency key are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  select * into debit_row
  from public.beegame_usage_debit_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if debit_row.id is not null then
    return jsonb_set(debit_row.result, '{duplicate}', 'true'::jsonb);
  end if;

  select * into usage_row
  from public.beegame_usage_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  select * into wallet_row
  from public.beegame_usage_wallets
  where user_id = p_user_id
  for update;

  weighted_tokens := ceil((prompt_tokens * 100 + cache_read_tokens * 25 + cache_creation_tokens * 125 + completion_tokens * 500)::numeric / 100)::bigint;
  if usage_row.id is not null then
    amount_micro := usage_row.weighted_tokens_delta * 100;
  elsif p_usage_source = 'model_runtime_host' then
    -- Direct debit callers use the same per-request weights as record_usage.
    amount_micro := ceil((prompt_tokens * 100 + cache_read_tokens * 10 + cache_creation_tokens * 125 + completion_tokens * 500)::numeric / 100)::bigint * 100;
  else
    select * into previous_usage_row
    from public.beegame_usage_events
    where user_id = p_user_id and session_id = p_session_id
    order by created_at desc, id desc
    limit 1;
    if previous_usage_row.id is not null then
      reset_epoch := prompt_tokens < previous_usage_row.prompt_tokens or
        completion_tokens < previous_usage_row.completion_tokens or
        cache_read_tokens < previous_usage_row.cache_read_tokens or
        cache_creation_tokens < previous_usage_row.cache_creation_tokens or
        coalesce((p_usage->>'total_tokens')::bigint, 0) < previous_usage_row.total_tokens;
      previous_weighted_tokens := previous_usage_row.weighted_tokens;
    end if;
    amount_micro := case
      when reset_epoch or previous_usage_row.id is null then weighted_tokens * 100
      else greatest(0, weighted_tokens - previous_weighted_tokens) * 100
    end;
  end if;
  if wallet_row.included_credits_micro - wallet_row.consumed_credits_micro < amount_micro then
    raise exception 'Insufficient realtime usage credits';
  end if;

  result_payload := public.beegame_record_usage(
    p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key,
    p_usage, p_metadata, p_pricing_version, p_usage_source
  );
  insert into public.beegame_usage_debit_events (
    user_id, idempotency_key, amount_credits_micro, result
  ) values (
    p_user_id, p_idempotency_key, amount_micro, result_payload
  );
  update public.beegame_usage_wallets
  set consumed_credits_micro = consumed_credits_micro + amount_micro,
      updated_at = now()
  where user_id = p_user_id;
  return result_payload;
end
$$;
