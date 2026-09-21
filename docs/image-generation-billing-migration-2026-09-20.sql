-- Apply before enabling image generation. No existing wallet balance is changed.
begin;
alter table public.beegame_usage_wallets
  add column if not exists reserved_credits_micro bigint not null default 0;

-- Also protects concurrent/older text-debit writers which do not yet subtract holds.
-- Existing overdrawn wallets without holds keep their previous behavior.
alter table public.beegame_usage_wallets drop constraint if exists beegame_wallet_image_reservation;
alter table public.beegame_usage_wallets add constraint beegame_wallet_image_reservation
  check (reserved_credits_micro >= 0 and
    (reserved_credits_micro = 0 or consumed_credits_micro + reserved_credits_micro <= included_credits_micro));

create table if not exists public.beegame_image_charges (
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  request_id text not null,
  digest text not null,
  state text not null check (state in ('reserved', 'settled', 'released')),
  reserved_credits_micro bigint not null check (reserved_credits_micro > 0),
  charged_credits_micro bigint not null default 0 check (charged_credits_micro >= 0),
  metadata jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  primary key (user_id, project_id, request_id),
  check (charged_credits_micro <= reserved_credits_micro)
);
alter table public.beegame_image_charges enable row level security;
revoke all on public.beegame_image_charges from anon, authenticated;
grant all on public.beegame_image_charges to service_role;

create or replace function public.beegame_image_billing(
  p_user_id uuid, p_project_id text, p_request_id text, p_digest text,
  p_action text, p_amount bigint, p_budget bigint, p_metadata jsonb
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  charge public.beegame_image_charges%rowtype;
  wallet public.beegame_usage_wallets%rowtype;
  committed bigint;
  created boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service authorization required'; end if;
  if p_user_id is null or coalesce(length(trim(p_project_id)), 0) = 0
    or coalesce(length(trim(p_request_id)), 0) = 0 or coalesce(length(trim(p_digest)), 0) = 0
    or p_action is null or p_action not in ('reserve', 'settle', 'release')
    or p_amount is null or p_amount < 0 or p_budget is null or p_budget < 0
    or p_metadata is null or jsonb_typeof(p_metadata) <> 'object'
  then raise exception 'Invalid image billing request'; end if;
  -- Same user wallet lock as text billing, covering per-project budgets as well.
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  select * into charge from public.beegame_image_charges
    where user_id = p_user_id and project_id = p_project_id and request_id = p_request_id for update;
  if found then
    if charge.digest <> p_digest then raise exception 'Image request identity conflict'; end if;
    if p_action = 'reserve' then
      if p_amount <> charge.reserved_credits_micro then raise exception 'Reservation amount conflict'; end if;
      -- Existing terminal state is returned: it never authorizes another generation.
    elsif charge.state <> 'reserved' then
      if (p_action = 'settle' and (charge.state <> 'settled' or p_amount <> charge.charged_credits_micro))
        or (p_action = 'release' and (charge.state <> 'released' or p_amount <> 0))
      then raise exception 'Image settlement conflict'; end if;
    else
      if p_action = 'release' and p_amount <> 0 then raise exception 'Release amount must be zero'; end if;
      if p_amount > charge.reserved_credits_micro then raise exception 'Charge exceeds reserved amount'; end if;
      update public.beegame_usage_wallets set
        reserved_credits_micro = reserved_credits_micro - charge.reserved_credits_micro,
        consumed_credits_micro = consumed_credits_micro + p_amount, updated_at = now()
        where user_id = p_user_id;
      update public.beegame_image_charges set
        state = case when p_action = 'settle' then 'settled' else 'released' end,
        charged_credits_micro = p_amount, metadata = metadata || p_metadata, updated_at = now()
        where user_id = p_user_id and project_id = p_project_id and request_id = p_request_id
        returning * into charge;
    end if;
  else
    created := true;
    if p_action <> 'reserve' or p_amount <= 0 or p_budget < p_amount
      then raise exception 'Image reservation required'; end if;
    insert into public.beegame_usage_wallets (user_id) values (p_user_id) on conflict do nothing;
    select * into wallet from public.beegame_usage_wallets where user_id = p_user_id for update;
    if wallet.included_credits_micro - wallet.consumed_credits_micro - wallet.reserved_credits_micro < p_amount
      then raise exception 'Insufficient image credits'; end if;
    select coalesce(sum(case when state = 'reserved' then reserved_credits_micro else charged_credits_micro end), 0)
      into committed from public.beegame_image_charges where user_id = p_user_id and project_id = p_project_id;
    if committed + p_amount > p_budget then raise exception 'Image project budget exceeded'; end if;
    update public.beegame_usage_wallets set reserved_credits_micro = reserved_credits_micro + p_amount,
      updated_at = now() where user_id = p_user_id;
    insert into public.beegame_image_charges
      (user_id, project_id, request_id, digest, state, reserved_credits_micro, metadata)
      values (p_user_id, p_project_id, p_request_id, p_digest, 'reserved', p_amount, p_metadata)
      returning * into charge;
  end if;
  return jsonb_build_object('created', created, 'state', charge.state,
    'reservedCreditsMicro', charge.reserved_credits_micro, 'chargedCreditsMicro', charge.charged_credits_micro,
    'metadata', charge.metadata);
end;
$$;
revoke all on function public.beegame_image_billing(uuid,text,text,text,text,bigint,bigint,jsonb) from public, anon, authenticated;
grant execute on function public.beegame_image_billing(uuid,text,text,text,text,bigint,bigint,jsonb) to service_role;
-- Credit grants must not write a stale consumed amount over concurrent settlement.
create or replace function public.beegame_increment_credit_wallet(p_user_id uuid, p_amount bigint)
returns jsonb language plpgsql security definer set search_path = public as $$
declare wallet public.beegame_usage_wallets%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then raise exception 'Service authorization required'; end if;
  if p_user_id is null or p_amount is null or p_amount <= 0 then raise exception 'Invalid credit grant'; end if;
  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':usage-wallet'));
  insert into public.beegame_usage_wallets (user_id) values (p_user_id) on conflict do nothing;
  update public.beegame_usage_wallets set included_credits_micro = included_credits_micro + p_amount,
    updated_at = now() where user_id = p_user_id returning * into wallet;
  return to_jsonb(wallet);
end;
$$;
revoke all on function public.beegame_increment_credit_wallet(uuid,bigint) from public, anon, authenticated;
grant execute on function public.beegame_increment_credit_wallet(uuid,bigint) to service_role;
commit;
