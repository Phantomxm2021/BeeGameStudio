


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE SCHEMA IF NOT EXISTS "public";


ALTER SCHEMA "public" OWNER TO "pg_database_owner";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE OR REPLACE FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(
    (
      select account_id
      from public.beegame_account_links
      where user_id = p_user_id
      limit 1
    ),
    p_user_id
  )
$$;


ALTER FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "public"."beegame_project_revisions" (
    "id" "uuid" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "snapshot_storage_object_id" "uuid" NOT NULL,
    "workspace_path" "text" NOT NULL,
    "source_revision" "text" NOT NULL,
    "status" "text" NOT NULL,
    "failure_reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "activated_at" timestamp with time zone,
    CONSTRAINT "beegame_project_revisions_status_check" CHECK (("status" = ANY (ARRAY['materializing'::"text", 'active'::"text", 'superseded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."beegame_project_revisions" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") RETURNS SETOF "public"."beegame_project_revisions"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  target public.beegame_project_revisions;
begin
  select * into target
  from public.beegame_project_revisions
  where id = p_revision_id and status = 'materializing'
  for update;

  if target.id is null then
    raise exception 'Project revision is not materializing';
  end if;

  update public.beegame_projects
  set root_path = target.workspace_path,
      updated_at = now()
  where id = target.project_id and owner_id = target.owner_id;

  if not found then
    raise exception 'Project revision owner mismatch';
  end if;

  update public.beegame_project_revisions
  set status = 'superseded', updated_at = now()
  where project_id = target.project_id and id <> target.id and status = 'active';

  update public.beegame_project_revisions
  set status = 'active', activated_at = now(), updated_at = now(), failure_reason = null
  where id = target.id
  returning * into target;

  insert into public.beegame_audit_events (actor_id, project_id, action, metadata)
  values (
    target.owner_id,
    target.project_id,
    'project.snapshot.restored',
    jsonb_build_object(
      'targetType', 'project_revision',
      'targetId', target.id,
      'snapshotStorageObjectId', target.snapshot_storage_object_id,
      'sourceRevision', target.source_revision
    )
  );

  return next target;
end
$$;


ALTER FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text" DEFAULT NULL::"text", "p_max_uses" integer DEFAULT NULL::integer, "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    code,
    code_hash,
    label,
    max_uses,
    expires_at,
    created_by
  ) values (
    trim(p_code),
    public.beegame_invitation_code_hash(p_code),
    coalesce(nullif(trim(coalesce(p_label, '')), ''), trim(p_code)),
    p_max_uses,
    p_expires_at,
    auth.uid()
  )
  returning * into created;

  return jsonb_build_object(
    'id', created.id,
    'code', created.code,
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


ALTER FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text", "p_max_uses" integer, "p_expires_at" timestamp with time zone) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_admin_list_invitations"() RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  result jsonb;
begin
  if not public.beegame_is_platform_owner() then
    raise exception 'Forbidden';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'code', i.code,
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


ALTER FUNCTION "public"."beegame_admin_list_invitations"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text" DEFAULT NULL::"text", "p_enabled" boolean DEFAULT NULL::boolean, "p_max_uses" integer DEFAULT NULL::integer, "p_clear_max_uses" boolean DEFAULT false, "p_expires_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_clear_expires_at" boolean DEFAULT false) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
    'code', updated.code,
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


ALTER FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text", "p_enabled" boolean, "p_max_uses" integer, "p_clear_max_uses" boolean, "p_expires_at" timestamp with time zone, "p_clear_expires_at" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_append_confirmed_brief_revision"("p_owner_id" "uuid", "p_project_id" "text", "p_origin_session_id" "text", "p_schema_version" integer, "p_content" "jsonb", "p_content_digest" "text", "p_idempotency_key" "text", "p_expected_current_brief_id" "uuid") RETURNS TABLE("id" "uuid", "owner_id" "uuid", "project_id" "text", "origin_session_id" "text", "revision" integer, "schema_version" integer, "content" "jsonb", "content_digest" "text", "idempotency_key" "text", "supersedes_brief_id" "uuid", "created_at" timestamp with time zone, "previous_brief_id" "uuid", "idempotent" boolean)
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
declare
  current_head public.beegame_confirmed_brief_heads;
  existing_revision public.beegame_confirmed_brief_revisions;
  inserted_revision public.beegame_confirmed_brief_revisions;
  next_revision integer;
begin
  if p_owner_id is null or nullif(trim(p_project_id), '') is null
    or nullif(trim(p_idempotency_key), '') is null
    or p_schema_version is null or p_schema_version < 1
    or p_content is null or jsonb_typeof(p_content) <> 'object'
    or nullif(trim(p_content_digest), '') is null then
    raise exception using errcode = '22023';
  end if;

  -- Serializes first writes as well as head replacement without relying on a
  -- missing-row lock. The key is project-scoped, not content- or user-derived.
  perform pg_advisory_xact_lock(hashtextextended(p_project_id, 0));

  if not exists (
    select 1 from public.beegame_projects project
    where project.id = p_project_id and project.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0002';
  end if;

  if p_origin_session_id is not null and not exists (
    select 1 from public.beegame_sessions session
    where session.id = p_origin_session_id
      and session.project_id = p_project_id
      and session.owner_id = p_owner_id
  ) then
    raise exception using errcode = 'P0002';
  end if;

  select * into existing_revision
  from public.beegame_confirmed_brief_revisions brief
  where brief.owner_id = p_owner_id
    and brief.project_id = p_project_id
    and brief.idempotency_key = p_idempotency_key;

  if existing_revision.id is not null then
    if existing_revision.content_digest <> p_content_digest then
      raise exception using errcode = '23505';
    end if;
    return query select
      existing_revision.id,
      existing_revision.owner_id,
      existing_revision.project_id,
      existing_revision.origin_session_id,
      existing_revision.revision,
      existing_revision.schema_version,
      existing_revision.content,
      existing_revision.content_digest,
      existing_revision.idempotency_key,
      existing_revision.supersedes_brief_id,
      existing_revision.created_at,
      existing_revision.supersedes_brief_id,
      true;
    return;
  end if;

  select * into current_head
  from public.beegame_confirmed_brief_heads head
  where head.project_id = p_project_id and head.owner_id = p_owner_id
  for update;

  if p_expected_current_brief_id is distinct from current_head.current_brief_id then
    raise exception using errcode = '40001';
  end if;

  select coalesce(max(brief.revision), 0) + 1 into next_revision
  from public.beegame_confirmed_brief_revisions brief
  where brief.project_id = p_project_id;

  insert into public.beegame_confirmed_brief_revisions (
    project_id,
    owner_id,
    origin_session_id,
    revision,
    schema_version,
    content,
    content_digest,
    idempotency_key,
    supersedes_brief_id
  ) values (
    p_project_id,
    p_owner_id,
    p_origin_session_id,
    next_revision,
    p_schema_version,
    p_content,
    p_content_digest,
    p_idempotency_key,
    current_head.current_brief_id
  ) returning * into inserted_revision;

  insert into public.beegame_confirmed_brief_heads (
    project_id,
    owner_id,
    current_brief_id,
    updated_at
  ) values (
    p_project_id,
    p_owner_id,
    inserted_revision.id,
    now()
  ) on conflict on constraint beegame_confirmed_brief_heads_pkey do update
    set current_brief_id = excluded.current_brief_id,
        updated_at = excluded.updated_at
    where public.beegame_confirmed_brief_heads.owner_id = excluded.owner_id;

  if not found then
    raise exception using errcode = 'P0002';
  end if;

  -- The mutation and its user-visible audit fact are one transaction. A
  -- service-level follow-up write would permit a committed revision without a
  -- corresponding audit record when the process or network fails mid-request.
  insert into public.beegame_audit_events (actor_id, project_id, action, metadata)
  values (
    p_owner_id,
    p_project_id,
    case when current_head.current_brief_id is null
      then 'confirmed_brief.created'
      else 'confirmed_brief.revised'
    end,
    jsonb_build_object(
      'targetType', 'confirmed_brief',
      'targetId', inserted_revision.id,
      'revision', inserted_revision.revision,
      'previousBriefId', current_head.current_brief_id,
      'originSessionId', inserted_revision.origin_session_id,
      'schemaVersion', inserted_revision.schema_version
    )
  );

  return query select
    inserted_revision.id,
    inserted_revision.owner_id,
    inserted_revision.project_id,
    inserted_revision.origin_session_id,
    inserted_revision.revision,
    inserted_revision.schema_version,
    inserted_revision.content,
    inserted_revision.content_digest,
    inserted_revision.idempotency_key,
    inserted_revision.supersedes_brief_id,
    inserted_revision.created_at,
    current_head.current_brief_id,
    false;
end
$$;


ALTER FUNCTION "public"."beegame_append_confirmed_brief_revision"("p_owner_id" "uuid", "p_project_id" "text", "p_origin_session_id" "text", "p_schema_version" integer, "p_content" "jsonb", "p_content_digest" "text", "p_idempotency_key" "text", "p_expected_current_brief_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_assert_resource_storage_binding"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  bound_object_id uuid;
  bound_pack_id text;
  bound_logical_path text;
  expected_object_kind text;
begin
  if tg_table_name = 'beegame_resource_elements' then
    bound_object_id := new.storage_object_id;
    bound_pack_id := new.pack_id;
    bound_logical_path := new.path;
    expected_object_kind := 'resource_element';
  else
    if new.cover_path is null and new.cover_storage_object_id is null then
      return new;
    end if;
    bound_object_id := new.cover_storage_object_id;
    bound_pack_id := new.id;
    bound_logical_path := new.cover_path;
    expected_object_kind := 'resource_preview';
  end if;

  if not exists (
    select 1
    from public.beegame_storage_objects object
    where object.id = bound_object_id
      and object.provider = 'r2'
      and object.scope_type = 'pack'
      and object.pack_id = bound_pack_id
      and object.object_kind = expected_object_kind
      and object.logical_path = bound_logical_path
      and object.status = 'ready'
      and object.deleted_at is null
  ) then
    raise exception 'Resource metadata must reference a ready R2 object owned by the same Pack';
  end if;

  return new;
end;
$$;


ALTER FUNCTION "public"."beegame_assert_resource_storage_binding"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_is_platform_owner()
    or exists (
      select 1
      from public.beegame_workspace_members member
      where member.workspace_id = target_workspace_id
        and member.user_id = auth.uid()
        and member.role in ('owner', 'developer')
    )
$$;


ALTER FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_is_platform_owner()
    or exists (
      select 1
      from public.beegame_projects project
      left join public.beegame_workspace_members member
        on member.workspace_id = project.workspace_id
        and member.user_id = auth.uid()
      where project.id = target_project_id
        and (
          project.owner_id = auth.uid()
          or member.role = 'owner'
        )
    )
$$;


ALTER FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_is_platform_owner()
    or exists (
      select 1
      from public.beegame_projects project
      join public.beegame_workspace_members member
        on member.workspace_id = project.workspace_id
      where project.id = target_project_id
        and member.user_id = auth.uid()
        and member.role in ('owner', 'developer')
    )
$$;


ALTER FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_is_platform_owner()
      or exists (
        select 1 from public.beegame_resource_packs pack
        where pack.id = target_pack_id and pack.created_by = auth.uid()
      );
$$;


ALTER FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_is_platform_owner()
    or exists (
      select 1
      from public.beegame_projects project
      join public.beegame_workspace_members member
        on member.workspace_id = project.workspace_id
      where project.id = target_project_id
        and member.user_id = auth.uid()
    )
$$;


ALTER FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_claim_platform_owner_invite"() RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid;
  current_email text;
  invite_claimed boolean;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return false;
  end if;

  select u.email
  into current_email
  from auth.users u
  where u.id = current_user_id
  limit 1;

  if nullif(trim(coalesce(current_email, '')), '') is null then
    return false;
  end if;

  update public.beegame_platform_owner_invites
  set claimed_user_id = current_user_id,
      claimed_at = coalesce(claimed_at, now())
  where lower(email) = lower(current_email)
    and (claimed_user_id is null or claimed_user_id = current_user_id)
  returning true into invite_claimed;

  if coalesce(invite_claimed, false) is false then
    return false;
  end if;

  update public.beegame_workspace_members m
  set role = 'owner'
  from public.beegame_workspaces w
  where m.workspace_id = w.id
    and m.user_id = current_user_id
    and w.owner_id = current_user_id;

  return true;
end
$$;


ALTER FUNCTION "public"."beegame_claim_platform_owner_invite"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_current_user_context"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid;
  profile_row public.beegame_profiles%rowtype;
  workspace_row public.beegame_workspaces%rowtype;
  member_role text;
  account_role text;
  account_user_id uuid;
  model_config_owner_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    return null;
  end if;

  perform public.beegame_claim_platform_owner_invite();
  account_user_id := public.beegame_account_id(current_user_id);

  select *
  into profile_row
  from public.beegame_profiles
  where user_id = current_user_id
  limit 1;

  select w.*
  into workspace_row
  from public.beegame_workspaces w
  join public.beegame_workspace_members m on m.workspace_id = w.id
  where m.user_id = current_user_id
  order by
    case when w.owner_id = current_user_id then 0 else 1 end,
    w.created_at asc
  limit 1;

  model_config_owner_id := public.beegame_model_config_owner_id(current_user_id);

  if workspace_row.id is null then
    return jsonb_build_object(
      'id', current_user_id,
      'accountId', account_user_id,
      'email', profile_row.email,
      'displayName', profile_row.display_name,
      'avatarUrl', profile_row.avatar_url,
      'modelConfigOwnerId', model_config_owner_id,
      'role', 'viewer',
      'permissions', public.beegame_role_permissions('viewer')
    );
  end if;

  select coalesce(m.role, 'viewer')
  into member_role
  from public.beegame_workspace_members m
  where m.workspace_id = workspace_row.id
    and m.user_id = current_user_id
  limit 1;

  select nullif(u.raw_app_meta_data->>'beegame_role', '')
  into account_role
  from auth.users u
  where u.id = current_user_id
  limit 1;

  member_role := coalesce(member_role, 'viewer');
  if account_role = 'owner' or public.beegame_is_platform_owner() then
    member_role := 'owner';
  end if;

  return jsonb_build_object(
    'id', current_user_id,
    'accountId', account_user_id,
    'email', profile_row.email,
    'displayName', profile_row.display_name,
    'avatarUrl', profile_row.avatar_url,
    'workspaceId', workspace_row.id,
    'workspaceOwnerId', workspace_row.owner_id,
    'modelConfigOwnerId', model_config_owner_id,
    'role', member_role,
    'permissions', public.beegame_role_permissions(member_role)
  );
end;
$$;


ALTER FUNCTION "public"."beegame_current_user_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_debit_realtime_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text" DEFAULT NULL::"text", "p_project_id" "text" DEFAULT NULL::"text", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_usage" "jsonb" DEFAULT '{}'::"jsonb", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_pricing_version" "text" DEFAULT 'weighted-v1'::"text", "p_usage_source" "text" DEFAULT 'runtime_snapshot'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."beegame_debit_realtime_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_delete_current_user"() RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'auth'
    AS $$
declare
  current_user_id uuid;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;

  insert into public.beegame_audit_events (actor_id, action, metadata)
  values (
    current_user_id,
    'account.delete',
    jsonb_build_object('source', 'beegame_delete_current_user')
  );

  delete from auth.users
  where id = current_user_id;
end
$$;


ALTER FUNCTION "public"."beegame_delete_current_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_delete_storage_quota_policy"("p_actor_id" "uuid", "p_policy_id" "uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  deleted_policy public.beegame_storage_quota_policies%rowtype;
begin
  if p_actor_id is null or not public.beegame_is_platform_owner_id(p_actor_id) then
    raise exception using errcode = '42501', message = 'storage_quota_admin_required';
  end if;
  delete from public.beegame_storage_quota_policies
  where id = p_policy_id
  returning * into deleted_policy;
  if not found then
    return false;
  end if;
  insert into public.beegame_resource_audit_events (actor_id, action, metadata)
  values (p_actor_id, 'storage.quota.deleted', jsonb_build_object(
    'policyId', deleted_policy.id,
    'scopeType', deleted_policy.scope_type,
    'scopeId', deleted_policy.scope_id,
    'bucketRole', deleted_policy.bucket_role
  ));
  return true;
end;
$$;


ALTER FUNCTION "public"."beegame_delete_storage_quota_policy"("p_actor_id" "uuid", "p_policy_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_find_usable_invitation"("p_code" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select i.id
  from public.beegame_invitations i
  where i.code_hash = public.beegame_invitation_code_hash(p_code)
    and i.enabled = true
    and (i.expires_at is null or i.expires_at > now())
    and (i.max_uses is null or i.used_count < i.max_uses)
  limit 1
$$;


ALTER FUNCTION "public"."beegame_find_usable_invitation"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_handle_new_user"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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

  return new;
end
$$;


ALTER FUNCTION "public"."beegame_handle_new_user"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_invitation_code_hash"("p_code" "text") RETURNS "text"
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select encode(extensions.digest(convert_to(trim(coalesce(p_code, '')), 'UTF8'), 'sha256'::text), 'hex')
$$;


ALTER FUNCTION "public"."beegame_invitation_code_hash"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_invitation_required"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce((select required from public.beegame_invitation_settings where id = true), false)
$$;


ALTER FUNCTION "public"."beegame_invitation_required"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from public.beegame_deployments deployment
    join public.beegame_storage_objects manifest
      on manifest.id = deployment.manifest_storage_object_id
    where deployment.id = p_deployment_id
      and deployment.status = 'succeeded'
      and deployment.url <> ''
      and deployment.artifact_path is not null
      and manifest.project_id = deployment.project_id
      and manifest.scope_type = 'project'
      and manifest.scope_id = deployment.project_id
      and manifest.provider = 'r2'
      and manifest.bucket_role = 'delivery'
      and manifest.object_kind = 'deployment_manifest'
      and manifest.status = 'ready'
      and manifest.visibility = 'public'
      and manifest.deleted_at is null
      and manifest.metadata ->> 'deployment_id' = deployment.id
  );
$$;


ALTER FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_is_platform_owner"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from auth.users u
    where u.id = auth.uid()
      and u.raw_app_meta_data->>'beegame_role' = 'owner'
  ) or exists (
    select 1
    from public.beegame_platform_owner_invites i
    where i.claimed_user_id = auth.uid()
      and i.claimed_at is not null
  )
$$;


ALTER FUNCTION "public"."beegame_is_platform_owner"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1
    from auth.users u
    where u.id = target_user_id
      and u.raw_app_meta_data->>'beegame_role' = 'owner'
  ) or exists (
    select 1
    from public.beegame_platform_owner_invites i
    where i.claimed_user_id = target_user_id
      and i.claimed_at is not null
  )
$$;


ALTER FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_is_sql_admin_context"() RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select auth.uid() is null
    and session_user in ('postgres', 'supabase_admin')
$$;


ALTER FUNCTION "public"."beegame_is_sql_admin_context"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_is_workspace_owner"("target_workspace_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select coalesce(public.beegame_workspace_role(target_workspace_id) = 'owner', false)
    or exists (
      select 1
      from auth.users u
      where u.id = auth.uid()
        and u.raw_app_meta_data->>'beegame_role' = 'owner'
    )
$$;


ALTER FUNCTION "public"."beegame_is_workspace_owner"("target_workspace_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_list_storage_quota_policies"("p_actor_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if p_actor_id is null or not public.beegame_is_platform_owner_id(p_actor_id) then
    raise exception using errcode = '42501', message = 'storage_quota_admin_required';
  end if;
  return coalesce((
    select jsonb_agg(to_jsonb(policy) order by policy.bucket_role, policy.scope_type, policy.scope_id)
    from public.beegame_storage_quota_policies policy
  ), '[]'::jsonb);
end;
$$;


ALTER FUNCTION "public"."beegame_list_storage_quota_policies"("p_actor_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") RETURNS "uuid"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  workspace_owner uuid;
  workspace_owner_with_default uuid;
  platform_owner_with_default uuid;
begin
  if target_user_id is null then
    return null;
  end if;

  select w.owner_id
  into workspace_owner
  from public.beegame_workspaces w
  join public.beegame_workspace_members m on m.workspace_id = w.id
  where m.user_id = target_user_id
  order by
    case when w.owner_id = target_user_id then 0 else 1 end,
    w.created_at asc
  limit 1;

  select c.owner_id
  into workspace_owner_with_default
  from public.beegame_model_configs c
  where c.owner_id = coalesce(workspace_owner, target_user_id)
    and c.is_default = true
  order by c.updated_at desc, c.created_at desc, c.id desc
  limit 1;

  select c.owner_id
  into platform_owner_with_default
  from public.beegame_model_configs c
  join auth.users u on u.id = c.owner_id
  where (
      u.raw_app_meta_data->>'beegame_role' = 'owner'
      or exists (
        select 1
        from public.beegame_platform_owner_invites i
        where i.claimed_user_id = u.id
          and i.claimed_at is not null
      )
    )
    and c.is_default = true
  order by c.updated_at desc, c.created_at desc, c.id desc
  limit 1;

  return coalesce(
    workspace_owner_with_default,
    platform_owner_with_default
  );
end
$$;


ALTER FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") RETURNS "uuid"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select owner_id
  from public.beegame_projects
  where id = target_project_id
  limit 1
$$;


ALTER FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_public_invitation_settings"() RETURNS "jsonb"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select jsonb_build_object('required', public.beegame_invitation_required())
$$;


ALTER FUNCTION "public"."beegame_public_invitation_settings"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_read_current_confirmed_brief"("p_owner_id" "uuid", "p_project_id" "text") RETURNS TABLE("id" "uuid", "owner_id" "uuid", "project_id" "text", "origin_session_id" "text", "revision" integer, "schema_version" integer, "content" "jsonb", "content_digest" "text", "idempotency_key" "text", "supersedes_brief_id" "uuid", "created_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  select
    brief.id,
    brief.owner_id,
    brief.project_id,
    brief.origin_session_id,
    brief.revision,
    brief.schema_version,
    brief.content,
    brief.content_digest,
    brief.idempotency_key,
    brief.supersedes_brief_id,
    brief.created_at
  from public.beegame_confirmed_brief_heads head
  join public.beegame_confirmed_brief_revisions brief
    on brief.id = head.current_brief_id
   and brief.project_id = head.project_id
   and brief.owner_id = head.owner_id
  where head.owner_id = p_owner_id and head.project_id = p_project_id
$$;


ALTER FUNCTION "public"."beegame_read_current_confirmed_brief"("p_owner_id" "uuid", "p_project_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_record_shadow_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text" DEFAULT NULL::"text", "p_project_id" "text" DEFAULT NULL::"text", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_usage" "jsonb" DEFAULT '{}'::"jsonb", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_pricing_version" "text" DEFAULT 'weighted-v1'::"text", "p_usage_source" "text" DEFAULT 'runtime_snapshot'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  previous_row public.beegame_shadow_usage_events%rowtype;
  event_row public.beegame_shadow_usage_events%rowtype;
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
  ) then
    raise exception 'Forbidden';
  end if;
  if p_usage_source not in ('runtime_snapshot', 'model_runtime_host') then
    raise exception 'Invalid usage source';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_session_id));
  select * into event_row
  from public.beegame_shadow_usage_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if event_row.id is not null then
    duplicate_event := true;
  else
    select * into previous_row
    from public.beegame_shadow_usage_events
    where user_id = p_user_id and session_id = p_session_id
    order by created_at desc, id desc
    limit 1;

    current_weighted := ceil((current_prompt * 100 + current_cache_read * 10 + current_cache_creation * 125 + current_completion * 500)::numeric / 100)::bigint;
    reset_epoch := previous_row.id is null or
      current_prompt < previous_row.prompt_tokens or
      current_completion < previous_row.completion_tokens or
      current_cache_read < previous_row.cache_read_tokens or
      current_cache_creation < previous_row.cache_creation_tokens or
      current_total < previous_row.total_tokens;
    delta_prompt := case when reset_epoch then current_prompt else greatest(0, current_prompt - previous_row.prompt_tokens) end;
    delta_completion := case when reset_epoch then current_completion else greatest(0, current_completion - previous_row.completion_tokens) end;
    delta_cache_read := case when reset_epoch then current_cache_read else greatest(0, current_cache_read - previous_row.cache_read_tokens) end;
    delta_cache_creation := case when reset_epoch then current_cache_creation else greatest(0, current_cache_creation - previous_row.cache_creation_tokens) end;
    delta_total := case when reset_epoch then current_total else greatest(0, current_total - previous_row.total_tokens) end;
    delta_weighted := case when reset_epoch then current_weighted else greatest(0, current_weighted - previous_row.weighted_tokens) end;

    insert into public.beegame_shadow_usage_events (
      user_id, session_id, turn_id, project_id, idempotency_key, pricing_version, usage_source,
      prompt_tokens, completion_tokens, cache_read_tokens, cache_creation_tokens, total_tokens,
      prompt_tokens_delta, completion_tokens_delta, cache_read_tokens_delta, cache_creation_tokens_delta,
      total_tokens_delta, weighted_tokens, weighted_tokens_delta, shadow_credits_micro, metadata
    ) values (
      p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key, coalesce(nullif(trim(p_pricing_version), ''), 'weighted-v1'), p_usage_source,
      current_prompt, current_completion, current_cache_read, current_cache_creation, current_total,
      delta_prompt, delta_completion, delta_cache_read, delta_cache_creation,
      delta_total, current_weighted, delta_weighted, delta_weighted * 100, coalesce(p_metadata, '{}'::jsonb)
    ) returning * into event_row;
  end if;

  select coalesce(sum(prompt_tokens_delta), 0), coalesce(sum(completion_tokens_delta), 0),
    coalesce(sum(cache_read_tokens_delta), 0), coalesce(sum(cache_creation_tokens_delta), 0),
    coalesce(sum(total_tokens_delta), 0), coalesce(sum(weighted_tokens_delta), 0),
    coalesce(sum(shadow_credits_micro), 0)
  into cumulative_prompt, cumulative_completion, cumulative_cache_read,
    cumulative_cache_creation, cumulative_total, cumulative_weighted, cumulative_credits
  from public.beegame_shadow_usage_events
  where user_id = p_user_id and session_id = p_session_id;

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
      'shadow_credits_micro', event_row.shadow_credits_micro, 'created_at', event_row.created_at,
      'metadata', event_row.metadata
    ),
    'cumulative_usage', jsonb_build_object(
      'prompt_tokens', cumulative_prompt, 'completion_tokens', cumulative_completion,
      'cache_read_tokens', cumulative_cache_read, 'cache_creation_tokens', cumulative_cache_creation,
      'total_tokens', cumulative_total
    ),
    'cumulative_weighted_tokens', cumulative_weighted,
    'shadow_credits_micro', cumulative_credits
  );
end
$$;


ALTER FUNCTION "public"."beegame_record_shadow_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_record_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text" DEFAULT NULL::"text", "p_project_id" "text" DEFAULT NULL::"text", "p_idempotency_key" "text" DEFAULT NULL::"text", "p_usage" "jsonb" DEFAULT '{}'::"jsonb", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb", "p_pricing_version" "text" DEFAULT 'weighted-v1'::"text", "p_usage_source" "text" DEFAULT 'runtime_snapshot'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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
  ) then
    raise exception 'Forbidden';
  end if;
  if p_usage_source not in ('runtime_snapshot', 'model_runtime_host') then
    raise exception 'Invalid usage source';
  end if;

  perform pg_advisory_xact_lock(hashtext(p_user_id::text || ':' || p_session_id));
  select * into event_row
  from public.beegame_usage_events
  where user_id = p_user_id and idempotency_key = p_idempotency_key;

  if event_row.id is not null then
    duplicate_event := true;
  else
    select * into previous_row
    from public.beegame_usage_events
    where user_id = p_user_id and session_id = p_session_id
    order by created_at desc, id desc
    limit 1;

    current_weighted := ceil((current_prompt * 100 + current_cache_read * 10 + current_cache_creation * 125 + current_completion * 500)::numeric / 100)::bigint;
    reset_epoch := previous_row.id is null or
      current_prompt < previous_row.prompt_tokens or
      current_completion < previous_row.completion_tokens or
      current_cache_read < previous_row.cache_read_tokens or
      current_cache_creation < previous_row.cache_creation_tokens or
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
      p_user_id, p_session_id, p_turn_id, p_project_id, p_idempotency_key, coalesce(nullif(trim(p_pricing_version), ''), 'weighted-v1'), p_usage_source,
      current_prompt, current_completion, current_cache_read, current_cache_creation, current_total,
      delta_prompt, delta_completion, delta_cache_read, delta_cache_creation,
      delta_total, current_weighted, delta_weighted, delta_weighted * 100, coalesce(p_metadata, '{}'::jsonb)
    ) returning * into event_row;
  end if;

  select coalesce(sum(prompt_tokens_delta), 0), coalesce(sum(completion_tokens_delta), 0),
    coalesce(sum(cache_read_tokens_delta), 0), coalesce(sum(cache_creation_tokens_delta), 0),
    coalesce(sum(total_tokens_delta), 0), coalesce(sum(weighted_tokens_delta), 0),
    coalesce(sum(credits_micro), 0)
  into cumulative_prompt, cumulative_completion, cumulative_cache_read,
    cumulative_cache_creation, cumulative_total, cumulative_weighted, cumulative_credits
  from public.beegame_usage_events
  where user_id = p_user_id and session_id = p_session_id;

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
      'credits_micro', event_row.credits_micro, 'created_at', event_row.created_at,
      'metadata', event_row.metadata
    ),
    'cumulative_usage', jsonb_build_object(
      'prompt_tokens', cumulative_prompt, 'completion_tokens', cumulative_completion,
      'cache_read_tokens', cumulative_cache_read, 'cache_creation_tokens', cumulative_cache_creation,
      'total_tokens', cumulative_total
    ),
    'cumulative_weighted_tokens', cumulative_weighted,
    'credits_micro', cumulative_credits
  );
end
$$;


ALTER FUNCTION "public"."beegame_record_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_redeem_invitation_for_user"("p_user_id" "uuid", "p_code" "text" DEFAULT NULL::"text", "p_invitation_id" "uuid" DEFAULT NULL::"uuid") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
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


ALTER FUNCTION "public"."beegame_redeem_invitation_for_user"("p_user_id" "uuid", "p_code" "text", "p_invitation_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  current_user_id uuid;
  current_account_id uuid;
  nonce_row public.beegame_oauth_invitation_nonces%rowtype;
begin
  current_user_id := auth.uid();
  if current_user_id is null then
    raise exception 'Authentication required';
  end if;
  current_account_id := public.beegame_account_id(current_user_id);

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

  insert into public.beegame_credit_accounts (user_id)
  values (current_account_id)
  on conflict (user_id) do update
  set included_credits = greatest(public.beegame_credit_accounts.included_credits, 300),
      updated_at = now();

  return jsonb_build_object('ok', true);
end
$$;


ALTER FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_row public.beegame_credit_ledger%rowtype;
  target_project_id text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if nullif(trim(coalesce(p_reservation_id, '')), '') is null then
    raise exception 'Reservation id is required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  select *
  into reservation_row
  from public.beegame_credit_ledger
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and kind = 'reserve'
  order by created_at asc
  limit 1;

  if not found then
    raise exception 'Credit reservation not found';
  end if;

  if exists (
    select 1
    from public.beegame_credit_ledger
    where user_id = p_user_id
      and reservation_id = p_reservation_id
      and kind in ('settle', 'refund')
  ) then
    raise exception 'Credit reservation already settled';
  end if;

  target_project_id := coalesce(p_project_id, reservation_row.project_id);

  update public.beegame_credit_accounts
  set reserved_credits = greatest(0, reserved_credits - reservation_row.credits),
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    p_user_id,
    target_project_id,
    p_reservation_id,
    'refund',
    reservation_row.credits,
    null,
    coalesce(p_metadata, jsonb_build_object('reason', 'reservation_refunded'))
  );

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'reserved_credits', reservation_row.credits,
    'settled_credits', 0,
    'refunded_credits', reservation_row.credits,
    'account', to_jsonb(account_row)
  );
end
$$;


ALTER FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_reject_project_identity_change"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if not public.beegame_is_platform_owner()
    and (new.owner_id is distinct from old.owner_id or new.workspace_id is distinct from old.workspace_id) then
    raise exception 'Project owner and workspace are immutable for workspace members';
  end if;
  return new;
end
$$;


ALTER FUNCTION "public"."beegame_reject_project_identity_change"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text" DEFAULT NULL::"text", "p_project_id" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_uuid uuid;
  available_credits integer;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if p_credits is null or p_credits <= 0 then
    raise exception 'Credits must be positive';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  available_credits :=
    account_row.included_credits -
    account_row.consumed_credits -
    account_row.reserved_credits;

  if available_credits < p_credits then
    raise exception 'Insufficient credits';
  end if;

  reservation_uuid := gen_random_uuid();

  update public.beegame_credit_accounts
  set reserved_credits = reserved_credits + p_credits,
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    id,
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    reservation_uuid,
    p_user_id,
    p_project_id,
    reservation_uuid::text,
    'reserve',
    p_credits,
    null,
    coalesce(p_metadata, '{}'::jsonb) ||
      case
        when p_kind is null or p_kind = '' then '{}'::jsonb
        else jsonb_build_object('kind', p_kind)
      end
  );

  return jsonb_build_object(
    'reservation_id', reservation_uuid::text,
    'reserved_credits', p_credits,
    'account', to_jsonb(account_row)
  );
end
$$;


ALTER FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text", "p_project_id" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_reserve_resource_upload"("p_actor_id" "uuid", "p_pack_id" "text", "p_storage_object_id" "uuid", "p_intent_id" "uuid", "p_bucket" "text", "p_logical_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_byte_size" bigint, "p_object_kind" "text", "p_idempotency_key" "text", "p_upload_mode" "text", "p_expires_at" timestamp with time zone, "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  pack_owner uuid;
  quota_owner uuid;
  quota_workspace_id uuid;
  quota_scope_type text;
  quota_scope_id text;
  quota_max_bytes bigint;
  quota_max_objects bigint;
  used_bytes bigint;
  used_objects bigint;
  existing_intent public.beegame_storage_upload_intents%rowtype;
  created_object public.beegame_storage_objects%rowtype;
  created_intent public.beegame_storage_upload_intents%rowtype;
  expected_object_key text;
begin
  if p_actor_id is null or p_pack_id is null or btrim(p_pack_id) = '' then
    raise exception using errcode = '22023', message = 'storage_upload_actor_or_pack_missing';
  end if;
  if p_byte_size is null or p_byte_size <= 0 then
    raise exception using errcode = '22023', message = 'storage_upload_size_invalid';
  end if;
  if p_upload_mode not in ('single', 'multipart') then
    raise exception using errcode = '22023', message = 'storage_upload_mode_invalid';
  end if;

  select created_by into pack_owner
  from public.beegame_resource_packs
  where id = p_pack_id;
  if pack_owner is null then
    raise exception using errcode = 'P0002', message = 'resource_pack_not_found';
  end if;
  if pack_owner <> p_actor_id and not public.beegame_is_platform_owner_id(p_actor_id) then
    raise exception using errcode = '42501', message = 'resource_pack_access_denied';
  end if;

  quota_owner := public.beegame_account_id(pack_owner);
  perform pg_advisory_xact_lock(hashtextextended('storage-quota:account:' || quota_owner::text || ':resource-private', 0));

  select id into quota_workspace_id
  from public.beegame_workspaces
  where owner_id = quota_owner
  order by created_at asc
  limit 1;

  select * into existing_intent
  from public.beegame_storage_upload_intents
  where owner_user_id = p_actor_id and idempotency_key = p_idempotency_key;
  if found then
    return jsonb_build_object(
      'reused', true,
      'object', (select to_jsonb(o) from public.beegame_storage_objects o where o.id = existing_intent.storage_object_id),
      'intent', to_jsonb(existing_intent)
    );
  end if;

  select scope_type, scope_id, max_bytes, max_objects
  into quota_scope_type, quota_scope_id, quota_max_bytes, quota_max_objects
  from public.beegame_storage_quota_policies
  where bucket_role = 'resource-private'
    and (
      (scope_type = 'account' and scope_id = quota_owner::text)
      or (scope_type = 'workspace' and quota_workspace_id is not null and scope_id = quota_workspace_id::text)
      or (scope_type = 'platform' and scope_id = '*')
    )
  order by case scope_type when 'account' then 0 when 'workspace' then 1 else 2 end
  limit 1;
  if quota_max_bytes is null or quota_max_objects is null then
    raise exception using errcode = 'P0001', message = 'storage_quota_not_configured';
  end if;

  select coalesce(sum(byte_size), 0), count(*)
  into used_bytes, used_objects
  from public.beegame_storage_objects
  where owner_user_id = quota_owner
    and bucket_role = 'resource-private'
    and deleted_at is null
    and status in ('pending', 'uploading', 'verifying', 'ready');

  if used_bytes + p_byte_size > quota_max_bytes then
    raise exception using errcode = 'P0001', message = 'storage_byte_quota_exceeded';
  end if;
  if used_objects + 1 > quota_max_objects then
    raise exception using errcode = 'P0001', message = 'storage_object_quota_exceeded';
  end if;

  expected_object_key := 'packs/' || p_pack_id || '/objects/' || p_storage_object_id::text || '/payload';
  insert into public.beegame_storage_objects (
    id, scope_type, scope_id, owner_user_id, pack_id, provider, bucket_role,
    bucket, object_key, logical_path, original_filename, mime_type, byte_size,
    object_kind, status, visibility, metadata
  ) values (
    p_storage_object_id, 'pack', p_pack_id, quota_owner, p_pack_id, 'r2', 'resource-private',
    p_bucket, expected_object_key, p_logical_path, p_original_filename, p_mime_type,
    p_byte_size, p_object_kind, 'pending', 'private', coalesce(p_metadata, '{}'::jsonb)
  ) returning * into created_object;

  insert into public.beegame_storage_upload_intents (
    id, storage_object_id, owner_user_id, upload_mode, idempotency_key,
    expected_byte_size, expected_mime_type, status, expires_at
  ) values (
    p_intent_id, p_storage_object_id, p_actor_id, p_upload_mode, p_idempotency_key,
    p_byte_size, p_mime_type, 'pending', p_expires_at
  ) returning * into created_intent;

  return jsonb_build_object(
    'reused', false,
    'object', to_jsonb(created_object),
    'intent', to_jsonb(created_intent),
    'quota', jsonb_build_object(
      'scopeType', quota_scope_type,
      'scopeId', quota_scope_id,
      'usedBytes', used_bytes + p_byte_size,
      'maxBytes', quota_max_bytes,
      'usedObjects', used_objects + 1,
      'maxObjects', quota_max_objects
    )
  );
end;
$$;


ALTER FUNCTION "public"."beegame_reserve_resource_upload"("p_actor_id" "uuid", "p_pack_id" "text", "p_storage_object_id" "uuid", "p_intent_id" "uuid", "p_bucket" "text", "p_logical_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_byte_size" bigint, "p_object_kind" "text", "p_idempotency_key" "text", "p_upload_mode" "text", "p_expires_at" timestamp with time zone, "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_role_permissions"("role_name" "text") RETURNS "text"[]
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select case role_name
    when 'owner' then array[
      'workspace.read',
      'workspace.manage',
      'workspace.manage_members',
      'project.read',
      'project.create',
      'project.delete',
      'project.export',
      'agent.send_message',
      'agent.cancel',
      'agent.approve_tool',
      'preview.manage',
      'deployment.manage',
      'assets.upload',
      'assets.integrate',
      'model_config.manage',
      'mcp.manage',
      'skills.manage',
      'runtime_settings.manage',
      'secrets.manage',
      'credits.admin',
      'lifecycle.admin',
      'audit.read'
    ]
    when 'developer' then array[
      'workspace.read',
      'project.read',
      'project.create',
      'project.export',
      'agent.send_message',
      'agent.cancel',
      'agent.approve_tool',
      'preview.manage',
      'deployment.manage',
      'assets.upload',
      'assets.integrate',
      'skills.manage'
    ]
    when 'reviewer' then array[
      'workspace.read',
      'project.read',
      'project.export',
      'skills.manage'
    ]
    else array[
      'workspace.read',
      'project.read',
      'skills.manage'
    ]
  end
$$;


ALTER FUNCTION "public"."beegame_role_permissions"("role_name" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text" DEFAULT NULL::"text", "p_model_config_id" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE
    SET "search_path" TO 'public'
    AS $$
declare
  model_row public.beegame_model_configs%rowtype;
  web_row public.beegame_web_tools%rowtype;
  settings_row public.beegame_runtime_settings%rowtype;
  platform_settings jsonb := '{}'::jsonb;
  model_env jsonb := '{}'::jsonb;
  web_env jsonb := '{}'::jsonb;
  settings_env jsonb := '{}'::jsonb;
  runtime_env jsonb := '{}'::jsonb;
  base_config_dir text;
  runtime_root_dir text;
  config_owner_id uuid;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;
  config_owner_id := public.beegame_model_config_owner_id(p_user_id);

  base_config_dir := trim(trailing '/' from coalesce(p_data_dir, ''));
  if base_config_dir <> '' then
    runtime_root_dir := base_config_dir || '/.runtime';
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_CONFIG_DIR', runtime_root_dir || '/app',
      'BEEGAME_PROJECT_CONFIG_DIR_NAME', '.beegame'
    );
  else
    runtime_env := runtime_env || jsonb_build_object(
      'BEEGAME_PROJECT_CONFIG_DIR_NAME', '.beegame'
    );
  end if;

  select *
  into model_row
  from public.beegame_model_configs
  where owner_id = config_owner_id
    and (
      (p_model_config_id is not null and id = p_model_config_id) or
      (p_model_config_id is null and is_default = true)
    )
  order by is_default desc, updated_at desc
  limit 1;

  if found then
    case model_row.provider
      when 'anthropic-compatible', 'anthropic-native-batch' then
        model_env := jsonb_build_object(
          'ANTHROPIC_BASE_URL', model_row.base_url,
          'ANTHROPIC_AUTH_TOKEN', model_row.api_key_ciphertext,
          'ANTHROPIC_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'ANTHROPIC_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'ANTHROPIC_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'openai-compatible' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_OPENAI', '1',
          'OPENAI_BASE_URL', model_row.base_url,
          'OPENAI_API_KEY', model_row.api_key_ciphertext,
          'OPENAI_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'OPENAI_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'OPENAI_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'gemini' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_GEMINI', '1',
          'GEMINI_BASE_URL', model_row.base_url,
          'GEMINI_API_KEY', model_row.api_key_ciphertext,
          'GEMINI_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'GEMINI_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'GEMINI_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      when 'grok' then
        model_env := jsonb_build_object(
          'CLAUDE_CODE_USE_GROK', '1',
          'GROK_BASE_URL', model_row.base_url,
          'GROK_API_KEY', model_row.api_key_ciphertext,
          'GROK_DEFAULT_HAIKU_MODEL', model_row.models->>'fast',
          'GROK_DEFAULT_SONNET_MODEL', model_row.models->>'balanced',
          'GROK_DEFAULT_OPUS_MODEL', model_row.models->>'strong'
        );
      else
        model_env := '{}'::jsonb;
    end case;
  end if;

  select *
  into web_row
  from public.beegame_web_tools
  where owner_id = config_owner_id
  limit 1;

  if found then
    web_env := jsonb_build_object(
      'WEB_SEARCH_ADAPTER', web_row.config->>'webSearchAdapter',
      'WEB_FETCH_ADAPTER', web_row.config->>'webFetchAdapter',
      'BRAVE_SEARCH_API_KEY', web_row.config->>'braveApiKey',
      'EXA_API_KEY', web_row.config->>'exaApiKey'
    );
  end if;

  select coalesce(config, '{}'::jsonb)
  into platform_settings
  from public.beegame_platform_settings
  where key = 'runtime_settings'
  limit 1;

  if platform_settings = '{}'::jsonb then
    select *
    into settings_row
    from public.beegame_runtime_settings
    where owner_id = config_owner_id
    limit 1;

    if found then
      platform_settings := coalesce(settings_row.settings, '{}'::jsonb);
    end if;
  end if;

  if platform_settings <> '{}'::jsonb then
    settings_env := settings_env || jsonb_build_object(
      'BEEGAME_RUNTIME_SETTINGS_JSON',
      platform_settings::text
    );
    if platform_settings ? 'autoMemoryEnabled' then
      settings_env := settings_env || jsonb_build_object(
        'CLAUDE_CODE_DISABLE_AUTO_MEMORY',
        case when (platform_settings->>'autoMemoryEnabled')::boolean then '0' else '1' end
      );
      if base_config_dir <> '' then
        settings_env := settings_env || jsonb_build_object(
          'CLAUDE_CONFIG_DIR',
          runtime_root_dir || '/core'
        );
      end if;
    end if;
    if platform_settings ? 'autoDreamEnabled' and base_config_dir <> '' then
      settings_env := settings_env || jsonb_build_object(
        'CLAUDE_CONFIG_DIR',
        runtime_root_dir || '/core'
      );
    end if;
    if (platform_settings->>'treeSitterBashEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_TREE_SITTER_BASH', '1');
    end if;
    if (platform_settings->>'webBrowserToolEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_WEB_BROWSER_TOOL', '1');
    end if;
    if (platform_settings->>'bashClassifierEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_BASH_CLASSIFIER', '1');
    end if;
    if (platform_settings->>'mcpSkillsEnabled')::boolean is true then
      settings_env := settings_env || jsonb_build_object('FEATURE_MCP_SKILLS', '1');
    end if;
  end if;

  return jsonb_strip_nulls(runtime_env || model_env || web_env || settings_env);
end
$$;


ALTER FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text", "p_model_config_id" "text") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_model_configs" (
    "id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "provider" "text" NOT NULL,
    "base_url" "text",
    "api_key_ciphertext" "text",
    "models" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_model_configs" OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") RETURNS "public"."beegame_model_configs"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
declare
  selected_config public.beegame_model_configs%rowtype;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if p_model_config_id is null or trim(p_model_config_id) = '' then
    raise exception 'Model config id is required';
  end if;
  if auth.uid() is null or auth.uid() <> p_user_id then
    raise exception 'Forbidden';
  end if;

  select *
  into selected_config
  from public.beegame_model_configs
  where owner_id = p_user_id
    and id = p_model_config_id
  for update;

  if not found then
    raise exception 'Model config not found';
  end if;

  update public.beegame_model_configs
  set is_default = false,
      updated_at = now()
  where owner_id = p_user_id
    and is_default = true
    and id <> p_model_config_id;

  update public.beegame_model_configs
  set is_default = true,
      updated_at = now()
  where owner_id = p_user_id
    and id = p_model_config_id
  returning * into selected_config;

  return selected_config;
end
$$;


ALTER FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer DEFAULT 10000, "p_project_id" "text" DEFAULT NULL::"text", "p_metadata" "jsonb" DEFAULT '{}'::"jsonb") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  account_row public.beegame_credit_accounts%rowtype;
  reservation_row public.beegame_credit_ledger%rowtype;
  reservation_credits integer;
  weighted_tokens integer;
  credit_unit integer;
  available_unreserved_credits integer;
  settled_credits integer;
  refunded_credits integer;
  target_project_id text;
begin
  if p_user_id is null then
    raise exception 'User id is required';
  end if;
  if coalesce(auth.role(), '') <> 'service_role' and (
    auth.uid() is null or public.beegame_account_id(auth.uid()) <> p_user_id
  ) then
    raise exception 'Forbidden';
  end if;
  if nullif(trim(coalesce(p_reservation_id, '')), '') is null then
    raise exception 'Reservation id is required';
  end if;

  insert into public.beegame_credit_accounts (user_id)
  values (p_user_id)
  on conflict (user_id) do nothing;

  select *
  into account_row
  from public.beegame_credit_accounts
  where user_id = p_user_id
  for update;

  select *
  into reservation_row
  from public.beegame_credit_ledger
  where user_id = p_user_id
    and reservation_id = p_reservation_id
    and kind = 'reserve'
  order by created_at asc
  limit 1;

  if not found then
    raise exception 'Credit reservation not found';
  end if;

  if exists (
    select 1
    from public.beegame_credit_ledger
    where user_id = p_user_id
      and reservation_id = p_reservation_id
      and kind in ('settle', 'refund')
  ) then
    raise exception 'Credit reservation already settled';
  end if;

  reservation_credits := reservation_row.credits;
  weighted_tokens := greatest(coalesce(p_weighted_tokens, 0), 0);
  credit_unit := greatest(coalesce(p_credit_unit_weighted_tokens, 10000), 1);
  settled_credits := greatest(
    1,
    ceil(weighted_tokens::numeric / credit_unit::numeric)::integer
  );
  available_unreserved_credits := greatest(
    0,
    coalesce(account_row.included_credits, 0) -
      coalesce(account_row.consumed_credits, 0) -
      coalesce(account_row.reserved_credits, 0)
  );
  if greatest(0, settled_credits - reservation_credits) > available_unreserved_credits then
    raise exception 'Insufficient credits to settle actual token usage';
  end if;
  refunded_credits := greatest(0, reservation_credits - settled_credits);
  target_project_id := coalesce(p_project_id, reservation_row.project_id);

  update public.beegame_credit_accounts
  set consumed_credits = consumed_credits + settled_credits,
      reserved_credits = greatest(
        0,
        public.beegame_credit_accounts.reserved_credits - reservation_credits
      ),
      updated_at = now()
  where user_id = p_user_id
  returning * into account_row;

  insert into public.beegame_credit_ledger (
    user_id,
    project_id,
    reservation_id,
    kind,
    credits,
    weighted_tokens,
    metadata
  )
  values (
    p_user_id,
    target_project_id,
    p_reservation_id,
    'settle',
    settled_credits,
    weighted_tokens,
    coalesce(p_metadata, '{}'::jsonb)
  );

  if refunded_credits > 0 then
    insert into public.beegame_credit_ledger (
      user_id,
      project_id,
      reservation_id,
      kind,
      credits,
      weighted_tokens,
      metadata
    )
    values (
      p_user_id,
      target_project_id,
      p_reservation_id,
      'refund',
      refunded_credits,
      null,
      jsonb_build_object('reason', 'unused_reservation')
    );
  end if;

  return jsonb_build_object(
    'reservation_id', p_reservation_id,
    'reserved_credits', reservation_credits,
    'settled_credits', settled_credits,
    'refunded_credits', refunded_credits,
    'account', to_jsonb(account_row)
  );
end
$$;


ALTER FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer, "p_project_id" "text", "p_metadata" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_storage_quota_usage"("p_actor_id" "uuid", "p_bucket_role" "text" DEFAULT 'resource-private'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  quota_owner uuid;
  quota_workspace_id uuid;
  quota_scope_type text;
  quota_scope_id text;
  quota_max_bytes bigint;
  quota_max_objects bigint;
  used_bytes bigint;
  used_objects bigint;
begin
  if p_actor_id is null then
    raise exception using errcode = '22023', message = 'storage_quota_actor_missing';
  end if;
  if p_bucket_role not in ('project-private', 'resource-private', 'delivery', 'log-private') then
    raise exception using errcode = '22023', message = 'storage_quota_bucket_role_invalid';
  end if;

  quota_owner := public.beegame_account_id(p_actor_id);
  select id into quota_workspace_id
  from public.beegame_workspaces
  where owner_id = quota_owner
  order by created_at asc
  limit 1;

  select scope_type, scope_id, max_bytes, max_objects
  into quota_scope_type, quota_scope_id, quota_max_bytes, quota_max_objects
  from public.beegame_storage_quota_policies
  where bucket_role = p_bucket_role
    and (
      (scope_type = 'account' and scope_id = quota_owner::text)
      or (scope_type = 'workspace' and quota_workspace_id is not null and scope_id = quota_workspace_id::text)
      or (scope_type = 'platform' and scope_id = '*')
    )
  order by case scope_type when 'account' then 0 when 'workspace' then 1 else 2 end
  limit 1;

  select coalesce(sum(byte_size), 0), count(*)
  into used_bytes, used_objects
  from public.beegame_storage_objects
  where owner_user_id = quota_owner
    and bucket_role = p_bucket_role
    and deleted_at is null
    and status in ('pending', 'uploading', 'verifying', 'ready');

  return jsonb_build_object(
    'accountId', quota_owner,
    'workspaceId', quota_workspace_id,
    'bucketRole', p_bucket_role,
    'configured', quota_max_bytes is not null and quota_max_objects is not null,
    'effectiveScopeType', quota_scope_type,
    'effectiveScopeId', quota_scope_id,
    'usedBytes', used_bytes,
    'maxBytes', quota_max_bytes,
    'remainingBytes', case when quota_max_bytes is null then 0 else greatest(quota_max_bytes - used_bytes, 0) end,
    'usedObjects', used_objects,
    'maxObjects', quota_max_objects,
    'remainingObjects', case when quota_max_objects is null then 0 else greatest(quota_max_objects - used_objects, 0) end
  );
end;
$$;


ALTER FUNCTION "public"."beegame_storage_quota_usage"("p_actor_id" "uuid", "p_bucket_role" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_sync_resource_pack_element_count"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
begin
  if tg_op <> 'INSERT' then
    update public.beegame_resource_packs
    set element_count = (select count(*) from public.beegame_resource_elements where pack_id = old.pack_id),
        updated_at = now()
    where id = old.pack_id;
  end if;

  if tg_op <> 'DELETE' then
    update public.beegame_resource_packs
    set element_count = (select count(*) from public.beegame_resource_elements where pack_id = new.pack_id),
        updated_at = now()
    where id = new.pack_id;
  end if;

  return null;
end;
$$;


ALTER FUNCTION "public"."beegame_sync_resource_pack_element_count"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_upsert_storage_quota_policy"("p_actor_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_bucket_role" "text", "p_max_bytes" bigint, "p_max_objects" bigint) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
declare
  saved public.beegame_storage_quota_policies%rowtype;
begin
  if p_actor_id is null or not public.beegame_is_platform_owner_id(p_actor_id) then
    raise exception using errcode = '42501', message = 'storage_quota_admin_required';
  end if;
  if p_scope_type not in ('platform', 'account', 'workspace')
    or p_scope_id is null or btrim(p_scope_id) = ''
    or (p_scope_type = 'platform' and p_scope_id <> '*')
    or p_bucket_role not in ('project-private', 'resource-private', 'delivery', 'log-private')
    or p_max_bytes is null or p_max_bytes <= 0
    or p_max_objects is null or p_max_objects <= 0 then
    raise exception using errcode = '22023', message = 'storage_quota_policy_invalid';
  end if;

  insert into public.beegame_storage_quota_policies (
    scope_type, scope_id, bucket_role, max_bytes, max_objects, created_by, updated_by
  ) values (
    p_scope_type, btrim(p_scope_id), p_bucket_role, p_max_bytes, p_max_objects, p_actor_id, p_actor_id
  )
  on conflict (scope_type, scope_id, bucket_role) do update
  set max_bytes = excluded.max_bytes,
      max_objects = excluded.max_objects,
      updated_by = excluded.updated_by,
      updated_at = now()
  returning * into saved;

  insert into public.beegame_resource_audit_events (actor_id, action, metadata)
  values (p_actor_id, 'storage.quota.updated', jsonb_build_object(
    'policyId', saved.id,
    'scopeType', saved.scope_type,
    'scopeId', saved.scope_id,
    'bucketRole', saved.bucket_role,
    'maxBytes', saved.max_bytes,
    'maxObjects', saved.max_objects
  ));

  return to_jsonb(saved);
end;
$$;


ALTER FUNCTION "public"."beegame_upsert_storage_quota_policy"("p_actor_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_bucket_role" "text", "p_max_bytes" bigint, "p_max_objects" bigint) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_user_has_invitation"("p_user_id" "uuid") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select exists (
    select 1 from public.beegame_invitation_redemptions r
    where r.user_id = p_user_id
  )
$$;


ALTER FUNCTION "public"."beegame_user_has_invitation"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_valid_dependency_bindings"("value" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select jsonb_typeof(value) = 'array'
    and not exists (
      select 1
      from jsonb_array_elements(value) binding
      where jsonb_typeof(binding) <> 'object'
         or coalesce(binding->>'referencePath', '') = ''
         or left(binding->>'referencePath', 1) = '/'
         or position('\\' in coalesce(binding->>'referencePath', '')) > 0
         or coalesce(binding->>'dependencyElementId', '') = ''
    );
$$;


ALTER FUNCTION "public"."beegame_valid_dependency_bindings"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_valid_resource_relations"("value" "jsonb") RETURNS boolean
    LANGUAGE "sql" IMMUTABLE
    AS $$
  select jsonb_typeof(value) = 'array' and not exists (
    select 1 from jsonb_array_elements(value) relation
    where jsonb_typeof(relation) <> 'object'
       or coalesce(relation->>'kind', '') not in (
         'uses-texture', 'uses-material', 'uses-rig', 'animation-for', 'collision-for',
         'lod-of', 'variant-of', 'component-of', 'audio-for', 'vfx-for'
       )
       or coalesce(relation->>'targetElementId', '') = ''
       or (relation ? 'role' and coalesce(relation->>'role', '') = '')
       or (relation ? 'required' and jsonb_typeof(relation->'required') <> 'boolean')
  );
$$;


ALTER FUNCTION "public"."beegame_valid_resource_relations"("value" "jsonb") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") RETURNS boolean
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select public.beegame_find_usable_invitation(p_code) is not null
$$;


ALTER FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."beegame_workspace_role"("target_workspace_id" "uuid") RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  select m.role
  from public.beegame_workspace_members m
  where m.workspace_id = target_workspace_id
    and m.user_id = auth.uid()
  limit 1
$$;


ALTER FUNCTION "public"."beegame_workspace_role"("target_workspace_id" "uuid") OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_account_links" (
    "user_id" "uuid" NOT NULL,
    "account_id" "uuid" NOT NULL,
    "email" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_account_links" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_assets" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "manifest" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_assets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "workspace_id" "uuid",
    "project_id" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_billing_credit_packs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "price_id" "text" NOT NULL,
    "credits" integer NOT NULL,
    "display_name" "text",
    "enabled" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_billing_credit_packs_credits_check" CHECK (("credits" > 0))
);


ALTER TABLE "public"."beegame_billing_credit_packs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_billing_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "provider" "text" DEFAULT 'stripe'::"text" NOT NULL,
    "event_type" "text" NOT NULL,
    "status" "text" NOT NULL,
    "user_id" "uuid",
    "price_id" "text",
    "credits" integer,
    "provider_event_id" "text",
    "checkout_session_id" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_billing_events_credits_check" CHECK ((("credits" IS NULL) OR ("credits" >= 0))),
    CONSTRAINT "beegame_billing_events_status_check" CHECK (("status" = ANY (ARRAY['received'::"text", 'ignored'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."beegame_billing_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_deployments" (
    "id" "text" NOT NULL,
    "session_id" "text" NOT NULL,
    "project_id" "text",
    "owner_id" "uuid" NOT NULL,
    "workspace_path" "text" NOT NULL,
    "status" "text" NOT NULL,
    "url" "text" DEFAULT ''::"text" NOT NULL,
    "build_command" "text",
    "build_log" "text",
    "entrypoint" "text",
    "output_dir" "text",
    "artifact_path" "text",
    "artifact_hash" "text",
    "message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deployed_at" timestamp with time zone,
    "manifest_storage_object_id" "uuid",
    CONSTRAINT "beegame_deployments_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'building'::"text", 'publishing'::"text", 'succeeded'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."beegame_deployments" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_invitation_redemptions" (
    "user_id" "uuid" NOT NULL,
    "invitation_id" "uuid" NOT NULL,
    "redeemed_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_invitation_redemptions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_invitation_settings" (
    "id" boolean DEFAULT true NOT NULL,
    "required" boolean DEFAULT false NOT NULL,
    "updated_by" "uuid",
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_invitation_settings_id_check" CHECK ("id")
);


ALTER TABLE "public"."beegame_invitation_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_invitations" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code_hash" "text" NOT NULL,
    "label" "text" DEFAULT 'Invitation'::"text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "max_uses" integer,
    "used_count" integer DEFAULT 0 NOT NULL,
    "expires_at" timestamp with time zone,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "code" "text",
    CONSTRAINT "beegame_invitations_max_uses_check" CHECK ((("max_uses" IS NULL) OR ("max_uses" > 0))),
    CONSTRAINT "beegame_invitations_used_count_check" CHECK (("used_count" >= 0))
);


ALTER TABLE "public"."beegame_invitations" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_mcp_servers" (
    "id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "env_ciphertext" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_mcp_servers" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_oauth_invitation_nonces" (
    "nonce" "text" NOT NULL,
    "invitation_id" "uuid" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "consumed_by" "uuid",
    "consumed_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_oauth_invitation_nonces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_platform_owner_invites" (
    "email" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "claimed_user_id" "uuid",
    "claimed_at" timestamp with time zone
);


ALTER TABLE "public"."beegame_platform_owner_invites" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_platform_settings" (
    "key" "text" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_platform_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_previews" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'stopped'::"text" NOT NULL,
    "url" "text",
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_previews" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_profiles" (
    "user_id" "uuid" NOT NULL,
    "display_name" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "email" "text",
    "avatar_url" "text"
);


ALTER TABLE "public"."beegame_profiles" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_projects" (
    "id" "text" NOT NULL,
    "workspace_id" "uuid" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "root_path" "text",
    "runtime_snapshot" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_projects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_audit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "actor_id" "uuid",
    "pack_id" "text",
    "element_id" "text",
    "action" "text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_resource_audit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_dependencies" (
    "element_id" "text" NOT NULL,
    "dependency_path" "text" NOT NULL,
    "dependency_kind" "text"
);


ALTER TABLE "public"."beegame_resource_dependencies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_elements" (
    "id" "text" NOT NULL,
    "pack_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "path" "text" NOT NULL,
    "category" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "preview" "jsonb",
    "specs" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "dependencies" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "status" "text" DEFAULT 'ready'::"text" NOT NULL,
    "style_override" "text",
    "dimension_override" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "usage_tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "dependency_bindings" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "asset_kind" "text",
    "capabilities" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "relations" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "content_profile" "jsonb",
    "usage_tags_mode" "text" DEFAULT 'inherit'::"text" NOT NULL,
    "storage_object_id" "uuid" NOT NULL,
    CONSTRAINT "beegame_resource_elements_asset_kind_check" CHECK ((("asset_kind" IS NULL) OR ("asset_kind" = ANY (ARRAY['image'::"text", 'texture'::"text", 'sprite'::"text", 'sprite-sheet'::"text", 'sprite-atlas'::"text", 'frame-animation'::"text", 'tileset'::"text", 'tilemap'::"text", 'mesh'::"text", 'model'::"text", 'scene'::"text", 'material'::"text", 'rig'::"text", 'animation-clip'::"text", 'animation-library'::"text", 'ui-document'::"text", 'ui-screen'::"text", 'font'::"text", 'audio-clip'::"text", 'audio-cue'::"text", 'audio-bank'::"text", 'music'::"text", 'ambience'::"text", 'voice'::"text", 'vfx'::"text", 'shader'::"text", 'physical-material'::"text", 'collider'::"text", 'input-profile'::"text", 'data'::"text"])))),
    CONSTRAINT "beegame_resource_elements_capabilities_check" CHECK (("capabilities" <@ ARRAY['alpha'::"text", 'tileable'::"text", 'nine-slice'::"text", 'sprite-slicing'::"text", 'frame-sequence'::"text", 'atlas-regions'::"text", 'tile-collision'::"text", 'skinned'::"text", 'rigged'::"text", 'contains-animations'::"text", 'contains-materials'::"text", 'contains-textures'::"text", 'morph-targets'::"text", 'lod'::"text", 'collision'::"text", 'navigation'::"text", 'modular'::"text", 'connection-points'::"text", 'scene-layout'::"text", 'spawn-markers'::"text", 'objective-markers'::"text", 'ui-states'::"text", 'focus-navigation'::"text", 'safe-area'::"text", 'particle'::"text", 'flipbook'::"text", 'trail'::"text", 'spatial-audio'::"text", 'loop-points'::"text", 'audio-variants'::"text", 'physical-properties'::"text", 'ragdoll'::"text", 'input-actions'::"text", 'touch-controls'::"text", 'gamepad-controls'::"text"])),
    CONSTRAINT "beegame_resource_elements_content_profile_check" CHECK ((("content_profile" IS NULL) OR (("jsonb_typeof"("content_profile") = 'object'::"text") AND ("content_profile" ?& ARRAY['packaging'::"text", 'components'::"text", 'inspection'::"text"]) AND (("content_profile" ->> 'packaging'::"text") = ANY (ARRAY['self-contained'::"text", 'external-dependencies'::"text", 'unknown'::"text"])) AND ("jsonb_typeof"(("content_profile" -> 'components'::"text")) = 'array'::"text") AND ("jsonb_typeof"(("content_profile" -> 'inspection'::"text")) = 'object'::"text") AND (("content_profile" -> 'inspection'::"text") ?& ARRAY['status'::"text", 'source'::"text"]) AND ((("content_profile" -> 'inspection'::"text") ->> 'status'::"text") = ANY (ARRAY['complete'::"text", 'partial'::"text", 'unavailable'::"text"])) AND ((("content_profile" -> 'inspection'::"text") ->> 'source'::"text") = ANY (ARRAY['server'::"text", 'client'::"text", 'admin'::"text"]))))),
    CONSTRAINT "beegame_resource_elements_dependency_bindings_check" CHECK ("public"."beegame_valid_dependency_bindings"("dependency_bindings")),
    CONSTRAINT "beegame_resource_elements_dimension_override_check" CHECK ((("dimension_override" IS NULL) OR ("dimension_override" = ANY (ARRAY['2D'::"text", '3D'::"text", 'agnostic'::"text"])))),
    CONSTRAINT "beegame_resource_elements_relations_check" CHECK ("public"."beegame_valid_resource_relations"("relations")),
    CONSTRAINT "beegame_resource_elements_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'uploading'::"text", 'ready'::"text", 'failed'::"text", 'hidden'::"text", 'archived'::"text"]))),
    CONSTRAINT "beegame_resource_elements_usage_tags_check" CHECK (("usage_tags" <@ ARRAY['character'::"text", 'npc'::"text", 'creature'::"text", 'weapon-equipment'::"text", 'prop'::"text", 'vehicle'::"text", 'building'::"text", 'environment'::"text", 'terrain'::"text", 'vegetation'::"text", 'scene'::"text", 'level-map'::"text", 'tile'::"text", 'ui'::"text", 'icon'::"text", 'effect'::"text", 'combat'::"text", 'interaction'::"text", 'narrative'::"text", 'music'::"text", 'sound-effect'::"text", 'ambient-audio'::"text", 'voice'::"text"])),
    CONSTRAINT "beegame_resource_elements_usage_tags_mode_check" CHECK (("usage_tags_mode" = ANY (ARRAY['inherit'::"text", 'override'::"text", 'manual-only'::"text"])))
);


ALTER TABLE "public"."beegame_resource_elements" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_folders" (
    "id" "text" NOT NULL,
    "pack_id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "parent_id" "text",
    "path" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_resource_folders" OWNER TO "postgres";


CREATE OR REPLACE VIEW "public"."beegame_resource_pack_catalog" AS
SELECT
    NULL::"text" AS "pack_id",
    NULL::"text" AS "pack_version",
    NULL::"text" AS "pack_name",
    NULL::"text"[] AS "styles",
    NULL::"text"[] AS "game_types",
    NULL::"text" AS "dimension",
    NULL::"text" AS "primary_category",
    NULL::"text"[] AS "categories",
    NULL::"text"[] AS "tags",
    NULL::integer AS "ready_element_count",
    NULL::"text"[] AS "asset_kinds",
    NULL::"text"[] AS "usage_tags",
    NULL::"text"[] AS "capabilities",
    NULL::"text"[] AS "formats",
    NULL::"text" AS "description",
    NULL::"text" AS "license",
    NULL::"text" AS "author",
    NULL::"text" AS "source",
    NULL::"text"[] AS "compatible_engines";


ALTER VIEW "public"."beegame_resource_pack_catalog" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_packs" (
    "id" "text" NOT NULL,
    "name" "text" NOT NULL,
    "game_types" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "dimension" "text" NOT NULL,
    "categories" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "license" "text" NOT NULL,
    "version" "text" NOT NULL,
    "status" "text" DEFAULT 'draft'::"text" NOT NULL,
    "cover_path" "text",
    "element_count" integer DEFAULT 0 NOT NULL,
    "created_by" "uuid",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "primary_category" "text" DEFAULT 'mixed'::"text" NOT NULL,
    "archived_at" timestamp with time zone,
    "description" "text",
    "tags" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "source" "text",
    "author" "text",
    "license_evidence" "text",
    "compatible_engines" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "deprecated_at" timestamp with time zone,
    "styles" "text"[] DEFAULT '{}'::"text"[] NOT NULL,
    "cover_storage_object_id" "uuid",
    CONSTRAINT "beegame_resource_packs_cover_storage_pair_check" CHECK (((("cover_path" IS NULL) AND ("cover_storage_object_id" IS NULL)) OR ((NULLIF("btrim"("cover_path"), ''::"text") IS NOT NULL) AND ("cover_storage_object_id" IS NOT NULL)))),
    CONSTRAINT "beegame_resource_packs_dimension_check" CHECK (("dimension" = ANY (ARRAY['2D'::"text", '3D'::"text", 'agnostic'::"text"]))),
    CONSTRAINT "beegame_resource_packs_element_count_check" CHECK (("element_count" >= 0)),
    CONSTRAINT "beegame_resource_packs_primary_category_check" CHECK (("primary_category" = ANY (ARRAY['2d-art'::"text", '3d-assets'::"text", 'animation-rig'::"text", 'ui-kit'::"text", 'vfx'::"text", 'audio'::"text", 'fonts'::"text", 'world-scene'::"text", 'mixed'::"text"]))),
    CONSTRAINT "beegame_resource_packs_status_check" CHECK (("status" = ANY (ARRAY['draft'::"text", 'published'::"text", 'archived'::"text"])))
);


ALTER TABLE "public"."beegame_resource_packs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_resource_processing_items" (
    "id" "text" NOT NULL,
    "job_id" "text" NOT NULL,
    "element_id" "text" NOT NULL,
    "status" "text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "source_content_hash" "text",
    "curator_revision" "text",
    "input_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
    "output_tokens" bigint DEFAULT 0 NOT NULL,
    "total_tokens" bigint DEFAULT 0 NOT NULL,
    "credits_micro" bigint DEFAULT 0 NOT NULL,
    "batch_id" "text",
    "batch_receipt_id" "text",
    "failure_stage" "text",
    "failure_trace_id" "text",
    CONSTRAINT "beegame_resource_processing_items_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_cache_creation_tokens_check" CHECK (("cache_creation_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_cache_read_tokens_check" CHECK (("cache_read_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_credits_micro_check" CHECK (("credits_micro" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_failure_stage_check" CHECK ((("failure_stage" IS NULL) OR ("failure_stage" = ANY (ARRAY['runtime_transport'::"text", 'model_request'::"text", 'model_response'::"text", 'usage_billing'::"text"])))),
    CONSTRAINT "beegame_resource_processing_items_input_tokens_check" CHECK (("input_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_output_tokens_check" CHECK (("output_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_items_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "beegame_resource_processing_items_total_tokens_check" CHECK (("total_tokens" >= 0))
);


ALTER TABLE "public"."beegame_resource_processing_items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."beegame_resource_processing_items"."source_content_hash" IS 'Content hash frozen when the durable processing item is created; semantic results must match it.';



COMMENT ON COLUMN "public"."beegame_resource_processing_items"."curator_revision" IS 'Semantic curator contract revision used for this item; accepted results are idempotent by hash and revision.';



COMMENT ON COLUMN "public"."beegame_resource_processing_items"."batch_id" IS 'Stable durable identity of the semantic batch currently processing this item.';



COMMENT ON COLUMN "public"."beegame_resource_processing_items"."batch_receipt_id" IS 'Accepted batch acknowledgement shared by all items completed from one provider call.';



COMMENT ON COLUMN "public"."beegame_resource_processing_items"."failure_stage" IS 'Canonical stage that produced the latest durable processing failure.';



COMMENT ON COLUMN "public"."beegame_resource_processing_items"."failure_trace_id" IS 'Trace identifier for the external runtime failure; safe diagnostic only.';



CREATE TABLE IF NOT EXISTS "public"."beegame_resource_processing_jobs" (
    "id" "text" NOT NULL,
    "pack_id" "text" NOT NULL,
    "kind" "text" NOT NULL,
    "status" "text" NOT NULL,
    "total_items" integer DEFAULT 0 NOT NULL,
    "completed_items" integer DEFAULT 0 NOT NULL,
    "failed_items" integer DEFAULT 0 NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "owner_id" "uuid",
    "model_config_id" "text",
    "input_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
    "output_tokens" bigint DEFAULT 0 NOT NULL,
    "total_tokens" bigint DEFAULT 0 NOT NULL,
    "credits_micro" bigint DEFAULT 0 NOT NULL,
    "analysis_mode" "text" DEFAULT 'missing'::"text" NOT NULL,
    "retry_of_job_id" "text",
    CONSTRAINT "beegame_resource_processing_jobs_analysis_mode_check" CHECK (("analysis_mode" = ANY (ARRAY['missing'::"text", 'all'::"text"]))),
    CONSTRAINT "beegame_resource_processing_jobs_cache_creation_tokens_check" CHECK (("cache_creation_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_cache_read_tokens_check" CHECK (("cache_read_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_completed_items_check" CHECK (("completed_items" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_credits_micro_check" CHECK (("credits_micro" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_failed_items_check" CHECK (("failed_items" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_input_tokens_check" CHECK (("input_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_kind_check" CHECK (("kind" = ANY (ARRAY['inspect-elements'::"text", 'semantic-curate-elements'::"text"]))),
    CONSTRAINT "beegame_resource_processing_jobs_output_tokens_check" CHECK (("output_tokens" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'running'::"text", 'completed'::"text", 'failed'::"text", 'cancelled'::"text"]))),
    CONSTRAINT "beegame_resource_processing_jobs_total_items_check" CHECK (("total_items" >= 0)),
    CONSTRAINT "beegame_resource_processing_jobs_total_tokens_check" CHECK (("total_tokens" >= 0))
);


ALTER TABLE "public"."beegame_resource_processing_jobs" OWNER TO "postgres";


COMMENT ON COLUMN "public"."beegame_resource_processing_jobs"."total_tokens" IS 'Cumulative provider token usage across every processing item, including failed and retried calls.';



COMMENT ON COLUMN "public"."beegame_resource_processing_jobs"."credits_micro" IS 'Cumulative billed Credit in micro-credits across every processing item.';



COMMENT ON COLUMN "public"."beegame_resource_processing_jobs"."analysis_mode" IS 'Durable semantic curation scope: missing labels only or all non-manual resources.';



CREATE TABLE IF NOT EXISTS "public"."beegame_runtime_settings" (
    "owner_id" "uuid" NOT NULL,
    "settings" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_runtime_settings" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_sessions" (
    "id" "text" NOT NULL,
    "project_id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "workspace_path" "text" NOT NULL,
    "status" "text" DEFAULT 'idle'::"text" NOT NULL,
    "transcript_path" "text",
    "model_config_id" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_sessions" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_shadow_usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "turn_id" "text",
    "project_id" "text",
    "idempotency_key" "text" NOT NULL,
    "pricing_version" "text" DEFAULT 'weighted-v1'::"text" NOT NULL,
    "usage_source" "text" NOT NULL,
    "prompt_tokens" bigint DEFAULT 0 NOT NULL,
    "completion_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
    "total_tokens" bigint DEFAULT 0 NOT NULL,
    "prompt_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "completion_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "total_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "weighted_tokens" bigint DEFAULT 0 NOT NULL,
    "weighted_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "shadow_credits_micro" bigint DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_shadow_usage_events_cache_creation_tokens_check" CHECK (("cache_creation_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_cache_creation_tokens_delta_check" CHECK (("cache_creation_tokens_delta" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_cache_read_tokens_check" CHECK (("cache_read_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_cache_read_tokens_delta_check" CHECK (("cache_read_tokens_delta" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_completion_tokens_check" CHECK (("completion_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_completion_tokens_delta_check" CHECK (("completion_tokens_delta" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_prompt_tokens_check" CHECK (("prompt_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_prompt_tokens_delta_check" CHECK (("prompt_tokens_delta" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_shadow_credits_micro_check" CHECK (("shadow_credits_micro" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_total_tokens_check" CHECK (("total_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_total_tokens_delta_check" CHECK (("total_tokens_delta" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_usage_source_check" CHECK (("usage_source" = ANY (ARRAY['runtime_snapshot'::"text", 'model_runtime_host'::"text"]))),
    CONSTRAINT "beegame_shadow_usage_events_weighted_tokens_check" CHECK (("weighted_tokens" >= 0)),
    CONSTRAINT "beegame_shadow_usage_events_weighted_tokens_delta_check" CHECK (("weighted_tokens_delta" >= 0))
);


ALTER TABLE "public"."beegame_shadow_usage_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_storage_migration_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "source_storage_object_id" "uuid" NOT NULL,
    "destination_storage_object_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'queued'::"text" NOT NULL,
    "attempts" integer DEFAULT 0 NOT NULL,
    "last_error" "text",
    "started_at" timestamp with time zone,
    "verified_at" timestamp with time zone,
    "cutover_at" timestamp with time zone,
    "source_deleted_at" timestamp with time zone,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_storage_migration_jobs_attempts_check" CHECK (("attempts" >= 0)),
    CONSTRAINT "beegame_storage_migration_jobs_distinct_objects" CHECK (("source_storage_object_id" <> "destination_storage_object_id")),
    CONSTRAINT "beegame_storage_migration_jobs_status_check" CHECK (("status" = ANY (ARRAY['queued'::"text", 'copying'::"text", 'verifying'::"text", 'ready_to_cutover'::"text", 'cutover_complete'::"text", 'source_deleted'::"text", 'copy_failed'::"text", 'verification_failed'::"text", 'cutover_failed'::"text", 'delete_source_failed'::"text"])))
);


ALTER TABLE "public"."beegame_storage_migration_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_storage_objects" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "text" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "project_id" "text",
    "pack_id" "text",
    "deployment_id" "text",
    "session_id" "text",
    "provider" "text" NOT NULL,
    "bucket_role" "text",
    "bucket" "text" NOT NULL,
    "object_key" "text" NOT NULL,
    "logical_path" "text",
    "original_filename" "text",
    "mime_type" "text",
    "byte_size" bigint,
    "checksum_algorithm" "text",
    "checksum_value" "text",
    "etag" "text",
    "object_kind" "text" NOT NULL,
    "version_id" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "visibility" "text" DEFAULT 'private'::"text" NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "deleted_at" timestamp with time zone,
    "tombstoned_by" "uuid",
    "purge_after" timestamp with time zone,
    "purged_at" timestamp with time zone,
    "purge_error" "text",
    CONSTRAINT "beegame_storage_objects_bucket_role_check" CHECK (("bucket_role" = ANY (ARRAY['project-private'::"text", 'resource-private'::"text", 'delivery'::"text", 'log-private'::"text"]))),
    CONSTRAINT "beegame_storage_objects_byte_size_check" CHECK ((("byte_size" IS NULL) OR ("byte_size" >= 0))),
    CONSTRAINT "beegame_storage_objects_checksum_pair" CHECK (((("checksum_algorithm" IS NULL) AND ("checksum_value" IS NULL)) OR ((NULLIF("btrim"("checksum_algorithm"), ''::"text") IS NOT NULL) AND (NULLIF("btrim"("checksum_value"), ''::"text") IS NOT NULL)))),
    CONSTRAINT "beegame_storage_objects_provider_check" CHECK (("provider" = ANY (ARRAY['supabase'::"text", 'r2'::"text"]))),
    CONSTRAINT "beegame_storage_objects_r2_role" CHECK ((("provider" <> 'r2'::"text") OR ("bucket_role" IS NOT NULL))),
    CONSTRAINT "beegame_storage_objects_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['user'::"text", 'studio'::"text", 'platform'::"text", 'project'::"text", 'pack'::"text", 'deployment'::"text", 'session'::"text"]))),
    CONSTRAINT "beegame_storage_objects_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'verifying'::"text", 'ready'::"text", 'failed'::"text", 'deleted'::"text"]))),
    CONSTRAINT "beegame_storage_objects_visibility_check" CHECK (("visibility" = ANY (ARRAY['private'::"text", 'project'::"text", 'organization'::"text", 'public'::"text"])))
);


ALTER TABLE "public"."beegame_storage_objects" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_storage_quota_policies" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "scope_type" "text" NOT NULL,
    "scope_id" "text" NOT NULL,
    "bucket_role" "text" NOT NULL,
    "max_bytes" bigint NOT NULL,
    "max_objects" bigint NOT NULL,
    "created_by" "uuid" NOT NULL,
    "updated_by" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_storage_quota_platform_scope" CHECK ((("scope_type" <> 'platform'::"text") OR ("scope_id" = '*'::"text"))),
    CONSTRAINT "beegame_storage_quota_policies_bucket_role_check" CHECK (("bucket_role" = ANY (ARRAY['project-private'::"text", 'resource-private'::"text", 'delivery'::"text", 'log-private'::"text"]))),
    CONSTRAINT "beegame_storage_quota_policies_max_bytes_check" CHECK (("max_bytes" > 0)),
    CONSTRAINT "beegame_storage_quota_policies_max_objects_check" CHECK (("max_objects" > 0)),
    CONSTRAINT "beegame_storage_quota_policies_scope_type_check" CHECK (("scope_type" = ANY (ARRAY['platform'::"text", 'account'::"text", 'workspace'::"text"])))
);


ALTER TABLE "public"."beegame_storage_quota_policies" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_storage_upload_intents" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "storage_object_id" "uuid" NOT NULL,
    "owner_user_id" "uuid" NOT NULL,
    "upload_mode" "text" DEFAULT 'single'::"text" NOT NULL,
    "multipart_upload_id" "text",
    "idempotency_key" "text" NOT NULL,
    "expected_byte_size" bigint,
    "expected_mime_type" "text",
    "expected_checksum_algorithm" "text",
    "expected_checksum_value" "text",
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "expires_at" timestamp with time zone NOT NULL,
    "completed_at" timestamp with time zone,
    "last_error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_storage_upload_intents_checksum_pair" CHECK (((("expected_checksum_algorithm" IS NULL) AND ("expected_checksum_value" IS NULL)) OR ((NULLIF("btrim"("expected_checksum_algorithm"), ''::"text") IS NOT NULL) AND (NULLIF("btrim"("expected_checksum_value"), ''::"text") IS NOT NULL)))),
    CONSTRAINT "beegame_storage_upload_intents_expected_byte_size_check" CHECK ((("expected_byte_size" IS NULL) OR ("expected_byte_size" >= 0))),
    CONSTRAINT "beegame_storage_upload_intents_multipart_id" CHECK ((("upload_mode" = 'multipart'::"text") OR ("multipart_upload_id" IS NULL))),
    CONSTRAINT "beegame_storage_upload_intents_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'verifying'::"text", 'completed'::"text", 'failed'::"text", 'aborted'::"text", 'expired'::"text"]))),
    CONSTRAINT "beegame_storage_upload_intents_upload_mode_check" CHECK (("upload_mode" = ANY (ARRAY['single'::"text", 'multipart'::"text"])))
);


ALTER TABLE "public"."beegame_storage_upload_intents" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_upgrade_backup_20260902" (
    "source_table" "text" NOT NULL,
    "record_id" "text" NOT NULL,
    "fields" "jsonb" NOT NULL,
    "backed_up_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_upgrade_backup_20260902" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_usage_debit_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "amount_credits_micro" bigint NOT NULL,
    "result" "jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_usage_debit_events_amount_credits_micro_check" CHECK (("amount_credits_micro" >= 0))
);


ALTER TABLE "public"."beegame_usage_debit_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_usage_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "session_id" "text" NOT NULL,
    "turn_id" "text",
    "project_id" "text",
    "idempotency_key" "text" NOT NULL,
    "pricing_version" "text" DEFAULT 'weighted-v1'::"text" NOT NULL,
    "usage_source" "text" NOT NULL,
    "prompt_tokens" bigint DEFAULT 0 NOT NULL,
    "completion_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens" bigint DEFAULT 0 NOT NULL,
    "total_tokens" bigint DEFAULT 0 NOT NULL,
    "prompt_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "completion_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "cache_read_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "cache_creation_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "total_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "weighted_tokens" bigint DEFAULT 0 NOT NULL,
    "weighted_tokens_delta" bigint DEFAULT 0 NOT NULL,
    "credits_micro" bigint DEFAULT 0 NOT NULL,
    "metadata" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_usage_events_cache_creation_tokens_check" CHECK (("cache_creation_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_cache_creation_tokens_delta_check" CHECK (("cache_creation_tokens_delta" >= 0)),
    CONSTRAINT "beegame_usage_events_cache_read_tokens_check" CHECK (("cache_read_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_cache_read_tokens_delta_check" CHECK (("cache_read_tokens_delta" >= 0)),
    CONSTRAINT "beegame_usage_events_completion_tokens_check" CHECK (("completion_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_completion_tokens_delta_check" CHECK (("completion_tokens_delta" >= 0)),
    CONSTRAINT "beegame_usage_events_credits_micro_check" CHECK (("credits_micro" >= 0)),
    CONSTRAINT "beegame_usage_events_prompt_tokens_check" CHECK (("prompt_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_prompt_tokens_delta_check" CHECK (("prompt_tokens_delta" >= 0)),
    CONSTRAINT "beegame_usage_events_total_tokens_check" CHECK (("total_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_total_tokens_delta_check" CHECK (("total_tokens_delta" >= 0)),
    CONSTRAINT "beegame_usage_events_usage_source_check" CHECK (("usage_source" = ANY (ARRAY['runtime_snapshot'::"text", 'model_runtime_host'::"text"]))),
    CONSTRAINT "beegame_usage_events_weighted_tokens_check" CHECK (("weighted_tokens" >= 0)),
    CONSTRAINT "beegame_usage_events_weighted_tokens_delta_check" CHECK (("weighted_tokens_delta" >= 0))
);


ALTER TABLE "public"."beegame_usage_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_usage_wallets" (
    "user_id" "uuid" NOT NULL,
    "included_credits_micro" bigint DEFAULT 300000000 NOT NULL,
    "consumed_credits_micro" bigint DEFAULT 0 NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_usage_wallets_consumed_credits_micro_check" CHECK (("consumed_credits_micro" >= 0)),
    CONSTRAINT "beegame_usage_wallets_included_credits_micro_check" CHECK (("included_credits_micro" >= 0))
);


ALTER TABLE "public"."beegame_usage_wallets" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_user_skills" (
    "id" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "slug" "text" NOT NULL,
    "name" "text" NOT NULL,
    "description" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "content" "text" NOT NULL,
    "references" "jsonb" DEFAULT '[]'::"jsonb" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_user_skills" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_web_tools" (
    "owner_id" "uuid" NOT NULL,
    "config" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_web_tools" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_workspace_members" (
    "workspace_id" "uuid" NOT NULL,
    "user_id" "uuid" NOT NULL,
    "role" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "beegame_workspace_members_role_check" CHECK (("role" = ANY (ARRAY['owner'::"text", 'developer'::"text", 'reviewer'::"text", 'viewer'::"text"])))
);


ALTER TABLE "public"."beegame_workspace_members" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."beegame_workspaces" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "owner_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."beegame_workspaces" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."waitlist_signups" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "name" "text" NOT NULL,
    "email" "text" NOT NULL,
    "persona" "text" NOT NULL,
    "locale" "text" NOT NULL,
    "source" "text" DEFAULT 'landing-page'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "waitlist_signups_email_check" CHECK ((("email" = "lower"("btrim"("email"))) AND (("char_length"("email") >= 3) AND ("char_length"("email") <= 320)) AND ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::"text"))),
    CONSTRAINT "waitlist_signups_locale_check" CHECK (("locale" = ANY (ARRAY['zh-CN'::"text", 'en'::"text", 'ja'::"text", 'ko'::"text"]))),
    CONSTRAINT "waitlist_signups_name_check" CHECK ((("name" = "btrim"("name")) AND (("char_length"("name") >= 1) AND ("char_length"("name") <= 80)))),
    CONSTRAINT "waitlist_signups_persona_check" CHECK (("persona" = ANY (ARRAY['idea'::"text", 'creator'::"text", 'investor'::"text"]))),
    CONSTRAINT "waitlist_signups_source_check" CHECK (("source" = 'landing-page'::"text"))
);


ALTER TABLE "public"."waitlist_signups" OWNER TO "postgres";


ALTER TABLE ONLY "public"."beegame_account_links"
    ADD CONSTRAINT "beegame_account_links_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."beegame_assets"
    ADD CONSTRAINT "beegame_assets_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_audit_events"
    ADD CONSTRAINT "beegame_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_billing_credit_packs"
    ADD CONSTRAINT "beegame_billing_credit_packs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_billing_credit_packs"
    ADD CONSTRAINT "beegame_billing_credit_packs_provider_price_id_key" UNIQUE ("provider", "price_id");



ALTER TABLE ONLY "public"."beegame_billing_events"
    ADD CONSTRAINT "beegame_billing_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_deployments"
    ADD CONSTRAINT "beegame_deployments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_invitation_redemptions"
    ADD CONSTRAINT "beegame_invitation_redemptions_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."beegame_invitation_settings"
    ADD CONSTRAINT "beegame_invitation_settings_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_invitations"
    ADD CONSTRAINT "beegame_invitations_code_hash_key" UNIQUE ("code_hash");



ALTER TABLE ONLY "public"."beegame_invitations"
    ADD CONSTRAINT "beegame_invitations_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_mcp_servers"
    ADD CONSTRAINT "beegame_mcp_servers_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_model_configs"
    ADD CONSTRAINT "beegame_model_configs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_oauth_invitation_nonces"
    ADD CONSTRAINT "beegame_oauth_invitation_nonces_pkey" PRIMARY KEY ("nonce");



ALTER TABLE ONLY "public"."beegame_platform_owner_invites"
    ADD CONSTRAINT "beegame_platform_owner_invites_pkey" PRIMARY KEY ("email");



ALTER TABLE ONLY "public"."beegame_platform_settings"
    ADD CONSTRAINT "beegame_platform_settings_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."beegame_previews"
    ADD CONSTRAINT "beegame_previews_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_profiles"
    ADD CONSTRAINT "beegame_profiles_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."beegame_project_revisions"
    ADD CONSTRAINT "beegame_project_revisions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_projects"
    ADD CONSTRAINT "beegame_projects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_audit_events"
    ADD CONSTRAINT "beegame_resource_audit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_dependencies"
    ADD CONSTRAINT "beegame_resource_dependencies_pkey" PRIMARY KEY ("element_id", "dependency_path");



ALTER TABLE ONLY "public"."beegame_resource_elements"
    ADD CONSTRAINT "beegame_resource_elements_pack_id_path_key" UNIQUE ("pack_id", "path");



ALTER TABLE ONLY "public"."beegame_resource_elements"
    ADD CONSTRAINT "beegame_resource_elements_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_folders"
    ADD CONSTRAINT "beegame_resource_folders_pack_id_path_key" UNIQUE ("pack_id", "path");



ALTER TABLE ONLY "public"."beegame_resource_folders"
    ADD CONSTRAINT "beegame_resource_folders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_packs"
    ADD CONSTRAINT "beegame_resource_packs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_processing_items"
    ADD CONSTRAINT "beegame_resource_processing_items_job_id_element_id_key" UNIQUE ("job_id", "element_id");



ALTER TABLE ONLY "public"."beegame_resource_processing_items"
    ADD CONSTRAINT "beegame_resource_processing_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_resource_processing_jobs"
    ADD CONSTRAINT "beegame_resource_processing_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_runtime_settings"
    ADD CONSTRAINT "beegame_runtime_settings_pkey" PRIMARY KEY ("owner_id");



ALTER TABLE ONLY "public"."beegame_sessions"
    ADD CONSTRAINT "beegame_sessions_id_project_owner_key" UNIQUE ("id", "project_id", "owner_id");



ALTER TABLE ONLY "public"."beegame_sessions"
    ADD CONSTRAINT "beegame_sessions_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_shadow_usage_events"
    ADD CONSTRAINT "beegame_shadow_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_shadow_usage_events"
    ADD CONSTRAINT "beegame_shadow_usage_events_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."beegame_storage_migration_jobs"
    ADD CONSTRAINT "beegame_storage_migration_job_source_storage_object_id_dest_key" UNIQUE ("source_storage_object_id", "destination_storage_object_id");



ALTER TABLE ONLY "public"."beegame_storage_migration_jobs"
    ADD CONSTRAINT "beegame_storage_migration_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_storage_quota_policies"
    ADD CONSTRAINT "beegame_storage_quota_policie_scope_type_scope_id_bucket_ro_key" UNIQUE ("scope_type", "scope_id", "bucket_role");



ALTER TABLE ONLY "public"."beegame_storage_quota_policies"
    ADD CONSTRAINT "beegame_storage_quota_policies_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_storage_upload_intents"
    ADD CONSTRAINT "beegame_storage_upload_intents_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_upgrade_backup_20260902"
    ADD CONSTRAINT "beegame_upgrade_backup_20260902_pkey" PRIMARY KEY ("source_table", "record_id");



ALTER TABLE ONLY "public"."beegame_usage_debit_events"
    ADD CONSTRAINT "beegame_usage_debit_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_usage_debit_events"
    ADD CONSTRAINT "beegame_usage_debit_events_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."beegame_usage_events"
    ADD CONSTRAINT "beegame_usage_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_usage_events"
    ADD CONSTRAINT "beegame_usage_events_user_id_idempotency_key_key" UNIQUE ("user_id", "idempotency_key");



ALTER TABLE ONLY "public"."beegame_usage_wallets"
    ADD CONSTRAINT "beegame_usage_wallets_pkey" PRIMARY KEY ("user_id");



ALTER TABLE ONLY "public"."beegame_user_skills"
    ADD CONSTRAINT "beegame_user_skills_owner_id_slug_key" UNIQUE ("owner_id", "slug");



ALTER TABLE ONLY "public"."beegame_user_skills"
    ADD CONSTRAINT "beegame_user_skills_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."beegame_web_tools"
    ADD CONSTRAINT "beegame_web_tools_pkey" PRIMARY KEY ("owner_id");



ALTER TABLE ONLY "public"."beegame_workspace_members"
    ADD CONSTRAINT "beegame_workspace_members_pkey" PRIMARY KEY ("workspace_id", "user_id");



ALTER TABLE ONLY "public"."beegame_workspaces"
    ADD CONSTRAINT "beegame_workspaces_owner_id_key" UNIQUE ("owner_id");



ALTER TABLE ONLY "public"."beegame_workspaces"
    ADD CONSTRAINT "beegame_workspaces_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."waitlist_signups"
    ADD CONSTRAINT "waitlist_signups_email_key" UNIQUE ("email");



ALTER TABLE ONLY "public"."waitlist_signups"
    ADD CONSTRAINT "waitlist_signups_pkey" PRIMARY KEY ("id");



CREATE INDEX "beegame_account_links_email_idx" ON "public"."beegame_account_links" USING "btree" ("lower"("email"));



CREATE INDEX "beegame_billing_credit_packs_enabled_idx" ON "public"."beegame_billing_credit_packs" USING "btree" ("provider", "enabled", "sort_order", "credits");



CREATE INDEX "beegame_billing_events_provider_created_idx" ON "public"."beegame_billing_events" USING "btree" ("provider", "created_at" DESC);



CREATE INDEX "beegame_billing_events_provider_event_idx" ON "public"."beegame_billing_events" USING "btree" ("provider", "provider_event_id");



CREATE INDEX "beegame_deployments_owner_session_idx" ON "public"."beegame_deployments" USING "btree" ("owner_id", "session_id", "created_at" DESC);



CREATE UNIQUE INDEX "beegame_model_configs_one_default_per_owner" ON "public"."beegame_model_configs" USING "btree" ("owner_id") WHERE ("is_default" = true);



CREATE UNIQUE INDEX "beegame_project_revisions_one_active_idx" ON "public"."beegame_project_revisions" USING "btree" ("project_id") WHERE ("status" = 'active'::"text");



CREATE INDEX "beegame_project_revisions_project_created_idx" ON "public"."beegame_project_revisions" USING "btree" ("project_id", "created_at" DESC);



CREATE INDEX "beegame_resource_audit_events_pack_created_idx" ON "public"."beegame_resource_audit_events" USING "btree" ("pack_id", "created_at" DESC);



CREATE INDEX "beegame_resource_elements_asset_kind_idx" ON "public"."beegame_resource_elements" USING "btree" ("pack_id", "asset_kind");



CREATE INDEX "beegame_resource_elements_capabilities_idx" ON "public"."beegame_resource_elements" USING "gin" ("capabilities");



CREATE INDEX "beegame_resource_elements_dependency_bindings_idx" ON "public"."beegame_resource_elements" USING "gin" ("dependency_bindings");



CREATE INDEX "beegame_resource_elements_pack_category_idx" ON "public"."beegame_resource_elements" USING "btree" ("pack_id", "category", "path");



CREATE INDEX "beegame_resource_elements_relations_idx" ON "public"."beegame_resource_elements" USING "gin" ("relations");



CREATE INDEX "beegame_resource_elements_usage_tags_idx" ON "public"."beegame_resource_elements" USING "gin" ("usage_tags");



CREATE INDEX "beegame_resource_folders_pack_parent_idx" ON "public"."beegame_resource_folders" USING "btree" ("pack_id", "parent_id", "path");



CREATE INDEX "beegame_resource_packs_compatible_engines_idx" ON "public"."beegame_resource_packs" USING "gin" ("compatible_engines");



CREATE INDEX "beegame_resource_packs_created_by_idx" ON "public"."beegame_resource_packs" USING "btree" ("created_by", "status", "updated_at" DESC);



CREATE INDEX "beegame_resource_packs_tags_idx" ON "public"."beegame_resource_packs" USING "gin" ("tags");



CREATE INDEX "beegame_resource_processing_items_job_status_idx" ON "public"."beegame_resource_processing_items" USING "btree" ("job_id", "status", "created_at");



CREATE INDEX "beegame_resource_processing_jobs_pack_status_idx" ON "public"."beegame_resource_processing_jobs" USING "btree" ("pack_id", "status", "created_at" DESC);



CREATE INDEX "beegame_resource_processing_jobs_retry_of_idx" ON "public"."beegame_resource_processing_jobs" USING "btree" ("retry_of_job_id");



CREATE INDEX "beegame_shadow_usage_events_project_idx" ON "public"."beegame_shadow_usage_events" USING "btree" ("user_id", "project_id", "created_at" DESC);



CREATE INDEX "beegame_shadow_usage_events_session_idx" ON "public"."beegame_shadow_usage_events" USING "btree" ("user_id", "session_id", "created_at" DESC);



CREATE INDEX "beegame_storage_migration_jobs_work_idx" ON "public"."beegame_storage_migration_jobs" USING "btree" ("status", "updated_at");



CREATE UNIQUE INDEX "beegame_storage_objects_live_locator_idx" ON "public"."beegame_storage_objects" USING "btree" ("provider", "bucket", "object_key") WHERE ("deleted_at" IS NULL);



CREATE INDEX "beegame_storage_objects_owner_scope_idx" ON "public"."beegame_storage_objects" USING "btree" ("owner_user_id", "scope_type", "scope_id", "created_at" DESC);



CREATE INDEX "beegame_storage_objects_pack_idx" ON "public"."beegame_storage_objects" USING "btree" ("pack_id", "status", "object_kind") WHERE (("pack_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "beegame_storage_objects_project_idx" ON "public"."beegame_storage_objects" USING "btree" ("project_id", "status", "object_kind") WHERE (("project_id" IS NOT NULL) AND ("deleted_at" IS NULL));



CREATE INDEX "beegame_storage_objects_purge_idx" ON "public"."beegame_storage_objects" USING "btree" ("purge_after", "deleted_at") WHERE (("provider" = 'r2'::"text") AND ("status" = 'deleted'::"text") AND ("purged_at" IS NULL));



CREATE INDEX "beegame_storage_quota_policy_lookup_idx" ON "public"."beegame_storage_quota_policies" USING "btree" ("bucket_role", "scope_type", "scope_id");



CREATE UNIQUE INDEX "beegame_storage_upload_intents_idempotency_idx" ON "public"."beegame_storage_upload_intents" USING "btree" ("owner_user_id", "idempotency_key");



CREATE INDEX "beegame_storage_upload_intents_recovery_idx" ON "public"."beegame_storage_upload_intents" USING "btree" ("status", "expires_at") WHERE ("status" = ANY (ARRAY['pending'::"text", 'uploading'::"text", 'verifying'::"text"]));



CREATE INDEX "beegame_usage_events_project_idx" ON "public"."beegame_usage_events" USING "btree" ("user_id", "project_id", "created_at" DESC);



CREATE INDEX "beegame_usage_events_session_idx" ON "public"."beegame_usage_events" USING "btree" ("user_id", "session_id", "created_at" DESC);



CREATE INDEX "waitlist_signups_created_at_idx" ON "public"."waitlist_signups" USING "btree" ("created_at" DESC);



CREATE OR REPLACE VIEW "public"."beegame_resource_pack_catalog" WITH ("security_invoker"='true') AS
 WITH "selectable_elements" AS (
         SELECT "e_1"."id",
            "e_1"."pack_id",
            "e_1"."status",
            "e_1"."usage_tags_mode",
            "e_1"."usage_tags",
            "e_1"."asset_kind",
            "e_1"."specs",
            "e_1"."dependencies",
            "e_1"."dependency_bindings",
            "e_1"."relations",
            "e_1"."category",
            "e_1"."capabilities",
            "e_1"."path"
           FROM "public"."beegame_resource_elements" "e_1"
          WHERE (("e_1"."status" = 'ready'::"text") AND ("e_1"."usage_tags_mode" = 'override'::"text") AND ("cardinality"("e_1"."usage_tags") > 0) AND ("e_1"."asset_kind" IS NOT NULL) AND ("length"(COALESCE(("e_1"."specs" ->> 'contentHash'::"text"), ''::"text")) = 64) AND (NOT (EXISTS ( SELECT 1
                   FROM ("jsonb_array_elements_text"("e_1"."dependencies") "dependency_id"("value")
                     LEFT JOIN "public"."beegame_resource_elements" "dependency" ON (("dependency"."id" = "dependency_id"."value")))
                  WHERE (("dependency"."id" IS NULL) OR ("dependency"."status" <> 'ready'::"text"))))) AND (NOT (EXISTS ( SELECT 1
                   FROM ("jsonb_array_elements"("e_1"."dependency_bindings") "binding"("value")
                     LEFT JOIN "public"."beegame_resource_elements" "dependency" ON (("dependency"."id" = ("binding"."value" ->> 'dependencyElementId'::"text"))))
                  WHERE (("dependency"."id" IS NULL) OR ("dependency"."status" <> 'ready'::"text"))))) AND (NOT (EXISTS ( SELECT 1
                   FROM ("jsonb_array_elements"("e_1"."relations") "relation"("value")
                     LEFT JOIN "public"."beegame_resource_elements" "target" ON (("target"."id" = ("relation"."value" ->> 'targetElementId'::"text"))))
                  WHERE ((COALESCE(("relation"."value" ->> 'required'::"text"), 'true'::"text") = 'true'::"text") AND (("target"."id" IS NULL) OR ("target"."status" <> 'ready'::"text")))))))
        )
 SELECT "p"."id" AS "pack_id",
    "p"."version" AS "pack_version",
    "p"."name" AS "pack_name",
    "p"."styles",
    ARRAY( SELECT "jsonb_array_elements_text"("p"."game_types") AS "jsonb_array_elements_text") AS "game_types",
    "p"."dimension",
    "p"."primary_category",
    COALESCE("array_agg"(DISTINCT "e"."category") FILTER (WHERE ("e"."id" IS NOT NULL)), '{}'::"text"[]) AS "categories",
    COALESCE("p"."tags", '{}'::"text"[]) AS "tags",
    ("count"("e"."id"))::integer AS "ready_element_count",
    COALESCE("array_agg"(DISTINCT "e"."asset_kind") FILTER (WHERE ("e"."asset_kind" IS NOT NULL)), '{}'::"text"[]) AS "asset_kinds",
    COALESCE(ARRAY( SELECT DISTINCT "unnest"("e2"."usage_tags") AS "unnest"
           FROM "selectable_elements" "e2"
          WHERE ("e2"."pack_id" = "p"."id")), '{}'::"text"[]) AS "usage_tags",
    COALESCE(ARRAY( SELECT DISTINCT "unnest"("e3"."capabilities") AS "unnest"
           FROM "selectable_elements" "e3"
          WHERE ("e3"."pack_id" = "p"."id")), '{}'::"text"[]) AS "capabilities",
    COALESCE("array_agg"(DISTINCT "lower"("reverse"("split_part"("reverse"("e"."path"), '.'::"text", 1)))) FILTER (WHERE (("e"."id" IS NOT NULL) AND ("e"."path" ~~ '%.%'::"text"))), '{}'::"text"[]) AS "formats",
    "p"."description",
    "p"."license",
    "p"."author",
    "p"."source",
    COALESCE("p"."compatible_engines", '{}'::"text"[]) AS "compatible_engines"
   FROM ("public"."beegame_resource_packs" "p"
     LEFT JOIN "selectable_elements" "e" ON (("e"."pack_id" = "p"."id")))
  WHERE ("p"."status" = 'published'::"text")
  GROUP BY "p"."id";



CREATE OR REPLACE TRIGGER "beegame_project_identity_immutable" BEFORE UPDATE ON "public"."beegame_projects" FOR EACH ROW EXECUTE FUNCTION "public"."beegame_reject_project_identity_change"();



CREATE OR REPLACE TRIGGER "beegame_resource_elements_storage_binding" BEFORE INSERT OR UPDATE OF "pack_id", "storage_object_id" ON "public"."beegame_resource_elements" FOR EACH ROW EXECUTE FUNCTION "public"."beegame_assert_resource_storage_binding"();



CREATE OR REPLACE TRIGGER "beegame_resource_elements_sync_pack_count" AFTER INSERT OR DELETE OR UPDATE OF "pack_id" ON "public"."beegame_resource_elements" FOR EACH ROW EXECUTE FUNCTION "public"."beegame_sync_resource_pack_element_count"();



CREATE OR REPLACE TRIGGER "beegame_resource_packs_cover_storage_binding" BEFORE INSERT OR UPDATE OF "cover_path", "cover_storage_object_id" ON "public"."beegame_resource_packs" FOR EACH ROW EXECUTE FUNCTION "public"."beegame_assert_resource_storage_binding"();



ALTER TABLE ONLY "public"."beegame_account_links"
    ADD CONSTRAINT "beegame_account_links_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_account_links"
    ADD CONSTRAINT "beegame_account_links_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_assets"
    ADD CONSTRAINT "beegame_assets_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_assets"
    ADD CONSTRAINT "beegame_assets_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_audit_events"
    ADD CONSTRAINT "beegame_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_audit_events"
    ADD CONSTRAINT "beegame_audit_events_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_audit_events"
    ADD CONSTRAINT "beegame_audit_events_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."beegame_workspaces"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_billing_events"
    ADD CONSTRAINT "beegame_billing_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_deployments"
    ADD CONSTRAINT "beegame_deployments_manifest_storage_object_id_fkey" FOREIGN KEY ("manifest_storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_deployments"
    ADD CONSTRAINT "beegame_deployments_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_deployments"
    ADD CONSTRAINT "beegame_deployments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_deployments"
    ADD CONSTRAINT "beegame_deployments_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."beegame_sessions"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_invitation_redemptions"
    ADD CONSTRAINT "beegame_invitation_redemptions_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "public"."beegame_invitations"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_invitation_redemptions"
    ADD CONSTRAINT "beegame_invitation_redemptions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_invitation_settings"
    ADD CONSTRAINT "beegame_invitation_settings_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_invitations"
    ADD CONSTRAINT "beegame_invitations_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_mcp_servers"
    ADD CONSTRAINT "beegame_mcp_servers_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_model_configs"
    ADD CONSTRAINT "beegame_model_configs_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_oauth_invitation_nonces"
    ADD CONSTRAINT "beegame_oauth_invitation_nonces_consumed_by_fkey" FOREIGN KEY ("consumed_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_oauth_invitation_nonces"
    ADD CONSTRAINT "beegame_oauth_invitation_nonces_invitation_id_fkey" FOREIGN KEY ("invitation_id") REFERENCES "public"."beegame_invitations"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_platform_owner_invites"
    ADD CONSTRAINT "beegame_platform_owner_invites_claimed_user_id_fkey" FOREIGN KEY ("claimed_user_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_previews"
    ADD CONSTRAINT "beegame_previews_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_previews"
    ADD CONSTRAINT "beegame_previews_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_profiles"
    ADD CONSTRAINT "beegame_profiles_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_project_revisions"
    ADD CONSTRAINT "beegame_project_revisions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_project_revisions"
    ADD CONSTRAINT "beegame_project_revisions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_project_revisions"
    ADD CONSTRAINT "beegame_project_revisions_snapshot_storage_object_id_fkey" FOREIGN KEY ("snapshot_storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_projects"
    ADD CONSTRAINT "beegame_projects_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_projects"
    ADD CONSTRAINT "beegame_projects_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."beegame_workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_audit_events"
    ADD CONSTRAINT "beegame_resource_audit_events_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_resource_audit_events"
    ADD CONSTRAINT "beegame_resource_audit_events_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "public"."beegame_resource_elements"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_resource_audit_events"
    ADD CONSTRAINT "beegame_resource_audit_events_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "public"."beegame_resource_packs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_resource_dependencies"
    ADD CONSTRAINT "beegame_resource_dependencies_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "public"."beegame_resource_elements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_elements"
    ADD CONSTRAINT "beegame_resource_elements_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "public"."beegame_resource_packs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_elements"
    ADD CONSTRAINT "beegame_resource_elements_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_resource_folders"
    ADD CONSTRAINT "beegame_resource_folders_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "public"."beegame_resource_packs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_folders"
    ADD CONSTRAINT "beegame_resource_folders_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "public"."beegame_resource_folders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_packs"
    ADD CONSTRAINT "beegame_resource_packs_cover_storage_object_id_fkey" FOREIGN KEY ("cover_storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_resource_packs"
    ADD CONSTRAINT "beegame_resource_packs_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_resource_processing_items"
    ADD CONSTRAINT "beegame_resource_processing_items_element_id_fkey" FOREIGN KEY ("element_id") REFERENCES "public"."beegame_resource_elements"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_processing_items"
    ADD CONSTRAINT "beegame_resource_processing_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "public"."beegame_resource_processing_jobs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_processing_jobs"
    ADD CONSTRAINT "beegame_resource_processing_jobs_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "public"."beegame_resource_packs"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_resource_processing_jobs"
    ADD CONSTRAINT "beegame_resource_processing_jobs_retry_of_job_id_fkey" FOREIGN KEY ("retry_of_job_id") REFERENCES "public"."beegame_resource_processing_jobs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_runtime_settings"
    ADD CONSTRAINT "beegame_runtime_settings_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_sessions"
    ADD CONSTRAINT "beegame_sessions_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_sessions"
    ADD CONSTRAINT "beegame_sessions_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_shadow_usage_events"
    ADD CONSTRAINT "beegame_shadow_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_storage_migration_jobs"
    ADD CONSTRAINT "beegame_storage_migration_job_destination_storage_object_i_fkey" FOREIGN KEY ("destination_storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_storage_migration_jobs"
    ADD CONSTRAINT "beegame_storage_migration_jobs_source_storage_object_id_fkey" FOREIGN KEY ("source_storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_deployment_id_fkey" FOREIGN KEY ("deployment_id") REFERENCES "public"."beegame_deployments"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_pack_id_fkey" FOREIGN KEY ("pack_id") REFERENCES "public"."beegame_resource_packs"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "public"."beegame_projects"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "public"."beegame_sessions"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_storage_objects"
    ADD CONSTRAINT "beegame_storage_objects_tombstoned_by_fkey" FOREIGN KEY ("tombstoned_by") REFERENCES "auth"."users"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."beegame_storage_quota_policies"
    ADD CONSTRAINT "beegame_storage_quota_policies_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_storage_quota_policies"
    ADD CONSTRAINT "beegame_storage_quota_policies_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "auth"."users"("id") ON DELETE RESTRICT;



ALTER TABLE ONLY "public"."beegame_storage_upload_intents"
    ADD CONSTRAINT "beegame_storage_upload_intents_owner_user_id_fkey" FOREIGN KEY ("owner_user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_storage_upload_intents"
    ADD CONSTRAINT "beegame_storage_upload_intents_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "public"."beegame_storage_objects"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_usage_debit_events"
    ADD CONSTRAINT "beegame_usage_debit_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_usage_events"
    ADD CONSTRAINT "beegame_usage_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_usage_wallets"
    ADD CONSTRAINT "beegame_usage_wallets_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_user_skills"
    ADD CONSTRAINT "beegame_user_skills_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_web_tools"
    ADD CONSTRAINT "beegame_web_tools_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_workspace_members"
    ADD CONSTRAINT "beegame_workspace_members_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_workspace_members"
    ADD CONSTRAINT "beegame_workspace_members_workspace_id_fkey" FOREIGN KEY ("workspace_id") REFERENCES "public"."beegame_workspaces"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."beegame_workspaces"
    ADD CONSTRAINT "beegame_workspaces_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



CREATE POLICY "account link owner access" ON "public"."beegame_account_links" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR ("account_id" = "public"."beegame_account_id"("auth"."uid"()))));



CREATE POLICY "asset owner access" ON "public"."beegame_assets" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "asset workspace read" ON "public"."beegame_assets" FOR SELECT USING ("public"."beegame_can_read_project"("project_id"));



CREATE POLICY "asset workspace write" ON "public"."beegame_assets" USING ("public"."beegame_can_edit_project"("project_id")) WITH CHECK (("public"."beegame_can_edit_project"("project_id") AND ("owner_id" = "public"."beegame_project_owner_id"("project_id"))));



CREATE POLICY "audit actor insert" ON "public"."beegame_audit_events" FOR INSERT WITH CHECK (("actor_id" = "auth"."uid"()));



CREATE POLICY "audit owner access" ON "public"."beegame_audit_events" FOR SELECT USING (("actor_id" = "auth"."uid"()));



CREATE POLICY "audit workspace insert" ON "public"."beegame_audit_events" FOR INSERT WITH CHECK ((("actor_id" = "auth"."uid"()) AND (("project_id" IS NULL) OR "public"."beegame_can_edit_project"("project_id"))));



CREATE POLICY "audit workspace read" ON "public"."beegame_audit_events" FOR SELECT USING ((("actor_id" = "auth"."uid"()) OR (("project_id" IS NOT NULL) AND "public"."beegame_can_read_project"("project_id"))));



ALTER TABLE "public"."beegame_account_links" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_assets" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_billing_credit_packs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_billing_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_deployments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_invitation_redemptions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_invitation_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_invitations" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_mcp_servers" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_model_configs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_oauth_invitation_nonces" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_platform_owner_invites" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_platform_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_previews" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_profiles" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_project_revisions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_projects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_audit_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_dependencies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_elements" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_folders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_packs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_processing_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_resource_processing_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_runtime_settings" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_sessions" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_storage_migration_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_storage_objects" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_storage_quota_policies" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_storage_upload_intents" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_user_skills" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_web_tools" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_workspace_members" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."beegame_workspaces" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "billing credit packs owner manage" ON "public"."beegame_billing_credit_packs" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "billing credit packs owner read" ON "public"."beegame_billing_credit_packs" FOR SELECT USING ("public"."beegame_is_platform_owner"());



CREATE POLICY "billing events owner read" ON "public"."beegame_billing_events" FOR SELECT USING ("public"."beegame_is_platform_owner"());



CREATE POLICY "deployment owner access" ON "public"."beegame_deployments" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "deployment workspace read" ON "public"."beegame_deployments" FOR SELECT USING ((("project_id" IS NOT NULL) AND "public"."beegame_can_read_project"("project_id")));



CREATE POLICY "deployment workspace write" ON "public"."beegame_deployments" USING ((("project_id" IS NOT NULL) AND "public"."beegame_can_edit_project"("project_id"))) WITH CHECK ((("project_id" IS NOT NULL) AND "public"."beegame_can_edit_project"("project_id") AND ("owner_id" = "public"."beegame_project_owner_id"("project_id"))));



CREATE POLICY "invitation platform owner access" ON "public"."beegame_invitations" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "invitation redemption owner read" ON "public"."beegame_invitation_redemptions" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."beegame_is_platform_owner"()));



CREATE POLICY "invitation settings platform owner access" ON "public"."beegame_invitation_settings" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "mcp server owner access" ON "public"."beegame_mcp_servers" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "model config managed by platform owner" ON "public"."beegame_model_configs" USING ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"()));



CREATE POLICY "model config readable by effective owner" ON "public"."beegame_model_configs" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("owner_id" = "public"."beegame_model_config_owner_id"("auth"."uid"()))));



CREATE POLICY "oauth invitation nonce platform owner read" ON "public"."beegame_oauth_invitation_nonces" FOR SELECT USING ("public"."beegame_is_platform_owner"());



CREATE POLICY "platform settings authenticated read" ON "public"."beegame_platform_settings" FOR SELECT USING (("auth"."uid"() IS NOT NULL));



CREATE POLICY "platform settings managed by platform owner" ON "public"."beegame_platform_settings" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "preview owner access" ON "public"."beegame_previews" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "preview workspace read" ON "public"."beegame_previews" FOR SELECT USING ("public"."beegame_can_read_project"("project_id"));



CREATE POLICY "preview workspace write" ON "public"."beegame_previews" USING ("public"."beegame_can_edit_project"("project_id")) WITH CHECK (("public"."beegame_can_edit_project"("project_id") AND ("owner_id" = "public"."beegame_project_owner_id"("project_id"))));



CREATE POLICY "profile owner access" ON "public"."beegame_profiles" USING (("auth"."uid"() = "user_id")) WITH CHECK (("auth"."uid"() = "user_id"));



CREATE POLICY "project owner access" ON "public"."beegame_projects" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "project revision workspace read" ON "public"."beegame_project_revisions" FOR SELECT USING ("public"."beegame_can_read_project"("project_id"));



CREATE POLICY "project workspace create" ON "public"."beegame_projects" FOR INSERT WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."beegame_can_create_project"("workspace_id")));



CREATE POLICY "project workspace delete" ON "public"."beegame_projects" FOR DELETE USING ("public"."beegame_can_delete_project"("id"));



CREATE POLICY "project workspace read" ON "public"."beegame_projects" FOR SELECT USING ("public"."beegame_can_read_project"("id"));



CREATE POLICY "project workspace update" ON "public"."beegame_projects" FOR UPDATE USING ("public"."beegame_can_edit_project"("id")) WITH CHECK ("public"."beegame_can_create_project"("workspace_id"));



CREATE POLICY "public can join waitlist" ON "public"."waitlist_signups" FOR INSERT TO "authenticated", "anon" WITH CHECK ((("name" = "btrim"("name")) AND (("char_length"("name") >= 1) AND ("char_length"("name") <= 80)) AND ("email" = "lower"("btrim"("email"))) AND (("char_length"("email") >= 3) AND ("char_length"("email") <= 320)) AND ("email" ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'::"text") AND ("persona" = ANY (ARRAY['idea'::"text", 'creator'::"text", 'investor'::"text"])) AND ("locale" = ANY (ARRAY['zh-CN'::"text", 'en'::"text", 'ja'::"text", 'ko'::"text"])) AND ("source" = 'landing-page'::"text")));



CREATE POLICY "resource Pack owner access" ON "public"."beegame_resource_packs" USING (("public"."beegame_is_platform_owner"() OR ("created_by" = "auth"."uid"()))) WITH CHECK (("public"."beegame_is_platform_owner"() OR ("created_by" = "auth"."uid"())));



CREATE POLICY "resource Pack platform owner access" ON "public"."beegame_resource_packs" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "resource audit platform owner read" ON "public"."beegame_resource_audit_events" FOR SELECT USING ("public"."beegame_is_platform_owner"());



CREATE POLICY "resource dependency owner access" ON "public"."beegame_resource_dependencies" USING ((EXISTS ( SELECT 1
   FROM "public"."beegame_resource_elements" "element"
  WHERE (("element"."id" = "beegame_resource_dependencies"."element_id") AND "public"."beegame_can_manage_resource_pack"("element"."pack_id"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."beegame_resource_elements" "element"
  WHERE (("element"."id" = "beegame_resource_dependencies"."element_id") AND "public"."beegame_can_manage_resource_pack"("element"."pack_id")))));



CREATE POLICY "resource dependency platform owner access" ON "public"."beegame_resource_dependencies" USING ((EXISTS ( SELECT 1
   FROM "public"."beegame_resource_elements" "e"
  WHERE (("e"."id" = "beegame_resource_dependencies"."element_id") AND "public"."beegame_is_platform_owner"())))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."beegame_resource_elements" "e"
  WHERE (("e"."id" = "beegame_resource_dependencies"."element_id") AND "public"."beegame_is_platform_owner"()))));



CREATE POLICY "resource element owner access" ON "public"."beegame_resource_elements" USING ("public"."beegame_can_manage_resource_pack"("pack_id")) WITH CHECK ("public"."beegame_can_manage_resource_pack"("pack_id"));



CREATE POLICY "resource element platform owner access" ON "public"."beegame_resource_elements" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "resource folder owner access" ON "public"."beegame_resource_folders" USING ("public"."beegame_can_manage_resource_pack"("pack_id")) WITH CHECK ("public"."beegame_can_manage_resource_pack"("pack_id"));



CREATE POLICY "resource folder platform owner access" ON "public"."beegame_resource_folders" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "resource processing item platform owner access" ON "public"."beegame_resource_processing_items" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "resource processing job platform owner access" ON "public"."beegame_resource_processing_jobs" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "runtime settings managed by platform owner" ON "public"."beegame_runtime_settings" USING ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"()));



CREATE POLICY "runtime settings readable by effective owner" ON "public"."beegame_runtime_settings" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("owner_id" = "public"."beegame_model_config_owner_id"("auth"."uid"())) OR "public"."beegame_is_platform_owner_id"("owner_id")));



CREATE POLICY "session owner access" ON "public"."beegame_sessions" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "session workspace read" ON "public"."beegame_sessions" FOR SELECT USING ("public"."beegame_can_read_project"("project_id"));



CREATE POLICY "session workspace write" ON "public"."beegame_sessions" USING ("public"."beegame_can_edit_project"("project_id")) WITH CHECK (("public"."beegame_can_edit_project"("project_id") AND ("owner_id" = "public"."beegame_project_owner_id"("project_id"))));



CREATE POLICY "storage migration owner read" ON "public"."beegame_storage_migration_jobs" FOR SELECT USING (("public"."beegame_is_platform_owner"() OR (EXISTS ( SELECT 1
   FROM "public"."beegame_storage_objects" "source"
  WHERE (("source"."id" = "beegame_storage_migration_jobs"."source_storage_object_id") AND ("source"."owner_user_id" = "auth"."uid"()))))));



CREATE POLICY "storage object owner insert" ON "public"."beegame_storage_objects" FOR INSERT WITH CHECK ((("owner_user_id" = "auth"."uid"()) AND ((("scope_type" = 'user'::"text") AND ("scope_id" = ("auth"."uid"())::"text")) OR (("scope_type" = 'project'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_projects" "project"
  WHERE (("project"."id" = "beegame_storage_objects"."project_id") AND ("project"."owner_id" = "auth"."uid"()))))) OR (("scope_type" = 'pack'::"text") AND ("pack_id" IS NOT NULL) AND "public"."beegame_can_manage_resource_pack"("pack_id")) OR (("scope_type" = 'deployment'::"text") AND ("deployment_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_deployments" "deployment"
  WHERE (("deployment"."id" = "beegame_storage_objects"."deployment_id") AND ("deployment"."owner_id" = "auth"."uid"()))))) OR (("scope_type" = 'session'::"text") AND ("session_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_sessions" "session"
  WHERE (("session"."id" = "beegame_storage_objects"."session_id") AND ("session"."owner_id" = "auth"."uid"()))))) OR (("scope_type" = ANY (ARRAY['studio'::"text", 'platform'::"text"])) AND "public"."beegame_is_platform_owner"()))));



CREATE POLICY "storage object owner read" ON "public"."beegame_storage_objects" FOR SELECT USING ((("owner_user_id" = "auth"."uid"()) OR (("scope_type" = 'pack'::"text") AND ("pack_id" IS NOT NULL) AND "public"."beegame_can_manage_resource_pack"("pack_id")) OR "public"."beegame_is_platform_owner"()));



CREATE POLICY "storage object owner update" ON "public"."beegame_storage_objects" FOR UPDATE USING ((("owner_user_id" = "auth"."uid"()) OR (("scope_type" = 'pack'::"text") AND ("pack_id" IS NOT NULL) AND "public"."beegame_can_manage_resource_pack"("pack_id")) OR "public"."beegame_is_platform_owner"())) WITH CHECK (("public"."beegame_is_platform_owner"() OR (("owner_user_id" = "auth"."uid"()) AND ((("scope_type" = 'user'::"text") AND ("scope_id" = ("auth"."uid"())::"text")) OR (("scope_type" = 'project'::"text") AND ("project_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_projects" "project"
  WHERE (("project"."id" = "beegame_storage_objects"."project_id") AND ("project"."owner_id" = "auth"."uid"()))))) OR (("scope_type" = 'pack'::"text") AND ("pack_id" IS NOT NULL) AND "public"."beegame_can_manage_resource_pack"("pack_id")) OR (("scope_type" = 'deployment'::"text") AND ("deployment_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_deployments" "deployment"
  WHERE (("deployment"."id" = "beegame_storage_objects"."deployment_id") AND ("deployment"."owner_id" = "auth"."uid"()))))) OR (("scope_type" = 'session'::"text") AND ("session_id" IS NOT NULL) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_sessions" "session"
  WHERE (("session"."id" = "beegame_storage_objects"."session_id") AND ("session"."owner_id" = "auth"."uid"())))))))));



CREATE POLICY "storage object workspace read" ON "public"."beegame_storage_objects" FOR SELECT USING ((("owner_user_id" = "auth"."uid"()) OR (("project_id" IS NOT NULL) AND "public"."beegame_can_read_project"("project_id")) OR (("scope_type" = 'pack'::"text") AND ("pack_id" IS NOT NULL) AND "public"."beegame_can_manage_resource_pack"("pack_id")) OR "public"."beegame_is_platform_owner"()));



CREATE POLICY "storage quota platform owner access" ON "public"."beegame_storage_quota_policies" USING ("public"."beegame_is_platform_owner"()) WITH CHECK ("public"."beegame_is_platform_owner"());



CREATE POLICY "storage upload intent owner access" ON "public"."beegame_storage_upload_intents" USING ((("owner_user_id" = "auth"."uid"()) OR "public"."beegame_is_platform_owner"())) WITH CHECK (((("owner_user_id" = "auth"."uid"()) OR "public"."beegame_is_platform_owner"()) AND (EXISTS ( SELECT 1
   FROM "public"."beegame_storage_objects" "object"
  WHERE (("object"."id" = "beegame_storage_upload_intents"."storage_object_id") AND (("object"."owner_user_id" = "auth"."uid"()) OR "public"."beegame_is_platform_owner"()))))));



CREATE POLICY "user skill owner access" ON "public"."beegame_user_skills" USING (("owner_id" = "auth"."uid"())) WITH CHECK (("owner_id" = "auth"."uid"()));



ALTER TABLE "public"."waitlist_signups" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "web tools managed by platform owner" ON "public"."beegame_web_tools" USING ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"())) WITH CHECK ((("owner_id" = "auth"."uid"()) AND "public"."beegame_is_platform_owner"()));



CREATE POLICY "web tools readable by effective owner" ON "public"."beegame_web_tools" FOR SELECT USING ((("owner_id" = "auth"."uid"()) OR ("owner_id" = "public"."beegame_model_config_owner_id"("auth"."uid"()))));



CREATE POLICY "workspace member access" ON "public"."beegame_workspaces" USING ((EXISTS ( SELECT 1
   FROM "public"."beegame_workspace_members" "m"
  WHERE (("m"."workspace_id" = "beegame_workspaces"."id") AND ("m"."user_id" = "auth"."uid"()))))) WITH CHECK (("owner_id" = "auth"."uid"()));



CREATE POLICY "workspace membership access" ON "public"."beegame_workspace_members" FOR SELECT USING ((("user_id" = "auth"."uid"()) OR "public"."beegame_is_workspace_owner"("workspace_id")));



CREATE POLICY "workspace owner manages membership" ON "public"."beegame_workspace_members" USING ("public"."beegame_is_workspace_owner"("workspace_id")) WITH CHECK ("public"."beegame_is_workspace_owner"("workspace_id"));



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_account_id"("p_user_id" "uuid") TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."beegame_project_revisions" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."beegame_project_revisions" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_project_revisions" TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_activate_project_revision"("p_revision_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text", "p_max_uses" integer, "p_expires_at" timestamp with time zone) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text", "p_max_uses" integer, "p_expires_at" timestamp with time zone) TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text", "p_max_uses" integer, "p_expires_at" timestamp with time zone) TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_admin_create_invitation"("p_code" "text", "p_label" "text", "p_max_uses" integer, "p_expires_at" timestamp with time zone) TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_admin_delete_invitation"("p_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_admin_list_invitations"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_admin_list_invitations"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_admin_list_invitations"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_admin_list_invitations"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_admin_save_invitation_settings"("p_required" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text", "p_enabled" boolean, "p_max_uses" integer, "p_clear_max_uses" boolean, "p_expires_at" timestamp with time zone, "p_clear_expires_at" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text", "p_enabled" boolean, "p_max_uses" integer, "p_clear_max_uses" boolean, "p_expires_at" timestamp with time zone, "p_clear_expires_at" boolean) TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text", "p_enabled" boolean, "p_max_uses" integer, "p_clear_max_uses" boolean, "p_expires_at" timestamp with time zone, "p_clear_expires_at" boolean) TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_admin_update_invitation"("p_id" "uuid", "p_label" "text", "p_enabled" boolean, "p_max_uses" integer, "p_clear_max_uses" boolean, "p_expires_at" timestamp with time zone, "p_clear_expires_at" boolean) TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_append_confirmed_brief_revision"("p_owner_id" "uuid", "p_project_id" "text", "p_origin_session_id" "text", "p_schema_version" integer, "p_content" "jsonb", "p_content_digest" "text", "p_idempotency_key" "text", "p_expected_current_brief_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_append_confirmed_brief_revision"("p_owner_id" "uuid", "p_project_id" "text", "p_origin_session_id" "text", "p_schema_version" integer, "p_content" "jsonb", "p_content_digest" "text", "p_idempotency_key" "text", "p_expected_current_brief_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_assert_resource_storage_binding"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_assert_resource_storage_binding"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_assert_resource_storage_binding"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_can_create_project"("target_workspace_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_can_delete_project"("target_project_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_can_edit_project"("target_project_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_can_manage_resource_pack"("target_pack_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_can_read_project"("target_project_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_claim_platform_owner_invite"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_claim_platform_owner_invite"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_claim_platform_owner_invite"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_claim_platform_owner_invite"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_create_oauth_invitation_nonce"("p_code" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_current_user_context"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_current_user_context"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_current_user_context"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_current_user_context"() TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_debit_realtime_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_debit_realtime_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_debit_realtime_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_delete_current_user"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_delete_current_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_delete_current_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_delete_current_user"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_delete_storage_quota_policy"("p_actor_id" "uuid", "p_policy_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_delete_storage_quota_policy"("p_actor_id" "uuid", "p_policy_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_find_usable_invitation"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_find_usable_invitation"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_find_usable_invitation"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_handle_new_user"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_handle_new_user"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_handle_new_user"() TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_invitation_code_hash"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_invitation_code_hash"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_invitation_code_hash"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_invitation_required"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_invitation_required"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_invitation_required"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_is_deployment_public"("p_deployment_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_is_platform_owner"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_is_platform_owner_id"("target_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_is_sql_admin_context"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_is_sql_admin_context"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_is_sql_admin_context"() TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_is_workspace_owner"("target_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_is_workspace_owner"("target_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_is_workspace_owner"("target_workspace_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_list_storage_quota_policies"("p_actor_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_list_storage_quota_policies"("p_actor_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_model_config_owner_id"("target_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_project_owner_id"("target_project_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_public_invitation_settings"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_public_invitation_settings"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_public_invitation_settings"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_public_invitation_settings"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_read_current_confirmed_brief"("p_owner_id" "uuid", "p_project_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_read_current_confirmed_brief"("p_owner_id" "uuid", "p_project_id" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_record_shadow_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_record_shadow_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_record_shadow_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_record_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_record_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_record_usage"("p_user_id" "uuid", "p_session_id" "text", "p_turn_id" "text", "p_project_id" "text", "p_idempotency_key" "text", "p_usage" "jsonb", "p_metadata" "jsonb", "p_pricing_version" "text", "p_usage_source" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_redeem_invitation_for_user"("p_user_id" "uuid", "p_code" "text", "p_invitation_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_redeem_invitation_for_user"("p_user_id" "uuid", "p_code" "text", "p_invitation_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_redeem_invitation_for_user"("p_user_id" "uuid", "p_code" "text", "p_invitation_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_redeem_oauth_invitation"("p_nonce" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_refund_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_reject_project_identity_change"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_reject_project_identity_change"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_reject_project_identity_change"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text", "p_project_id" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_reserve_credits"("p_user_id" "uuid", "p_credits" integer, "p_kind" "text", "p_project_id" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_reserve_resource_upload"("p_actor_id" "uuid", "p_pack_id" "text", "p_storage_object_id" "uuid", "p_intent_id" "uuid", "p_bucket" "text", "p_logical_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_byte_size" bigint, "p_object_kind" "text", "p_idempotency_key" "text", "p_upload_mode" "text", "p_expires_at" timestamp with time zone, "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_reserve_resource_upload"("p_actor_id" "uuid", "p_pack_id" "text", "p_storage_object_id" "uuid", "p_intent_id" "uuid", "p_bucket" "text", "p_logical_path" "text", "p_original_filename" "text", "p_mime_type" "text", "p_byte_size" bigint, "p_object_kind" "text", "p_idempotency_key" "text", "p_upload_mode" "text", "p_expires_at" timestamp with time zone, "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_role_permissions"("role_name" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_role_permissions"("role_name" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_role_permissions"("role_name" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_role_permissions"("role_name" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text", "p_model_config_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text", "p_model_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text", "p_model_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_runtime_env"("p_user_id" "uuid", "p_data_dir" "text", "p_model_config_id" "text") TO "service_role";



GRANT ALL ON TABLE "public"."beegame_model_configs" TO "anon";
GRANT ALL ON TABLE "public"."beegame_model_configs" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_model_configs" TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_set_default_model_config"("p_user_id" "uuid", "p_model_config_id" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer, "p_project_id" "text", "p_metadata" "jsonb") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer, "p_project_id" "text", "p_metadata" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer, "p_project_id" "text", "p_metadata" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_settle_credit_reservation"("p_user_id" "uuid", "p_reservation_id" "text", "p_weighted_tokens" integer, "p_credit_unit_weighted_tokens" integer, "p_project_id" "text", "p_metadata" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_storage_quota_usage"("p_actor_id" "uuid", "p_bucket_role" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_storage_quota_usage"("p_actor_id" "uuid", "p_bucket_role" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_sync_resource_pack_element_count"() TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_sync_resource_pack_element_count"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_sync_resource_pack_element_count"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_upsert_storage_quota_policy"("p_actor_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_bucket_role" "text", "p_max_bytes" bigint, "p_max_objects" bigint) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_upsert_storage_quota_policy"("p_actor_id" "uuid", "p_scope_type" "text", "p_scope_id" "text", "p_bucket_role" "text", "p_max_bytes" bigint, "p_max_objects" bigint) TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_user_has_invitation"("p_user_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_user_has_invitation"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_user_has_invitation"("p_user_id" "uuid") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_valid_dependency_bindings"("value" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_valid_dependency_bindings"("value" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_valid_dependency_bindings"("value" "jsonb") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_valid_resource_relations"("value" "jsonb") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_valid_resource_relations"("value" "jsonb") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_valid_resource_relations"("value" "jsonb") TO "service_role";



REVOKE ALL ON FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_validate_invitation_code"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."beegame_workspace_role"("target_workspace_id" "uuid") TO "anon";
GRANT ALL ON FUNCTION "public"."beegame_workspace_role"("target_workspace_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."beegame_workspace_role"("target_workspace_id" "uuid") TO "service_role";



GRANT ALL ON TABLE "public"."beegame_account_links" TO "anon";
GRANT ALL ON TABLE "public"."beegame_account_links" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_account_links" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_assets" TO "anon";
GRANT ALL ON TABLE "public"."beegame_assets" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_assets" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_audit_events" TO "anon";
GRANT ALL ON TABLE "public"."beegame_audit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_audit_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_billing_credit_packs" TO "anon";
GRANT ALL ON TABLE "public"."beegame_billing_credit_packs" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_billing_credit_packs" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_billing_events" TO "anon";
GRANT ALL ON TABLE "public"."beegame_billing_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_billing_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_deployments" TO "anon";
GRANT ALL ON TABLE "public"."beegame_deployments" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_deployments" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_invitation_redemptions" TO "anon";
GRANT ALL ON TABLE "public"."beegame_invitation_redemptions" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_invitation_redemptions" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_invitation_settings" TO "anon";
GRANT ALL ON TABLE "public"."beegame_invitation_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_invitation_settings" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_invitations" TO "anon";
GRANT ALL ON TABLE "public"."beegame_invitations" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_invitations" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_mcp_servers" TO "anon";
GRANT ALL ON TABLE "public"."beegame_mcp_servers" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_mcp_servers" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_oauth_invitation_nonces" TO "anon";
GRANT ALL ON TABLE "public"."beegame_oauth_invitation_nonces" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_oauth_invitation_nonces" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_platform_owner_invites" TO "anon";
GRANT ALL ON TABLE "public"."beegame_platform_owner_invites" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_platform_owner_invites" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_platform_settings" TO "anon";
GRANT ALL ON TABLE "public"."beegame_platform_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_platform_settings" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_previews" TO "anon";
GRANT ALL ON TABLE "public"."beegame_previews" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_previews" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_profiles" TO "anon";
GRANT ALL ON TABLE "public"."beegame_profiles" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_profiles" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_projects" TO "anon";
GRANT ALL ON TABLE "public"."beegame_projects" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_projects" TO "service_role";



GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."beegame_resource_audit_events" TO "anon";
GRANT SELECT,REFERENCES,TRIGGER,TRUNCATE,MAINTAIN ON TABLE "public"."beegame_resource_audit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_audit_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_dependencies" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_dependencies" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_dependencies" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_elements" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_elements" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_elements" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_folders" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_folders" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_folders" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_pack_catalog" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_pack_catalog" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_pack_catalog" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_packs" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_packs" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_packs" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_processing_items" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_processing_items" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_processing_items" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_resource_processing_jobs" TO "anon";
GRANT ALL ON TABLE "public"."beegame_resource_processing_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_resource_processing_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_runtime_settings" TO "anon";
GRANT ALL ON TABLE "public"."beegame_runtime_settings" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_runtime_settings" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_sessions" TO "anon";
GRANT ALL ON TABLE "public"."beegame_sessions" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_sessions" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_shadow_usage_events" TO "anon";
GRANT ALL ON TABLE "public"."beegame_shadow_usage_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_shadow_usage_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_storage_migration_jobs" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_storage_migration_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_storage_objects" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_storage_objects" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_storage_quota_policies" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."beegame_storage_quota_policies" TO "authenticated";



GRANT ALL ON TABLE "public"."beegame_storage_upload_intents" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_storage_upload_intents" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_upgrade_backup_20260902" TO "anon";
GRANT ALL ON TABLE "public"."beegame_upgrade_backup_20260902" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_upgrade_backup_20260902" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_usage_debit_events" TO "anon";
GRANT ALL ON TABLE "public"."beegame_usage_debit_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_usage_debit_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_usage_events" TO "anon";
GRANT ALL ON TABLE "public"."beegame_usage_events" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_usage_events" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_usage_wallets" TO "anon";
GRANT ALL ON TABLE "public"."beegame_usage_wallets" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_usage_wallets" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_user_skills" TO "anon";
GRANT ALL ON TABLE "public"."beegame_user_skills" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_user_skills" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_web_tools" TO "anon";
GRANT ALL ON TABLE "public"."beegame_web_tools" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_web_tools" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_workspace_members" TO "anon";
GRANT ALL ON TABLE "public"."beegame_workspace_members" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_workspace_members" TO "service_role";



GRANT ALL ON TABLE "public"."beegame_workspaces" TO "anon";
GRANT ALL ON TABLE "public"."beegame_workspaces" TO "authenticated";
GRANT ALL ON TABLE "public"."beegame_workspaces" TO "service_role";



GRANT ALL ON TABLE "public"."waitlist_signups" TO "service_role";



GRANT INSERT("name") ON TABLE "public"."waitlist_signups" TO "anon";
GRANT INSERT("name") ON TABLE "public"."waitlist_signups" TO "authenticated";



GRANT INSERT("email") ON TABLE "public"."waitlist_signups" TO "anon";
GRANT INSERT("email") ON TABLE "public"."waitlist_signups" TO "authenticated";



GRANT INSERT("persona") ON TABLE "public"."waitlist_signups" TO "anon";
GRANT INSERT("persona") ON TABLE "public"."waitlist_signups" TO "authenticated";



GRANT INSERT("locale") ON TABLE "public"."waitlist_signups" TO "anon";
GRANT INSERT("locale") ON TABLE "public"."waitlist_signups" TO "authenticated";



GRANT INSERT("source") ON TABLE "public"."waitlist_signups" TO "anon";
GRANT INSERT("source") ON TABLE "public"."waitlist_signups" TO "authenticated";



ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";







