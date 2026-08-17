# Human-Team Foundation Review Design

## Status

Accepted current architecture. This specification defines the only Foundation
Reviewer path.

## Goal

Review the eight canonical game documents the way a human game-development
team works: three discipline owners each deeply review one disjoint document
group, read only contracted cross-group excerpts, emit a bounded issue packet,
and then let one synthesis worker deduplicate those packets without rereading
all eight documents.

The review gate reports only defects that can change gameplay, implementation,
production, or acceptance. It is not a prose-quality audit, a document-writing
stage, or an entry point to automatic repair.

## Authority Boundary

- Bee Game Studio routes immutable paths, extracts contract-declared source
  ranges, validates schemas, digests, and revisions, persists state, and
  displays tasks.
- Review workers alone decide whether a semantic conflict exists.
- Bee Game Studio does not summarize documents, invent findings, merge semantic
  claims, write documents, choose a Reviewer's read/search sequence, or modify
  the native runtime core.
- There is one Reviewer execution path and one canonical `review.json`.
- The existing Workflow Card and Task interaction remain authoritative. No
  Reviewer-specific card, workbench, role panel, token panel, or second task
  system is introduced.

## Review Topology

Initial review launches three independent workers concurrently:

| Review task | Full documents owned by the worker |
| --- | --- |
| `review:core-design` | `GDD.md`, `LEVEL_SCENE_DESIGN.md`, `BALANCE_DESIGN.md` |
| `review:technical-assets` | `TECHNICAL_DESIGN.md`, `ASSET_PLAN.md` |
| `review:presentation` | `ART_DIRECTION.md`, `UI_UX_SPEC.md`, `AUDIO_DESIGN.md` |

Each canonical document is assigned in full exactly once. No worker receives
all eight documents.

After all three packets commit, `review:synthesis` reads only those packets. It
deduplicates findings, resolves shared outcomes, and writes the sole canonical
version 2 `review.json`. It does not perform another complete source review.

## Reviewer Capability Boundary

Every Foundation Reviewer process receives native `Read`, `Grep`, and `Glob`
plus the internal `StructuredOutput` channel created by `--json-schema`. It
does not receive mutation tools, shell execution, or Agent launch capability.

This is a least-privilege role contract, not workflow-owned reasoning. The
Reviewer decides what to read within its immutable assignment, how to analyze
the evidence, and which semantic conflicts to report. Bee Game Studio declares
only the capability set, project-confined source paths, schema, revision, and
output destination. It never dictates individual tool calls or creates
semantic substitute results.

## Cross-Group Evidence

Each discipline worker also receives one immutable projection containing only
sections that existing `GameDocumentContract.upstreamSections` declare as
inputs to its owned documents and that live outside its own group.

Projection is mechanical:

- select `(path, sectionId)` pairs from the existing contracts;
- deduplicate them in canonical byte order;
- extract bytes between existing section markers;
- record line range and SHA-256 digest;
- bind the projection to the current Foundation revision.

Bee Game Studio does not interpret or summarize those bytes. The projection is
review input metadata, not document authority or a second document format.

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

The three discipline tasks emit `FoundationReviewLanePacket` version 1. Each
packet is bound to one lane, the accepted source revision, and its projection
digest, and contains at most eight highest-priority candidates. Evidence paths
must belong to the lane's full documents or contracted projection.

Packets contain no verdict, replacement prose, correct-item summary,
non-blocking register, coverage narrative, or preservation list. Invalid
authority or stale evidence fails the owning task; Bee Game Studio does not
interpret or repair review semantics.

## Canonical Report and Terminal Verdict

Synthesis produces the strict version 2 `review.json`. Byte-bound acceptance,
revision checks, digest checks, conflict shape, and source tamper protection
remain mandatory.

The accepted verdict is terminal for the Reviewer stage:

- `READY` advances to the existing checklist stage.
- `NEEDS_REVISION` preserves the accepted report, sets the workflow to the
  generic `needs_action` status, and dispatches no further work.

No Reviewer worker writes a canonical source document. No document-author,
repair, verification, or retry dispatch may be created from an accepted
`NEEDS_REVISION` report.

## State, Recovery, and Retry

Reviewer state contains exactly four ordered units:

1. `core-design`
2. `technical-assets`
3. `presentation`
4. `synthesis`

Every unit persists status, dispatch, path, digest, duration, usage, and exact
failure. Explicit retry resets only failed incomplete units; accepted siblings
are reused. Synthesis starts only after all three packet digests are accepted.
Source or projection revision changes invalidate the complete review.

Current snapshots contain only initial Reviewer state. Snapshots containing
removed post-report execution state are rejected rather than migrated or
projected.

## Workflow Card

Foundation review uses the existing standard `tasks` projection and Task icons:

- completed: check;
- running: spinner;
- pending: empty circle;
- failed: red failure icon with exact reason;
- stopped: stopped icon.

The Task list shows the three discipline review tasks and one conflict
synthesis task. The main card does not show packet names, raw JSON, revision,
digest, evidence prose, or a separate conflict panel. Existing global usage UI
remains the sole token and credit display.

## Acceptance

Automated and Chrome acceptance must prove:

- the three initial assignments have disjoint full-document sets whose union is
  exactly the eight canonical documents;
- no assignment contains all eight documents;
- projections contain only contract-declared sections and are revision/digest
  bound;
- synthesis receives only three accepted packets;
- source and packet tampering fail closed;
- the four ordinary Reviewer tasks remain the only Reviewer task projection;
- Reviewer processes expose only `Read`, `Grep`, `Glob`, and internal
  `StructuredOutput`;
- a schema-valid `NEEDS_REVISION` report ends in `needs_action` with no later
  repair or verification dispatch;
- all eight source-document SHA-256 values remain unchanged.

## Design Self-Review

- The design has one Reviewer runtime path and one canonical report.
- Every document is deeply reviewed once; cross-group overlap is bounded by
  existing contracts rather than model-selected whole-document rereads.
- Bee Game Studio performs deterministic routing and validation only.
- The accepted verdict has one explicit workflow outcome and cannot begin
  post-report document mutation.
- The UI reuses the established Task system and adds no new interaction model.
- No native-core change, example-specific rule, feature flag, adapter, alias,
  migration, or dual dispatch route is introduced.
