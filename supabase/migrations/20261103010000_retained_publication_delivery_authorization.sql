-- A retained Portal release owns its delivery manifest after project deletion.
-- Keep the project-scoped publication path used before Portal verification.
begin;

create or replace function public.beegame_is_deployment_public(p_deployment_id text)
returns boolean
language sql stable security definer set search_path = ''
as $function$
  select exists (
    select 1
    from public.beegame_deployments deployment
    join public.beegame_storage_objects manifest
      on manifest.id = deployment.manifest_storage_object_id
    where deployment.id = p_deployment_id
      and deployment.status = 'succeeded'
      and deployment.url <> ''
      and deployment.artifact_path is not null
      and manifest.owner_user_id = deployment.owner_id
      and (
        (manifest.project_id = deployment.project_id
          and manifest.scope_type = 'project'
          and manifest.scope_id = deployment.project_id)
        or
        (deployment.portal_published_at is not null
          and manifest.project_id is null
          and manifest.deployment_id = deployment.id
          and manifest.scope_type = 'deployment'
          and manifest.scope_id = deployment.id)
      )
      and manifest.provider = 'r2'
      and manifest.bucket_role = 'delivery'
      and manifest.object_kind = 'deployment_manifest'
      and manifest.status = 'ready'
      and manifest.visibility = 'public'
      and manifest.deleted_at is null
      and manifest.metadata ->> 'deployment_id' = deployment.id
  );
$function$;

-- CREATE OR REPLACE preserves the existing execution grants.
notify pgrst, 'reload schema';
commit;
