# Web Preview Access Design

**Status:** approved for implementation planning

## Scope

This change makes the existing managed preview safe for multi-user Web projects.
It preserves the current Web/Vite lifecycle: launch a loopback server, wait for
readiness, proxy it through the runtime, render it in the dashboard, and stop
it with the project preview controls.

Godot, Unity, and Unreal are deliberately out of scope for this iteration.
They will be added later through engine-specific MCP adapters, not through
filesystem heuristics or commands in the shared preview manager.

## Goals

1. A preview can be read only by a user with `project.read` access to its
   owning project.
2. A preview session URL cannot be used as a bearer capability by itself.
3. Preview credentials are short-lived, bound to one browser user/session and
   never persisted in build reports, preview snapshots, Supabase, or audit
   metadata.
4. Existing Web preview start, stop, restart, readiness checking, console
   bridge, and iframe behavior continue to work.
5. The durable preview model explicitly identifies Web as its sole first-phase
   capability without implying that native engines are supported.

## Non-goals

- Starting an editor, running a native executable, collecting screenshots, or
  streaming Godot, Unity, or Unreal projects.
- Making an arbitrary runtime host public for unauthenticated iframe traffic.
- Sharing previews by copying a dashboard URL.
- Replacing the existing preview process manager or deployment system.

## Architecture

```text
Dashboard (authenticated API request)
  -> GET /api/projects/:projectId/preview/access
  -> checks project.read + project owner/session binding
  -> creates an opaque, short-lived PreviewAccessGrant
  -> returns a one-time bootstrap URL

iframe / external browser opens bootstrap URL
  -> runtime consumes grant and sets a scoped HttpOnly preview-access cookie
  -> redirects to canonical /previews/:sessionId/
  -> proxy validates cookie before every preview resource or upgrade request
  -> loopback Web preview server
```

`BeeGamePreviewManager` remains responsible only for the lifecycle of a Web
HTTP process. It produces a canonical URL (`/previews/:sessionId/`) that is
safe to store, but that URL is not directly readable without an access grant.

`PreviewAccessManager` is a focused in-memory service. It creates cryptographic
random opaque grants containing no user data, stores their server-side binding
to `userId`, `projectId`, `sessionId`, and preview generation, and expires them
after a short fixed TTL. A grant can bootstrap one browser access session once.
The resulting session cookie is also opaque, path-scoped to the preview, and
expires at the same deadline. Stop, restart, project deletion, or runtime
generation change invalidates the matching grants and browser sessions.

The runtime and dashboard must be deployed same-site (for example sibling
subdomains of the same registrable domain) so the scoped cookie can accompany
the iframe resource requests. Production uses `Secure; HttpOnly; SameSite=Strict`;
local HTTP development omits only `Secure`. If a deployment cannot meet this
same-site requirement, its reverse proxy must present dashboard and runtime
under one site before enabling managed previews.

## API and model changes

### Durable preview data

`BeeGamePreviewSnapshot` gains explicit Web capability fields:

```ts
type BeeGamePreviewKind = 'web'

type BeeGamePreviewSnapshot = {
  // existing fields
  kind: BeeGamePreviewKind
  engine: 'web'
}
```

No credential, bootstrap URL, cookie identifier, or grant expiry is added to
this snapshot. Build reports continue to use its canonical `build_url`.

### Authenticated access API

Add the project-scoped endpoint:

```text
GET /api/projects/:id/preview/access
```

It requires `project.read`, resolves the caller-owned project and its bound
session, and only creates a grant when that exact session has a running Web
preview. It returns:

```ts
type BeeGamePreviewAccessPayload = {
  status: 'ready' | 'unavailable'
  accessUrl?: string
  expiresAt?: string
  message?: string
}
```

Add the matching session-scoped route behind the existing session ownership
check. Both routes call the same grant-creation helper so project and session
semantics cannot drift.

The `accessUrl` points to a non-API bootstrap route. It accepts only the opaque
grant, verifies its binding and current preview generation, sets the scoped
cookie, removes the grant, and redirects to the canonical preview root. The
canonical `/previews/:sessionId/*` proxy validates the browser access session
before looking up the internal loopback URL.

## Request behavior and failures

- A missing, malformed, expired, consumed, wrong-project, wrong-session, or
  stale-generation grant returns `404` to avoid revealing preview existence.
- A canonical preview request without a valid scoped access session returns
  `404`; it must not proxy a request or reveal the internal URL.
- The access API returns an authenticated structured `unavailable` payload for
  idle, stopped, failed, unsupported, or absent previews. It does not expose a
  port or raw process output.
- Preview start/restart invalidates all prior grants/sessions for that session
  before exposing the new generation. Stop invalidates them before killing the
  process.
- The proxy preserves only the Web methods and headers necessary for the
  preview, including `GET`, `HEAD`, `OPTIONS`, and WebSocket upgrade handling
  when supported by the host. It does not set `Access-Control-Allow-Origin: *`.
- HTML console-bridge injection happens only after authorization and retains
  the existing sandboxed iframe behavior.

## Frontend behavior

`BeeGamePreviewPayload.url` remains the canonical metadata URL. The frontend
does not put it directly in an iframe. When the preview becomes live, and after
each start or restart, it calls the access endpoint and stores `accessUrl` only
in component state. The iframe and Open action use that ephemeral bootstrap
URL. Refreshing the preview obtains a new grant. Stopping clears the ephemeral
URL immediately.

If the access call says unavailable, the existing preview surface remains in
its stopped/failed/empty state. If the bootstrap session expires while an iframe
is open, the surface reports access expiration and provides refresh rather than
mislabeling it as a build failure.

## Verification

Server tests must prove:

1. A direct `/previews/:sessionId/` request is denied even when the preview is
   running.
2. A user without project ownership or `project.read` cannot obtain a grant.
3. A valid grant boots an iframe session and permits the root, static assets,
   and injected console bridge.
4. Grants are single-use, expire, and cannot cross project/session/user or
   preview-generation boundaries.
5. Stop and restart revoke existing browser sessions.
6. The canonical snapshot/build report contains no access credential.
7. Existing Web process readiness and proxy base-path behavior remain green.

Frontend tests must prove that the frame and external-open action use the
ephemeral access URL, that start/restart refresh it, and that unavailable or
expired access presents a recovery state without changing build failure
classification.

## Future MCP engine adapters

The next engine phase adds a separate adapter contract, driven by MCP tool
capabilities rather than path names or platform-specific shared logic:

```ts
type EnginePreviewAdapter = {
  engine: 'godot' | 'unity' | 'unreal'
  inspect(): Promise<PreviewCapabilities>
  buildAndValidate(): Promise<PreviewArtifact>
  start(): Promise<PreviewArtifact>
  stop(): Promise<void>
}
```

Artifacts will declare their presentation capability (`web-url`,
`local-process`, `evidence`, or `remote-stream`). Only `web-url` shares the
access design above. Native MCP interaction stays isolated in its own adapters.
