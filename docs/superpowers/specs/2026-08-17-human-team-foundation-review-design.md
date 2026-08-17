# Human-Team Foundation Review Design

## Status

Approved direction. This specification replaces every Foundation Reviewer
design dated 2026-08-16 and the earlier 2026-08-17 worker-pipeline design.

## Goal

Review the eight canonical game documents the way a human game-development
team works: three discipline owners each deeply review one disjoint document
group, read only contracted cross-group excerpts, emit a short issue list, and
then let one synthesis worker deduplicate those lists without rereading all
eight documents.

The review gate reports only defects that can change gameplay, implementation,
production, or acceptance. It is not a prose-quality audit or a second document
authoring stage.

## Non-Negotiable Boundaries

- Bee Game Studio routes immutable paths, extracts contract-declared source
  ranges, validates schemas/digests/revisions, persists state, and displays
  tasks.
- Review workers alone decide whether a semantic conflict exists.
- Bee Game Studio does not summarize documents, invent findings, merge semantic
  claims, write repairs, choose a Reviewer's read/search sequence, or modify the
  native runtime core. It may declare the Reviewer role's fixed read-only
  capability envelope; that envelope is not a content-generation policy.
- There is one Reviewer execution path, one canonical `review.json`, one
  remediation state, and one verification pass. No compatibility execution
  branch or hidden fallback remains.
- The existing Workflow Card and Task interaction remain authoritative. No
  Reviewer-specific card, workbench, role panel, token panel, or second task
  system is introduced.

## Human-Team Review Topology

Initial review launches three independent workers concurrently:

| Review task | Full documents owned by the worker |
| --- | --- |
| `review:core-design` | `GDD.md`, `LEVEL_SCENE_DESIGN.md`, `BALANCE_DESIGN.md` |
| `review:technical-assets` | `TECHNICAL_DESIGN.md`, `ASSET_PLAN.md` |
| `review:presentation` | `ART_DIRECTION.md`, `UI_UX_SPEC.md`, `AUDIO_DESIGN.md` |

These groups are the same exclusive ownership groups already used by
Foundation remediation. One shared constant defines both review and repair
ownership.

Each canonical document is therefore fully assigned exactly once across the
initial review. No worker receives all eight documents.

After all three packets commit, one `review:synthesis` worker reads only those
packets. It removes duplicates, confirms shared outcomes, and writes the sole
canonical version 2 `review.json`. It does not perform another complete source
review.

## Reviewer Capability Boundary

Every Foundation Reviewer process receives the native `Read`, `Grep`, and
`Glob` tools plus the internal `StructuredOutput` channel created by
`--json-schema`. It does not receive mutation tools, shell execution, or Agent
launch capability.

This is a least-privilege role contract, not workflow-owned reasoning. The
Reviewer decides what to read within its immutable assignment, how to analyze
the evidence, and which semantic conflicts to report. Bee Game Studio only
declares the read-only capability set, project-confined source paths, schema,
revision, and output destination. It never dictates individual tool calls or
creates semantic fallback results.

The read-only capability boundary is required even when project permissions
automatically approve requests. Direct workflow path checks cover native file
mutation tools but do not turn arbitrary shell execution into a read-only
operation. Removing the Reviewer capability boundary without an equivalent
process-level read-only sandbox would therefore permit mutation outside the
Reviewer contract.

## Cross-Group Evidence

Each discipline worker also receives one immutable projection file containing
only sections that existing `GameDocumentContract.upstreamSections` declare as
inputs to its owned documents and that live outside its own group.

Projection is mechanical:

- select `(path, sectionId)` pairs from the existing contracts;
- deduplicate them in canonical byte order;
- extract bytes between existing section markers;
- record line range and SHA-256 digest;
- bind the projection to the current Foundation revision.

Bee Game Studio does not interpret or summarize those bytes. The projection is
review input metadata, not document authority and not a second document format.

## Review Scope

A worker reports a candidate only when it proves at least one of these defects:

1. incompatible gameplay rules, states, transitions, outcomes, or recovery;
2. conflicting enumeration, cardinality, value, formula, unit, bound, or budget;
3. missing or duplicated authority ownership;
4. owner-to-consumer or cross-discipline interface mismatch;
5. production, runtime, asset, UI, art, audio, accessibility, or acceptance
   requirements that make the authorized game impossible or ambiguous to ship;
6. an unresolved dependency or assumption that blocks a unique implementation
   or acceptance result.

Workers ignore prose style, harmless redundancy, optional clarification,
editorial quality, non-blocking polish, correct-content summaries, and requests
for additional detail that do not change implementation or acceptance.

## Bounded Evidence Packets

The two-role `contract-specialist` / `integration-specialist` protocol is
deleted. It is replaced by three lane packets:

```ts
type FoundationReviewLaneId =
  | 'core-design'
  | 'technical-assets'
  | 'presentation'

type FoundationReviewLanePacket = {
  version: 1
  scope: 'foundation'
  revision: string
  lane: FoundationReviewLaneId
  candidates: Array<{
    title: string
    problem: string
    evidence: Array<{
      path: FoundationDocumentPath
      location: string
      observed: string
    }>
    blockingReason: string
  }>
}
```

Packets contain at most 8 highest-priority candidates. Acceptance verifies that
every evidence path belongs to the lane's full documents or contracted
projection and that the packet is bound to the accepted source revision and
projection digest. `observed` is the Reviewer's bounded calculation or
cross-section observation, not a required verbatim quote. Invalid authority or
stale evidence fails the owning task; Bee Game Studio never interprets or
repairs review semantics.

Packets contain no verdict, replacement prose, correct-item summary,
non-blocking register, coverage narrative, or preservation list.

## Canonical Review and Repair

The existing strict version 2 `review.json`, byte-bound acceptance, revision
checks, digest checks, conflict shape, exclusive three repair lanes, lane
receipts, and delivery gate remain.

`NEEDS_REVISION` creates only affected repair tasks:

- `repair:core-design`
- `repair:technical-assets`
- `repair:presentation`

They run concurrently and retain their existing exclusive write ownership.
After all required receipts commit, the same three disjoint responsibility
lanes verify only the prior conflicts that touch their owned documents. Each
lane reads its 2–3 owned documents, the prior review and one dependency
projection, then emits one bounded verification packet. A lightweight
`synthesis` unit reads only the prior review and the three packets. It closes a
cross-lane conflict only when every responsible lane reports it closed. It
never reads all eight canonical documents or starts another full review. If
the first verification still reports actionable conflicts, those exact
conflicts create one final targeted repair pass followed by one final
three-lane verification. Attempt three is terminal: `READY` advances and
`NEEDS_REVISION` stops as `needs_action`. This bounded loop prevents both a
premature manual stop and an unbounded repair cycle.

## State and Recovery

Initial review state contains exactly four ordered units:

1. `core-design`
2. `technical-assets`
3. `presentation`
4. `synthesis`

Verification state uses the same four ordered units. This is one execution
topology with a mode-specific packet contract, not a second Reviewer path.

Every unit persists status, dispatch, path, digest, duration, usage, and exact
failure. Explicit retry resets only failed units. Accepted siblings are reused.
Synthesis starts only after all three packet digests are accepted. Source or
projection revision changes invalidate the complete initial review.

Schema 22 snapshots are migrated once to schema 24. In-flight or unsuccessful
old Reviewer state and remediation state are discarded and restarted from the
current canonical document revision. Completed delivery runs retain their
delivery result but do not retain an executable old Reviewer state. No runtime
parser or adapter for old specialist packets remains after migration.
Schema 23 snapshots with the removed single verification worker are migrated
once into the three verification lanes plus synthesis, preserving prior-review
and remediation authority while discarding the failed single-worker dispatch.

## Workflow Card

The current Reviewer-specific block in `WorkflowStageCard` is deleted.
Foundation review uses the existing standard `tasks` projection and existing
Task icons:

- completed: check;
- running: spinner;
- pending: empty circle;
- failed: red failure icon with exact reason;
- stopped: stopped icon.

During initial review the Task list shows three discipline review tasks and one
conflict synthesis task. During remediation it shows the three repair tasks and
one user-facing verification Task. The three internal verification lanes remain
aggregated behind that Task so workflow mechanics do not leak into Dashboard.

The main card does not show roles, packet names, JSON, revision, digest,
per-worker token metrics, evidence prose, or a separate conflict panel. The
normal workflow message states the current result and problem count. Existing
global usage UI remains the sole token/credit display.

## Required Removal

Delete rather than retain:

- `contract-specialist` and `integration-specialist` role types, prompts,
  schemas, paths, state transitions, tests, API fields, and UI labels;
- the current two-specialist all-eight-document assignment;
- `foundation-review-evidence.ts` and its role-specific tests, replaced by the
  lane packet module;
- the `foundationReview` frontend/API display projection and the entire custom
  rendering block in `WorkflowStageCard`;
- obsolete Reviewer design and plan documents dated 2026-08-16 and the
  superseded 2026-08-17 worker-pipeline design/plan;
- tests that assert raw role rows, per-role token display, a custom conflict
  panel, or empty review tasks;
- any old packet conversion, alias, fallback, feature flag, or dual dispatch
  route found by the final static audit.

Retain and reuse:

- strict canonical `foundation-review.ts` version 2 authority;
- revision/digest/tamper protection;
- exact failure persistence and failed-only retry;
- three exclusive remediation lanes and receipts;
- current Task list component and icons;
- deterministic checklist and Resource gates.

## Acceptance

Automated tests must prove:

- the three initial review assignments have disjoint full-document sets whose
  union is exactly the eight canonical documents;
- no review assignment contains all eight documents;
- cross-group projections contain only contract-declared sections and are
  revision/digest bound;
- synthesis receives only three accepted packets;
- source and packet tampering fail closed;
- only affected repair tasks appear and run concurrently;
- verification does not rerun initial workers;
- failed-only retry and restart preserve accepted siblings;
- API and Workflow Card expose ordinary Tasks and no `foundationReview` custom
  object;
- no production reference remains to either old specialist role or obsolete
  Reviewer protocol files.

Chrome acceptance must use Web/React on a copy of an already completed
eight-document project. It records wall time, input, cache input, output,
credit, compaction, full document Read count, projected bytes, packet/report
digests, and final task states. Acceptance requires exactly eight full-document
assignments across the three initial workers, no worker context compaction,
natural Task checkmarks in the existing Workflow Card, and a semantically
actionable canonical `review.json`. Runtime evidence must also prove that each
Reviewer process exposes only `Read`, `Grep`, `Glob`, and the internal
`StructuredOutput` channel, while document-author and remediation processes
retain their normal native tool inventory.

## Design Self-Review

- The design has one runtime path and deletes the rejected role-based topology.
- Review and repair use one shared ownership map, preventing assignment drift.
- Every document is deeply reviewed once; cross-group overlap is bounded by
  existing contracts rather than model-selected whole-document rereads.
- Bee Game Studio performs only deterministic routing and validation.
- The UI reuses the established Task system and adds no new interaction model.
- No native-core change, example-specific rule, automatic API retry, document
  checkpoint control, or semantic fallback is introduced.
