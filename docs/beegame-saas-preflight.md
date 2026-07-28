# BeeGame SaaS Preflight Checklist

Use this checklist before promoting a BeeGame deployment to production.

## Supabase

- Apply the latest SQL migrations. Re-running the SQL must be idempotent and must not fail with `already exists` errors.
- Confirm Row Level Security is enabled for BeeGame tables.
- Confirm ordinary users can access only their own projects, sessions, assets, previews, model metadata, runtime settings, MCP metadata, usage events, usage summaries, and wallet data.
- Confirm admin permissions come only from Supabase-controlled state:
  - `auth.users.raw_app_meta_data.beegame_role = "owner"`, or
  - a workspace membership row where the current user is `owner`.
- Confirm realtime usage event recording, usage summaries, wallet debit idempotency,
  and billing audit routes are available.
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
- Create the `beegame-deployments` bucket and apply public-read/user-write policies.
- Verify avatar upload, preview, update, and delete.
- Verify project asset upload, manifest persistence, and delete.
- Verify static Web deployment upload and public URL access.
- Keep generated local workspace files out of Supabase unless they are durable product metadata or user assets.
- Review `docs/beegame-project-lifecycle.md` for project quota, backup, restore,
  deletion, and retention operations.

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

Dedicated billing backend values:

```env
BEEGAME_BILLING_MODE=server
BEEGAME_SUPABASE_URL=https://your-project.supabase.co
BEEGAME_SUPABASE_ANON_KEY=your-supabase-anon-key
BEEGAME_SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
BEEGAME_SUPABASE_AVATAR_BUCKET=avatars
BEEGAME_SUPABASE_ASSET_BUCKET=beegame-assets
BEEGAME_DEPLOYMENT_STORAGE_BUCKET=beegame-deployments
BEEGAME_DEPLOYMENT_STORAGE_PREFIX=deployments
BEEGAME_WORKSPACE_ROOT=/srv/beegame/projects
BEEGAME_STRIPE_SECRET_KEY=sk_live_...
BEEGAME_STRIPE_WEBHOOK_SECRET=whsec_...
BEEGAME_STRIPE_PRICE_CREDITS=price_...=100
BEEGAME_CREDIT_CONTROL_TOKEN=shared-runtime-to-billing-secret
```

Trusted SaaS runtime host values:

```env
BEEGAME_BILLING_MODE=remote
BEEGAME_BILLING_API_BASE_URL=https://billing.your-domain.com
BEEGAME_CREDIT_CONTROL_TOKEN=shared-runtime-to-billing-secret
BEEGAME_SUPABASE_URL=https://your-project.supabase.co
BEEGAME_SUPABASE_ANON_KEY=your-supabase-anon-key
BEEGAME_SUPABASE_AVATAR_BUCKET=avatars
BEEGAME_SUPABASE_ASSET_BUCKET=beegame-assets
BEEGAME_DEPLOYMENT_STORAGE_BUCKET=beegame-deployments
BEEGAME_DEPLOYMENT_STORAGE_PREFIX=deployments
BEEGAME_WORKSPACE_ROOT=/srv/beegame/projects
```

Local client runtime values when the web UI and runtime host are packaged
together for users to run on their own machine:

```env
BEEGAME_BILLING_MODE=remote
BEEGAME_BILLING_API_BASE_URL=https://billing.your-domain.com
BEEGAME_SUPABASE_URL=https://your-project.supabase.co
BEEGAME_SUPABASE_ANON_KEY=your-supabase-anon-key
BEEGAME_SUPABASE_ACCESS_TOKEN=the-current-user-token
BEEGAME_WORKSPACE_ROOT=/local/user/projects
```

Rules:

- Normal user requests use the current user's Supabase access token and RLS/RPC.
- Stripe webhook credit grants use the server-only Supabase service-role key
  only inside the dedicated billing backend running `BEEGAME_BILLING_MODE=server`.
- Trusted runtime hosts in `BEEGAME_BILLING_MODE=remote` must send
  `BEEGAME_CREDIT_CONTROL_TOKEN` to the billing backend for usage recording.
  User-run local clients must not receive this token.
- Never expose `BEEGAME_SUPABASE_SERVICE_ROLE_KEY`, `BEEGAME_STRIPE_SECRET_KEY`,
  `BEEGAME_STRIPE_WEBHOOK_SECRET`, or `BEEGAME_CREDIT_CONTROL_TOKEN` to frontend
  builds, generated game runtimes, or user-run local clients.
- The workspace root is a platform deployment setting, not a normal user setting.
- Preview ports must not conflict with the frontend, runtime host, or reverse proxy.
- Generated projects should live outside the source repository.

## Billing Topology

BeeGame supports three billing modes:

- `server`: trusted deployment mode. This process creates Stripe Checkout
  Sessions, receives Stripe webhooks, verifies `Stripe-Signature`, and grants
  credits through the Supabase service-role RPC.
- `remote`: local-client mode. This process does not hold Stripe or service-role
  secrets. It proxies Credit Store pack, checkout, and operator grant requests to
  `BEEGAME_BILLING_API_BASE_URL`, forwarding the signed-in user's authorization.
  The remote billing backend must run in `server` mode.
- `disabled`: no billing. The Credit Store has no packs and checkout creation
  returns a clear unavailable response.

For packaged local clients, use `remote`. The local runtime host and web UI can
ship together, but purchases and provider credit grants remain centralized in a
trusted backend or Docker service.

The dedicated backend entrypoint is
`packages/beegame-billing-server/src/index.ts`. Docker deployments should run
the `beegame-billing` target from `docker/Dockerfile.backend` and keep its
secret environment in `docker/.env.billing`.

The dedicated billing package must not depend on the runtime host package.
`packages/beegame-billing-server` owns its own auth resolver and Supabase
billing repository; shared route logic lives in `packages/beegame-billing-core`.

## Stripe Credits

BeeGame creates Stripe Checkout Sessions from the signed-in user store. In
`server` mode these routes talk to Stripe directly. In `remote` mode they proxy
to the billing backend:

```text
GET  https://runtime.your-domain.com/api/payments/stripe/credit-packs
POST https://runtime.your-domain.com/api/payments/stripe/checkout-session
```

Operator credit grants also belong to the billing backend boundary:

```text
POST https://runtime.your-domain.com/api/admin/credits/grants
```

In `remote` mode the runtime host only checks the operator permission and proxies
the request. The billing backend records the usage event and updates the wallet.

The user-facing entry is the account menu `Credit Store`, not Settings.
Settings > Platform > Credit remains an operator audit view.

Credit grants are completed from Stripe Checkout webhooks at the trusted billing
backend:

```text
POST https://billing.your-domain.com/api/payments/stripe/webhook
```

This webhook route is enabled only in `server` mode. Do not point Stripe
webhooks at a user-run local client.

Configure the Stripe endpoint to send `checkout.session.completed` events. The
Checkout Session created by BeeGame includes:

- `metadata.beeGameUserId`: BeeGame/Supabase account UUID to receive credits.
- `metadata.beeGamePriceId`: Stripe Price ID to map to credits.
- `metadata.beeGameCredits`: mapped BeeGame credit amount for operator audit.

Trusted billing backend variables:

```env
BEEGAME_BILLING_MODE=server
BEEGAME_SUPABASE_URL=https://your-project.supabase.co
BEEGAME_SUPABASE_ANON_KEY=your-supabase-anon-key
BEEGAME_SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
BEEGAME_STRIPE_SECRET_KEY=sk_live_...
BEEGAME_STRIPE_WEBHOOK_SECRET=whsec_...
BEEGAME_STRIPE_PRICE_CREDITS=price_123=100,price_456=500
BEEGAME_CREDIT_CONTROL_TOKEN=shared-runtime-to-billing-secret
```

The billing backend uses the Supabase anon key to resolve the signed-in user
from the forwarded Bearer token. It uses the service-role key only for
provider credit grants after Stripe signature verification.

Trusted runtime hosts and the billing backend should share
`BEEGAME_CREDIT_CONTROL_TOKEN` when `BEEGAME_BILLING_MODE=remote`. Runtime credit
mutations use this internal service token to call the trusted billing backend;
browsers and user-run local clients must never receive this value.

`BEEGAME_STRIPE_PRICE_CREDITS` also accepts strict JSON object syntax, for
example `{"price_123":100,"price_456":500}`.

When using `stripe listen` for local testing, use the `whsec_...` printed by
that running CLI process and restart the runtime host after updating
`BEEGAME_STRIPE_WEBHOOK_SECRET`.

The runtime host verifies the Stripe signature before calling Supabase.
Supabase then makes duplicate webhook deliveries idempotent by
`providerReference`.

Manual production smoke test:

1. Sign in as a normal user.
2. Open the account menu and click `Credit Store`.
3. Confirm the packs match `BEEGAME_STRIPE_PRICE_CREDITS`.
4. Buy a small test pack through Stripe Checkout.
5. Return to BeeGame and confirm the credit balance increases.
6. Open Settings > Platform > Credit as an audit-capable owner and confirm the
   wallet and billing audit event reflect the grant.

## Settings Boundary

Normal user Settings should contain only low-risk personal preferences such as language.

The Platform section inside Settings may contain:

- Model provider configuration.
- Web search provider credentials.
- Runtime capability toggles.
- MCP server configuration.
- Workspace deployment policy.
- Credit policy and audit views.

The Platform section must be visible only when `/api/current-user` returns the required named permissions.

## Platform Default Model

Hosted SaaS deployments should not require every user to configure their own
LLM key. Before opening generation to regular users:

- Apply the latest SQL so `beegame_platform_owner_invites` exists.
- Configure one or more trusted bootstrap owner emails and run the one-time
  bootstrap command from a deployment/admin machine:

  ```bash
  BEEGAME_BOOTSTRAP_OWNER_EMAILS=owner@example.com \
  BEEGAME_SUPABASE_SERVICE_ROLE_KEY=... \
  bun run supabase:bootstrap-owner
  ```

- Let the invited owner register or sign in through the normal frontend.
- If the owner account already exists, sign in or refresh after bootstrap; the
  current-user RPC will claim the invite.
- Sign in as that owner and create a default model config from Settings > Platform.
- Confirm ordinary users can list the masked default model metadata but cannot
  create, update, or delete model configs.
- Confirm `beegame_runtime_env` returns the model provider environment for an
  ordinary authenticated user.

The service-role key is for this one-time deployment bootstrap command only. Do
not put it in frontend builds or the long-running runtime host environment.

If `bun run supabase:smoke` fails with `beegame_runtime_env did not return a
usable model provider configuration`, the SQL/RLS path may be working, but no
effective default model config is available to the smoke user.

If you previously configured a model before Supabase owner-scoped settings were
enabled, it may still exist in the local dashboard store instead of Supabase.
Check the local migration summary first:

```bash
BEEGAME_MIGRATION_EMAIL=owner@example.com \
BEEGAME_MIGRATION_PASSWORD=... \
bun scripts/migrate-beegame-local-to-supabase.ts
```

For OAuth-only accounts without a password, use the signed-in browser session
token instead:

```bash
BEEGAME_MIGRATION_DATA_DIR="$PWD/Projects" \
BEEGAME_SUPABASE_ACCESS_TOKEN="eyJ...eyJ...signature" \
BEEGAME_MIGRATION_OWNER_ID="<supabase-user-id>" \
bun scripts/migrate-beegame-local-to-supabase.ts
```

`BEEGAME_SUPABASE_ACCESS_TOKEN` must be the Supabase `access_token` JWT, not the
refresh token, provider token, or OAuth code. The migration CLI also accepts the
copied Supabase localStorage JSON and will extract `access_token` or
`currentSession.access_token`.

If existing projects are still visible on disk under this worktree's `Projects`
directory but the History modal is empty after signing in, migrate the local
project index from that exact directory:

```bash
BEEGAME_MIGRATION_DATA_DIR="$PWD/Projects" \
BEEGAME_MIGRATION_EMAIL=owner@example.com \
BEEGAME_MIGRATION_PASSWORD=... \
bun scripts/migrate-beegame-local-to-supabase.ts
```

When the dry-run summary shows the expected project and configuration counts,
apply it:

```bash
BEEGAME_MIGRATION_DATA_DIR="$PWD/Projects" \
BEEGAME_MIGRATION_EMAIL=owner@example.com \
BEEGAME_MIGRATION_PASSWORD=... \
bun scripts/migrate-beegame-local-to-supabase.ts --apply
```

The migration uses the signed-in owner user by default. Use a platform owner
account, not a regular smoke/developer account.

By default, the migration applies project metadata and user-owned MCP server
records only. It does not write platform-level model, runtime, or web search
settings, because Supabase RLS allows only platform owners to manage those
tables. To migrate platform settings, sign in as a platform owner and add:

```bash
--include-platform-settings
```

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
