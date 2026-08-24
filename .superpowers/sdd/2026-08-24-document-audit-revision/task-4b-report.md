# Task 4B report

Implemented the bounded, recoverable foundation fact extraction runtime.

## Delivered

- Cut the persisted run schema to `DELIVERY_RUN_SCHEMA_VERSION = 31` and introduced `FoundationAuditState` v2 with a strict `index_staged → extracting_facts → facts_staged → derived_committed` state machine.
- Added one discriminated `foundationAuditState.tasks[]` collection with stable task identity, packet/revision binding, fast model tier, own dispatch, attempts, terminal digest, usage, duration and failure state.
- Reused the existing dispatcher, run lock, usage path and recovery projector. Audit tasks claim under lock, run at most four concurrently, retry once, accept exact terminal replay idempotently, and reject conflicts.
- Added packet/output/aggregate/deadline caps and the `foundation-fact-extractor` worker contract/prompt/native terminal surface. Fact workers have explicit empty project read scope and no write scope.
- Validated model results against the existing Task 4A packet/evidence contract and staged admitted normalized facts only.
- Added same-parent temporary-directory publication for Section Index, Fact Store, derived manifest and `COMMITTED.json`; recovery accepts only a digest-valid final `derived/` directory.
- Added zero-task mechanical fast path to derived commit with no worker dispatch.

## Verification

- `bun run --cwd packages/agent-workflow-server typecheck` — passed.
- `bun test packages/agent-workflow-server/src/beegame/delivery-workflow` — 88 passed.
- `bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts` — 89 passed.
- `bun test packages/agent-workflow-server/src/__tests__/delivery-worker-session-port.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts` — 18 passed.
- `git diff --check` — passed.
- Protected authoring diff scan — no changes to `document-stage.ts`, `foundation-authoring-batch.ts`, `game-document-contracts.ts`, or Document Author behavior.
