# Task 4B implementation report

## Scope

Implemented the bounded Foundation fact-extractor runtime from `index_staged` through `derived_committed`. The implementation keeps one `foundationAuditState.tasks[]` collection, uses the existing dispatcher/run-store/terminal/usage/recovery lanes, and leaves ordinary `activeDispatch` independent.

## Delivered

- Schema v2/fingerprint cutover with strict revision-bound task identity and no compatibility reader.
- Eight-task maximum, four-way dispatch waves, attempt/retry/needs-action rules, terminal replay idempotence, conflict rejection, measured output/aggregate/deadline caps, and per-task usage/duration.
- Controller admission under the mutation lock: dispatcher persists only the terminal envelope; validated results receive immutable per-task receipts; all receipts are reloaded through the strict loader.
- Durable `extracting_facts → facts_staged` commit boundary before unlocked aggregation/publication, followed by exact state/artifact binding for `derived_committed`.
- Same-parent temporary derived directory with complete Section Index, closed Fact Store, manifest, and `COMMITTED.json`; invalid/partial final artifacts fail closed.
- Production recovery scans all fact tasks, preserves terminal envelopes for replay, retries orphaned tasks, and preserves unrelated ordinary active dispatches.
- Fast-tier provider routing, empty project-read scope, and the single read-only `SubmitFoundationFactResult` terminal contract.

## Verification

- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow --timeout 30000` — 93 passed, 0 failed.
- Related session/dispatch/recovery tests — 137 passed, 0 failed.
- Focused runtime, integration, artifact, native terminal tests — 14 passed, 0 failed.
- `bunx tsc --noEmit -p packages/agent-workflow-server/tsconfig.json` — passed.
- `git diff --check` — passed.
- Protected authoring/revision/UI/docs diff scan — no matches.

