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

- Frontend: `http://127.0.0.1:8080`
- Runtime host: `http://127.0.0.1:62174`

## Reverse Proxy

In production, terminate TLS in Caddy, Nginx, Traefik, or your cloud load
balancer:

- `https://app.your-domain.com` -> frontend port `8080`
- `https://runtime.your-domain.com` -> runtime host port `62174`

The runtime domain must support WebSocket upgrades.

## Data

Generated projects are stored in the `beegame-projects` Docker volume at
`/srv/beegame/projects` inside the runtime container.

Runtime config is stored in the `beegame-config` Docker volume at
`/home/bun/.beegame`.

The runtime image seeds the checked-in `.beegame/skills` into that volume on the
first start if the volume does not already contain a `skills` directory.

## Current Scope

This deploys the BeeGame SaaS application and runtime host. It does not yet
publish finished games to static hosting. Generated game deployment should be
added as a separate deployment service after project acceptance.
