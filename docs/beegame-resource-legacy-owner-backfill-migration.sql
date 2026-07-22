-- One-time ownership repair for Resource Packs created before `created_by`
-- existed. This migration is intentionally fail-closed: it only infers the
-- owner when the installation has exactly one distinct workspace owner.

do $$
declare
  inferred_owner_id uuid;
  distinct_owner_count integer;
  affected_pack_count integer;
  affected_pack_ids text[];
begin
  select count(distinct member.user_id), min(member.user_id::text)::uuid
  into distinct_owner_count, inferred_owner_id
  from public.beegame_workspace_members member
  where member.role = 'owner';

  select count(*), array_agg(pack.id order by pack.id)
  into affected_pack_count, affected_pack_ids
  from public.beegame_resource_packs pack
  where pack.created_by is null;

  if affected_pack_count = 0 then
    raise notice 'No ownerless Resource Packs require repair.';
    return;
  end if;

  if distinct_owner_count <> 1 or inferred_owner_id is null then
    raise exception
      'Cannot infer legacy Resource Pack owner: expected exactly one workspace owner, found %.',
      distinct_owner_count;
  end if;

  update public.beegame_resource_packs
  set created_by = inferred_owner_id,
      updated_at = now()
  where created_by is null;

  insert into public.beegame_resource_audit_events (
    actor_id,
    pack_id,
    action,
    metadata
  )
  select
    inferred_owner_id,
    pack.id,
    'pack.owner_backfilled',
    jsonb_build_object(
      'source', 'beegame-resource-legacy-owner-backfill-migration',
      'ownerId', inferred_owner_id
    )
  from public.beegame_resource_packs pack
  where pack.id = any(affected_pack_ids)
    and not exists (
      select 1
      from public.beegame_resource_audit_events audit
      where audit.pack_id = pack.id
        and audit.action = 'pack.owner_backfilled'
    );

  raise notice 'Assigned % legacy Resource Pack(s) to owner %.',
    affected_pack_count,
    inferred_owner_id;
end
$$;
