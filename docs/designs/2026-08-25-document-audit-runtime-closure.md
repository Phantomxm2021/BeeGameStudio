# Document Audit Runtime Closure Design

**Date:** 2026-08-25
**Status:** Non-executable history; current behavior is governed solely by authority doc
**Authority:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Purpose

Close the remaining gap between the single-track document audit architecture and the production runtime without introducing another queue, recovery state machine, reviewer authority, or revision candidate format. Correct the existing path in place.

## Observed Runtime Gaps

The real project `moonlight-mushroom-defense--5462c252b870` reached `DOCUMENT_REVIEW` with 84 indexed sections and nine valid fact packets, but fact extraction did not complete. Four dispatched workers consumed 98,408 total model tokens before the phase stopped. The terminal identity mismatch is fixed at the current branch HEAD, but the aggregate 32,000-token ceiling and shared five-minute deadline still cannot contain the required fresh-context workload.

The runtime also has these correctness gaps:

- fact workers receive the full Confirmed Brief and generic workspace context in addition to their packet;
- mechanically extracted facts are removed from worker requests but are not merged back during Fact Store finalization;
- new audit issues are published in the sole Issue Registry and the live controller continues into the next dynamic revision round;
- recovery contains a special pause repair path that can revive a run after its cap has already been exceeded;
- fact tasks and their failure details are not projected as ordinary Dashboard work;
- terminal dispatch usage exists, but failed task records do not consistently retain usage and duration.

## Design

### Packet-only worker input

Fact and semantic workers receive only the immutable packet plus language, task/revision/packet identity and digest, explicit project read/write denial, and the strict terminal schema. Fact model output contains business fields only; the service binds immutable catalog-owner provenance into the durable terminal. Workers do not receive the Confirmed Brief, workspace path, canonical document list, or generic native-tool instructions.

Brief constraints are converted locally into closed-catalog values or revision-bound digests before packet construction. A worker cannot use the Brief as an undeclared second source of truth.

### Bounds and cost accounting

Keep fresh context per attempt and maximum concurrency of four. Deep audit may use only authority-selected indexed additions and never a whole document. Fact, semantic, and revision packets contain their exact authorized scope and are not truncated or rejected by an arbitrary business-size limit. Revision tasks have no fixed attempt ceiling: a failed attempt is rebuilt from the same canonical base and retried automatically.

Remove aggregate token caps, fixed token-estimate business gates, shared phase/round wall-clock deadlines, and the fixed revision-attempt ceiling. Each dispatch retains its existing per-worker timeout, strict structured schema, exact task identity and scope, and provider/native output constraint. Fact-key cardinality remains a packet/state identity and scope check, not a payload-size proxy. A legal terminal is never rejected because one fixed token estimate cannot represent case complexity. At the worker transport boundary, Foundation fact and semantic structured outputs share the existing 2 MiB UTF-8 JSON infrastructure envelope before parsing and persistence; exceeding it is an explicit infrastructure failure rather than an audit finding or business-quality verdict. Provider usage remains complete cost telemetry and never rejects an otherwise valid terminal.

Record prompt, completion, and total usage, duration, attempt, and failure reason on every terminal task. Cost is observable but does not cancel unopened mandatory packets.

### Exact Fact Store completion

Local mechanical extraction and admitted worker extraction are two producers for the same closed catalog. Finalization recomputes the revision-bound mechanical result, merges it with admitted worker facts plus their closed receipts, rejects duplicate/overlapping accounting or receipt disagreement, and verifies that mechanical present keys plus every admitted receipt account for every catalog key exactly once before atomic publication. Absent and uncertain receipts provide coverage but do not enter the present-only Fact Store; deterministic and semantic review own the resulting issues. The zero-worker path uses the same finalizer.

### Semantic packet discipline

Semantic packets deliberately omit sections whose normalized owner facts already carry the needed structure. A marked contract section terminates at any following same-level-or-higher Markdown heading; unmarked `Production Materials` and audit appendices are outside the preceding authoritative section. This preserves exact section bytes and the immutable packet identity without imposing a fixed business-size boundary.

### Integrity failure versus audit result

Canonical authority tampering or identity/digest conflict that prevents rebuilding a fresh attempt fails closed and moves the run to `needs_action`. Unauthorized sections, invalid evidence, illegal patches, a missing/invalid receipt, and a worker that stops before submitting its required durable terminal fail only the current revision attempt: discard its staged bytes, rebuild from the same canonical base, attach the structured failure diagnostic, and retry automatically without a fixed attempt ceiling. Business conflicts and newly discovered issues are compiled into the sole Issue Registry. A valid Registry is published even when it contains new issues; no receipt is fabricated and no terminal contract is weakened.

### Revision rounds

Each successful round publishes one immutable revision-bound authority set. Every non-empty Registry is repaired in full, regardless of severity. If the Issue Registry authority changes and remains non-empty, the controller starts the next positive-integer round with targeted incremental validation. PASS requires an empty Registry; there is no fixed maximum round or severity budget. An unchanged Issue Registry digest is authoritative no-progress even when worker edits produce a new document revision, because document-byte drift cannot substitute for Issue resolution. Only an unrecoverable authority/integrity failure, a strong confirmation that remains `UNDECIDABLE`, or genuinely unchanged Issue authority may move the run to `needs_action`.

Each per-document revision packet carries the admitted Issue Registry entries and exact selected immutable sections directly; it is not truncated or rejected by a fixed business-size boundary. It must not duplicate `actual` as a second `problem` field or repeat source, target, and fix references in an `evidenceRefs` track; the Registry issue and selected immutable sections remain the sole business evidence.

### Recovery and feedback

Recovery uses the same durable task collection and artifact preconditions as the live controller. It replays receipts, retries only incomplete retryable tasks, and preserves attempts, failures, usage, and duration. It does not repair clocks or reset cost. Every revision retry recreates the staged document from its canonical round base, so failed-attempt edits cannot contaminate the next dispatch. Each revision dispatch runs in a unique empty native sandbox cwd; its native tool surface is exactly `Read`, `Edit`, and `SubmitFoundationRevisionResult`, with no Bash, Grep, Glob, or other file-access bypass. The real project path is passed only through a trusted service environment to the receipt tool, while native Read/Edit input validation permits exactly the one absolute staged regular file and rejects canonical, other staged, workspace-external, and symlink paths.

The Dashboard uses ordinary workflow tasks for fact extraction, deterministic checks, semantic/deep checks, issue compilation, per-document revision, and targeted validation. Audit and revision remain in the single durable `DOCUMENT_REVIEW` delivery phase and the sole `foundationAuditState`, but their display stages are distinct: the frozen audit card is stage 3 and the active repair card is the display-only virtual stage 4. The display projection inserts that virtual stage before downstream display stages; checklist drafting remains at stage 4 so progress never regresses after repair. During repair, the same task collection contains revision/targeted-validation tasks only, so the card cannot imply that audit and revision are executing concurrently. Completed audit evidence remains bound through the same state and its committed artifacts; no `foundationRevisionState`, fallback field, migration reader, or parallel recovery branch exists. Stage-card history freezes the stage-3 audit boundary when entering virtual stage 4. The Dashboard shows status, dynamic round, severity summary, compact aggregated task telemetry (usage/duration), and safe projected failure reason without exposing raw Registry JSON, `problem`/`actual`/`evidence`, worker prose/thinking, or worker feedback; those messages remain in runtime logs and durable evidence only.

## Boundaries

- Preserve the eight-document authoring flow and canonical Markdown contracts.
- Reuse `foundationAuditState.tasks[]`, the dispatcher, terminal admission, atomic publication, and display-task projection.
- Add no dependencies, migrations, feature flags, queues, candidate artifacts, compatibility schemas, or Reviewer UI.
- The real test project must reach automatic checklist drafting before the implementation is accepted.
