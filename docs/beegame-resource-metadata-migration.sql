-- Resource metadata for governance and structured discovery. Apply after
-- beegame-resource-governance-migration.sql.

alter table public.beegame_resource_packs
  add column if not exists description text,
  add column if not exists tags text[] not null default '{}',
  add column if not exists source text,
  add column if not exists author text,
  add column if not exists license_evidence text,
  add column if not exists compatible_engines text[] not null default '{}',
  add column if not exists deprecated_at timestamptz;

create index if not exists beegame_resource_packs_tags_idx
  on public.beegame_resource_packs using gin (tags);

create index if not exists beegame_resource_packs_compatible_engines_idx
  on public.beegame_resource_packs using gin (compatible_engines);
