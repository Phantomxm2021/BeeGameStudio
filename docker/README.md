# BeeGame Docker Deployment

This stack runs BeeGame as a static frontend plus a runtime host.

## Services

- `beegame-frontend`: Nginx serving the built React/Vite app.
- `beegame-runtime`: Bun runtime host for sessions, workspace files, previews,
  transcripts, permissions, and Supabase RLS/RPC access.

## Prepare

```bash
cp docker/.env.production.example docker/.env.production
```

Fill the Supabase and public runtime URLs in `docker/.env.production`.

Do not put Supabase service-role keys in this file. Service-role keys are only
for one-time setup commands from a trusted admin machine.

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

## Reverse Proxy

In production, terminate TLS in Caddy, Nginx, Traefik, or your cloud load
balancer:

- `https://app.your-domain.com` -> frontend port `18080`
- `https://runtime.your-domain.com` -> runtime host port `62174`

The runtime domain must support WebSocket upgrades.

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

This deploys the BeeGame SaaS application and runtime host.

The runtime host can publish generated static Web builds under `/deployments/*`.
Deployment artifacts and deployment metadata are stored in the same
`beegame-projects` Docker volume as generated projects. This is the first local
publisher implementation; production object storage/CDN publishing should be
added before relying on deployments as long-term public hosting.
