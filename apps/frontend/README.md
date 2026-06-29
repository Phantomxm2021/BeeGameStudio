# BeeGame Frontend

BeeGame Frontend is the Web UI for BeeGame. It provides the idea intake, project dashboard, chat timeline, preview controls, asset panel, account menu, and SaaS settings surfaces.

The frontend is intentionally thin:

- Supabase Auth owns user sessions.
- Supabase RLS/RPC owns durable SaaS data, roles, credits, and permissions.
- The BeeGame runtime host owns local execution only: agent sessions, filesystem access, previews, permissions, and transcript streaming.
- The frontend must not rely on a shared production auth token.

## Development

From the repository root:

```bash
bun run dashboard:dev
```

This starts the runtime host and the Vite frontend together. Use this path for normal local development so the frontend and runtime API stay on compatible ports.

If you only need the frontend:

```bash
cd apps/frontend
bun install
bun run dev
```

## Environment

Required for Supabase-backed SaaS mode:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-supabase-anon-key
```

Optional:

```env
VITE_API_BASE_URL=http://127.0.0.1:62175
VITE_WS_BASE_URL=ws://127.0.0.1:62175
```

`VITE_API_AUTH_TOKEN` is reserved for dev/offline diagnostics. Production builds ignore it unless `VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN=1` is explicitly set.

Do not place service-role keys in frontend environment files.

## Scripts

```bash
bun run dev
bun run build
bun run preview
bun run test:run
```

The app package still supports npm-compatible scripts because Vite tooling does, but BeeGame development in this repository should use Bun.

## SaaS Boundaries

User-facing settings are limited to personal preferences such as language. Admin-only settings include model configuration, web search credentials, runtime capability toggles, MCP configuration, and deployment workspace policy.

The frontend gets the current user and permissions from the runtime host, which reads Supabase Auth/RLS context. It should hide admin surfaces unless the returned permissions allow them, and the runtime host must still enforce permissions on every route.

## Project Data

Generated projects, transcripts, previews, and uploaded assets are runtime data. The runtime host may mirror metadata to Supabase, but file execution remains under the managed workspace root.

Do not commit generated `Projects/` data or `.env.local`.
