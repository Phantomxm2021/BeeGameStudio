-- Explicit external-file dependency mappings for Resource Pack elements.
-- A mapping preserves the URI embedded in a model/material and resolves it to
-- a Pack element ID. The workflow copier uses this to recreate the required
-- relative file layout in a target project.

alter table public.beegame_resource_elements
  add column if not exists dependency_bindings jsonb not null default '[]'::jsonb;

alter table public.beegame_resource_elements
  drop constraint if exists beegame_resource_elements_dependency_bindings_check;

create or replace function public.beegame_valid_dependency_bindings(value jsonb)
returns boolean
language sql
immutable
as $$
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

alter table public.beegame_resource_elements
  add constraint beegame_resource_elements_dependency_bindings_check
  check (public.beegame_valid_dependency_bindings(dependency_bindings));

create index if not exists beegame_resource_elements_dependency_bindings_idx
  on public.beegame_resource_elements using gin (dependency_bindings);
