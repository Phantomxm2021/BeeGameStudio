# Generic Web Preview Refresh Contract

## Problem

Managed Web previews can transform React TSX modules with `$RefreshSig$` while
serving an HTML document that did not initialize React Refresh. The resulting
failure is project-independent and appears in whichever transformed module is
evaluated first.

## Goals

- Make preview process environment independent from the dashboard runtime.
- Preserve the preview base path for HTML, modules, styles, and Vite runtime
  endpoints.
- Ensure HTML is transformed by the project Vite server before it is proxied.
- Avoid exposing a half-working HMR WebSocket through the runtime HTTP proxy.
- Test the protocol with generic React/Vite fixtures rather than a named game.

## Design

The preview manager treats a Vite development client as a managed adapter. It
starts it with an isolated development environment and an explicit HMR policy.
The adapter must either use a Vite host that sets `server.hmr = false`, or a
future transport that implements an authenticated WebSocket upgrade. The first
phase uses the former because the managed preview does not require hot module
updates to render or interact with a game.

The preview proxy forwards the full public session path when the upstream Vite
server is configured with that base. It does not infer behavior from project
names or source text. HTML transformation remains the responsibility of Vite;
the proxy only forwards the transformed response and attaches the generic
console bridge.

The iframe contract is independent of the framework. If preview access uses a
scoped cookie on a separate runtime origin, the iframe must retain a same-origin
context for that preview origin. The parent dashboard never receives the
preview session token.

## Invariants

1. A transformed module that contains `$RefreshSig$` must be preceded in the
   same document realm by a React Refresh preamble.
2. If HMR is disabled, Vite must not emit a Refresh transform that depends on
   `$RefreshSig$`.
3. Every public module URL must map to the same upstream base path used by the
   preview process.
4. A preview session must not depend on the dashboard process's `NODE_ENV`.
5. A generic fixture must pass without matching its project name, file names, or
   user text.

## Verification

The test suite will cover environment isolation, base-preserving proxy
forwarding, HTML/module consistency, and the absence of HMR upgrade attempts
when managed HMR is disabled. A browser smoke check will verify that a generic
React fixture renders inside the managed iframe without `ReferenceError`, 404,
or WebSocket upgrade errors.
