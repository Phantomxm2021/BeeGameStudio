# BeeGame Product TODO

Last audited: 2026-07-08

This document tracks product and deployment gaps that are not covered by the
current BeeGame implementation. It is intentionally focused on system-level
work, not individual generated game fixes.

## Current State

- BeeGame dashboard, Supabase Auth/RLS data access, credit quote/reserve/settle
  flow, runtime host, and Docker deployment scaffolding are implemented.
- The Docker stack deploys the BeeGame application and local runtime host, but
  a real Docker smoke pass still needs to be run on a machine with Docker.
- Generated game projects are stored in the runtime workspace volume.
- Static Web deployments can be published by the runtime host under
  `/deployments/*` for local/dev use, or to Supabase Storage when
  `BEEGAME_DEPLOYMENT_STORAGE_BUCKET` is configured.
- Deployment records are mirrored to Supabase so published URLs and statuses can
  survive runtime host replacement.

## Completed

- [x] Production Web game deployment lifecycle
  - Evidence:
    - Runtime deploy/list/rollback routes exist for project-scoped and
      session-scoped APIs.
    - Deployment records include build command, build log, output directory,
      artifact path/hash, status, message, URL, and timestamps.
    - Supabase Storage publishing is implemented with the current user's bearer
      token, not a service-role key.
    - Deployment records are mirrored to Supabase.
    - Dashboard UI shows latest deployment, history, failed build logs,
      redeploy, open-live, and rollback actions.
  - Verified:
    - `bun test packages/agent-workflow-server/src/__tests__/deployment-manager.test.ts`
    - `bun test packages/agent-workflow-server/src/__tests__/supabase-dashboard-store.test.ts`
    - `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`
    - `bunx vitest --config vitest.config.ts run src/components/Demiurge/DashboardView.test.tsx`

- [x] MCP administration verification and cleanup
  - Evidence:
    - Settings UI exposes MCP management only through privileged platform
      settings.
    - Add/edit/import/discovery flows are covered by frontend tests.
    - Backend stores MCP servers owner-scoped in local or Supabase-backed stores.
    - Runtime sessions receive persisted runtime and MCP-related settings.
  - Verified:
    - `bunx vitest --config vitest.config.ts run src/components/Demiurge/Landing/SettingsMenu.test.tsx`
    - `bun test packages/agent-workflow-server/src/__tests__/beegame-routes.test.ts`

- [x] Account deletion production flow
  - Evidence:
    - `/api/current-user` DELETE calls `beegame_delete_current_user()` through
      authenticated Supabase RPC when Supabase is configured.
    - Local/dev mode refuses account deletion instead of pretending to delete.
    - The SQL RPC writes an audit event and deletes only `auth.uid()`.
    - Frontend confirms the destructive action before clearing the signed-in
      session.
  - Remaining storage-object cleanup policy is tracked under generated project
    lifecycle controls.

- [x] Production launch checklist
  - Evidence:
    - `docs/beegame-saas-preflight.md` covers Supabase SQL/RLS/RPC, Auth/OAuth,
      Storage buckets, platform owner bootstrap, default model config, runtime
      env, smoke checks, and repository hygiene.
  - Note:
    - The checklist exists, but reverse-proxy copy-paste examples are still a
      separate P0.

## P0

- [ ] Production Docker smoke test
  - Problem: Docker files exist, but the stack has not been verified locally in
    this environment because `docker` is unavailable.
  - Scope:
    - Run `docker compose config`.
    - Run `docker compose up -d --build`.
    - Verify frontend, runtime host, Supabase Auth, credit quote, project
      generation, preview, deployment, and volume persistence.
  - Acceptance:
    - A clean server can start BeeGame from the Docker instructions.
    - Restarting containers does not lose user/session/project state.
    - Docker deployment env includes the Supabase deployment storage variables
      required for persistent public game publishing.

- [ ] Reverse proxy and TLS deployment example
  - Problem: current docs say a reverse proxy is required, but they do not give a
    deployer a complete Caddy/Nginx/Traefik example.
  - Scope:
    - Add production examples for Caddy, Nginx, or Traefik.
    - Document WebSocket/proxy headers for runtime host and preview routes.
    - Document recommended domains, HTTPS, port boundaries, and deployment
      storage public URL settings.
  - Acceptance:
    - A deployer can run BeeGame behind HTTPS without guessing proxy settings.

## P1

- [ ] Credit billing hardening
  - Problem: quote/reserve/settle/refund exists and interrupted runtime tasks are
    refunded or settled in tested paths, but production billing still needs
    stuck-reservation expiry and payment-provider preparation.
  - Scope:
    - Expire or reconcile stale reservations that survive process crashes.
    - Add reconciliation for failed runtime tasks outside the normal request
      lifecycle.
    - Add admin-visible credit audit details.
    - Prepare payment provider integration.
  - Acceptance:
    - Interrupted tasks do not leave credits permanently frozen.
    - Ledger entries show task type, phase, project, reservation, settlement,
      refund, and actual usage.
    - Operators can reconcile credit state without direct database surgery.

- [ ] Generated project lifecycle controls
  - Problem: project/session deletion can remove local workspace artifacts, but
    the product still needs a full retention, quota, backup, and cloud artifact
    cleanup policy.
  - Scope:
    - Per-user project quotas.
    - Project deletion cleanup for workspace files, previews, deployments,
      uploaded assets, and Supabase Storage objects.
    - Backup and restore guidance for `/srv/beegame/projects`.
    - Retention policy for generated projects, deployment artifacts, previews,
      and transcripts.
  - Acceptance:
    - Deleting a project removes the expected physical and cloud artifacts.
    - Storage growth is bounded by documented quota and retention rules.

## P2

- [ ] Admin Console boundary audit
  - Problem: platform-level settings mostly sit behind permission-gated UI and
    route checks, but the full admin surface still needs a final product audit,
    especially audit and credit policy views.
  - Scope:
    - Verify model configuration, Web Search, MCP, Runtime, Audit, and Credit
      policy are only visible to users with the correct permissions.
    - Verify route-level permission checks match UI visibility.
    - Confirm owner/admin users can operate platform settings from a coherent
      admin UI.
  - Acceptance:
    - Ordinary users cannot see or call platform admin operations.
    - Owner/admin users can operate platform settings from a coherent admin UI.

- [ ] Local connector strategy
  - Problem: future Unity, Godot, Unreal, and local editor MCP workflows need a
    local execution node, but BeeGame is currently SaaS + runtime host.
  - Scope:
    - Define the connector protocol.
    - Decide how local editor MCP servers register with the SaaS dashboard.
    - Define authentication, workspace approval, and revocation.
  - Acceptance:
    - A future local connector can be implemented without changing the SaaS
      product model.

## Explicit Non-Goals For Now

- Do not build a full desktop client before the SaaS deployment and generated
  game publishing path is stable.
- Do not make BeeGame judge gameplay quality through hardcoded keywords or
  platform-specific rules.
- Do not put Supabase service-role credentials into the frontend or local
  runtime host.
- Do not use the cloud artifacts package as the primary generated-game hosting
  mechanism unless it is redesigned for public static deployment.
