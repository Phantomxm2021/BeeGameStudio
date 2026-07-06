-- BeeGame invitation gate migration.
-- Run after docs/beegame-supabase-schema.sql. This keeps the registration gate
-- inside Supabase using tables, RPC functions, and auth.users triggers.

create extension if not exists pgcrypto;

create table if not exists public.beegame_invitation_settings (
  id boolean primary key default true check (id),
  required boolean not null default false,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

insert into public.beegame_invitation_settings (id, required)
values (true, false)
on conflict (id) do nothing;

create table if not exists public.beegame_invitations (
  id uuid primary key default gen_random_uuid(),
  code_hash text not null unique,
  label text not null default 'Invitation',
  enabled boolean not null default true,
  max_uses integer check (max_uses is null or max_uses > 0),
  used_count integer not null default 0 check (used_count >= 0),
  expires_at timestamptz,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.beegame_invitation_redemptions (
  user_id uuid primary key references auth.users(id) on delete cascade,
  invitation_id uuid not null references public.beegame_invitations(id) on delete restrict,
  redeemed_at timestamptz not null default now()
);

create table if not exists public.beegame_oauth_invitation_nonces (
  nonce text primary key,
  invitation_id uuid not null references public.beegame_invitations(id) on delete cascade,
  expires_at timestamptz not null,
  consumed_by uuid references auth.users(id) on delete set null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);

create or replace function public.beegame_invitation_code_hash(p_code text)
returns text
language sql
immutable
as $$
  select encode(digest(trim(coalesce(p_code, '')), 'sha256'), 'hex')
$$;

create or replace function public.beegame_invitation_required()
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select coalesce((select required from public.beegame_invitation_settings where id = true), false)
$$;

create or replace function public.beegame_public_invitation_settings()
returns jsonb
language sql
security definer
set search_path = public
stable
as $$
  select jsonb_build_object('required', public.beegame_invitation_required())
$$;

create or replace function public.beegame_find_usable_invitation(p_code text)
returns uuid
language sql
security definer
set search_path = public
stable
as $$
  select i.id
  from public.beegame_invitations i
  where i.code_hash = public.beegame_invitation_code_hash(p_code)
    and i.enabled = true
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.used_count < i.max_uses)
  limit 1
$$;

create or replace function public.beegame_validate_invitation_code(p_code text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select public.beegame_find_usable_invitation(p_code) is not null
$$;

create or replace function public.beegame_admin_list_invitations()
returns jsonb
language plpgsql
security definer
set search_path = public
stable
as $$
declare
  result jsonb;
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'label', i.label,
    'enabled', i.enabled,
    'maxUses', i.max_uses,
    'usedCount', i.used_count,
    'expiresAt', i.expires_at,
    'createdBy', i.created_by,
    'createdAt', i.created_at,
    'updatedAt', i.updated_at
  ) order by i.created_at desc), '[]'::jsonb)
  into result
  from public.beegame_invitations i;

  return result;
end
$$;

create or replace function public.beegame_admin_save_invitation_settings(p_required boolean)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;

  insert into public.beegame_invitation_settings (id, required, updated_by, updated_at)
  values (true, coalesce(p_required, false), auth.uid(), now())
  on conflict (id) do update
  set required = excluded.required,
      updated_by = excluded.updated_by,
      updated_at = now();

  return public.beegame_public_invitation_settings();
end
$$;

create or replace function public.beegame_admin_create_invitation(
  p_code text,
  p_label text default null,
  p_max_uses integer default null,
  p_expires_at timestamptz default null
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  created public.beegame_invitations%rowtype;
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;
  if nullif(trim(coalesce(p_code, '')), '') is null then
    raise exception 'Invitation code is required';
  end if;
  if p_max_uses is not null and p_max_uses < 1 then
    raise exception 'maxUses must be greater than zero';
  end if;

  insert into public.beegame_invitations (
    code_hash,
    label,
    max_uses,
    expires_at,
    created_by
  ) values (
    public.beegame_invitation_code_hash(p_code),
    coalesce(nullif(trim(coalesce(p_label, '')), ''), 'Invitation'),
    p_max_uses,
    p_expires_at,
    auth.uid()
  )
  returning * into created;

  return jsonb_build_object(
    'id', created.id,
    'label', created.label,
    'enabled', created.enabled,
    'maxUses', created.max_uses,
    'usedCount', created.used_count,
    'expiresAt', created.expires_at,
    'createdBy', created.created_by,
    'createdAt', created.created_at,
    'updatedAt', created.updated_at
  );
exception
  when unique_violation then
    raise exception 'Invitation code already exists';
end
$$;

create or replace function public.beegame_admin_update_invitation(
  p_id uuid,
  p_label text default null,
  p_enabled boolean default null,
  p_max_uses integer default null,
  p_clear_max_uses boolean default false,
  p_expires_at timestamptz default null,
  p_clear_expires_at boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  updated public.beegame_invitations%rowtype;
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;

  update public.beegame_invitations
  set label = coalesce(nullif(trim(coalesce(p_label, '')), ''), label),
      enabled = coalesce(p_enabled, enabled),
      max_uses = case when p_clear_max_uses then null else coalesce(p_max_uses, max_uses) end,
      expires_at = case when p_clear_expires_at then null else coalesce(p_expires_at, expires_at) end,
      updated_at = now()
  where id = p_id
  returning * into updated;

  if updated.id is null then
    raise exception 'Invitation not found';
  end if;

  return jsonb_build_object(
    'id', updated.id,
    'label', updated.label,
    'enabled', updated.enabled,
    'maxUses', updated.max_uses,
    'usedCount', updated.used_count,
    'expiresAt', updated.expires_at,
    'createdBy', updated.created_by,
    'createdAt', updated.created_at,
    'updatedAt', updated.updated_at
  );
end
$$;

create or replace function public.beegame_admin_delete_invitation(p_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  deleted_count integer;
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;

  delete from public.beegame_invitations
  where id = p_id
    and not exists (
      select 1 from public.beegame_invitation_redemptions r
      where r.invitation_id = p_id
    );
  get diagnostics deleted_count = row_count;
  return jsonb_build_object('deleted', deleted_count > 0);
end
$$;

create or replace function public.beegame_redeem_invitation_for_user(
  p_user_id uuid,
  p_code text default null,
  p_invitation_id uuid default null
)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  target_invitation public.beegame_invitations%rowtype;
begin
  if p_user_id is null then
    return false;
  end if;
  if exists (select 1 from public.beegame_invitation_redemptions where user_id = p_user_id) then
    return true;
  end if;

  select *
  into target_invitation
  from public.beegame_invitations i
  where (p_invitation_id is not null and i.id = p_invitation_id)
     or (p_invitation_id is null and i.code_hash = public.beegame_invitation_code_hash(p_code))
  for update;

  if target_invitation.id is null then
    return false;
  end if;
  if not target_invitation.enabled then
    return false;
  end if;
  if target_invitation.expires_at is not null and target_invitation.expires_at <= now() then
    return false;
  end if;
  if target_invitation.max_uses is not null and target_invitation.used_count >= target_invitation.max_uses then
    return false;
  end if;

  update public.beegame_invitations
  set used_count = used_count + 1,
      updated_at = now()
  where id = target_invitation.id;

  insert into public.beegame_invitation_redemptions (user_id, invitation_id)
  values (p_user_id, target_invitation.id)
  on conflict (user_id) do nothing;

  return true;
end
$$;

create or replace function public.beegame_create_oauth_invitation_nonce(p_code text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  invitation_id uuid;
  nonce text;
begin
  invitation_id := public.beegame_find_usable_invitation(p_code);
  if invitation_id is null then
    raise exception 'Invalid invitation code';
  end if;

  nonce := encode(gen_random_bytes(24), 'hex');
  insert into public.beegame_oauth_invitation_nonces (nonce, invitation_id, expires_at)
  values (nonce, invitation_id, now() + interval '10 minutes');
  return nonce;
end
$$;

create or replace function public.beegame_redeem_oauth_invitation(p_nonce text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  current_user_id uuid;
  nonce_row public.beegame_oauth_invitation_nonces%rowtype;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  select *
  into nonce_row
  from public.beegame_oauth_invitation_nonces
  where nonce = nullif(trim(coalesce(p_nonce, '')), '')
  for update;

  if nonce_row.nonce is null or nonce_row.expires_at <= now() or nonce_row.consumed_at is not null then
    raise exception 'Invalid invitation nonce';
  end if;

  if not public.beegame_redeem_invitation_for_user(current_user_id, null, nonce_row.invitation_id) then
    raise exception 'Invalid invitation code';
  end if;

  update public.beegame_oauth_invitation_nonces
  set consumed_by = current_user_id,
      consumed_at = now()
  where nonce = nonce_row.nonce;

  update auth.users
  set raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) ||
    jsonb_build_object('beegame_invitation_redeemed_at', now())
  where id = current_user_id;

  return jsonb_build_object('ok', true);
end
$$;

create or replace function public.beegame_user_has_invitation(p_user_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1 from public.beegame_invitation_redemptions r
    where r.user_id = p_user_id
  )
$$;

create or replace function public.beegame_handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  created_workspace_id uuid;
  canonical_account_id uuid;
  profile_name text;
  profile_avatar_url text;
  initial_role text;
  invited_platform_owner boolean;
begin
  invited_platform_owner := exists (
    select 1
    from public.beegame_platform_owner_invites i
    where lower(i.email) = lower(new.email)
      and (i.claimed_user_id is null or i.claimed_user_id = new.id)
  );

  if public.beegame_invitation_required()
     and not invited_platform_owner
     and coalesce(new.raw_app_meta_data->>'beegame_role', '') <> 'owner'
     and not public.beegame_user_has_invitation(new.id) then
    if nullif(new.raw_user_meta_data->>'beegame_invitation_code', '') is not null then
      if not public.beegame_redeem_invitation_for_user(
        new.id,
        new.raw_user_meta_data->>'beegame_invitation_code',
        null
      ) then
        raise exception 'Invalid invitation code';
      end if;
    elsif coalesce(new.raw_app_meta_data->>'provider', 'email') = 'email' then
      raise exception 'Invitation code is required';
    else
      return new;
    end if;
  end if;
  profile_name := coalesce(
    nullif(new.raw_user_meta_data->>'display_name', ''),
    nullif(new.raw_user_meta_data->>'full_name', ''),
    nullif(new.raw_user_meta_data->>'name', ''),
    nullif(new.raw_user_meta_data->>'user_name', ''),
    nullif(split_part(new.email, '@', 1), '')
  );
  profile_avatar_url := coalesce(
    nullif(new.raw_user_meta_data->>'avatar_url', ''),
    nullif(new.raw_user_meta_data->>'picture', ''),
    nullif(new.raw_user_meta_data->>'image', ''),
    nullif(new.raw_user_meta_data->>'photo_url', '')
  );
  initial_role := case
    when new.raw_app_meta_data->>'beegame_role' = 'owner' or invited_platform_owner then 'owner'
    else 'developer'
  end;
  canonical_account_id := new.id;
  if nullif(new.email, '') is not null and new.email_confirmed_at is not null then
    select l.account_id
    into canonical_account_id
    from public.beegame_account_links l
    where lower(l.email) = lower(new.email)
    order by
      case when l.account_id = l.user_id then 0 else 1 end,
      l.updated_at asc,
      l.account_id::text asc
    limit 1;
    canonical_account_id := coalesce(canonical_account_id, new.id);
  end if;

  insert into public.beegame_account_links (user_id, account_id, email)
  values (new.id, canonical_account_id, coalesce(new.email, new.id::text))
  on conflict (user_id) do update
  set account_id = excluded.account_id,
      email = excluded.email,
      updated_at = now();

  insert into public.beegame_profiles (user_id, display_name, email, avatar_url)
  values (new.id, profile_name, new.email, profile_avatar_url)
  on conflict (user_id) do update
  set display_name = coalesce(public.beegame_profiles.display_name, excluded.display_name),
      email = coalesce(excluded.email, public.beegame_profiles.email),
      avatar_url = coalesce(public.beegame_profiles.avatar_url, excluded.avatar_url),
      updated_at = now();

  insert into public.beegame_workspaces (name, owner_id)
  values (
    coalesce(profile_name, 'BeeGame Workspace'),
    new.id
  )
  on conflict (owner_id) do update
  set updated_at = now()
  returning id into created_workspace_id;

  insert into public.beegame_workspace_members (workspace_id, user_id, role)
  values (created_workspace_id, new.id, initial_role)
  on conflict (workspace_id, user_id) do update
  set role = case
    when new.raw_app_meta_data->>'beegame_role' = 'owner' or invited_platform_owner then 'owner'
    else excluded.role
  end;

  if invited_platform_owner then
    update public.beegame_platform_owner_invites
    set claimed_user_id = new.id,
        claimed_at = coalesce(claimed_at, now())
    where lower(email) = lower(new.email)
      and (claimed_user_id is null or claimed_user_id = new.id);
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (canonical_account_id)
  on conflict (user_id) do nothing;

  return new;
end
$$;

drop trigger if exists beegame_after_auth_user_created on auth.users;
create trigger beegame_after_auth_user_created
  after insert or update of email, email_confirmed_at, raw_user_meta_data, raw_app_meta_data on auth.users
  for each row execute function public.beegame_handle_new_user();

alter table public.beegame_invitation_settings enable row level security;
alter table public.beegame_invitations enable row level security;
alter table public.beegame_invitation_redemptions enable row level security;
alter table public.beegame_oauth_invitation_nonces enable row level security;

drop policy if exists "invitation settings platform owner access" on public.beegame_invitation_settings;
create policy "invitation settings platform owner access" on public.beegame_invitation_settings
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "invitation platform owner access" on public.beegame_invitations;
create policy "invitation platform owner access" on public.beegame_invitations
  for all using (public.beegame_is_platform_owner())
  with check (public.beegame_is_platform_owner());

drop policy if exists "invitation redemption owner read" on public.beegame_invitation_redemptions;
create policy "invitation redemption owner read" on public.beegame_invitation_redemptions
  for select using (user_id = auth.uid() or public.beegame_is_platform_owner());

drop policy if exists "oauth invitation nonce platform owner read" on public.beegame_oauth_invitation_nonces;
create policy "oauth invitation nonce platform owner read" on public.beegame_oauth_invitation_nonces
  for select using (public.beegame_is_platform_owner());

revoke execute on function public.beegame_public_invitation_settings() from public;
grant execute on function public.beegame_public_invitation_settings() to anon, authenticated;

revoke execute on function public.beegame_validate_invitation_code(text) from public;
grant execute on function public.beegame_validate_invitation_code(text) to anon, authenticated;

revoke execute on function public.beegame_create_oauth_invitation_nonce(text) from public;
grant execute on function public.beegame_create_oauth_invitation_nonce(text) to anon, authenticated;

revoke execute on function public.beegame_redeem_oauth_invitation(text) from public;
grant execute on function public.beegame_redeem_oauth_invitation(text) to authenticated;

revoke execute on function public.beegame_admin_list_invitations() from public;
revoke execute on function public.beegame_admin_save_invitation_settings(boolean) from public;
revoke execute on function public.beegame_admin_create_invitation(text,text,integer,timestamptz) from public;
revoke execute on function public.beegame_admin_update_invitation(uuid,text,boolean,integer,boolean,timestamptz,boolean) from public;
revoke execute on function public.beegame_admin_delete_invitation(uuid) from public;
grant execute on function public.beegame_admin_list_invitations() to authenticated;
grant execute on function public.beegame_admin_save_invitation_settings(boolean) to authenticated;
grant execute on function public.beegame_admin_create_invitation(text,text,integer,timestamptz) to authenticated;
grant execute on function public.beegame_admin_update_invitation(uuid,text,boolean,integer,boolean,timestamptz,boolean) to authenticated;
grant execute on function public.beegame_admin_delete_invitation(uuid) to authenticated;
