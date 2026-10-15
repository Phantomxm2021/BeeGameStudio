# BeeGame Frontend

BeeGame Frontend is the Web UI for BeeGame. It provides the idea intake, project dashboard, chat timeline, preview controls, asset panel, account menu, and SaaS settings surfaces.

The frontend is intentionally thin:

- Supabase Auth owns user sessions.
- Supabase RLS/RPC owns durable SaaS data, roles, credits, and permissions.
- The BeeGame runtime host owns local execution only: agent sessions, filesystem access, previews, permissions, and transcript streaming. Live project events use authenticated SSE with cursor-based polling fallback for older or unavailable hosts.
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
```

`VITE_API_AUTH_TOKEN` is reserved for dev/offline diagnostics. Production builds ignore it unless `VITE_BEEGAME_ALLOW_DEV_AUTH_TOKEN=1` is explicitly set.

Do not place service-role keys in frontend environment files.

## Scripts

```bash
bun run dev
bun run build
bun run preview
bun run test:run
bun run typecheck
bun run check
```

The app package still supports npm-compatible scripts because Vite tooling does, but BeeGame development in this repository should use Bun.

`bun run check` runs type checking, all frontend tests and the production build.
The frontend CI workflow runs these checks and bundles the shared UI inspector.
`bun run lint` remains a separate check while the existing lint backlog is resolved.

## Code ownership

- `App.tsx` and page components compose views and handle navigation.
- `hooks/` owns React state and interactions with services; for example, skill settings load only while their section is open.
- `services/` owns API transport and conversion of server data.
- `components/Demiurge/Landing/types.ts` owns the intake and authentication view contracts. Copy construction and session recovery live beside it, so child components do not depend on the landing page implementation.
- `packages/scene-editor/src/ui-preview/` owns the UI renderer, atlas/font loading and browser inspection entry shared by the editor and runtime checker. It must not import frontend pages, stores or service adapters. The frontend adapter re-exports its UI node contract for existing callers.

Keep rendering and inspection behavior in that shared implementation rather than copying it between the app and runtime host.

## SaaS Boundaries

User-facing settings are limited to personal preferences such as language. Admin-only settings include model configuration, web search credentials, runtime capability toggles, MCP configuration, and deployment workspace policy.

The frontend gets the current user and permissions from the runtime host, which reads Supabase Auth/RLS context. It should hide admin surfaces unless the returned permissions allow them, and the runtime host must still enforce permissions on every route.

## Project Data

Generated projects, transcripts, previews, and uploaded assets are runtime data. The runtime host may mirror metadata to Supabase, but file execution remains under the managed workspace root.

Do not commit generated `Projects/` data or `.env.local`.
