# BeeGame Docker Deployment

This stack runs BeeGame as a static frontend, a local runtime host, and
dedicated billing, resource-library, and user-skills backends.

## Services

- `beegame-frontend`: Nginx serving the built React/Vite app.
- `beegame-runtime`: Bun runtime host for sessions, workspace files, previews,
  transcripts, permissions, and Supabase RLS/RPC access.
- `beegame-billing`: trusted Stripe/Supabase service-role backend for Credit
  Store packs, Checkout Session creation, Stripe webhooks, and provider credit
  grants.
- `beegame-skills`: user-private BeeGame skill package backend. Users upload
  zip packages here; the runtime host only materializes enabled skills before a
  new BeeGame runtime turn starts.
- `beegame-resources`: resource Pack administration, processing, catalog
  exploration, and signed project-integration URLs.

## Prepare

```bash
npm run docker:init
```

This creates `docker/.env.production`, `docker/.env.billing`, and
`docker/.env.resource` from the examples when they are missing. It generates
the internal Skills and Resource service tokens, creates the runtime secret
encryption key, and sets the same `BEEGAME_CREDIT_CONTROL_TOKEN` in the runtime
and billing env files.

Fill the Supabase and public runtime URLs in `docker/.env.production`.

Fill Stripe, Supabase anon, and Supabase service-role values in
`docker/.env.billing`. The billing backend uses the anon key to verify the
signed-in user's Bearer token on Credit Store requests, and uses the
service-role key only for provider credit grants after Stripe webhook
verification.

Fill Supabase URL, anon key, and service-role values in
`docker/.env.resource`. Keeping these in a separate file prevents resource
Storage/database credentials from entering the browser image or Claude runtime
container.

`BEEGAME_CREDIT_CONTROL_TOKEN` must match in both files. The runtime host uses
it only for internal reserve, settle, and refund requests to `beegame-billing`;
it is not passed to the frontend image.

`BEEGAME_SKILLS_SERVICE_TOKEN` lives in `docker/.env.production`. The same value
is injected into `beegame-runtime` and `beegame-skills`; the runtime host uses it
only for internal enabled-skill materialization requests to `beegame-skills`.

Do not put Supabase service-role keys or Stripe secrets in
`docker/.env.production`. The runtime host runs in `BEEGAME_BILLING_MODE=remote`
and calls the billing backend through the internal Compose URL
`http://beegame-billing:62175`.

`http://127.0.0.1:62175/health` is public. Billing API routes under
`/api/payments/*` require the same signed-in user Authorization header that the
frontend sends to the runtime host; direct browser visits to those API routes
return `401 Unauthorized`.

`http://127.0.0.1:62176/health` is public. User skill routes under
`/api/user-skills/*` require the signed-in user Authorization header. Internal
enabled-skill reads can require `BEEGAME_SKILLS_SERVICE_TOKEN` when configured.

`http://127.0.0.1:62177/health` is public. Resource management routes require a
signed-in resource administrator; runtime catalog exploration uses the
dedicated `BEEGAME_RESOURCE_SERVICE_TOKEN` on the internal Compose network.

## Local Billing Backend

For full local development without Docker, prefer the one-command launcher from
the repository root:

```bash
npm run beegame:dev
```

It starts frontend, runtime host, billing backend, and skills backend together,
auto-selects free ports, and injects the local service URLs into each process.

When debugging billing only, create `docker/.env.billing` and run:

```bash
npm run billing:dev
```

The billing server automatically loads `docker/.env.billing` when it starts and
prints only configured or missing environment variable names, never secret
values. Override the env file path with `BEEGAME_BILLING_ENV_FILE` only when
you deliberately need a different local file.
Billing listens on `BEEGAME_BILLING_PORT` or defaults to `62175`; it does not
inherit the runtime host's `AGENT_WORKFLOW_PORT`.

## Local Skills Backend

When debugging skills only, run:

```bash
npm run skills:dev
```

The skills server listens on `BEEGAME_SKILLS_PORT` or defaults to `62176`. It
stores uploaded user skill packages under `BEEGAME_SKILLS_DATA_DIR`, or under
the local BeeGame config directory when that variable is not set.

## Start

```bash
npm run docker:up
```

Equivalent command:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
```

The four Bun backend services share one dependency-install stage in
`docker/Dockerfile.backend`. Only `beegame-runtime` keeps the full workspace and
dependency tree. Billing, Skills, and Resource Library are emitted as compact
runtime bundles, so Compose does not export four duplicate `node_modules`
layers. Bun and npm download caches use BuildKit cache mounts and are not copied
into the final images.

On a small host, keep `BEEGAME_BUN_INSTALL_NETWORK_CONCURRENCY=2` (the default)
and build without Compose-level parallelism:

```bash
COMPOSE_PARALLEL_LIMIT=1 ./scripts/beegame-docker.sh up
```

The launcher uses the same configurable package registry for frontend npm and
backend Bun installs. The default is `https://registry.npmmirror.com/`. Override
it for one build without editing a Dockerfile or env file:

```bash
sudo ./scripts/beegame-docker.sh up --registry https://registry.npmjs.org/
```

For a persistent override, set `BEEGAME_PACKAGE_REGISTRY` in
`docker/.env.production`. npm replaces registry hosts recorded in the lockfile,
and retries transient downloads with bounded backoff.

If the host previously attempted builds with the legacy per-service
Dockerfiles, old BuildKit layers can still occupy `/var/lib/docker` or
`/var/lib/containerd`. After confirming that no other in-progress image build
needs those caches, reclaim build cache and unreferenced images once:

```bash
docker builder prune -af
docker image prune -af
```

Do not prune named volumes: `beegame-config` and `beegame-skills` contain
persistent application data.

Useful wrappers:

```bash
npm run docker:ps
npm run docker:logs
npm run docker:restart
npm run docker:down
```

Default local ports:

- Frontend: `http://127.0.0.1:18080`
- Runtime host: `http://127.0.0.1:62174`
- Billing backend: `http://127.0.0.1:62175`
- Skills backend: `http://127.0.0.1:62176`
- Resource backend: `http://127.0.0.1:62177`

## Billing Flow

The Docker topology is intentionally split:

```text
browser -> beegame-runtime -> beegame-billing -> Stripe/Supabase service-role RPC
```

`beegame-runtime` runs with `BEEGAME_BILLING_MODE=remote`. It proxies Credit
Store and checkout requests to `beegame-billing`, forwarding the signed-in
user's Authorization header. It also sends `BEEGAME_CREDIT_CONTROL_TOKEN` for
internal credit-control mutations.

`beegame-billing` runs with `BEEGAME_BILLING_MODE=server`. It is the only
container that should receive:

- `BEEGAME_SUPABASE_SERVICE_ROLE_KEY`
- `BEEGAME_STRIPE_SECRET_KEY`
- `BEEGAME_STRIPE_WEBHOOK_SECRET`

## Skills Flow

The user skills topology is also split:

```text
browser -> beegame-runtime -> beegame-skills
runtime turn startup -> beegame-skills -> materialized .runtime/app/skills/user-*
```

`beegame-runtime` proxies user skill list/import/toggle/delete requests to
`beegame-skills`, forwarding the signed-in user's Authorization header.
`beegame-skills` accepts zip packages containing `SKILL.md` plus optional
`references/*.md` files. It does not expose markdown editing through the UI.

Configure Stripe webhooks to call:

```text
https://billing.your-domain.com/api/payments/stripe/webhook
```

Local Stripe CLI example:

```bash
stripe listen --forward-to http://127.0.0.1:62175/api/payments/stripe/webhook
```

Use the `whsec_...` printed by that running `stripe listen` process in
`docker/.env.billing`, then restart `beegame-billing`.

## Smoke Test

After `docker compose` is healthy:

1. Open the frontend and sign in.
2. Open the account menu and select Credit Store.
3. Confirm credit packs load from `beegame-billing`.
4. Buy a Stripe test pack and return to BeeGame.
5. Confirm the user's credit balance increases after the webhook is delivered.
6. Generate or edit a project and confirm the runtime host can reserve and
   settle credits through the billing backend.
7. Open Settings -> Skills, import a valid skill zip, toggle it on, then start a
   new BeeGame runtime turn and confirm the runtime host materializes it.
8. Create or inspect a resource Pack and confirm the runtime can explore the
   published catalog.
9. Restart all services, then confirm Credit Store, resource Packs, credit
   balance, and imported skills still work.

## Reverse Proxy

In production, terminate TLS in Caddy, Nginx, Traefik, or your cloud load
balancer:

- `https://app.your-domain.com` -> frontend port `18080`
- `https://runtime.your-domain.com` -> runtime host port `62174`
- `https://billing.your-domain.com` -> billing backend port `62175`
- `https://skills.your-domain.com` -> skills backend port `62176` only if you
  intentionally expose it directly; the default frontend path goes through
  runtime host proxy routes.
- `https://resources.your-domain.com` -> resource backend port `62177`.

The runtime domain must support WebSocket upgrades.
The billing domain does not need WebSocket upgrades. Configure Stripe webhooks
to call `https://billing.your-domain.com/api/payments/stripe/webhook`.
The skills domain does not need WebSocket upgrades.

Managed live previews are exposed through the runtime host under `/previews/*`.
Set `BEEGAME_PREVIEW_PUBLIC_BASE_URL` to the public runtime preview base, for
example `https://runtime.your-domain.com/previews`. If frontend and runtime
share one public domain, route `/previews/` to the runtime host port `62174`,
not the frontend container.

Single-domain Nginx example:

```nginx
location /api/ {
  proxy_pass http://127.0.0.1:62174;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
}

location /deployments/ {
  proxy_pass http://127.0.0.1:62174;
  proxy_set_header Host $host;
}

location /previews/ {
  proxy_pass http://127.0.0.1:62174;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
}

location /api/payments/stripe/ {
  proxy_pass http://127.0.0.1:62175;
  proxy_set_header Host $host;
  proxy_set_header X-Forwarded-Proto $scheme;
  proxy_set_header X-Forwarded-Host $host;
}

location / {
  proxy_pass http://127.0.0.1:18080;
  proxy_set_header Host $host;
}
```

## Data

Generated projects are stored in the `beegame-projects` Docker volume at
`/srv/beegame/projects` inside the runtime container.

Runtime config is stored in the `beegame-config` Docker volume at
`/home/bun/.beegame`.

The runtime image seeds the checked-in `.beegame/skills/builtinskills` into that
volume on the first start if the volume does not already contain built-in skills.
Uploaded user skills are managed separately by the skills service under
`.beegame/skills/<user_id>`.

## Current Scope

This deploys the BeeGame SaaS application, runtime host, and dedicated billing
backend. The billing backend is intentionally narrow and should be the only
long-running service that receives Stripe secrets and the Supabase service-role
key.

The runtime host can publish generated static Web builds under `/deployments/*`.
Deployment artifacts and deployment metadata are stored in the same
`beegame-projects` Docker volume as generated projects. This is the first local
publisher implementation; production object storage/CDN publishing should be
added before relying on deployments as long-term public hosting.
