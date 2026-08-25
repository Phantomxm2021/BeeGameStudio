# Document Audit Runtime Closure Design

**Date:** 2026-08-25
**Status:** Approved design; implementation pending
**Authority:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Purpose

Close the remaining gap between the single-track document audit architecture and the production runtime without introducing another queue, recovery state machine, reviewer authority, or revision candidate format. This design corrects the existing path in place.

## Observed Runtime Gaps

The real project `moonlight-mushroom-defense--5462c252b870` reached `DOCUMENT_REVIEW` with 84 indexed sections and nine valid fact packets, but fact extraction did not complete. Four dispatched workers consumed 98,408 total model tokens before the phase stopped. The recorded terminal identity mismatch is fixed at the current branch HEAD, but the remaining runtime still cannot reliably finish because the aggregate 32,000-token ceiling and shared five-minute deadline are smaller than the required fresh-context workload.

The runtime also has these correctness gaps:

- fact workers receive the full Confirmed Brief and generic workspace context in addition to their packet;
- mechanically extracted facts are removed from worker requests but are not merged back during Fact Store finalization;
- new audit issues are treated as publication failure, so the live controller cannot enter Round 2 or Round 3;
- recovery contains a special pause repair path that can revive a run after its cap has already been exceeded;
- fact tasks and their failure details are not projected as ordinary Dashboard work;
- terminal dispatch usage exists, but failed task records do not consistently retain usage and duration.

## Design

### 1. Packet-only worker input

Fact and semantic workers receive only the immutable packet plus protocol metadata required to validate and return it: language, task/revision/packet identity and digest, explicit project read/write denial, and the strict terminal schema. They do not receive the Confirmed Brief, workspace path, canonical document list, or generic native-tool instructions.

Brief constraints are converted locally into closed-catalog values or revision-bound digests before packet construction. A worker cannot use the Brief as an undeclared second source of truth.

### 2. Bounds and cost accounting

Keep the existing 16 KiB fact and semantic packet boundary, fresh context per attempt, maximum concurrency of four, and maximum two attempts. Deep audit may use only the authority-selected indexed additions and never a whole document.

Remove aggregate token caps and shared phase/round wall-clock deadlines. They cannot safely represent a workload whose number of mandatory packets is known in advance and whose fresh-context input cost is paid per worker. Each dispatch retains its existing per-worker timeout. Output limits are derived from the declared result cardinality rather than a fixed 512-token ceiling; the implementation plan must select the smallest formula that accommodates the strict schema and all requested fact keys, with a hard upper bound.

Record prompt, completion, and total usage, duration, attempt, and failure reason on every terminal task. Cost is observable and auditable, but it does not cancel unopened mandatory packets.

### 3. Exact Fact Store completion

Local mechanical extraction and admitted worker extraction are two producers for the same closed catalog. Finalization recomputes or loads the revision-bound mechanical result, merges it with admitted worker facts, rejects duplicate disagreement, and verifies that every required catalog key is accounted for exactly once before atomic publication.

The zero-worker path uses the same finalizer and publication protocol.

### 4. Integrity failure versus audit result

Integrity failures include stale or conflicting digests, terminal identity mismatch, unauthorized sections, invalid evidence, illegal patches, missing receipts, and exhausted task attempts. They fail closed, publish no partial authority, and move the run to `needs_action` with the exact task failure.

Audit results include deterministic or semantic conflicts, omissions, unresolved business requirements, and issues introduced by an otherwise valid revision. They are compiled into the sole Issue Registry. A valid registry is atomically published even when it contains new issues.

### 5. Revision rounds and authority

Each successful round atomically publishes one immutable, revision-bound authority set: canonical documents, derived artifacts, validation evidence, and Issue Registry. The next round references only that committed set.

- Round 1 addresses BLOCKER, HIGH, and MEDIUM.
- Round 2 addresses newly remaining BLOCKER and HIGH.
- Round 3 addresses BLOCKER and verifies convergence.
- PASS requires no BLOCKER or HIGH; remaining MEDIUM and LOW become Known Issues.
- A BLOCKER or HIGH after Round 3 moves the run to `needs_action`.

The controller must publish valid resulting issues and advance according to this policy. It must not treat `newIssues.length > 0` as an operational failure.

### 6. Recovery

Recovery uses the same durable task collection and the same state/artifact preconditions as the live controller. It replays admitted receipts, retries only incomplete retryable tasks, and preserves attempts, identity failures, usage, duration, and failure reasons.

Remove the special fact-pause clock repair. Recovery must not manufacture a new time window, reset cost, or revive an exhausted task. No second dispatcher or compatibility reader is added.

### 7. Dashboard feedback

Project fact extraction, deterministic checks, semantic/deep checks, issue compilation, per-document revision, and targeted validation through the existing ordinary workflow task model. Show status/checkmark, round, issue counts by severity, Known Issues count, and the exact failure reason when action is required. Do not add a Reviewer panel or expose raw Registry JSON.

## Implementation Boundaries

- Preserve the eight-document authoring flow and canonical Markdown contracts.
- Reuse the existing `foundationAuditState.tasks[]`, dispatcher, terminal admission, atomic artifact publication, and display-task projection.
- Delete or simplify recovery-only logic made unnecessary by removing shared phase deadlines.
- Do not add dependencies, migrations, feature flags, queues, candidate artifacts, or compatibility schemas.

## Acceptance

The implementation is acceptable only when:

1. focused runtime, recovery, session-authority, artifact, revision-round, display, and type tests pass;
2. typecheck passes without weakening the schema;
3. a legacy scan finds no active candidate/projection/synthesis Reviewer or revision dual track;
4. every terminal audit task exposes usage, duration, attempt, and exact failure reason;
5. the real project resumes from its durable state or is rerun with the same documents and completes fact derivation, deterministic and semantic audit, necessary revision rounds, targeted validation, and automatic checklist drafting;
6. no worker receives the Confirmed Brief or an unconditional full-document context.

## Deliberately Not Added

No global budget coordinator, adaptive scheduler, reviewer-specific UI, revision-candidate subsystem, or recovery state machine is introduced. The existing single path is sufficient once its inputs, finalization, publication, and recovery semantics are corrected.
