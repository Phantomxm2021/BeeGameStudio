alter table public.beegame_resource_elements
  add column if not exists semantic_suggestion jsonb;

comment on column public.beegame_resource_elements.semantic_suggestion is
  'Temporary administrator curation input. It is never used by catalog search or Workflow matching and is cleared when accepted or rejected.';
