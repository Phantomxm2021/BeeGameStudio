# BeeGame Multi-user and Supabase Architecture Design

## Status

Draft design. This document is planning-only and does not imply implementation.

## Problem

BeeGame is currently a single-user, local-first dashboard. It can protect the API with a shared Bearer token, but it does not distinguish users. Project metadata, model configuration, runtime sessions, transcripts, previews, uploaded assets, and workspace paths are effectively shared by the dashboard instance.

That is acceptable for local development, but not for a multi-user desktop client, private team deployment, or hosted dashboard.

## Goals

- Add real user identity to the dashboard and API.
- Ensure every user can only see and operate their own projects, model configs, sessions, transcripts, assets, previews, and workspace settings.
- Keep BeeGame as a Web TUI shell around the runtime. Do not turn BeeGame into a gameplay gate or platform-specific orchestrator.
- Support both managed Supabase and self-hosted Supabase.
- Keep the generated project files local-first, because BeeGame still launches local agent/runtime processes and preview servers.
- Leave a clean path for future organization/team sharing.

## Non-goals

- Do not implement organization/team sharing in the first multi-user phase.
- Do not move the active generated project workspace entirely into Supabase Storage.
- Do not let the frontend pass arbitrary `ownerId` values.
- Do not bind project generation to Web, Unity, Godot, or any specific engine.
- Do not store model API keys in project folders or transcripts.

## Current State

- Frontend model config API uses a hardcoded owner: `dashboard-local`.
- API auth is token-based but single-tenant; it can reject unauthorized requests but cannot identify separate users.
- `projects` metadata does not contain `owner_id`.
- Runtime sessions are keyed by session/project identity, not user identity.
- Default workspace is shared under `Projects/`.
- Transcripts are stored in project folders but are not user-scoped except through the project path.
- Model configuration is persisted in one dashboard-level store.

## Recommended Architecture

Use Supabase for identity and durable shared metadata, while keeping BeeGame server responsible for local runtime execution.

```text
Browser / Desktop UI
  -> Supabase Auth session
  -> BeeGame API with Authorization: Bearer <jwt>
  -> BeeGame server verifies user
  -> BeeGame server reads/writes Supabase metadata
  -> BeeGame server manages local workspace, runtime, preview, transcripts
```

Supabase responsibilities:

- Authentication.
- User profile metadata.
- Project/session/model/asset metadata.
- Optional Storage buckets for uploaded assets, project exports, and transcript archives.
- Row Level Security as a second boundary.

BeeGame server responsibilities:

- Verify Supabase JWT for every protected request.
- Enforce `owner_id = current_user.id` in all database operations.
- Enforce filesystem sandbox per user workspace.
- Launch and manage agent sessions.
- Manage preview processes and ports.
- Write active transcripts and generated project files.

## Deployment Modes

### Managed Supabase

Best for hosted/team/SaaS-style BeeGame deployments.

Pros:

- Supabase manages database, Auth, Storage, backups, TLS, and upgrades.
- Easier to operate.
- Better fit for remote users.

Cons:

- Requires external service dependency.
- Data residency and compliance depend on selected region and provider settings.

### Self-hosted Supabase

Best for private company deployments or fully local/server-controlled setups.

Pros:

- Full control over data.
- Can be deployed inside private network.
- Useful for enterprise or air-gapped-adjacent scenarios.

Cons:

- Operator owns backups, upgrades, secrets, monitoring, TLS, and security patches.
- Supabase self-hosting is not a full hosted-platform replacement; design should assume one configured project/backend per deployment.

## Configuration

The code should not care whether Supabase is managed or self-hosted. It should use environment/config values:

```text
SUPABASE_URL
SUPABASE_ANON_KEY
SUPABASE_SERVICE_ROLE_KEY
SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL
BEEGAME_DATA_DIR
BEEGAME_PROJECTS_ROOT
```

Frontend uses the anon key and Supabase client for login/session handling.

Backend uses service role only for trusted server-side metadata operations. The service role key must never be exposed to frontend code.

## Data Model

### profiles

```sql
create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  display_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### workspaces

```sql
create table workspaces (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  root_path text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### projects

```sql
create table projects (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  workspace_id uuid references workspaces(id) on delete set null,
  name text not null,
  slug text not null,
  root_path text not null,
  status text not null default 'idle',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(owner_id, slug)
);
```

### sessions

```sql
create table sessions (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  model_config_id text,
  runtime_status text not null default 'idle',
  turn_status text not null default 'idle',
  cwd text not null,
  transcript_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### model_configs

```sql
create table model_configs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  provider text not null,
  base_url text,
  api_key_ciphertext text not null,
  models jsonb not null default '{}'::jsonb,
  is_default boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Only one default model config should be allowed per user. Enforce with a partial unique index:

```sql
create unique index model_configs_one_default_per_owner
  on model_configs(owner_id)
  where is_default = true;
```

### asset_slots

```sql
create table asset_slots (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  slot_id text not null,
  type text,
  purpose text,
  status text not null default 'placeholder',
  target jsonb not null default '{}'::jsonb,
  uploaded_files jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, slot_id)
);
```

The project-local `assets/asset-manifest.json` remains the agent-facing contract. `asset_slots` is an indexed dashboard view of that contract.

### preview_sessions

```sql
create table preview_sessions (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  session_id text references sessions(id) on delete cascade,
  client_port integer,
  server_port integer,
  status text not null default 'stopped',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

### transcript_archives

Optional later table for archival metadata:

```sql
create table transcript_archives (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  session_id text not null references sessions(id) on delete cascade,
  local_path text not null,
  storage_path text,
  created_at timestamptz not null default now()
);
```

## Row Level Security

Enable RLS on user-owned tables:

```sql
alter table profiles enable row level security;
alter table workspaces enable row level security;
alter table projects enable row level security;
alter table sessions enable row level security;
alter table model_configs enable row level security;
alter table asset_slots enable row level security;
alter table preview_sessions enable row level security;
```

Policy pattern:

```sql
create policy "owner can read own projects"
  on projects for select
  using (owner_id = auth.uid());

create policy "owner can write own projects"
  on projects for all
  using (owner_id = auth.uid())
  with check (owner_id = auth.uid());
```

Even with RLS, BeeGame server must also enforce owner checks. RLS is defense in depth, not the only boundary.

## Storage Buckets

Recommended buckets:

- `project-assets`: uploaded replacement assets.
- `project-exports`: downloadable project packages.
- `transcript-archives`: archived JSONL transcripts.

Storage path convention:

```text
users/<user_id>/projects/<project_id>/assets/<slot_id>/<filename>
users/<user_id>/projects/<project_id>/exports/<filename>
users/<user_id>/projects/<project_id>/transcripts/<filename>
```

For active local development, assets should still be copied into the project workspace. Supabase Storage is for persistence, sync, sharing, or backup.

## Filesystem Layout

Default local workspace should become user-scoped:

```text
Projects/users/<user_id>/<project_slug>/
```

Project-local files:

```text
Projects/users/<user_id>/<project_slug>/docs/
Projects/users/<user_id>/<project_slug>/assets/asset-manifest.json
Projects/users/<user_id>/<project_slug>/transcripts/<project_slug>__<hash>.jsonl
```

Backend path checks must enforce:

```text
requested_path is inside current user's workspace root
```

Do not rely on project id or session id alone for filesystem authorization.

## API Changes

Remove frontend-controlled owner parameters:

```text
GET /api/model-configs?ownerId=...
POST /api/model-configs?ownerId=...
```

Replace with authenticated requests:

```text
GET /api/model-configs
POST /api/model-configs
PATCH /api/model-configs/:id
```

Backend derives owner from JWT:

```text
currentUser.id
```

The same applies to:

- projects
- beegame sessions
- session events
- artifacts
- assets
- preview
- package download
- delete project
- workspace settings

## Auth Flow

Frontend:

1. Initialize Supabase client.
2. Show login if there is no active session.
3. Store session via Supabase client.
4. Add `Authorization: Bearer <access_token>` to BeeGame API calls.
5. Refresh token through Supabase client.
6. Clear local dashboard state on logout.

Backend:

1. Verify JWT signature and issuer/audience.
2. Extract `sub` as `user_id`.
3. Attach user to request context.
4. Reject unauthenticated protected endpoints.
5. Never accept `owner_id` from request body/query as authority.

## Model Key Security

Model API keys should be:

- Scoped per user.
- Encrypted before storing.
- Never returned to frontend in plaintext.
- Exposed only as preview text, for example `sk-...abcd`.
- Injected into runtime env only on the server side.

Encryption options:

- Initial local/server deployment: envelope encryption using a server secret.
- Later hosted deployment: use KMS or Supabase Vault if the deployment model supports it.

## Runtime Session Isolation

Every runtime session must bind:

```text
session.owner_id
session.project_id
session.cwd
session.model_config_id
```

All runtime operations must verify owner:

- start turn
- continue turn
- cancel
- approve permission
- deny permission
- read events
- read artifacts
- package project
- start/stop/restart preview

Preview process tracking must also be keyed by owner/session/project so one user cannot stop another user's preview.

## Migration Plan

### Phase 1: Single-user compatibility with user identity

- Add Supabase configuration.
- Add auth middleware in BeeGame server.
- Add frontend login/session handling.
- Create `profiles`, `workspaces`, `projects`, `sessions`, and `model_configs`.
- Keep existing local files and existing project directories.
- Create one default local user migration path for current `dashboard-local` data.

### Phase 2: Owner-scoped metadata

- Replace `dashboard-local` frontend owner usage.
- Add owner filtering to all model config APIs.
- Move project metadata from local SQLite to Supabase or add an adapter interface first.
- Add owner filtering to project/session APIs.
- Add tests proving user A cannot read/update/delete user B data.

### Phase 3: User-scoped filesystem

- Default new projects to `Projects/users/<user_id>/<project_slug>`.
- Keep existing projects with their current paths but bind them to the migrated user.
- Enforce path sandbox based on current user workspace root.
- Update delete/project package/transcript logic to work with user-scoped roots.

### Phase 4: Assets and transcript metadata

- Index project `assets/asset-manifest.json` into `asset_slots`.
- Upload resources to project local folder and optionally Supabase Storage.
- Add transcript metadata rows.
- Add optional transcript archive to Storage.

### Phase 5: Team-ready foundation

Do not implement collaboration yet, but avoid schema dead ends:

- Add project sharing later through `organizations`, `organization_members`, and `project_members`.
- Keep owner checks isolated behind a policy function so future roles can extend it.

## Compatibility Strategy

Current local data should be migrated, not discarded.

Suggested migration:

1. Create or select a first local admin user.
2. Assign existing local projects to that user.
3. Assign existing model configs to that user.
4. Keep existing project paths.
5. New projects use user-scoped paths.

Do not support anonymous mixed ownership after migration.

## Testing Plan

Backend tests:

- Auth required for protected routes.
- Invalid token rejected.
- User A cannot list user B projects.
- User A cannot access user B session events.
- User A cannot delete user B project.
- User A cannot start/stop user B preview.
- User A cannot use model config owned by user B.
- Path sandbox rejects paths outside current user workspace root.

Frontend tests:

- Login screen appears without session.
- API calls include Supabase access token.
- Model settings no longer send `ownerId=dashboard-local`.
- Logout clears project/model/session state.
- Project history only renders authenticated user data.

Migration tests:

- Existing local `dashboard-local` model config migrates to selected user.
- Existing projects can be bound to selected user.
- Existing transcripts remain discoverable.

## Risks

- Local filesystem isolation is stricter than database isolation. A bug in path resolution could expose another user's generated project.
- Preview processes are OS-level child processes; owner checks must happen before process control.
- Model API keys are sensitive and need encryption from the first multi-user release.
- Supabase service role misuse could bypass RLS. Keep it server-only.
- Self-hosted Supabase adds operational burden and must be documented as such.
- Existing local projects may not fit the future `Projects/users/<user_id>/` layout. Migration must preserve old paths.

## Implementation Recommendation

Start with a small, strict multi-user foundation:

1. Auth middleware and user context.
2. Remove frontend `dashboard-local`.
3. Owner-scoped model configs and projects.
4. Owner-scoped sessions and preview operations.
5. User-scoped workspace root for new projects.

Only after that should BeeGame add organization/team sharing.

## References

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage: https://supabase.com/docs/guides/storage
- Supabase Self-hosting: https://supabase.com/docs/guides/self-hosting
