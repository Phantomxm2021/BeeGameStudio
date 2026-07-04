# BeeGame Product TODO

Last updated: 2026-07-02

This document tracks product and deployment gaps that are not covered by the
current `web-dashboard-replacement` implementation. It is intentionally focused
on system-level work, not individual generated game fixes.

## Current State

- BeeGame dashboard, Supabase Auth/RLS data access, credit quote/reserve/settle
  flow, runtime host, and Docker deployment scaffolding are implemented.
- The Docker stack deploys the BeeGame application and local runtime host.
- Generated game projects are stored in the runtime workspace volume.
- Static Web deployments can be published by the runtime host under
  `/deployments/*` for local/dev use, or to Supabase Storage when
  `BEEGAME_DEPLOYMENT_STORAGE_BUCKET` is configured.

## P0

- [ ] Production Web game deployment lifecycle
  - Problem: generated Web games can now be published by the runtime host, but
    deployment metadata and lifecycle controls are still minimal.
  - Scope:
    - Verify Supabase Storage deployment in a production-like environment.
    - Persist deployment records in Supabase, including project id, version,
      artifact hash, URL, logs, status, and created user.
    - Add deployment logs/history UI.
    - Add redeploy and rollback actions.
  - Acceptance:
    - A generated static Web game can be deployed from the dashboard and opened
      from a public persistent URL backed by durable storage.
    - Deployment history survives runtime host replacement.
    - Failed deployments show actionable logs and do not mark the project as
      delivered.

- [ ] Production Docker smoke test
  - Problem: Docker files exist, but the stack has not been verified locally
    because Docker is unavailable in this environment.
  - Scope:
    - Run `docker compose config`.
    - Run `docker compose up -d --build`.
    - Verify frontend, runtime host, Supabase Auth, credit quote, project
      generation, preview, and volume persistence.
  - Acceptance:
    - A clean server can start BeeGame from the Docker instructions.
    - Restarting containers does not lose user/session/project state.

- [ ] Reverse proxy and TLS deployment example
  - Problem: current Docker setup exposes ports directly.
  - Scope:
    - Add production examples for Caddy, Nginx, or Traefik.
    - Document WebSocket/proxy headers for runtime host and preview routes.
    - Document recommended domains, HTTPS, and port boundaries.
  - Acceptance:
    - A deployer can run BeeGame behind HTTPS without guessing proxy settings.

## P1

- [ ] MCP administration verification and cleanup
  - Problem: frontend copy still says safe MCP backend routes are incomplete,
    while backend route tests exist. The product state needs verification.
  - Scope:
    - Test add/edit/delete MCP server flows.
    - Test discovery/import flows.
    - Test permission boundaries for ordinary users vs platform owners.
    - Remove stale UI copy if backend support is complete.
  - Acceptance:
    - MCP management works only where the current user's permissions allow it.
    - Runtime sessions receive the expected MCP configuration.
    - UI no longer displays stale "not yet implemented" wording.

- [ ] Account deletion production flow
  - Problem: account deletion requires Supabase RPC and is not available in
    dev/offline mode.
  - Scope:
    - Confirm production SQL/RPC exists.
    - Delete or anonymize user profile, credits, settings, project metadata, and
      storage objects according to the product policy.
    - Keep audit records required for billing/security.
  - Acceptance:
    - A signed-in user can request account deletion.
    - Deletion cannot remove another user's data.
    - The UI clearly reports completed, pending, or failed deletion state.

- [ ] Credit billing hardening
  - Problem: quote/reserve/settle exists, but production billing needs
    reconciliation.
  - Scope:
    - Expire stuck reservations.
    - Add reconciliation for failed runtime tasks.
    - Add admin-visible credit audit details.
    - Prepare payment provider integration.
  - Acceptance:
    - Interrupted tasks do not leave credits permanently frozen.
    - Ledger entries show task type, phase, project, reservation, settlement,
      refund, and actual usage.

- [ ] Generated project lifecycle controls
  - Problem: generated projects live in the runtime workspace volume without a
    complete retention/quota/backup policy.
  - Scope:
    - Per-user project quotas.
    - Project deletion cleanup for workspace files, previews, deployments, and
      uploaded assets.
    - Backup and restore guidance for `/srv/beegame/projects`.
  - Acceptance:
    - Deleting a project removes the expected physical and cloud artifacts.
    - Storage growth is bounded by documented quota and retention rules.

## P2

- [ ] Admin Console boundary audit
  - Problem: platform-level settings must stay out of ordinary user settings.
  - Scope:
    - Verify model configuration, Web Search, MCP, Runtime, Audit, and Credit
      policy are only visible to users with the correct permissions.
    - Verify route-level permission checks match UI visibility.
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

- [ ] Production launch checklist
  - Problem: deployment steps are spread across docs and environment files.
  - Scope:
    - Supabase SQL/RLS/RPC.
    - OAuth providers and redirect URLs.
    - Storage buckets.
    - Platform owner bootstrap.
    - Default model configuration.
    - Runtime host environment.
    - Docker and reverse proxy setup.
    - Credit policy.
  - Acceptance:
    - A new deployer can launch a clean BeeGame instance by following one
      checklist.

## Explicit Non-Goals For Now

- Do not build a full desktop client before the SaaS deployment and generated
  game publishing path is stable.
- Do not make BeeGame judge gameplay quality through hardcoded keywords or
  platform-specific rules.
- Do not put Supabase service-role credentials into the frontend or local
  runtime host.
- Do not use the cloud artifacts package as the primary generated-game hosting
  mechanism unless it is redesigned for public static deployment.
