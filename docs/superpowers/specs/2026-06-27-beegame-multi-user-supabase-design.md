# BeeGame Multi-user and Supabase Architecture Design

## Status

Draft design. This document is planning-only and does not imply implementation.

## Problem

BeeGame is currently a single-user, local-first dashboard. It can protect the API with a shared Bearer token, but it does not distinguish users. Project metadata, model configuration, runtime settings, MCP server configuration, runtime sessions, transcripts, previews, uploaded assets, and workspace paths are effectively shared by the dashboard instance.

That is acceptable for local development, but not for a multi-user desktop client, private team deployment, or hosted dashboard.

## Goals

- Add real user identity to the dashboard and API.
- Ensure every user can only see and operate their own projects, model configs, runtime settings, MCP servers, sessions, transcripts, assets, previews, and workspace settings.
- Define explicit user permissions for workspace administration, project collaboration, runtime control, secrets, MCP configuration, and agent tool approvals.
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
- Do not expose one user's MCP configuration, runtime feature toggles, or local discovery results to another user.

## Current State

- Frontend model config API uses a hardcoded owner: `dashboard-local`.
- API auth is token-based but single-tenant; it can reject unauthorized requests but cannot identify separate users.
- `projects` metadata does not contain `owner_id`.
- Project metadata now persists runtime summary fields, such as usage, phase, and model snapshot, but these snapshots are not user-scoped.
- Runtime sessions are keyed by session/project identity, not user identity.
- Default workspace is shared under `Projects/`.
- Transcripts are stored in project folders but are not user-scoped except through the project path.
- Model configuration is persisted in one dashboard-level store.
- Runtime settings are persisted in one dashboard-level `runtime-settings.json` store.
- MCP server settings are persisted in one dashboard-level `mcp-servers.json` store, and discovery can inspect machine-level MCP config files.

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
- Runtime settings and MCP server metadata.
- Optional Storage buckets for uploaded assets, project exports, and transcript archives.
- Row Level Security as a second boundary.

BeeGame server responsibilities:

- Verify Supabase JWT for every protected request.
- Enforce `owner_id = current_user.id` in all database operations.
- Enforce filesystem sandbox per user workspace.
- Inject only the current user's runtime settings, model secrets, and MCP server config into agent sessions.
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
BEEGAME_SUPABASE_URL
BEEGAME_SUPABASE_ANON_KEY
BEEGAME_SUPABASE_SERVICE_ROLE_KEY
BEEGAME_SECRETS_KEY
BEEGAME_SUPABASE_ASSET_BUCKET
SUPABASE_JWT_SECRET or SUPABASE_JWKS_URL
BEEGAME_DATA_DIR
BEEGAME_PROJECTS_ROOT
```

Frontend uses the anon key and Supabase client for login/session handling:

```text
VITE_SUPABASE_URL
VITE_SUPABASE_ANON_KEY
VITE_SUPABASE_AVATAR_BUCKET
```

Backend uses service role only for trusted server-side metadata operations. The service role key must never be exposed to frontend code.

`BEEGAME_SECRETS_KEY` is the server-side encryption key for model API keys, web search keys, and MCP environment secrets before they are written to Supabase. It should be generated once per deployment and kept stable across service-role key rotation. If it is omitted, BeeGame falls back to service-role-derived encryption for local development and reads legacy rows written that way, but production deployments should set it explicitly.

Local dashboard data can be migrated into the authenticated Supabase owner scope with:

```bash
bun scripts/migrate-beegame-local-to-supabase.ts --owner-id <supabase-user-id> --data-dir <local-dashboard-data-dir>
```

The command is dry-run by default. Add `--apply` only after the printed summary is correct. It migrates the local project index, model configs, runtime settings, web tool settings, and MCP servers. Transcript files remain in project folders and are not inserted into Postgres.

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

### workspace_members

Workspace membership controls broad access to workspace-level settings and project lists. The first phase can create only one owner member per workspace, but the schema should not block future sharing.

```sql
create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
```

Allowed workspace roles:

```text
owner
developer
reviewer
viewer
```

Role intent:

- `owner`: manages workspace settings, members, project deletion, model configs, MCP configs, secrets, exports, and default workspace path.
- `developer`: creates and continues projects, sends agent messages, uploads assets, starts previews, and approves normal workspace-contained tool operations.
- `reviewer`: reads projects, chat, transcripts, assets, evidence, and preview output, but cannot drive the agent or approve tool execution.
- `viewer`: reads project summaries and delivered artifacts only. It cannot see secrets, raw runtime settings, or hidden operational metadata.

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
  runtime_snapshot jsonb not null default '{}'::jsonb,
  unique(owner_id, slug)
);
```

`runtime_snapshot` is a dashboard convenience cache, not a source of truth. It may contain recent token usage, model name, model config id, phase label, and last runtime update time. It must be scoped with the project owner because it can reveal model usage and work activity.

### project_members

Project membership allows narrower access than workspace membership. It is optional in the first phase, but should be included in the authorization model so future team sharing does not require rewriting route contracts.

```sql
create table project_members (
  project_id text not null references projects(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (project_id, user_id)
);
```

Project roles use the same role names as workspace roles. Effective project permission is the highest applicable role from:

```text
project.owner_id
workspace_members
project_members
```

If a user has no effective role for a project, all project routes must return not found or forbidden without exposing whether the project exists.

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

### runtime_settings

Runtime settings are currently stored in `runtime-settings.json`. They include feature toggles that change how the runtime is launched. In a multi-user deployment they must be user-scoped.

```sql
create table runtime_settings (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  config jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

Expected `config` keys are small boolean feature switches, for example:

```text
autoMemoryEnabled
autoDreamEnabled
skillSearchEnabled
treeSitterBashEnabled
webBrowserToolEnabled
bashClassifierEnabled
mcpSkillsEnabled
```

The server must validate keys and types before saving. Unknown keys should be ignored or rejected instead of blindly injected into runtime environment variables.

### mcp_servers

MCP server settings are currently stored in `mcp-servers.json`. They can include local commands, URLs, cwd values, env names, and secret previews. In a multi-user deployment they must be user-scoped and treated as sensitive configuration.

```sql
create table mcp_servers (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  enabled boolean not null default true,
  transport text not null,
  scope text not null default 'beegame',
  command text,
  args jsonb not null default '[]'::jsonb,
  url text,
  cwd text,
  env jsonb not null default '[]'::jsonb,
  auto_start boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
```

MCP env values should follow the same secret handling rules as model API keys. The frontend should receive only key names and masked previews. The server should inject decrypted values only into the current user's agent runtime.

MCP discovery needs special care:

- Machine-level discovered MCP files are candidates, not automatically shared user config.
- A discovered server only becomes user-visible after that user imports or saves it.
- Project-scoped MCP servers must also validate that `cwd` is inside an allowed workspace for the current user.

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
alter table workspace_members enable row level security;
alter table projects enable row level security;
alter table project_members enable row level security;
alter table sessions enable row level security;
alter table model_configs enable row level security;
alter table runtime_settings enable row level security;
alter table mcp_servers enable row level security;
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

For shared projects, RLS policies should use an effective membership check rather than only `owner_id = auth.uid()`. The first implementation can keep sharing disabled while still using helper functions that are ready for membership checks.

Recommended helper functions:

```text
has_workspace_role(workspace_id, user_id, minimum_role)
has_project_role(project_id, user_id, minimum_role)
```

Even with RLS, BeeGame server must also enforce permission checks. RLS is defense in depth, not the only boundary.

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
- runtime settings
- MCP server settings and discovery imports
- preview
- package download
- delete project
- workspace settings

Every protected route should evaluate a named permission instead of checking raw roles inline. Example permission names:

```text
workspace.read
workspace.manage
workspace.manage_members
project.read
project.create
project.delete
project.export
agent.send_message
agent.cancel
agent.approve_tool
preview.manage
assets.upload
assets.integrate
model_config.manage
mcp.manage
runtime_settings.manage
secrets.manage
```

This keeps route code stable when project-level sharing or organization roles are added later.

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

## Permission Model

BeeGame needs two permission layers:

1. Application permissions decide what the user is allowed to do in the dashboard.
2. Runtime tool policy decides whether a specific agent tool action is safe to run.

These layers must remain separate. A user can have permission to send messages without being allowed to approve high-risk tool calls, and a safe tool call can still be rejected if it targets a project the user cannot access.

### Application Permissions

Recommended baseline mapping:

| Permission | owner | developer | reviewer | viewer |
| --- | --- | --- | --- | --- |
| `workspace.read` | yes | yes | yes | limited |
| `workspace.manage` | yes | no | no | no |
| `workspace.manage_members` | yes | no | no | no |
| `project.read` | yes | yes | yes | limited |
| `project.create` | yes | yes | no | no |
| `project.delete` | yes | no | no | no |
| `project.export` | yes | yes | yes | yes, if artifact is delivered |
| `agent.send_message` | yes | yes | no | no |
| `agent.cancel` | yes | yes | no | no |
| `agent.approve_tool` | yes | yes, low/medium risk only | no | no |
| `preview.manage` | yes | yes | no | no |
| `assets.upload` | yes | yes | no | no |
| `assets.integrate` | yes | yes | no | no |
| `model_config.manage` | yes | no | no | no |
| `mcp.manage` | yes | no | no | no |
| `runtime_settings.manage` | yes | no | no | no |
| `secrets.manage` | yes | no | no | no |

`admin` is a deployment-level role, not a project content role. Admins can manage system health, users, billing/deployment settings, and emergency lockout. They should not automatically read user project content, transcripts, prompts, or secrets unless the deployment explicitly enables break-glass access with audit logging.

### Runtime Tool Policy

Runtime policy evaluates the actual tool request after application permissions pass.

Allowed automatically for `owner` and `developer` when the target stays inside the current user's allowed workspace:

- Read-like operations: `Read`, `Glob`, `Grep`, directory listing.
- Write-like operations: `Write`, `Edit`, `MultiEdit` for files inside the current project or allowed workspace.
- Low-risk build/check commands selected by the agent, when they run inside the allowed workspace and do not mutate global machine state.

Always deny:

- Paths outside the current user's allowed workspace, unless an owner explicitly grants a separate workspace root.
- Access to another user's project path.
- Attempts to write secrets into project folders or transcripts.
- Attempts to read decrypted model keys, Brave keys, or MCP env values from the frontend.

Require explicit confirmation from an `owner`, or from a `developer` only when policy marks it medium risk:

- Delete or move operations that can remove project files.
- Commands that install packages globally.
- Commands that change OS, shell, Git global, or user-level configuration.
- Commands that start external network tunnels or expose local services.
- MCP server commands with cwd outside an approved workspace.

Require `owner` only:

- Managing model provider credentials.
- Managing Brave/web search credentials.
- Managing MCP env values.
- Importing machine-level discovered MCP servers into saved user config.
- Changing workspace root paths.

The UI should present runtime approvals as alerts or permission cards, not as normal chat messages. Approval decisions should be persisted only as scoped policy decisions, for example "allow safe operations in this project for this run", not as blanket global bypass.

### Audit Events

For multi-user deployments, BeeGame should record audit metadata for sensitive operations:

```text
who
workspace/project/session
action
target
risk level
decision
timestamp
```

Audit events should avoid storing secret values or full prompt content unless explicitly configured for a private deployment.

## Model Key Security

Model API keys should be:

- Scoped per user.
- Encrypted before storing.
- Never returned to frontend in plaintext.
- Exposed only as preview text, for example `sk-...abcd`.
- Injected into runtime env only on the server side.

The same rules apply to:

- Brave Search API keys.
- Web fetch/search provider keys.
- MCP env values.
- Any future third-party tool credentials.

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
- read/update runtime settings
- read/update MCP server settings
- import discovered MCP server settings

Preview process tracking must also be keyed by owner/session/project so one user cannot stop another user's preview.

Runtime launch must build environment from the current user's scoped data only:

```text
current user's model config
current user's runtime settings
current user's enabled MCP servers
current project's workspace root
```

Do not read global dashboard-level settings as authority once user identity is enabled.

## Persistence Adapter Strategy

Do not jump directly from the current local stores to Supabase-only persistence. Introduce repository interfaces first, then provide two adapters:

- Local adapter: SQLite/JSON files, owner-scoped, suitable for desktop and local development.
- Supabase adapter: Auth/Postgres/Storage-backed metadata for hosted or team deployment.

Recommended repositories:

```text
ProjectRepository
SessionRepository
ModelConfigRepository
RuntimeSettingsRepository
McpServerRepository
AssetRepository
PreviewRepository
TranscriptRepository
```

The local adapter should still remove the old global assumption:

- `beegame.sqlite` project rows need owner data or an owner-scoped database path.
- `model-configs.json` entries need owner data or per-owner files.
- `runtime-settings.json` needs owner data or per-owner files.
- `mcp-servers.json` needs owner data or per-owner files.

Using repository interfaces before Supabase keeps the desktop packaging path clean and prevents API handlers from becoming tied to one persistence backend.

## Migration Plan

### Phase 0: Persistence inventory and repository boundary

- Inventory existing local stores:
  - project metadata SQLite
  - model config JSON
  - runtime settings JSON
  - MCP servers JSON
  - project-local transcripts
  - project-local asset manifests
- Add repository interfaces for each data domain.
- Keep current behavior through a local single-user adapter while the API shape is cleaned up.
- Do not introduce Supabase-specific logic into route handlers.

### Phase 1: Single-user compatibility with user identity

- Add Supabase configuration.
- Add auth middleware in BeeGame server.
- Add frontend login/session handling.
- Create `profiles`, `workspaces`, `workspace_members`, `projects`, `project_members`, `sessions`, `model_configs`, `runtime_settings`, and `mcp_servers`.
- Keep existing local files and existing project directories.
- Create one default local user migration path for current `dashboard-local` data.
- Create the default user as owner of the migrated workspace and projects.

### Phase 2: Owner-scoped metadata

- Replace `dashboard-local` frontend owner usage.
- Add permission evaluation helpers for route handlers.
- Add owner filtering to all model config APIs.
- Add owner filtering to runtime settings and MCP server APIs.
- Move project metadata behind the repository adapter.
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

### Phase 4.5: Runtime settings and MCP hardening

- Encrypt model, web search, and MCP secrets.
- Ensure MCP discovery only returns candidates, not another user's saved config.
- Ensure imported MCP servers are scoped to the current user.
- Ensure runtime env assembly uses only current-user settings.
- Add audit metadata for secret changes, MCP imports, workspace root changes, and high-risk tool approvals.

### Phase 5: Team-ready foundation

Do not implement collaboration yet, but avoid schema dead ends:

- Add project sharing later through `organizations`, `organization_members`, and `project_members`.
- Keep owner checks isolated behind a policy function so future roles can extend it.
- Keep application permissions and runtime tool policy separate.

## Compatibility Strategy

Current local data should be migrated, not discarded.

Suggested migration:

1. Create or select a first local admin user.
2. Assign existing local projects to that user.
3. Assign existing model configs to that user.
4. Assign existing runtime settings to that user.
5. Assign existing saved MCP servers to that user.
6. Keep existing project paths.
7. New projects use user-scoped paths.

Do not support anonymous mixed ownership after migration.

## Testing Plan

Backend tests:

- Auth required for protected routes.
- Invalid token rejected.
- Role mapping grants and denies expected application permissions.
- User A cannot list user B projects.
- User A cannot access user B session events.
- User A cannot delete user B project.
- User A cannot start/stop user B preview.
- User A cannot use model config owned by user B.
- User A cannot read or update user B runtime settings.
- User A cannot read, import, update, test, or delete user B MCP server settings.
- User A cannot receive user B model, web search, or MCP secrets in API responses.
- Runtime env assembly uses only the current user's model config, runtime settings, and MCP servers.
- Project runtime snapshots are filtered by owner.
- Path sandbox rejects paths outside current user workspace root.
- Reviewer and viewer roles cannot send agent messages or approve tool calls.
- Developer can approve low/medium-risk workspace-contained tool calls but cannot manage secrets.
- Owner-only operations reject developer/reviewer/viewer users.
- Deployment admin does not automatically read user project content without an explicit break-glass policy.
- Runtime approval decisions are scoped to project/run and do not become global bypasses.

Frontend tests:

- Login screen appears without session.
- API calls include Supabase access token.
- Model settings no longer send `ownerId=dashboard-local`.
- Runtime settings do not use a shared dashboard-global store from the frontend perspective.
- MCP settings are displayed per authenticated user.
- UI hides or disables actions the current role cannot perform.
- Permission requests render as permission cards or alerts, not normal chat messages.
- Logout clears project/model/session state.
- Project history only renders authenticated user data.

Migration tests:

- Existing local `dashboard-local` model config migrates to selected user.
- Existing projects can be bound to selected user.
- Existing runtime settings migrate to selected user.
- Existing saved MCP servers migrate to selected user.
- Existing transcripts remain discoverable.
- New projects use user-scoped workspace paths.

Static scans:

- Runtime frontend code should not contain `ownerId=dashboard-local`.
- Production route handlers should not trust request body/query owner ids.
- Production route handlers should not inline raw role checks when a named permission helper exists.
- No secret values are written to transcripts or project folders.

## Risks

- Local filesystem isolation is stricter than database isolation. A bug in path resolution could expose another user's generated project.
- Preview processes are OS-level child processes; owner checks must happen before process control.
- Model API keys are sensitive and need encryption from the first multi-user release.
- MCP env values and web search keys have the same sensitivity as model API keys.
- Machine-level MCP discovery can accidentally expose local developer config unless discovery candidates are explicitly imported per user.
- Runtime snapshots can leak project activity and model usage if not owner-scoped.
- Deployment-level admin can become too powerful if it is treated as project owner. Keep admin and project content roles separate.
- Permission prompts can become noisy if every tool call asks the user. Runtime policy should auto-allow low-risk workspace-contained actions for roles allowed to drive the agent.
- Supabase service role misuse could bypass RLS. Keep it server-only.
- Self-hosted Supabase adds operational burden and must be documented as such.
- Existing local projects may not fit the future `Projects/users/<user_id>/` layout. Migration must preserve old paths.

## Implementation Recommendation

Start with a small, strict multi-user foundation:

1. Repository interfaces for local and Supabase persistence.
2. Auth middleware and user context.
3. Remove frontend `dashboard-local`.
4. Named permission helper and baseline roles.
5. Owner-scoped projects, runtime snapshots, model configs, runtime settings, and MCP servers.
6. Owner-scoped sessions, transcripts, assets, and preview operations.
7. User-scoped workspace root for new projects.
8. Runtime tool policy for safe workspace-contained operations, high-risk approvals, and owner-only secret/MCP settings.

Only after that should BeeGame add organization/team sharing.

## References

- Supabase Auth: https://supabase.com/docs/guides/auth
- Supabase Row Level Security: https://supabase.com/docs/guides/database/postgres/row-level-security
- Supabase Storage: https://supabase.com/docs/guides/storage
- Supabase Self-hosting: https://supabase.com/docs/guides/self-hosting
