# Foundation Review v3 Three-Lane Assembly Design

## Goal

Produce one revision-bound, actionable Foundation Review from three parallel
Reviewer lanes without asking a fourth model turn to rewrite the lane results.
Bee Game Studio validates, orders, deduplicates exact repeats, assigns IDs and
persists the report; it does not author or semantically merge review content.

## Evidence and Problem

The v3 schema removal of obsolete verification fields fixed one proven schema
defect. Chrome acceptance then exposed two independent lifecycle failures:

1. a lane Reviewer successfully submitted corrected `StructuredOutput`, but the
   native process waited for a later prose result, crossed the compaction
   boundary at 175,354 tokens and attempted to submit the result again;
2. the fourth synthesis Reviewer read 24 already accepted candidates, began
   rewriting them as one larger report, emitted only 1,087 bytes of its tool
   input and then produced no further SSE, tool result, error or terminal event.

The first failure is closed by treating a validated structured-output tool
result as the terminal result of a BGS structured worker. The second failure is
architectural: a fourth model repeats accepted text and makes one large output
the sole completion point. Retry, watchdog and prompt changes retain that
failure mode and are not part of this design.

## Approaches Considered

### Selected: complete lane conflicts plus deterministic assembly

Each of the three Reviewer lanes returns complete, repair-ready conflicts.
BGS assembles the three packets without semantic rewriting. This preserves
parallelism, eliminates the largest structured generation and keeps BGS inside
its validation and persistence boundary.

### Rejected: retain a smaller semantic merge Agent

A merge Agent would still need to decide equivalence, could discard distinct
defects and would remain another remote completion point. The product does not
need semantic merging; exact repeats can be removed deterministically.

### Rejected: chunk or retry the fourth synthesis

Chunking adds state, recovery and partial-output contracts. Retrying repeats
the most expensive operation and does not address silent upstream interruption.
Both retain the wrong ownership boundary.

## Reviewer Topology

Exactly three model-backed Reviewer tasks remain:

1. `core-design` owns GDD, level/scene and balance;
2. `technical-assets` owns technical design and asset plan;
3. `presentation` owns art direction, UI/UX and audio.

There is no `synthesis` Reviewer role, dispatch, prompt, worker terminal or UI
task. All three lanes run concurrently and read only their owned documents plus
their accepted authority projection.

## Complete Lane Contract

Each lane packet is revision-bound and contains at most eight conflicts. Every
conflict contains exactly:

```text
ownerPath
title
problem
evidence[] { path, location, observed }
requiredOutcome
changes[] { path, action }
acceptance[]
```

The Reviewer must emit `changes` in canonical Foundation document order.
`ownerPath` must equal its first path, and the emitting lane must own
`ownerPath`. BGS rejects an unsorted value instead of rewriting it.
This gives every cross-document defect one deterministic reporting owner and
prevents the same defect being intentionally reported by two lanes.

Every conflict must already tell a repair worker what is wrong, where the proof
is, which document bytes must change, the shared required outcome and how to
verify completion. Lanes do not draft replacement prose and do not modify
documents.

## Deterministic Assembly

After all three packets are accepted for the same current document revision,
BGS performs one local assembly operation:

1. reread and verify all three packet bytes and persisted digests;
2. validate packet revision, lane identity, evidence authority and conflict
   ownership;
3. visit packets in fixed order `core-design`, `technical-assets`,
   `presentation`, preserving conflict order inside each packet;
4. compute a canonical fingerprint from the complete conflict value excluding
   its eventual ID;
5. retain the first byte-equivalent canonical conflict for each fingerprint;
6. assign `B1`, `B2`, ... in the resulting order;
7. derive `READY` only when the list is empty, otherwise derive
   `NEEDS_REVISION`;
8. validate the assembled v3 object and atomically persist `review.json`.

Exact deduplication never compares only titles or evidence locations and never
combines fields. Similar wording, overlapping evidence or related outcomes are
not sufficient to delete an item. This avoids silently merging distinct
defects. The deterministic ownership rule is the primary duplicate prevention;
fingerprinting is only a final guard for exact repeats.

## Identity and Failure Semantics

- Assembly is allowed only after all three lane packets are committed for the
  same active revision.
- A changed document revision, packet digest, lane identity or projection
  authority fails closed and produces no final report.
- An invalid owner path, unsorted/duplicate change path, malformed evidence or
  incomplete repair contract fails the responsible lane.
- Existing committed lane siblings survive retry; only a failed lane is
  redispatched.
- Assembly contains no remote model call and is safe to repeat: identical
  packet bytes produce identical `review.json` bytes and digest.
- v2 reports and legacy verification fields remain rejected. No fallback,
  migration or dual execution path is introduced.

## BGS Boundary

BGS may validate identities, verify digests, apply the fixed lane/item order,
remove exact duplicates, assign mechanical IDs, derive the verdict and
atomically persist bytes. BGS may not invent a conflict, rewrite model-authored prose, choose
between semantically similar findings, repair invalid lane output or modify the
eight source documents.

The native core and provider protocol remain unchanged.

## Workflow and Dashboard

The Foundation Review stage exposes three tasks, not four. The Dashboard shows
each lane as pending, reviewing, reviewed or failed. When all three are
reviewed, deterministic assembly either completes the stage or surfaces its
exact validation failure. No separate “blocking issue synthesis” task or Agent
status remains.

`NEEDS_REVISION` remains a terminal review outcome for this clean-slate scope.
Chrome acceptance stops after displaying the accepted report and does not start
any remediation logic.

## Test and Acceptance Contract

Implementation uses red-green-refactor and must prove:

- every lane conflict is complete and owned by its lane;
- the old candidate-only packet and all `synthesis` contracts are rejected or
  absent;
- three valid packets assemble to canonical v3 bytes with stable IDs, order,
  verdict and digest;
- exact duplicate conflicts retain the first item without merging;
- similar but non-identical conflicts are both preserved;
- stale packets, changed digests, missing lanes and invalid ownership fail
  before `review.json` is committed;
- retry preserves completed siblings and redispatches only a failed lane;
- the Dashboard renders exactly three Reviewer tasks;
- focused backend, frontend, typecheck and diff checks pass.

Chrome acceptance uses an unchanged copy of the accepted eight-document
project. It must complete all three lanes, persist one v3 `review.json`, retain
all eight source hashes, show no synthesis task, and stop before remediation.
