begin;
-- Preserve the original migration. Requirement changes are host-authorized,
-- append-only snapshots; all current tasks must be freshly pending.
create or replace function public.beegame_workflow_v3_commit(p_project_id text, p_actor_id uuid,
  p_expected_version bigint, p_state jsonb, p_event text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old_state jsonb; old_revision bigint; project_root text;
  old_changes jsonb; new_changes jsonb; last_change jsonb; item record;
begin
  select root_path into project_root from public.beegame_projects
    where id = p_project_id and owner_id = p_actor_id for update;
  if not found then raise exception 'workflow_project_forbidden' using errcode = '42501'; end if;
  if project_root is null or coalesce(p_state->>'workspacePath', '') = '' then
    raise exception 'workflow_invalid_workspace' using errcode = '22023';
  end if;
  select state, revision into old_state, old_revision from public.beegame_workflow_v3 where project_id = p_project_id;
  if coalesce(old_revision, 0) <> p_expected_version then
    raise exception 'workflow_revision_conflict' using errcode = '40001';
  end if;
  if p_state->>'protocol' is distinct from 'bgs.workflow.v3' or
     p_state->>'projectId' is distinct from p_project_id or
     p_state->>'ownerId' is distinct from p_actor_id::text or
     (p_state->>'version')::bigint is distinct from p_expected_version+1 or coalesce(p_event, '') = '' then
    raise exception 'workflow_invalid_commit' using errcode = '22023';
  end if;
  if old_state is not null then
    if old_state->>'id' is distinct from p_state->>'id' or
       old_state->>'chatSessionId' is distinct from p_state->>'chatSessionId' or
       old_state->>'workspacePath' is distinct from p_state->>'workspacePath' then
      raise exception 'workflow_immutable_source' using errcode = '22023';
    end if;
    old_changes := coalesce(old_state->'requirementChanges','[]'::jsonb);
    new_changes := coalesce(p_state->'requirementChanges','[]'::jsonb);
    if jsonb_typeof(old_changes) <> 'array' or jsonb_typeof(new_changes) <> 'array' then
      raise exception 'workflow_immutable_source' using errcode = '22023';
    end if;
    for item in select value, ordinality from jsonb_array_elements(old_changes) with ordinality loop
      if item.value is distinct from new_changes->(item.ordinality::int-1) then
        raise exception 'workflow_immutable_source' using errcode = '22023';
      end if;
    end loop;
    if old_state->'requirements' is distinct from p_state->'requirements' then
      last_change := new_changes->(jsonb_array_length(new_changes)-1);
      if p_event <> 'requirements.changed' or jsonb_array_length(new_changes) <> jsonb_array_length(old_changes)+1 or
         (old_state ? 'writer' and old_state->'writer' <> 'null'::jsonb) or
         last_change->>'actorId' is distinct from p_actor_id::text or coalesce(last_change->>'requestKey','') = '' or
         last_change->'before' is distinct from old_state->'requirements' or
         last_change->'after' is distinct from p_state->'requirements' or
         p_state->'requirements'->>'revision' is not distinct from old_state->'requirements'->>'revision' or
         (p_state->>'planRevision')::bigint is distinct from (old_state->>'planRevision')::bigint+1 or
         exists(select 1 from jsonb_array_elements(old_changes) c where c.value->>'requestKey'=last_change->>'requestKey') or
         exists(select 1 from jsonb_each(p_state->'tasks') t where t.value->>'status' <> 'superseded' and
           (t.value->>'status' is distinct from 'pending' or t.value ? 'attemptId')) then
        raise exception 'workflow_immutable_source' using errcode = '22023';
      end if;
    elsif jsonb_array_length(new_changes) <> jsonb_array_length(old_changes) then
      raise exception 'workflow_immutable_source' using errcode = '22023';
    end if;
    for item in select value from jsonb_array_elements(coalesce(old_state->'previewIssues','[]'::jsonb)) loop
      if not exists(select 1 from jsonb_array_elements(coalesce(p_state->'previewIssues','[]'::jsonb)) p where p.value=item.value) then
        raise exception 'workflow_immutable_source' using errcode = '22023';
      end if;
    end loop;
  end if;
  insert into public.beegame_workflow_v3 values (p_project_id, p_expected_version+1, p_state, now())
    on conflict (project_id) do update set revision = excluded.revision, state = excluded.state, updated_at = excluded.updated_at;
  insert into public.beegame_workflow_v3_events(project_id, revision, event, snapshot)
    values (p_project_id, p_expected_version+1, p_event, p_state);
  update public.beegame_projects set runtime_snapshot = coalesce(runtime_snapshot, '{}'::jsonb) ||
    jsonb_build_object('workflow_protocol', 'bgs.workflow.v3', 'workflow_chat_session_id', p_state->>'chatSessionId'), updated_at = now()
    where id = p_project_id;
  return p_state;
end;
$$;
revoke all on function public.beegame_workflow_v3_commit(text, uuid, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.beegame_workflow_v3_commit(text, uuid, bigint, jsonb, text) to service_role;
commit;
