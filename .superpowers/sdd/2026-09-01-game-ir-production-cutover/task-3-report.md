# Task 3 report — committed Game IR reader and compilation route

Status: fix round 2 implemented; verification complete.

## Changes

- Added `game-ir/committed-reader.ts`, the sole workspace/run-bound committed Game IR reader. It obtains Foundation READY through the adapter, recovers the durable checkpoint through the Task 2 loader, validates the committed publication tree, exact six-module coverage, canonical candidate, source maps, dependency graph, semantic evidence, marker, and all receipt/checkpoint/authority digests, then returns typed execution/resource/acceptance projections.
- Added strict reader/route coverage for alternate-authority rejection, forged compiler terminals, the canonical six-module/fallback matrix, admission→checkpoint→publication→reader order, retry progress identity, and latest-durable-state recovery.
- Added the service-bound compiler dispatch contract and domain-specific compiler terminal schema/prompt.
- Service now authenticates the READY Section Index and every canonical Foundation document as regular files, verifies their recorded digests, and builds immutable per-domain source packets. Both compiler dispatches retain `allowedPaths: []` and `projectReadScope: 'empty'`, while the contract carries the service-owned packets.
- Compiler DTOs are strict semantic/validation model unions; mechanical receipts are deterministic empty service authority. Dispatch admission binds run, dispatch, task, revision, compile request, and READY receipt before persistence.
- Routed Foundation READY into one deterministic `GAME_IR_COMPILATION` identity. Worker terminals now carry domain-result DTOs only; the service admits them through the Phase 4–7 domain assemblers, calls the Task 2 checkpoint writer for each stage, commits publication, reloads/revalidates through the sole reader, and only then crosses to `DOCUMENT_REVIEW/CHECKLIST_DRAFTING`. Failed or invalid publication stays diagnostic-only and retains the identity. Retry resumes the same identity without attempt/time/token/cardinality caps and no compiler terminal replay loop.
- Public execution/resource/acceptance projections include schema-parsed discriminated `{ kind, value }` payloads alongside typed identity, producer mode, relationship, and source-binding fields.
- Resume uses Task 2 loader/recover to adopt only a valid committed prefix, skips already committed phases, retries publication from a committed Phase 7 checkpoint, and never restarts Phase 4. Durable progress identity excludes dispatch/transport randomness and differentiates changed business state from unchanged/no-transition attention.
- Every compiler attention state persists phase, step, taskId, workerType, reasonCode, expected, actual, diagnosticRef, and recoveryAction; the UI/API projection exposes only the safe reason and diagnostic ID. Persisted workflow schema is v48.
- Added transition identity checks and safe Game IR compilation/publication display reason codes. Foundation reviewer/revision/issue-registry modules were not modified.

## TDD

- RED: the review regression test initially failed because the compiler GAME_IR branch still replayed a terminal result; the checkpoint-role boundary test also failed on its exact Task 2 seams.
- GREEN: removed compiler terminal replay, added progress-identity-aware compiler retry dispatch, constrained the checkpoint boundary to its exact seams, and passed the specified reader/boundary/display/session route suite.

## Verification

- `bun test .../committed-reader.test.ts .../stage-boundary.test.ts .../workflow-display-message.test.ts .../session-routes.test.ts`: 74 passed, 0 failed.
- `bun test .../stage-checkpoint.test.ts`: 22 passed, 0 failed.
- `bun test .../publication.test.ts`: 23 passed, 0 failed.
- `bun test .../schema-evolution.test.ts .../transition.test.ts .../worker-prompts.test.ts`: 43 passed, 0 failed.
- `bun run typecheck` from `packages/agent-workflow-server`: passed.
- Changed-file `biome lint`: passed; `git diff --check`: passed.

## Self-review / concerns

- The compiler worker is intentionally admitted only through the strict domain-specific terminal contract; it cannot supply alternate reader state, candidate, mechanical receipt, checkpoint, READY receipt, or fallback publication.
- Invalid committed publication is persisted as a safe reason code plus diagnostic ID and never returned to a downstream consumer.
- No Task 3, Task 4, Foundation Reviewer, or Foundation Revision files were changed beyond the documented shared workflow schema/test evidence.

Commits: `5a266f934` (source packet/strict DTO checkpoint), final fix-round commit recorded below.
