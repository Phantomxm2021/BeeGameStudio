# Game IR Semantic Slice Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace complete-domain Game IR projection StructuredOutput with a recoverable service-owned stream of small semantic slices while preserving one canonical ten-operation manifest chain.

**Architecture:** The service derives dependency-frontier slices from the projection contract's node-kind graph, admits one strict slice result at a time into an operation-local digest journal, then deterministically assembles the existing domain semantic result and writes the existing operation manifest. The immutable operation packet is supplied once per live operation session rather than repeated for every slice. Validation remains unchanged; the old complete-domain projection route and staged-packet identity fallback are deleted.

**Tech Stack:** TypeScript, Bun test, Zod v4, existing Bee Game native worker/session runtime.

**Spec:** `docs/superpowers/specs/2026-09-02-game-ir-semantic-slice-stream-design.md`

## Global Constraints

- Modify only Game IR compilation and its scoped worker/runtime seams.
- Do not modify Foundation Reviewer/Revision behavior, Checklist, UI, Task 9–15, or raw Markdown documents.
- Preserve exactly ten canonical Game IR operation manifests and the checkpoint v47 authority chain.
- Keep one canonical Game IR DTO/publication/reader; the slice journal is temporary staging state and never a second authority.
- Do not add compatibility, fallback, dual-read, dual-write, generic validator frameworks, or fixed token/time/attempt/slice/node/byte caps.
- Reject obsolete packets and journals fail closed; delete superseded production branches and tests.
- Use TDD. Do not commit unless the user explicitly asks.

---

### Task 1: Slice plan and strict slice contract

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slices.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-contract.ts`

**Interfaces:**
- Produces: `deriveProjectionSlicePlan(moduleId): GameIrProjectionSlicePlan` with stable SCC condensation and dependency-frontier ordering.
- Produces: `buildGameIrProjectionSliceAdmissionJsonSchema(moduleId, slice): Record<string, unknown>` for service-side admission only; it is never passed to the provider.

- [ ] Write RED tests for deterministic plans across all six modules, cycle grouping, same-frontier grouping, exact kind/edge scope, empty slice completion, and forbidden future fields.
- [ ] Run the focused test and confirm failures are caused by missing slice APIs.
- [ ] Implement the smallest immutable slice plan and schema by projecting the existing domain contract; do not copy domain schema declarations.
- [ ] Run focused tests and existing projection contract/schema tests.
- [ ] Run `git diff --check` and record evidence without committing.

### Task 2A: Operation-local tamper-evident slice journal

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.test.ts`

**Interfaces:**
- Consumes: `GameIrProjectionSlicePlan` and admitted slice results.
- Produces: create/load/append/invalidate/complete operations bound to compilation identity, operation packet and predecessor digests.
- Produces: exact-next-slice cursor and a fully verified completed snapshot; no unvalidated merged-semantic API.

- [ ] Write RED tests for append/reload, exact-next-slice recovery, duplicate/skip/tamper/stale-plan rejection, cross-slice duplicate node/evidence rejection, strict slice-schema validation, exact source-evidence rebinding, and coordinated digest recomputation rejection.
- [ ] Run RED tests and verify the expected missing behavior.
- [ ] Implement atomic journal writes using existing canonical serialization/digest helpers and the exact existing `GameIrCompilationIdentity`; do not invent optional identity fields.
- [ ] Expose cleanup only after a caller supplies a checkpoint-loader-verified canonical manifest identity; file existence alone is not authority.
- [ ] Run journal and projection-slice focused tests.

### Task 2B: Unique full-domain assembly integration

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/projection-slice-journal.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/staged-compiler.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/staged-compiler.test.ts`

**Interfaces:**
- Consumes: one fully verified completed journal snapshot plus the exact canonical operation packet.
- Produces: the existing `GameIrDomainSemanticResult` through source-evidence derivation and existing full-domain admission; no raw merge return path.

- [ ] Write RED tests for incomplete journal rejection, exact packet/identity binding, duplicate evidence subjects, cross-slice references, source-evidence completeness, and full-domain schema/graph failure.
- [ ] Run RED tests and verify failures are caused by missing unique assembly behavior.
- [ ] Implement one deterministic merge that immediately invokes existing source-claim derivation and full-domain admission.
- [ ] Integrate the helper into staged compiler without changing canonical operation records, checkpoint v47 or controller/session behavior.
- [ ] Run journal, staged compiler, checkpoint and domain integration tests.

### Task 3: Slice dispatch and terminal admission cutover

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Test: corresponding focused worker prompt, session port, dispatch recovery and controller progress tests.

**Interfaces:**
- Consumes: exact next slice from the journal.
- Produces: one slice-bound dispatch/terminal and retries only the current slice.
- Produces: canonical operation manifest only after journal completion and existing full-domain admission.
- Produces: strict slice-envelope rejection with no repair or compatibility normalization.

- [ ] Write RED tests proving a 46KB complete candidate is no longer requested, the immutable operation packet is supplied once per live operation session, one dependency-frontier slice is dispatched, admitted slices are not regenerated, invalid slice diagnostics remain slice-bound, and operation completion still emits exactly one canonical manifest.
- [ ] Write RED tests proving unknown completed-result fields (including root `reason`) are rejected without mutating the semantic body or accepting a compatibility shape.
- [ ] Add RED static tests rejecting projection prompts/schemas that request full-domain semantic and rejecting staged packets without `packet.source`.
- [ ] Run RED tests and capture exact failures.
- [ ] Cut projection dispatch over to the slice schema and cursor while leaving validation dispatch unchanged.
- [ ] Keep exact strict parsing; delete the old whole-domain repair/correction behavior rather than translating it into slice-envelope normalization.
- [ ] Delete the complete-domain projection prompt/schema/correction route and the `packet.source`-missing identity fallback; do not retain compatibility aliases.
- [ ] Run focused port/dispatch/controller/prompt tests and `git diff --check`.

### Task 4: Recovery, no-progress and single-track closure

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-checkpoint.test.ts`

**Interfaces:**
- Consumes: verified operation-local journal or canonical committed manifest.
- Produces: exact next-slice resumption, explicit same-slice no-progress diagnostic, and stale-journal cleanup.

- [ ] Write RED crash-point tests after each slice append, before operation assembly, after manifest commit before cleanup, and with a tampered predecessor.
- [ ] Write RED static assertions that old complete-domain fields/routes and generic compiler fields are absent from production code.
- [ ] Implement recovery and no-progress behavior without attempt/time/token counters.
- [ ] Delete obsolete recovery branches and fixtures rather than accepting old journals.
- [ ] Run focused recovery, boundary, checkpoint and schema-evolution tests.

### Task 5: Automated Game IR admission

**Files:**
- Modify only tests or Game IR-owned code required by concrete failures.

**Interfaces:**
- Verifies: all six domain projections, four validation operations, checkpoint/publication/reader/recovery and protected boundaries.

- [ ] Run all Game IR tests plus delivery-worker port, dispatch/controller recovery and Foundation parity suites.
- [ ] Run server typecheck, repository check and `git diff --check`.
- [ ] Audit changed paths against protected Reviewer/Revision, Checklist, UI and Task 9–15 routes.
- [ ] Audit production text for the old whole-domain projection protocol, compatibility/fallback fields and arbitrary caps; fix concrete findings and rerun affected tests.

### Task 6: Chrome real-project acceptance

**Files:**
- No production edits unless a concrete Game IR-owned defect is proven.

**Interfaces:**
- Produces: committed six-domain Game IR evidence from the existing real project and stops before Checklist.

- [ ] Restart the development stack from this worktree and resume from the real project's current Foundation READY authority.
- [ ] Use Chrome to run through all ten Game IR operations; if an error occurs, capture the exact UI message, runtime/raw log, run state, current slice journal and operation manifest before changing code.
- [ ] Inspect publication, committed reader, six modules, source claims, cross-domain dependency graph and semantic content quality.
- [ ] Confirm no slice journal remains after each committed operation and no Checklist task starts.
- [ ] Record actual tokens, duration, provider retries, slice dispatches, artifact bytes and recovery events as observations only.
- [ ] Rerun focused automated tests after any concrete correction and produce the final admission audit.

#### Acceptance correction: service-owned evidence fragments

The first real `gameplay.slice.0` run proved that semantic slicing alone does
not make literal evidence safe: the model filtered unrelated table rows and
joined the remaining rows into an excerpt that never existed contiguously in
the authority section. Retrying that output is probabilistic and preserves the
large literal-copy burden.

- [x] Replace projection-worker evidence `{documentPath, sectionId, excerpt}`
  and target-selector enumeration with the sole `{fragmentId, nodeIds}` shape.
- [x] Derive stable fragment IDs mechanically from exact non-empty, unique
  Markdown lines; do not introduce length, count, token or time limits.
- [x] Resolve fragment IDs inside journal admission to the existing canonical
  document, section, excerpt and byte-pointer authority; expand each node ID to
  its complete canonical semantic target set in the service.
- [x] Remove the old literal-evidence worker shape from Zod, JSON Schema,
  prompts and tests; retain no compatibility parser.
- [x] Keep canonical operation packets, ten manifests, checkpoint v47,
  publication and committed-reader formats unchanged.
- [ ] Re-run the real workflow and verify the model emits only fragment IDs,
  the journal admits the first slice, and continuation omits the operation
  packet only within the same resumable native session.

#### Acceptance correction: projection record-stream transport

The real Balance acceptance proved that a node-kind slice can still contain a
data-dependent recursive formula payload. Native StructuredOutput transported
the argument as cumulative DSML/JSON snapshots, repeated the growing semantic
payload into raw logs and transcript events, froze Chrome and ended without a
valid tool identity. This is a transport defect, not a journal defect.

- [x] Add one strict projection-only NDJSON parser. A node line has exact keys
  `record`, `sliceId`, `fragmentId`, `node`; the final line has exact keys
  `record`, `sliceId` with `record: done`.
- [x] Derive canonical source evidence groups mechanically from each node's
  sole fragment ID. Reject unknown fields, internal blank lines, malformed
  JSON, duplicate/descending IDs, wrong slice IDs, missing/duplicate `done`
  and records after `done`; never repair or reorder model records.
- [x] Add one generic native record-stream transport that accumulates true
  text deltas and continues the same native context until the exact terminal
  record. Reject cumulative frames, DSML/tool frames and no-progress
  continuation as `provider_stream_protocol_error`.
- [x] Cut Game IR projection dispatch from `workflowJsonSchema` to the unique
  record-stream contract. Keep validation StructuredOutput unchanged.
- [x] Delete the provider-facing complete-slice StructuredOutput schema/parser, projection
  tool-call continuation, projection DSML/text fallback and their fixtures.
- [x] Do not persist projection semantic frames to transcript or raw logs;
  retain only sequence, byte length, digest and bounded error summaries.
- [x] Prove provider truncation continuation, restart recovery, exact slice
  admission, single manifest closure, stale-journal cleanup and static absence
  of the old projection aggregate route. Introduce no token, time, attempt,
  node, record or byte cap.
- [ ] Restart Chrome acceptance from the same canonical checkpoint, finish all
  six Game IR domains and stop before Checklist.
