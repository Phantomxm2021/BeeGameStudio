# Workflow Exact-Resume Recovery Design

**Status:** Approved authority for implementation
**Date:** 2026-08-05  
**Scope:** BeeGame durable delivery Workflow only

## 1. Goal

Any managed project on the current persisted protocol must continue from its exact durable interruption point even when the materialized Workflow snapshot fails the current schema.

Recovery reconstructs orchestration state. It never reconstructs project output and never repeats an accepted phase, task, review check, document commit, resource operation, implementation task, audit, or acceptance operation.

## 2. Non-negotiable invariants

1. An accepted unit is immutable. Recovery must not dispatch it again.
2. A phase containing only accepted units is complete and must not be re-entered.
3. A commit with an accepted canonical receipt is reconciled, never regenerated.
4. An active unit with an accepted terminal is reconciled, never re-dispatched.
5. Only the single active unit without an accepted terminal may be re-dispatched after its stale worker session is stopped.
6. Units that have not started remain pending under the current protocol.
7. Project documents, Checklist, Manifest modules, imported/authored resources, JSON/YAML content and implementation files are never deleted, rewritten or reacquired merely because orchestration state is unreadable.
8. Recovery produces exactly one current-schema run. No alternate runtime, fallback Workflow, compatibility execution branch, second ledger or feedback loop may remain active.
9. If the system cannot prove whether a unit was accepted, it must report `recovery_checkpoint_missing`; it must not silently rerun the unit or pretend it completed.
10. Every breaking persisted-state change increments `DELIVERY_RUN_SCHEMA_VERSION` in the same commit.
11. The ordered graph identifies what may follow an accepted prefix, but it does not prove that the following unit started. Recovery may enter Document Drafting only when durable snapshot or dispatch identity proves that the exact unfinished unit is a current canonical document unit.
12. Every GET/read surface is observational: it never flushes a pending marker, reconciles a worker, persists progress, or dispatches work.
13. Concurrent or queued Continue requests persist one continuation decision. Later requests return the same current run without invoking the controller again once durable state owns the continuation.

## 3. Why the current design fails

`resume`, `retry`, startup reconciliation and controller progress all begin with strict `RunStore.load()`. A snapshot that cannot pass the current Zod schema fails before worker-session reconciliation, receipt recovery, phase transition or artifact inspection can run.

The error view is read-only and exposes no recovery operation. Consequently valid project outputs exist, but the controller cannot reach them.

## 4. Chosen architecture

The system uses one public continuation operation with two internal stages:

1. **Current snapshot load:** parse and resume a valid current run normally.
2. **Exact-resume reconstruction:** when normal load reports an invalid version-13 state, reconstruct one current run from durable semantic checkpoints, then invoke the same current controller resume path.

Earlier and newer schema versions fail closed. Reconstruction is a one-way data operation that ends before current Workflow execution begins.

### 4.1 Strict current snapshot protocol

The controller, schemas, prompts, transition logic and recovery projector support exactly `DELIVERY_RUN_SCHEMA_VERSION`. A breaking persisted change increments that version and starts a clean development protocol. The runtime does not transform prior versions. Read routes preserve unsupported bytes and return diagnostics; mutation routes fail closed.

### 4.2 Canonical accepted-unit events

Future exact recovery must not depend on a fully parseable snapshot. The existing `events.jsonl` becomes the durable recovery journal for accepted orchestration facts. `run.json` remains the current materialized projection used during normal execution.

Every accepted unit appends one `workflow.unit.accepted` event in the same durable commit boundary. The event contains:

- current event schema version;
- run, project and owner identities;
- stable semantic `unitId` and unit kind;
- phase and ordered predecessor identity;
- dispatch ID when applicable;
- input revision and dependency digests;
- accepted terminal or canonical receipt reference;
- resulting current phase cursor;
- accepted timestamp.

Unit IDs describe semantic work, not model turns. Examples include a canonical document path, a fixed review check ID, a Resource Production task, an atomic implementation task ID, an implementation audit, or acceptance.

The journal is not a second Workflow. It records accepted facts only and cannot dispatch, transition or override the current controller. `run.json` is always regenerated from the journal into the sole current state before execution resumes.

### 4.3 Recovery projector

`WorkflowRecoveryProjector` is the only invalid-snapshot recovery component. It receives the owned project, workspace, current protocol definition, raw snapshot digest, accepted-unit events and canonical receipts.

It performs this fixed sequence:

1. Acquire a workspace recovery lock that does not require parsing `run.json`.
2. Inspect and hash the invalid source without flushing or rewriting it.
3. Stop every open Workflow worker session owned by the workspace. The stop is a barrier: it waits for each active turn, deterministic terminal reconciliation and commit, and usage flush.
4. Inspect the now-stable source again and reconcile any active canonical document or Resource Content receipt committed before its terminal reached `run.json`.
5. Replay accepted-unit events in durable order.
6. Verify every replayed unit against the current unit schema, predecessor relation, receipt and dependency digest.
7. Inspect the invalid raw snapshot only to validate current-protocol identity, contradictions and the exact unfinished unit. It never supplies accepted-unit proof.
8. Derive the longest contiguous accepted unit prefix and require durable identity for the exact unfinished active unit. The first graph node after the prefix is a consistency check, not fallback authority.
9. Build one current-schema `DeliveryRun` with the original project identity, confirmed brief, start time and cumulative usage.
10. Ask `RunStore` to compare the expected source digest and write the reconstructed run plus `workflow.run.reconstructed` in the same storage mutation critical section.
11. Release the recovery lock and resume through the normal current controller.

The projector contains no LLM, keyword matching, regular expressions, project-specific names or platform-specific rules.

### 4.4 Invalid current snapshots

An invalid version-13 snapshot is recoverable only when `events.jsonl` proves the accepted prefix and durable current-protocol identity proves the exact unfinished unit. Snapshot completion arrays, task status, approvals or evidence never become accepted proof. They are checked only for contradictions with journal facts. Missing journal proof fails with `recovery_checkpoint_missing`.

## 5. Continue, retry and restart semantics

The UI exposes the existing user concepts, but all use one server-owned continuation boundary:

- **Continue:** valid run resumes normally; invalid version-13 state reconstructs and resumes the exact unit.
- **Retry:** valid actionable run retries only its current unit; invalid version-13 state first reconstructs, then retries only the reconstructed active unit.
- **Restart current Workflow:** stops the stale worker and reconstructs the same project from durable accepted facts. It does not create a project, return to the idea, or clear outputs.

Read-only GET routes never mutate state. They return `recoverable: true`, the diagnostic ID and the last provable phase/unit summary. The mutation occurs only after the user presses Continue/Retry/Restart.

## 6. Exact phase derivation

Recovery uses the ordered current unit graph, not file existence alone.

- A file proves output presence, not author/reviewer acceptance.
- A canonical receipt proves the corresponding mutation was accepted.
- A review accepted-unit event plus matching dependency digests proves that individual check completed.
- Resource inventory, content commit and Resource Gate remain separate accepted units.
- Implementation task completion requires its accepted task evidence, not merely changed source files.

The durable active-unit identity must equal the first unit after the contiguous accepted prefix. Recovery cannot infer a started unit from topology alone, jump over an unproven unit or reopen an earlier accepted unit. In particular, a missing active-unit proof never means “start from Document Drafting.”

## 7. Synthetic acceptance result

The regression fixture establishes:

- Foundation documents completed;
- all 12 Foundation Review checks completed;
- Checklist authoring and review completed;
- resource inventory, downloads, Manifest, JSON/YAML content and Resource Gate completed;
- Comprehensive Review entered;
- `resource_semantic_fitness` is the active unit and has no accepted terminal.

The version-11 to current transformation must remove the synthetic retired pending check from required topology, preserve the 12 completed checks and all prior accepted units, stop the fixture's stale dispatch, and resume with one new current-protocol dispatch for `resource_semantic_fitness`. No earlier work may run.

## 8. Concurrency and atomicity

Recovery is serialized per workspace independently of the ordinary run lock. `RunStore` performs the expected-digest comparison and replacement inside one mutation critical section, so a terminal or ordinary commit cannot land between the final comparison and write.

The operation is idempotent:

- if another request already wrote the same current projection, return it;
- if a current worker already owns the reconstructed active unit, do not dispatch another;
- if an accepted receipt appears while recovery is running, reconcile it before deciding to re-dispatch;
- if a terminal is accepted while workers are stopping, wait for its controller reconciliation/commit and project from the resulting durable state;
- if a Continue request queued behind the winner, read and return the winner's current run without another resume event or controller call;
- a crash before atomic replacement leaves the old snapshot and journal intact;
- a crash after replacement is handled by normal startup reconciliation.

## 9. Error behavior

Recovery errors are structured and actionable:

- `recovery_checkpoint_missing`: exact accepted status cannot be proven; no unit is rerun.
- `recovery_checkpoint_conflict`: duplicate or contradictory accepted facts.
- `recovery_artifact_digest_mismatch`: an accepted unit's inputs changed after acceptance.
- `recovery_worker_stop_failed`: stale worker ownership could not be cleared.
- `recovery_snapshot_changed`: another request changed the source during reconstruction.

Internal validation JSON stays in server diagnostics. The Workflow card shows the last proven phase/unit, the concise reason and Continue/Retry when actionable.

## 10. Testing requirements

### 10.1 Version and schema enforcement

- A persisted enum/shape change without a schema-version increment fails a repository test.
- Earlier and newer schema versions fail closed without rewriting snapshot bytes.
- No production migration module or alternate protocol parser exists.

### 10.2 Exact-resume matrix

For every Workflow phase and every worker type, test interruption:

1. before dispatch;
2. while worker is open;
3. after terminal accepted but before reconciliation;
4. after receipt persisted but before snapshot update;
5. after unit accepted and before next dispatch.

Every test asserts that accepted unit dispatch counts remain unchanged and only the one unaccepted active unit may receive a new dispatch.

### 10.3 Invalid snapshot matrix

Cover earlier/newer version rejection, current-version schema rejection, unknown fields, truncated JSON, stale active dispatch, duplicate Continue requests and server restart during reconstruction.

Use the real controller and dispatcher for dispatch-count assertions. Cover the final compare/write race with two real `RunStore` instances, restart after reconstruction, and a terminal accepted during the stop barrier. Do not manufacture `activeDispatch` in a resume callback.

### 10.4 Read and HTTP boundaries

- Project resume, project retry and session Continue each cover valid current state, recoverable invalid-current state and hard failures.
- Repeated or queued Continue requests produce one durable resume and one active-unit dispatch.
- Project Workflow, Workflow events and runtime-state GETs preserve `run.json`, `events.jsonl` and dispatch counts byte-for-byte, including snapshots with pending markers and orphaned-looking dispatches.

### 10.5 Current regression fixture

Use only synthetic version-13 fixtures. Assert reconstruction preserves every journal-accepted check, resumes the sole exact unfinished unit and dispatches zero earlier phases.

Do not use or modify a real user project as a test fixture.

## 11. Cleanup requirements

Implementation must remove:

- any resume/retry path that can only operate after strict full-run parsing;
- schema-changing code that does not register a version increment;
- alternate restart logic that clears documents, resources or accepted state;
- any invalid-state branch that selects Document Drafting without exact durable active-unit proof;
- polling/read logic that flushes markers, reconciles terminals or starts work;
- snapshot migration code, compatibility execution, fallback Workflow, duplicate state ledger and feedback-driven recovery.

After reconstruction, only the current-schema run, accepted-unit journal and canonical receipts participate in execution.

## 12. Task 6 measured verification and guarantees

The persisted protocol remains version 13. Its registered SHA-256 fingerprint is
`263640f06ada501afb0421806f29215b83e54b4fb239591b9dc1256e8e4b5067`.
The guard computes this value from canonicalized Zod JSON Schema projections of
the strict `DeliveryRun` topology, accepted-unit journal event topology and
versioned `tasks.planned.taskGraph` receipt topology. It
does not read TypeScript source text and does not use regular expressions. A
topology or persisted-enum change at version 13 now fails with a direct
instruction to increment `DELIVERY_RUN_SCHEMA_VERSION`; an unregistered new
version fails with an instruction to register its fingerprint.

The automated worker checkpoint matrix covers all 11 persisted worker types at
their real durable interruption points. Every worker covers before dispatch,
while open, terminal accepted and unit accepted. The two workers with an
independent canonical commit receipt (`document-author` and
`resource-content-author`) additionally cover receipt persisted before terminal
acceptance. These are 46 real on-disk restart cases plus one coverage-shape
assertion; no receipt is invented for the other nine worker contracts. Every case reconstructs fresh
RunStore/controller/dispatcher instances and enters through `resumeRun`.
Before dispatch starts exactly one semantic dispatch, an open duplicate retains
one, and terminal-, receipt- and unit-accepted checkpoints never increase the
accepted semantic unit's dispatch count. The matrix also proved and corrected
the Delivery question terminal: after `question.answered`, the run returns to
completed state and clears its one-shot change route, so restart cannot dispatch
the same question again. The wider recovery suite also covers unsupported-version
rejection and same-version invalid snapshots, malformed/truncated JSON with complete and incomplete
journal proof, stale worker telemetry and ownership, queued duplicate Continue,
terminal drain during the stop barrier, CAS races and reconstruction restart
with fresh RunStore/controller/dispatcher instances.

When atomic planning is accepted, the existing `tasks.planned` journal event
stores the strict task graph in the same RunStore commit as the snapshot and
accepted-unit events. Recovery validates its immutable plan topology against
the accepted task IDs and, when readable, the snapshot; accepted implementation
units alone advance mutable task status and evidence. This lets a complete
journal reconstruct a truncated `run.json` without a fallback path or second
ledger, while contradictory topology fails closed.

On 2026-08-06 the complete server command measured 584 passing tests across 66
files, 0 failures and 1640 assertions. The complete frontend command measured
643 passing tests across 58 files and 0 failures. Server and repository
TypeScript checks both exited 0; `git diff --check` exited 0. The anti-pollution
scan found no production snapshot migration or alternate execution path.
Chrome acceptance and port cleanup remain final integration gates.
