# HttpOnly Session File Store Design

## Goal

Replace the process-local HttpOnly session `Map` with an encrypted, persistent file-backed store so sessions survive route registration and process restart without changing the feature flag, cookie attributes, or Origin-based CSRF behavior.

## Architecture

`registerBeeGameSessionRoutes` will resolve a session store path from the new `sessionStorePath` option, then `AGENT_WORKFLOW_DATA_DIR`, then the canonical dashboard data root (`~/.beegame/dashboard`). The store file will contain a JSON object mapping opaque session ids to encrypted session envelopes. The session payload remains encrypted with `encryptSecret`/`decryptSecret` using the existing `auth:session` AAD.

Reads load the current file on demand so a newly registered route sees records written by an earlier registration. Mutations load the current map, apply the change, write JSON to a sibling temporary file, and atomically rename it over the target. Missing, malformed, undecryptable, invalid, and expired records are ignored; invalid or expired records are removed when a mutation persists the store.

This is a persistent local store, not a distributed-consistency mechanism. Multi-process or multi-instance deployments must provide a shared persistent backend with appropriate coordination; the file store alone is not sufficient for that topology.

## Compatibility and security

The `BEEGAME_HTTPONLY_SESSIONS=1` feature flag remains the gate. Cookie name and `Secure; HttpOnly; SameSite=Lax; Path=/` attributes remain unchanged. State-changing refresh/logout routes retain same-origin Origin validation. Refresh-token material remains inside the encrypted store and is never returned in the session response.

## Testing and operations

Focused tests will verify persistence across separate route registrations, refresh persistence, logout and DELETE persistence, and expired-record rejection. `.env.example` and `docs/security/service-hardening-runbook.md` will describe the encryption key, session rollout, outbound/upload limits, and the requirement for a shared persistent backend when multiple processes must observe the same sessions.
