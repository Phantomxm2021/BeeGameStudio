-- Host-only workflow facts. Existing text project identity, auth and billing are reused.
begin;
create table public.beegame_workflow_v3 (
  project_id text primary key references public.beegame_projects(id) on delete cascade,
  revision bigint not null check (revision > 0),
  state jsonb not null check (state->>'protocol' = 'bgs.workflow.v3'),
  updated_at timestamptz not null default now()
);
create table public.beegame_workflow_v3_events (
  project_id text not null references public.beegame_projects(id) on delete cascade,
  revision bigint not null,
  event text not null,
  snapshot jsonb not null,
  created_at timestamptz not null default now(),
  primary key (project_id, revision)
);
-- Database uniqueness, not lease expiry or process-local memory, excludes alias writers.
create unique index beegame_workflow_v3_one_writer
  on public.beegame_workflow_v3 ((state->>'workspacePath'))
  where state ? 'writer' and state->'writer' <> 'null'::jsonb;
alter table public.beegame_workflow_v3 enable row level security;
alter table public.beegame_workflow_v3_events enable row level security;
-- No authenticated-client mutation policy: clients must not forge successful checks.
revoke all on public.beegame_workflow_v3, public.beegame_workflow_v3_events from public, anon, authenticated;

create function public.beegame_workflow_v3_read(p_project_id text, p_actor_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare result jsonb;
begin
  if not exists (select 1 from public.beegame_projects where id = p_project_id and owner_id = p_actor_id) then
    raise exception 'workflow_project_forbidden' using errcode = '42501';
  end if;
  select state into result from public.beegame_workflow_v3 where project_id = p_project_id;
  return result;
end;
$$;

create function public.beegame_workflow_v3_commit(p_project_id text, p_actor_id uuid,
  p_expected_version bigint, p_state jsonb, p_event text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare old_state jsonb; old_revision bigint; project_root text;
begin
  -- Lock the existing project row, including first insert, to serialize workers.
  select root_path into project_root from public.beegame_projects
    where id = p_project_id and owner_id = p_actor_id for update;
  if not found then raise exception 'workflow_project_forbidden' using errcode = '42501'; end if;
  -- Only the trusted host supplies a realpath-normalized workspace after project/session
  -- validation. PostgreSQL cannot resolve filesystem symlinks in root_path itself.
  if project_root is null or coalesce(p_state->>'workspacePath', '') = '' then
    raise exception 'workflow_invalid_workspace' using errcode = '22023';
  end if;
  project_root := p_state->>'workspacePath';
  select state, revision into old_state, old_revision from public.beegame_workflow_v3 where project_id = p_project_id;
  if coalesce(old_revision, 0) <> p_expected_version then
    raise exception 'workflow_revision_conflict' using errcode = '40001';
  end if;
  if p_state->>'protocol' is distinct from 'bgs.workflow.v3' or
     p_state->>'projectId' is distinct from p_project_id or
     p_state->>'ownerId' is distinct from p_actor_id::text or
     (p_state->>'version')::bigint is distinct from p_expected_version+1 or
     coalesce(p_event, '') = '' then
    raise exception 'workflow_invalid_commit' using errcode = '22023';
  end if;
  if old_state is not null and (
    old_state->'requirements' is distinct from p_state->'requirements' or
    old_state->>'id' is distinct from p_state->>'id' or
    old_state->>'chatSessionId' is distinct from p_state->>'chatSessionId' or
    old_state->>'workspacePath' is distinct from p_state->>'workspacePath') then
    raise exception 'workflow_immutable_source' using errcode = '22023';
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
-- Only the authenticated BGS host uses these RPCs. Never put service credentials in native env.
revoke all on function public.beegame_workflow_v3_read(text, uuid) from public, anon, authenticated;
revoke all on function public.beegame_workflow_v3_commit(text, uuid, bigint, jsonb, text) from public, anon, authenticated;
grant execute on function public.beegame_workflow_v3_read(text, uuid) to service_role;
grant execute on function public.beegame_workflow_v3_commit(text, uuid, bigint, jsonb, text) to service_role;
commit;
