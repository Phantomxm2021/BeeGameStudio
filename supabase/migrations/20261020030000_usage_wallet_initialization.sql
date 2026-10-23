-- Initialize first-use wallets and debit only the authoritative recorded delta.
-- Existing usage/debit rows and balances are preserved by this migration.
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
  result_payload jsonb;
  amount_micro bigint;
  reserved_micro bigint;
begin
  if p_user_id is null or nullif(trim(p_session_id), '') is null or nullif(trim(p_idempotency_key), '') is null then
    raise exception 'User id, session id, and idempotency key are required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then raise exception 'Forbidden'; end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  select * into debit_row from public.beegame_usage_debit_events
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if debit_row.id is not null then
    return jsonb_set(debit_row.result, '{duplicate}', 'true'::jsonb);
  end if;

  insert into public.beegame_usage_wallets (user_id) values (p_user_id) on conflict do nothing;
  select * into wallet_row from public.beegame_usage_wallets where user_id = p_user_id for update;
  -- Supports deployments preceding the optional image-reservation column too.
  reserved_micro := coalesce((to_jsonb(wallet_row)->>'reserved_credits_micro')::bigint, 0);

  -- The ledger owns counter baselines and pricing. A direct debit registers its
  -- usage in the same transaction; insufficient credit rolls that insert back.
  result_payload := public.beegame_record_usage(
    p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key,
    p_usage, p_metadata, p_pricing_version, p_usage_source
  );
  select * into strict usage_row from public.beegame_usage_events
    where user_id = p_user_id and idempotency_key = p_idempotency_key;
  amount_micro := usage_row.credits_micro;
  if wallet_row.included_credits_micro - wallet_row.consumed_credits_micro - reserved_micro < amount_micro then
    raise exception 'Insufficient realtime usage credits';
  end if;

  insert into public.beegame_usage_debit_events (user_id, idempotency_key, amount_credits_micro, result)
    values (p_user_id, p_idempotency_key, amount_micro, result_payload);
  update public.beegame_usage_wallets
    set consumed_credits_micro = consumed_credits_micro + amount_micro, updated_at = now()
    where user_id = p_user_id;
  return result_payload;
end
$$;
