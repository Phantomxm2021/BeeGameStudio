# Revision configuration failure diagnostics

## Scope

Adds failure evidence for the pre-dispatch configuration failure observed in
`workflow-845c737b8dad`. Does not repair or replay that historical failure, change
authorization decisions, add retries, or invoke a real model.

## Evidence now available

- `[BeeGame session refresh]`: refresh rejection (400/401/403), upstream service
  failure, missing access token in the refresh response, or request failure.
- `[BeeGame runtime dependency]`: distinguishes runtime-env RPC from selected
  model configuration lookup; records HTTP status/network code when available.
- `[BeeGame runtime configuration]`: authentication, forced refresh, initial or
  retried environment lookup, and environment validation are distinct steps.
  Each resolution has a UUID `traceId`; a refresh warning and the terminal
  failure share it. HTTP status, allowlisted network code, timestamp and elapsed
  milliseconds are recorded. Untyped HTTP errors do not gain refresh authority.
- `[BeeGame foundation revision]`: binds the configuration diagnostic to the
  revision handle. The same safe diagnostic is saved as an optional field on
  the existing `lifecycle_failed` execution event under
  `.beegame/workflow/foundation-revision/native-file-v1/requests/<request-key>/execution-events/`.
  Historical events without this field remain readable. This is evidence only;
  the public error message and recovery policy are unchanged.

Session and dependency logs are server stderr records (correlate by time);
the configuration/revision pair additionally shares a trace ID and durable
event. The UI's existing `workflow-...` hash is not this new trace ID.

No raw exception messages/stacks, response bodies, URLs, cookies, access/refresh
tokens, or model credentials are copied into the new logs or diagnostic event.

## Verification and activation

- Targeted auth, session, configuration, repository, safe-error-facts and revision
  recovery suites: 51 tests passed, 246 assertions.
- Server TypeScript check and `git diff --check` passed.
- Three additional dependency-boundary tests fail because their allowlists omit
  the existing `native-response-trace.ts` / `native-diagnostics.ts` imports from
  `native-file-agent.ts`. Those imports and allowlists were not changed here.
- The running service was not restarted and the blocked project was not resumed.
  Restart the runtime service before collecting new diagnostics. Historical
  exceptions discarded by the old implementation cannot be reconstructed.
