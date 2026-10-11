begin;
-- A stale business revision cannot succeed by retrying the same transaction.
-- 40001 is a PostgreSQL serialization failure; PostgREST may automatically
-- retry it. Return HTTP 409 directly instead. Preserve the deployed body/ACL.
do $$
declare
  definition text;
  old_raise constant text := 'raise exception ''workflow_revision_conflict'' using errcode = ''40001'';';
  new_raise constant text := 'raise exception ''workflow_revision_conflict'' using errcode = ''PT409'';';
begin
  definition := pg_get_functiondef('public.beegame_workflow_v3_commit(text,uuid,bigint,jsonb,text)'::regprocedure);
  if position('requirements.changed' in definition) = 0 then
    raise exception 'Apply the authorized_changes migration before conflict_http';
  end if;
  if position(old_raise in definition) > 0 then
    execute replace(definition, old_raise, new_raise);
  elsif position(new_raise in definition) = 0 then
    raise exception 'Unexpected workflow conflict implementation; inspect before changing';
  end if;
end;
$$;
commit;
