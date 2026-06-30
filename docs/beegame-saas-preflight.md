# BeeGame SaaS Preflight Checklist

Use this checklist before promoting a BeeGame deployment to production.

## Supabase

- Apply the latest SQL migrations. Re-running the SQL must be idempotent and must not fail with `already exists` errors.
- Confirm Row Level Security is enabled for BeeGame tables.
- Confirm ordinary users can access only their own projects, sessions, assets, previews, model metadata, runtime settings, MCP metadata, credits, and ledger rows.
- Confirm admin permissions come only from Supabase-controlled state:
  - `auth.users.raw_app_meta_data.beegame_role = "owner"`, or
  - a workspace membership row where the current user is `owner`.
- Confirm credit RPCs are available:
  - quote
  - reserve
  - settle
  - refund
  - ledger query
- Confirm no frontend or runtime-host environment contains a Supabase service-role key.

## Auth And OAuth

- Configure Supabase Auth email/password.
- Configure OAuth providers that will be visible in the BeeGame UI.
- Add the production frontend URL to Supabase Site URL and redirect URLs.
- Add local development redirect URLs only for development environments.
- Verify OAuth providers return usable email, display name, and avatar metadata when available.
- Verify password reset redirects to the intended frontend route.

## Storage

- Create the `avatars` bucket and apply user-scoped policies.
- Create the `beegame-assets` bucket and apply project/member-scoped policies.
- Verify avatar upload, preview, update, and delete.
- Verify project asset upload, manifest persistence, and delete.
- Keep generated local workspace files out of Supabase unless they are durable product metadata or user assets.

## Frontend Environment

Start from the checked-in `.env.example` when preparing local development or deployment-specific environment files.

Required production values:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
VITE_API_BASE_URL=https://runtime.your-domain.com
VITE_WS_BASE_URL=wss://runtime.your-domain.com
```

Rules:

- Do not configure service-role keys in frontend builds.
- Do not enable `VITE_API_AUTH_TOKEN` in production unless running a deliberate dev/offline diagnostic build.
- Keep `.env.local` out of git.

## Runtime Host Environment

Required production values:

```env
BEEGAME_SUPABASE_URL=https://your-project.supabase.co
BEEGAME_SUPABASE_ANON_KEY=your-supabase-anon-key
BEEGAME_SUPABASE_AVATAR_BUCKET=avatars
BEEGAME_SUPABASE_ASSET_BUCKET=beegame-assets
BEEGAME_WORKSPACE_ROOT=/srv/beegame/projects
```

Rules:

- The runtime host uses the current user's Supabase access token and RLS/RPC.
- The runtime host must not use Supabase service-role credentials.
- The local dev launcher filters known Supabase service-role variables before spawning the runtime host.
- The workspace root is a platform deployment setting, not a normal user setting.
- Preview ports must not conflict with the frontend, runtime host, or reverse proxy.
- Generated projects should live outside the source repository.

## Admin Console Boundary

Normal user Settings should contain only low-risk personal preferences such as language.

Admin Console may contain:

- Model provider configuration.
- Web search provider credentials.
- Runtime capability toggles.
- MCP server configuration.
- Workspace deployment policy.
- Credit policy and audit views.

The Admin Console must be visible only when `/api/current-user` returns the required named permissions.

## Platform Default Model

Hosted SaaS deployments should not require every user to configure their own
LLM key. Before opening generation to regular users:

- Mark at least one trusted account as a platform owner in Supabase-controlled
  metadata.
- Sign in as that owner and create a default model config from Admin Console.
- Confirm ordinary users can list the masked default model metadata but cannot
  create, update, or delete model configs.
- Confirm `beegame_runtime_env` returns the model provider environment for an
  ordinary authenticated user.

If `bun run supabase:smoke` fails with `beegame_runtime_env did not return a
usable model provider configuration`, the SQL/RLS path may be working, but no
effective default model config is available to the smoke user.

## Smoke Check

First run the local configuration preflight. It does not contact Supabase and does not print secret values:

```bash
bun run saas:preflight
```

Add one of the following to `.env.local` before running the smoke check:

```env
BEEGAME_SMOKE_EMAIL=smoke-user@example.com
BEEGAME_SMOKE_PASSWORD=...
```

or:

```env
BEEGAME_SUPABASE_ACCESS_TOKEN=...
BEEGAME_SUPABASE_USER_ID=...
```

Then run:

```bash
bun run supabase:smoke
```

The smoke check must pass Auth, RLS, projects, asset manifest, avatar Storage, project asset Storage, credits RPC, and runtime env checks before production rollout.

If password sign-in fails with `Database error granting user`, re-run
`docs/beegame-supabase-schema.sql`. That error usually means the Supabase
Auth trigger or existing-user backfill is out of date.

## Repository Hygiene

- Do not commit `.env.local`.
- Do not commit generated `Projects/` workspaces.
- Do not commit local Supabase smoke artifacts.
- Confirm `bun run typecheck` passes.
- Confirm relevant frontend permission-boundary tests pass.
