# Document Audit Runtime Closure Design

**Date:** 2026-08-25
**Status:** Approved; implementation pending
**Authority:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Purpose

Close the remaining gap between the single-track document audit architecture and the production runtime without introducing another queue, recovery state machine, reviewer authority, or revision candidate format. Correct the existing path in place.

## Observed Runtime Gaps

The real project `moonlight-mushroom-defense--5462c252b870` reached `DOCUMENT_REVIEW` with 84 indexed sections and nine valid fact packets, but fact extraction did not complete. Four dispatched workers consumed 98,408 total model tokens before the phase stopped. The terminal identity mismatch is fixed at the current branch HEAD, but the aggregate 32,000-token ceiling and shared five-minute deadline still cannot contain the required fresh-context workload.

The runtime also has these correctness gaps:

- fact workers receive the full Confirmed Brief and generic workspace context in addition to their packet;
- mechanically extracted facts are removed from worker requests but are not merged back during Fact Store finalization;
- new audit issues are treated as publication failure, so the live controller cannot enter Round 2 or Round 3;
- recovery contains a special pause repair path that can revive a run after its cap has already been exceeded;
- fact tasks and their failure details are not projected as ordinary Dashboard work;
- terminal dispatch usage exists, but failed task records do not consistently retain usage and duration.

## Design

### Packet-only worker input

Fact and semantic workers receive only the immutable packet plus language, task/revision/packet identity and digest, explicit project read/write denial, and the strict terminal schema. Fact model output contains business fields only; the service binds immutable catalog-owner provenance into the durable terminal. Workers do not receive the Confirmed Brief, workspace path, canonical document list, or generic native-tool instructions.

Brief constraints are converted locally into closed-catalog values or revision-bound digests before packet construction. A worker cannot use the Brief as an undeclared second source of truth.

### Bounds and cost accounting

Keep the 16 KiB fact and semantic packet boundary, fresh context per attempt, maximum concurrency of four, and maximum two attempts. Deep audit may use only authority-selected indexed additions and never a whole document.

Remove aggregate token caps and shared phase/round wall-clock deadlines. Each dispatch retains its existing per-worker timeout. Per-dispatch output admission uses a fixed `4096` token cap for facts, `768` for semantic checks, and `1024` for deep confirmation. Fact-key cardinality remains a packet/state identity and scope check, but is not a proxy for final payload size: a single legal array-valued fact can be larger than a small multi-key result. The measured value is the final structured business payload, not provider-reported completion usage: facts measure `{status, results}`, while semantic/deep workers measure `{status, outcome, issues?, reason?}`. The service estimates this payload deterministically from its UTF-8 JSON size at two bytes per conservative token, including JSON structure but excluding transport/session metadata. Provider usage remains complete cost telemetry and never rejects an otherwise valid final payload.

Record prompt, completion, and total usage, duration, attempt, and failure reason on every terminal task. Cost is observable but does not cancel unopened mandatory packets.

### Exact Fact Store completion

Local mechanical extraction and admitted worker extraction are two producers for the same closed catalog. Finalization recomputes the revision-bound mechanical result, merges it with admitted worker facts, rejects duplicate disagreement, and verifies that every required catalog key is accounted for exactly once before atomic publication. The zero-worker path uses the same finalizer.

### Integrity failure versus audit result

Stale/conflicting digests, terminal identity mismatch, unauthorized sections, invalid evidence, illegal patches, missing receipts, and exhausted attempts fail closed and move the run to `needs_action`. Business conflicts and newly discovered issues are compiled into the sole Issue Registry. A valid Registry is published even when it contains new issues.

### Revision rounds

Each successful round publishes one immutable revision-bound authority set. Round 1 addresses BLOCKER/HIGH/MEDIUM; Round 2 addresses remaining BLOCKER/HIGH; Round 3 addresses BLOCKER and verifies convergence. PASS requires no BLOCKER/HIGH. Remaining MEDIUM/LOW become Known Issues. BLOCKER/HIGH after Round 3 moves the run to `needs_action`.

### Recovery and feedback

Recovery uses the same durable task collection and artifact preconditions as the live controller. It replays receipts, retries only incomplete retryable tasks, and preserves attempts, failures, usage, and duration. It does not repair clocks or reset cost.

The Dashboard uses ordinary workflow tasks for fact extraction, deterministic checks, semantic/deep checks, issue compilation, per-document revision, and targeted validation. It shows status, round, severity counts, Known Issues count, and exact failure reason without exposing raw Registry JSON.

## Boundaries

- Preserve the eight-document authoring flow and canonical Markdown contracts.
- Reuse `foundationAuditState.tasks[]`, the dispatcher, terminal admission, atomic publication, and display-task projection.
- Add no dependencies, migrations, feature flags, queues, candidate artifacts, compatibility schemas, or Reviewer UI.
- The real test project must reach automatic checklist drafting before the implementation is accepted.
