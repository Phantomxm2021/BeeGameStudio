# BeeGame Docker Deployment

This stack runs BeeGame as a static frontend, a local runtime host, and a
dedicated billing backend.

## Services

- `beegame-frontend`: Nginx serving the built React/Vite app.
- `beegame-runtime`: Bun runtime host for sessions, workspace files, previews,
  transcripts, permissions, and Supabase RLS/RPC access.
- `beegame-billing`: trusted Stripe/Supabase service-role backend for Credit
  Store packs, Checkout Session creation, Stripe webhooks, and provider credit
  grants.

## Prepare

```bash
cp docker/.env.production.example docker/.env.production
cp docker/.env.billing.example docker/.env.billing
```

Fill the Supabase and public runtime URLs in `docker/.env.production`.

Fill Stripe and Supabase service-role values in `docker/.env.billing`.

Do not put Supabase service-role keys or Stripe secrets in
`docker/.env.production`. The runtime host runs in `BEEGAME_BILLING_MODE=remote`
and calls the billing backend through the internal Compose URL
`http://beegame-billing:62175`.

## Start

```bash
bun run dashboard:docker
```

Equivalent command:

```bash
docker compose -f docker/docker-compose.yml --env-file docker/.env.production up -d --build
```

Default local ports:

- Frontend: `http://127.0.0.1:18080`
- Runtime host: `http://127.0.0.1:62174`
- Billing backend: `http://127.0.0.1:62175`

## Reverse Proxy

In production, terminate TLS in Caddy, Nginx, Traefik, or your cloud load
balancer:

- `https://app.your-domain.com` -> frontend port `18080`
- `https://runtime.your-domain.com` -> runtime host port `62174`
- `https://billing.your-domain.com` -> billing backend port `62175`

The runtime domain must support WebSocket upgrades.
The billing domain does not need WebSocket upgrades. Configure Stripe webhooks
to call `https://billing.your-domain.com/api/payments/stripe/webhook`.

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

location /ws {
  proxy_pass http://127.0.0.1:62174;
  proxy_http_version 1.1;
  proxy_set_header Upgrade $http_upgrade;
  proxy_set_header Connection "upgrade";
  proxy_set_header Host $host;
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

The runtime image seeds the checked-in `.beegame/skills` into that volume on the
first start if the volume does not already contain a `skills` directory.

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
