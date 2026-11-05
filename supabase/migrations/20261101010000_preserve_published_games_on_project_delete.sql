-- Published releases outlive their development workspace and session.
-- Apply before deploying the matching project-deletion implementation.
begin;

-- These IDs remain the original provenance used by Portal and historical links.
-- Owner/account deletion still cascades through owner_id.
alter table public.beegame_portal_games
  drop constraint beegame_portal_games_project_id_fkey;
alter table public.beegame_deployments
  drop constraint beegame_deployments_project_id_fkey,
  drop constraint beegame_deployments_session_id_fkey;

create function public.beegame_retain_project_publications(p_owner_id uuid, p_project_id text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_owner_id is null or
     (auth.uid() is distinct from p_owner_id and coalesce(auth.role(), '') <> 'service_role') then
    raise exception 'Project access denied' using errcode = '42501';
  end if;
  perform 1 from public.beegame_projects
    where id = p_project_id and owner_id = p_owner_id for update;
  if not found then
    raise exception 'Project access denied' using errcode = '42501';
  end if;

  -- The publisher initially registers files with project scope and a deployment
  -- ID in metadata, including the manifest and cover. Retain all public versions,
  -- not only the one currently featured in the Portal projection.
  update public.beegame_storage_objects o
    set project_id = null, session_id = null,
        deployment_id = d.id, scope_type = 'deployment', scope_id = d.id,
        updated_at = now()
    from public.beegame_deployments d
    where d.owner_id = p_owner_id and d.project_id = p_project_id
      and d.status = 'succeeded' and d.portal_published_at is not null
      and o.owner_user_id = p_owner_id and o.project_id = p_project_id
      and o.bucket_role = 'delivery'
      and (o.deployment_id = d.id or o.metadata->>'deployment_id' = d.id
        or o.id = d.manifest_storage_object_id);
end;
$$;
revoke all on function public.beegame_retain_project_publications(uuid,text) from public, anon;
grant execute on function public.beegame_retain_project_publications(uuid,text) to authenticated, service_role;
notify pgrst, 'reload schema';
commit;
