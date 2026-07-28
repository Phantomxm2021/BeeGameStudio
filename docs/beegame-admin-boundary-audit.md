# BeeGame Admin Console Boundary Audit

Last audited: 2026-07-08

This audit maps the platform settings UI to the backend or Supabase authority
that protects each operation. The current product boundary is intentionally
stricter than a pure permission list: the Platform settings tab is only exposed
to platform owner accounts, and each sensitive sub-surface also carries its own
permission where the product supports delegated administration.

## Entry Boundary

- `LandingView` exposes Settings > Platform only when `currentUser.role` is
  `owner`.
- Platform sub-surfaces then receive explicit capability props:
  - workspace and filesystem settings: `workspace.manage`
  - web/search secrets: `secrets.manage`
  - runtime settings: `runtime_settings.manage`
  - MCP servers: `mcp.manage`
  - model configuration: `model_config.manage`
  - audit and billing event visibility: `audit.read`
  - credit pack and grant administration: `credits.admin`
  - project lifecycle and retention administration: `lifecycle.admin`
  - invitation management: platform owner only
- Frontend coverage includes a non-owner account with management permissions and
  asserts that the Platform settings tab is not shown.

## Route And Data Boundaries

| Surface | UI capability | Server or data authority |
| --- | --- | --- |
| Audit events | `audit.read` | `GET /api/audit-events` requires `audit.read`. |
| Usage wallet and credit packs | `credits.admin` | Realtime wallet usage and credit pack administration require `credits.admin`. |
| Project lifecycle and retention | `lifecycle.admin` | Lifecycle overview and retention operations require `lifecycle.admin`. |
| Model configuration writes | `model_config.manage` | `POST/PATCH/DELETE /api/model-configs` require `model_config.manage`. |
| Model configuration reads | platform owner UI | `GET /api/model-configs` is readable by authenticated runtime context so normal project flows can resolve active model settings. Mutations remain permission-gated. |
| Web tool secrets | `secrets.manage` | `GET/PUT /api/web-tools` require `secrets.manage`. |
| Runtime settings | `runtime_settings.manage` | `GET/PUT /api/runtime-settings` require `runtime_settings.manage`. |
| MCP servers | `mcp.manage` | `GET/POST/PUT/DELETE /api/mcp-servers`, discovery, active discovery, and connection tests require `mcp.manage`. |
| Workspace directory browser | `workspace.manage` | `GET /api/filesystem/directories` requires `workspace.manage`. |
| Default workspace path | platform owner UI | `GET /api/filesystem/default-workspace` requires `workspace.read`; it returns a path used by normal project flows and does not mutate settings. |
| Invitation settings and codes | platform owner only | Frontend calls Supabase RPCs directly. Admin RPCs use authenticated calls and are guarded by `beegame_is_platform_owner()`. |
| Stripe Checkout webhook | trusted billing backend only | `POST /api/payments/stripe/webhook` is enabled only in `BEEGAME_BILLING_MODE=server`; it is intentionally unauthenticated but requires Stripe signature verification and a configured webhook secret. User-run local clients should use `BEEGAME_BILLING_MODE=remote` and must not receive Stripe webhooks. |

## Findings

- No ordinary user admin escape was found in the audited Platform settings
  surface. The UI entry point requires owner role, and mutating backend routes
  require the matching BeeGame permission.
- Invitation management is not a delegated permission today. It is platform
  owner-only by design and backed by Supabase owner checks rather than an app
  server route.
- Credit and project lifecycle controls use distinct administration
  capabilities. `audit.read` alone does not expose mutation-capable panels.

## Residual Risk

- If BeeGame later supports non-owner platform administrators, the current
  `currentUser.role === 'owner'` Platform entry gate should be replaced with an
  explicit platform-admin capability model.
- Stripe price-to-credit policy is environment-driven on the trusted billing
  backend. Operators should keep `BEEGAME_STRIPE_PRICE_CREDITS` in
  source-controlled deployment notes without committing Stripe secrets.
