-- Apply after beegame-storage-r2-foundation-migration.sql.
-- This narrows authenticated writes to business objects owned by auth.uid().

drop policy if exists "storage object owner insert" on public.beegame_storage_objects;
create policy "storage object owner insert" on public.beegame_storage_objects
  for insert with check (
    owner_user_id = auth.uid()
    and (
      (scope_type = 'user' and scope_id = auth.uid()::text)
      or (scope_type = 'project' and project_id is not null and exists (
        select 1 from public.beegame_projects project
        where project.id = beegame_storage_objects.project_id
          and project.owner_id = auth.uid()
      ))
      or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
      or (scope_type = 'deployment' and deployment_id is not null and exists (
        select 1 from public.beegame_deployments deployment
        where deployment.id = beegame_storage_objects.deployment_id
          and deployment.owner_id = auth.uid()
      ))
      or (scope_type = 'session' and session_id is not null and exists (
        select 1 from public.beegame_sessions session
        where session.id = beegame_storage_objects.session_id
          and session.owner_id = auth.uid()
      ))
      or (scope_type in ('studio', 'platform') and public.beegame_is_platform_owner())
    )
  );

drop policy if exists "storage object owner update" on public.beegame_storage_objects;
create policy "storage object owner update" on public.beegame_storage_objects
  for update using (
    owner_user_id = auth.uid()
    or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
    or public.beegame_is_platform_owner()
  ) with check (
    public.beegame_is_platform_owner()
    or (
      owner_user_id = auth.uid()
      and (
        (scope_type = 'user' and scope_id = auth.uid()::text)
        or (scope_type = 'project' and project_id is not null and exists (
          select 1 from public.beegame_projects project
          where project.id = beegame_storage_objects.project_id
            and project.owner_id = auth.uid()
        ))
        or (scope_type = 'pack' and pack_id is not null and public.beegame_can_manage_resource_pack(pack_id))
        or (scope_type = 'deployment' and deployment_id is not null and exists (
          select 1 from public.beegame_deployments deployment
          where deployment.id = beegame_storage_objects.deployment_id
            and deployment.owner_id = auth.uid()
        ))
        or (scope_type = 'session' and session_id is not null and exists (
          select 1 from public.beegame_sessions session
          where session.id = beegame_storage_objects.session_id
            and session.owner_id = auth.uid()
        ))
      )
    )
  );
