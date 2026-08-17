# Human-Team Foundation Review Design

## Status

Accepted current architecture. This specification defines the only Foundation
Reviewer path.

## Goal

Review the eight canonical game documents the way a human game-development
team works: three discipline owners each deeply review one disjoint document
group, read only contracted cross-group excerpts, and emit bounded, complete
Markdown issue records. One synthesis worker then classifies those records by
stable reference without rereading the eight documents or rewriting issue
content. Bee Game Studio deterministically assembles the selected records into
the sole canonical `review.json`.

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
- Reviewer-authored Markdown is immutable input evidence, not a second final
  report. Only the derived `review.json` drives workflow state and remediation.
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

After all three lane receipts commit, `review:synthesis` reads only those
receipts. It
classifies every candidate as keep, duplicate, or reject by stable candidate
reference. It does not merge or rewrite findings and does not perform another
complete source review.

Bee Game Studio then parses the four Markdown receipts, copies every kept
candidate without semantic modification, assigns canonical `B1`, `B2`, ...
identifiers in bytewise order, derives the verdict, validates the complete
object with the canonical review schema, and atomically persists `review.json`.

## Reviewer Capability Boundary

Every Foundation Reviewer process receives native `Read`, `Grep`, and `Glob`.
It returns its contracted Markdown receipt through the native final text
stream. It does not receive mutation tools, shell execution, Agent launch
capability, `StructuredOutput`, or `--json-schema`.

This is a least-privilege role contract, not workflow-owned reasoning. The
Reviewer decides what to read within its immutable assignment, how to analyze
the evidence, and which semantic conflicts to report. Bee Game Studio declares
only the capability set, project-confined source paths, Markdown grammar,
revision, and output destination. It never dictates individual tool calls or
creates semantic substitute results.

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

## Markdown Receipt Contract

The three discipline tasks emit immutable Markdown lane receipts. Each receipt
is bound to one lane, the accepted source revision, and its projection digest,
and contains at most eight highest-priority candidates. Evidence paths must
belong to the lane's full documents or contracted projection.

Each candidate is complete enough to become a remediation task without later
model expansion. Its strict heading structure contains:

- stable lane-local candidate reference;
- problem;
- one or more evidence items, each with path, stable location, and bounded
  observation;
- required outcome;
- one or more changed path/action entries; distinct actions may target the
  same document;
- one or more mechanically checkable acceptance conditions.

Receipts contain no verdict, replacement prose, correct-item summary,
non-blocking register, coverage narrative, preservation list, or duplicated
full-document content. A Markdown table is forbidden because cell separators,
multiline evidence, inline code, and long observations make it ambiguous to
parse. The contract uses headings and lists parsed through a Markdown syntax
tree, never regular-expression extraction.

The required shape is:

```markdown
# Foundation Review Packet

Revision: `<64-hex-revision>`
Lane: `<core-design|technical-assets|presentation>`
Projection: `<64-hex-projection-digest>`

## `<lane>:C1` — `<title>`

### Problem
`<why implementation or acceptance is blocked>`

### Evidence
- Path: `<canonical-project-relative-path>`
  Location: `<stable-heading-table-row-or-locator>`
  Observed: `<bounded-observation>`

### Required outcome
`<one unambiguous outcome>`

### Changes
- Path: `<canonical-project-relative-path>`
  Action: `<required change>`

### Acceptance
- `<mechanically-checkable-condition>`
```

Invalid structure, stale identity, out-of-scope paths, duplicate references,
or missing required fields fails the owning task with the exact parse or
validation error. Bee Game Studio does not interpret or repair the prose.

## Synthesis Selection Contract

The synthesis worker receives exactly the three accepted Markdown lane
receipts and their digests. It emits one compact Markdown selection receipt.
The native response may place a contiguous ordinary-paragraph preface before
the receipt H1. That preface is preserved byte-for-byte but is never parsed as
review authority. Headings, lists, quotes, code, HTML, tables, or any other
block type are forbidden before the unique receipt H1, and no content may
follow the receipt.

```markdown
# Foundation Review Selection

Revision: `<64-hex-revision>`

## Keep
- `<lane>:C1`

## Duplicate
- `<lane>:C2` -> `<kept-lane>:C1`

## Reject
- `<lane>:C3`
```

Every candidate reference must occur exactly once across `Keep`, `Duplicate`,
and `Reject`. A duplicate target must be retained by `Keep`. Similar findings
are never merged or rewritten: synthesis chooses one complete source record.
If two findings require materially different outcomes or changes, both remain
kept. Rejection means the candidate does not meet the blocking-review scope;
it does not create a non-blocking issue register. The selection receipt is
invalid unless it accounts for all candidates, so synthesis cannot silently
omit a finding.

## Canonical Report and Terminal Verdict

The deterministic local assembler produces the strict canonical `review.json`.
It performs only these mechanical operations:

1. parse the three lane receipts and selection receipt through a Markdown AST;
2. validate revision, projection, receipt digests, references, path authority,
   candidate limits, and exact candidate accounting;
3. copy retained candidate fields without summarizing, combining, or rewriting;
4. order retained references bytewise and assign `B1`, `B2`, ...;
5. derive `READY` from an empty retained set and `NEEDS_REVISION` otherwise;
6. validate the result with the canonical review schema;
7. atomically persist canonical JSON and its digest.

Byte-bound acceptance, revision checks, digest checks, conflict shape, and
source tamper protection remain mandatory. Lane Markdown and selection
Markdown remain audit receipts only. There is no independently authored final
`review.md`, and Dashboard rendering reads `review.json`.

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

Every unit persists status, dispatch, Markdown receipt path, digest, duration,
usage, and exact failure. Explicit retry resets only failed incomplete units;
accepted siblings are reused. Synthesis starts only after all three receipt
digests are accepted. Source or projection revision changes invalidate the
complete review.

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
synthesis task. The main card does not show receipt names, raw Markdown, raw
JSON, revision, digest, evidence prose, or a separate conflict panel. Existing
global usage UI remains the sole token and credit display.

## Failure Semantics

- A malformed or incomplete Markdown receipt fails once with its exact
  structural error; Bee Game Studio does not silently repair it.
- A missing native terminal, truncated text stream, or stale digest fails the
  owning task and never produces partial canonical JSON.
- There is no automatic API retry loop and no JSON fallback route.
- A local parse, validation, or atomic-persistence failure is distinct from a
  Reviewer semantic result and is surfaced unchanged.

## Removed Architecture

The implementation must delete, rather than retain behind flags or adapters:

- Reviewer `StructuredOutput` and Reviewer `--json-schema` wiring;
- JSON lane-packet prompts, parsing, and staging paths;
- synthesis instructions that regenerate a complete conflict object;
- any Markdown/JSON fallback or migration route for an active review;
- redundant Reviewer projection `content` copies that duplicate accepted
  source or issue bytes.

Historical completed reports may remain readable as immutable project data,
but cannot select an executable legacy Reviewer path.

## Acceptance

Automated and Chrome acceptance must prove:

- the three initial assignments have disjoint full-document sets whose union is
  exactly the eight canonical documents;
- no assignment contains all eight documents;
- projections contain only contract-declared sections and are revision/digest
  bound;
- all four Reviewer turns use ordinary streamed final Markdown and never
  receive `StructuredOutput` or `--json-schema`;
- each lane receipt includes the complete fields needed for deterministic
  canonical assembly;
- synthesis receives only three accepted Markdown receipts and emits only the
  compact selection grammar;
- every candidate is accounted for exactly once and duplicate targets are kept;
- the assembler never semantically merges or rewrites candidate content;
- table separators, inline code, Unicode text, and multiline evidence cannot
  confuse parsing because tables are rejected and parsing uses a Markdown AST;
- repeated assembly of identical receipts is byte-identical;
- malformed, truncated, stale, duplicate, out-of-scope, and tampered receipts
  fail before canonical persistence;
- source and receipt tampering fail closed;
- the four ordinary Reviewer tasks remain the only Reviewer task projection;
- Reviewer processes expose only `Read`, `Grep`, and `Glob`;
- a schema-valid `NEEDS_REVISION` report ends in `needs_action` with no later
  repair or verification dispatch;
- all eight source-document SHA-256 values remain unchanged.

## Design Self-Review

- The design has one Reviewer runtime path and one canonical report.
- Every document is deeply reviewed once; cross-group overlap is bounded by
  existing contracts rather than model-selected whole-document rereads.
- Bee Game Studio performs deterministic routing and validation only.
- Models author semantic issue content exactly once. Synthesis selects stable
  references; it does not repeat the expensive content-generation work.
- Ordinary Markdown text streaming avoids the proven large
  `StructuredOutput` `input_json_delta` failure boundary, while compact
  synthesis bounds the remaining terminal output.
- The accepted verdict has one explicit workflow outcome and cannot begin
  post-report document mutation.
- The UI reuses the established Task system and adds no new interaction model.
- No native-core change, example-specific rule, feature flag, adapter, alias,
  migration, or dual dispatch route is introduced.
