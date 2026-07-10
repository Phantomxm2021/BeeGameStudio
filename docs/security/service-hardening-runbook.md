# Service Hardening Runbook

This runbook covers the server-side security controls used by the dashboard and
the staged HttpOnly session migration.

## Required configuration

Set `BEEGAME_HTTPONLY_SESSIONS` on the backend and
`VITE_BEEGAME_HTTPONLY_SESSIONS` on the frontend to the same value. These flags
must be deployed atomically; a mixed deployment can send clients to a session
mode the server does not support.

Set `BEEGAME_CONFIG_ENCRYPTION_KEY` to a base64-encoded 32-byte key in every
environment that persists secrets. Store it in the deployment secret manager;
do not commit it, print it, or reuse a development key in production. The
server fails closed for encrypted secret operations when production has no key.

Set `AGENT_WORKFLOW_DATA_DIR` to the dashboard data root. HttpOnly sessions are
stored in `auth-sessions.json` below that directory. The route option
`sessionStorePath` can provide an explicit file path for an application that
needs a different location. The directory and file must be owned by the
service account and have permissions that prevent other users from reading
refresh-token ciphertext.

The file store encrypts each session record with the existing AES-256-GCM
secret-crypto implementation and `auth:session` AAD. Writes use a sibling
temporary file and atomic rename. Missing, malformed, undecryptable, and
expired records are ignored; expired records are removed when the store is
persisted.

This local file store does not provide distributed consistency. If more than
one process or instance must observe the same sessions, deploy a shared
persistent session backend with its own concurrency/coordination guarantees;
do not treat separate local files as a shared session store.

## HttpOnly session rollout

1. Generate and install the environment-specific encryption key. Verify the
   dashboard data directory exists, is persistent across restarts, and is not
   exposed as a static download path.
2. Deploy `BEEGAME_HTTPONLY_SESSIONS=0` and
   `VITE_BEEGAME_HTTPONLY_SESSIONS=0` together. Verify normal login, logout,
   refresh, outbound policy, and upload policy behavior.
3. In staging, deploy both flags as `1` together; verify the cookie is
   `Secure`, `HttpOnly`, `SameSite=Lax`, and `Path=/`, verify legacy migration
   only removes browser storage after an authenticated follow-up
   `GET /api/auth/session`, and verify refresh works after route registration
   or process restart.
4. Enable both flags for internal users first. Monitor authentication failures,
   refresh failures, cookie delivery, and store write errors without logging
   tokens or cookie values.
5. Expand gradually after the staging and internal checks pass. Keep the
   legacy path available for the migration window so rollback is one atomic
   change to both flags.
6. After the release window, remove the legacy path only after confirming no
   supported client still depends on browser-persisted refresh tokens.

For rollback, atomically set both `BEEGAME_HTTPONLY_SESSIONS=0` and
`VITE_BEEGAME_HTTPONLY_SESSIONS=0`, then redeploy/restart the backend and
frontend together. Preserve the encrypted store for investigation, and do not
rotate or delete the encryption key until any required recovery is complete. A
key rotation requires an explicit decrypt-and-re-encrypt migration.

## CSRF and cookie checks

Refresh and logout remain state-changing cookie-authenticated routes. They
accept no cross-origin `Origin`; an origin that is present must match the
request origin. Keep this behavior when adding routes. Never replace the
HttpOnly cookie with a client-readable refresh-token cookie.

## Outbound and upload limits

Outbound requests are restricted by the security-core target policy. Set
`BEEGAME_OUTBOUND_ALLOWED_HOSTS` to the smallest required host list and leave
`BEEGAME_ALLOW_INSECURE_OUTBOUND_HTTP=0` in production. HTTPS is the default;
non-default ports require an explicit `host:port` allowlist entry. Private,
loopback, link-local, credential-bearing, and otherwise disallowed targets must
be rejected before connection.

The server upload policy currently enforces a maximum of 8 attachments per
request, 10 MiB per attachment, 32 MiB total attachment bytes, and a 48 MiB
request body. It validates filenames, extensions, MIME types, magic bytes,
UTF-8 text/JSON, and ZIP signatures before parsing or workspace writes. Treat
these source constants as release-gated limits; changes require focused tests
and an operational review.

## Release verification

Run the package typecheck and focused session tests with the project’s required
Conda environment:

```sh
conda run -n xrmoddemiurge bun run --cwd packages/agent-workflow-server typecheck
conda run -n xrmoddemiurge bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
git diff --check
```

Confirm that logs and diagnostics contain no encryption keys, access tokens,
refresh tokens, cookie values, upload contents, or query strings.
