# Workflow Exact-Resume Recovery Design

**Status:** Proposed authority for implementation  
**Date:** 2026-08-05  
**Scope:** BeeGame durable delivery Workflow only

## 1. Goal

Any managed project must continue from its exact durable interruption point even when the materialized Workflow snapshot is obsolete, fails the current schema, or was left behind by a breaking Workflow release.

Recovery reconstructs orchestration state. It never reconstructs project output and never repeats an accepted phase, task, review check, document commit, resource operation, implementation task, audit, or acceptance operation.

## 2. Non-negotiable invariants

1. An accepted unit is immutable. Recovery must not dispatch it again.
2. A phase containing only accepted units is complete and must not be re-entered.
3. A commit with an accepted canonical receipt is reconciled, never regenerated.
4. An active unit with an accepted terminal is reconciled, never re-dispatched.
5. Only the single active unit without an accepted terminal may be re-dispatched after its stale worker session is stopped.
6. Units that have not started remain pending under the current protocol.
7. Project documents, Checklist, Manifest modules, imported/authored resources, JSON/YAML content and implementation files are never deleted, rewritten or reacquired merely because orchestration state is unreadable.
8. Recovery produces exactly one current-schema run. No old runtime, fallback Workflow, compatibility execution branch, second ledger or feedback loop may remain active.
9. If the system cannot prove whether a unit was accepted, it must report `recovery_checkpoint_missing`; it must not silently rerun the unit or pretend it completed.
10. Every breaking persisted-state change increments `DELIVERY_RUN_SCHEMA_VERSION` in the same commit.

## 3. Why the current design fails

`resume`, `retry`, startup reconciliation and controller progress all begin with strict `RunStore.load()`. A snapshot that cannot pass the current Zod schema fails before worker-session reconciliation, receipt recovery, phase transition or artifact inspection can run.

The current 15-check change also altered a persisted enum without increasing schema version 11. Existing version-11 snapshots containing the removed sixteenth check were therefore classified as malformed current state instead of an older state requiring deterministic transformation.

The error view is read-only and exposes no recovery operation. Consequently valid project outputs exist, but the controller cannot reach them.

## 4. Chosen architecture

The system uses one public continuation operation with two internal stages:

1. **Current snapshot load:** parse and resume a valid current run normally.
2. **Exact-resume reconstruction:** when normal load reports obsolete or invalid state, reconstruct one current run from durable semantic checkpoints, then invoke the same current controller resume path.

There is no old Workflow execution. Reconstruction is a one-way data operation that ends before current Workflow execution begins.

### 4.1 Versioned one-way snapshot migration

Every persisted breaking change defines a deterministic `N -> N+1` transformation. Migration operates on raw data, is keyed only by explicit `schemaVersion`, and must:

- preserve accepted unit identities, results, revisions, evidence and usage;
- preserve the exact active unit when it remains a current semantic unit;
- map or remove only protocol-owned pending topology that changed;
- reject ambiguous transformations rather than guessing;
- validate the transformed value with the current full schema;
- atomically replace `run.json` only after complete validation.

Migration code is not a runtime compatibility path. The controller, schemas, prompts and transition logic support only the current protocol. No old identifier may remain after the atomic replacement.

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
2. Stop every open Workflow worker session owned by the workspace.
3. Reconcile accepted document/content receipts that were committed before interruption.
4. Replay accepted-unit events in durable order.
5. Verify every replayed unit against the current unit schema, predecessor relation, receipt and dependency digest.
6. Inspect the invalid raw snapshot only for current-recognized semantic facts not yet journaled by historical versions. Accept such facts only when their current schema and all referenced digests validate; ignore unknown pending topology.
7. Derive the longest contiguous accepted unit prefix and the one active unaccepted unit.
8. Build one current-schema `DeliveryRun` with the original project identity, confirmed brief, start time and cumulative usage.
9. Append `workflow.run.reconstructed` containing the invalid snapshot digest, resulting run ID, accepted prefix and active unit.
10. Atomically replace `run.json`, release the recovery lock and resume through the normal current controller.

The projector contains no LLM, keyword matching, regular expressions, project-specific names or platform-specific rules.

### 4.4 Historical snapshots without complete accepted-unit events

Existing snapshots predate the complete accepted-unit journal. The projector may extract only current-recognized semantic facts from their raw JSON structure. It must never accept the old snapshot as a run.

A historical fact is reusable only when:

- its unit/check/task identity exists in the current protocol;
- its terminal or receipt passes the current result schema;
- its stored dependency digests exactly equal current artifact digests;
- its predecessor units are also proven accepted;
- no duplicate or contradictory accepted result exists.

Unknown fields and removed pending units are discarded. A removed unit that was previously accepted requires an explicit version migration decision; it cannot be silently treated as current work.

This historical extraction is part of the same projector and produces only current facts. It does not create a second parser used by normal execution.

## 5. Continue, retry and restart semantics

The UI exposes the existing user concepts, but all use one server-owned continuation boundary:

- **Continue:** valid run resumes normally; invalid/obsolete run reconstructs and resumes the exact unit.
- **Retry:** valid actionable run retries only its current unit; invalid/obsolete state first reconstructs, then retries only the reconstructed active unit.
- **Restart current Workflow:** stops the stale worker and reconstructs the same project from durable accepted facts. It does not create a project, return to the idea, or clear outputs.

Read-only GET routes never mutate state. They return `recoverable: true`, the diagnostic ID and the last provable phase/unit summary. The mutation occurs only after the user presses Continue/Retry/Restart.

## 6. Exact phase derivation

Recovery uses the ordered current unit graph, not file existence alone.

- A file proves output presence, not author/reviewer acceptance.
- A canonical receipt proves the corresponding mutation was accepted.
- A review accepted-unit event plus matching dependency digests proves that individual check completed.
- Resource inventory, content commit and Resource Gate remain separate accepted units.
- Implementation task completion requires its accepted task evidence, not merely changed source files.

The first unit after the contiguous accepted prefix is the only continuation target. Recovery cannot jump over an unproven unit and cannot reopen an earlier accepted unit.

## 7. Current project result

For `commander-tower-defense--bcdc5340e96e`, the recoverable facts establish:

- Foundation documents completed;
- all 12 Foundation Review checks completed;
- Checklist authoring and review completed;
- resource inventory, downloads, Manifest, JSON/YAML content and Resource Gate completed;
- Comprehensive Review entered;
- `resource_semantic_fitness` is the active unit and has no accepted terminal.

The version-11 to current transformation must remove the retired pending check from required topology, preserve the 12 completed checks and all prior accepted units, stop dispatch `b4ac1377-a187-40e7-af72-22c9e9c2d3cf`, and resume with a new current-protocol dispatch for `resource_semantic_fitness`. No earlier work may run.

## 8. Concurrency and atomicity

Recovery is serialized per workspace independently of the ordinary run lock. It compares the raw snapshot digest before replacement so two Continue requests cannot reconstruct different runs.

The operation is idempotent:

- if another request already wrote the same current projection, return it;
- if a current worker already owns the reconstructed active unit, do not dispatch another;
- if an accepted receipt appears while recovery is running, reconcile it before deciding to re-dispatch;
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
- Each registered migration transforms fixtures into the exact current schema.
- No production controller or prompt references an old identifier after migration.

### 10.2 Exact-resume matrix

For every Workflow phase and every worker type, test interruption:

1. before dispatch;
2. while worker is open;
3. after terminal accepted but before reconciliation;
4. after receipt persisted but before snapshot update;
5. after unit accepted and before next dispatch.

Every test asserts that accepted unit dispatch counts remain unchanged and only the one unaccepted active unit may receive a new dispatch.

### 10.3 Invalid snapshot matrix

Cover obsolete version, current-version schema rejection, unknown fields, removed pending unit, truncated JSON, stale active dispatch, duplicate Continue requests and server restart during reconstruction.

### 10.4 Current regression fixture

Use a synthetic version-11 16-check fixture with the same semantic state shape as the diagnosed project. Assert reconstruction yields 15 current checks, 12 completed Foundation checks, `resource_semantic_fitness` as the sole active unit, preserved Resource Gate evidence and zero dispatches for every earlier phase.

Do not use or modify a real user project as a test fixture.

## 11. Cleanup requirements

Implementation must remove:

- the generic instruction to create a new project for every obsolete snapshot;
- any resume/retry path that can only operate after strict full-run parsing;
- schema-changing code that does not register a version increment;
- alternate restart logic that clears documents, resources or accepted state;
- compatibility execution, fallback Workflow, duplicate state ledger and feedback-driven recovery.

After reconstruction, only the current-schema run, accepted-unit journal and canonical receipts participate in execution.

