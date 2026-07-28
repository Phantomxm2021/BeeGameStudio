# BeeGame Product TODO

Last audited: 2026-07-08

This document tracks product and deployment gaps that are not covered by the
current BeeGame implementation. It is intentionally focused on system-level
work, not individual generated game fixes.

## Current State

- BeeGame dashboard, Supabase Auth/RLS data access, realtime usage billing,
  runtime host, and Docker deployment scaffolding are implemented.
- The Docker stack deploys the BeeGame application and local runtime host, and
  has been smoke-tested on a server deployment.
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

- [x] Production Docker smoke test
  - Evidence:
    - Server Docker deployment has been completed and tested.
    - Full game creation and preview flows have been tested through the deployed
      stack.
  - Verified:
    - User-reported server smoke test on 2026-07-08.

- [x] Reverse proxy and TLS deployment example
  - Evidence:
    - Server deployment has been run behind the production proxy/TLS setup.
    - Deployed game creation and preview access have been tested through the
      production access path.
  - Verified:
    - User-reported server deployment test on 2026-07-08.

## P1

- [x] Realtime usage wallet billing
  - The realtime usage wallet is the only credit source of truth.
  - Token usage is recorded idempotently and debited in realtime.
  - Stripe credit packs grant directly to the realtime wallet.

- [x] Generated project lifecycle controls
  - Problem: project/session deletion can remove local workspace artifacts, new
    project creation is bounded by a per-user quota, Supabase-backed artifacts
    are cleaned up on project deletion, and operators can now see quota and
    cleanup status from the platform settings UI. Future automated retention
    jobs are a lower-priority operations enhancement.
  - Completed:
    - `BEEGAME_MAX_PROJECTS_PER_USER` enforces a configurable per-user project
      quota on new project creation while allowing updates to existing projects.
      The default limit is 100 projects per user; non-positive configured
      values disable the quota.
    - Deleting a project now removes the generated local workspace directory
      when the saved project root is safely inside the dashboard data root.
      External/manual workspace paths are left untouched by the safe-delete
      guard.
    - `docs/beegame-project-lifecycle.md` documents production storage model,
      quota configuration, backup/restore order, deletion verification, and
      retention defaults for generated projects.
    - Supabase-backed project deletion now removes uploaded asset object
      prefixes, published deployment artifact prefixes, and related
      assets/previews/deployments metadata before deleting sessions and project
      metadata.
    - `/api/admin/projects/lifecycle` exposes quota usage, project root paths,
      runtime snapshot status, storage mode, and recent deletion cleanup
      outcomes behind `lifecycle.admin`.
    - Settings > Platform > Project exposes the lifecycle overview to
      lifecycle administrators.
  - Acceptance:
    - Deleting a project removes the expected physical and cloud artifacts.
    - Storage growth is bounded by documented quota and retention rules.

## P2

- [x] Admin Console boundary audit
  - Problem: platform-level settings now have a documented UI and route/data
    authority map. The Platform settings entry remains owner-only, and each
    delegated sensitive surface is also bound to its matching permission.
  - Completed:
    - `docs/beegame-admin-boundary-audit.md` maps model configuration, Web
      Search secrets, MCP, Runtime, Audit, Credit, project lifecycle, invitation
      management, filesystem, and Stripe webhook boundaries.
    - Existing frontend coverage verifies that a non-owner account with
      management permissions still cannot see Platform settings.
    - Route-level checks were audited against the UI capability props for
      `model_config.manage`, `secrets.manage`, `runtime_settings.manage`,
      `mcp.manage`, `workspace.manage`, `credits.admin`, `lifecycle.admin`, and
      `audit.read`.
    - Invitation management was confirmed as platform owner-only through
      Supabase RPCs guarded by `beegame_is_platform_owner()`.
  - Acceptance:
    - Ordinary users cannot see or call platform admin operations.
    - Owner/admin users can operate platform settings from a coherent admin UI.

- [x] Automated retention jobs
  - Problem: documented retention windows now have an operator-triggered
    retention path. The first production-safe version is manual dry-run/run,
    not a background scheduler, so operators can verify deletions before
    enabling automation.
  - Completed:
    - `/api/admin/projects/retention/plan` returns a dry-run retention plan
      behind `lifecycle.admin`.
    - `/api/admin/projects/retention/run` applies local deployment retention
      behind `lifecycle.admin` and writes a `project.retention_run` audit event.
    - Local deployment retention keeps the latest successful deployment plus the
      last 5 rollback candidates per project/session group, and deletes older
      local deployment artifacts only under BeeGame's deployment data root.
    - Settings > Platform > Project exposes retention dry-run/run controls and
      recent retention results.
    - Preview/log cleanup is explicitly reported as skipped until those
      resources have a persisted cleanup index.
  - Acceptance:
    - Retention jobs do not rely on game titles, prompt text, or platform
      keywords.
    - Operators can verify what each retention run deleted or retained.

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
