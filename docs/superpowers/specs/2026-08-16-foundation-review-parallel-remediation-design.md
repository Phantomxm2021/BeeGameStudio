# Foundation Review Parallel Remediation Design

## Status

Approved in conversation; written specification pending user review.

This design revises the remediation workflow in
`2026-08-16-foundation-review-json-convergence-design.md`. The existing
canonical `review.json`, byte-bound review authority, one semantic remediation
cycle, and one verification review remain authoritative. This document replaces
only the earlier decision to use one coordinated remediation Agent.

## Goal

Reduce Foundation review and repair wall-clock time without letting BGS author,
merge, reinterpret, or correct game-document content.

The workflow is:

1. one parent Reviewer with two native read-only review subagents;
2. one canonical `review.json` committed by the parent Reviewer;
3. three isolated top-level remediation Agents running concurrently;
4. one final Reviewer over the current bytes of all eight documents.

There is no second automatic semantic remediation cycle.

## Scope

This design changes only Foundation review execution, Foundation remediation
dispatch, workflow mutation permissions, recovery state, and the corresponding
Dashboard projection.

It does not change:

- initial document generation;
- the canonical eight Foundation document paths;
- native Agent core code or native Write/Edit behavior;
- model configuration;
- the canonical Foundation review JSON schema except for tightening actionable
  instruction semantics;
- later implementation, resource, or acceptance workflows.

## BGS Boundary

BGS may:

- start and supervise workflow Agents;
- assign immutable document-path ownership;
- validate schemas, revisions, digests, receipts, and exact mutation paths;
- persist workflow state;
- retry failed execution units;
- render structured state in the Dashboard.

BGS may not:

- identify or resolve document conflicts;
- merge Reviewer opinions;
- choose an authority outcome;
- write or rewrite document content;
- generate editing checkpoints;
- split document prose into chunks;
- modify native Agent core behavior.

The parent Reviewer, remediation Agents, and final Reviewer remain responsible
for all semantic judgment and document writing.

## Review Execution

BGS dispatches one top-level Foundation Reviewer. Within its native session the
Reviewer uses two read-only subagents to parallelize analysis:

- **Contract specialist:** authority, enumeration, cardinality, states,
  transitions, arithmetic, units, formulas, and budgets.
- **Integration specialist:** ownership, consumers, production closure, asset
  closure, presentation mappings, assumptions, external dependencies, and
  duplicate facts that can drift.

The parent Reviewer reads the same eight documents, reconciles specialist
findings, removes duplicates, resolves disagreements, and performs the final
coverage pass. Only the parent may commit the single canonical `review.json`.

The subagents are native read-only analysis tasks. Their existing Agent
definitions expose only read/search tools and exclude file mutation tools. They
receive no durable review-artifact authority. BGS does not parse or merge their
intermediate responses. This uses the existing native Agent-definition tool
profile and requires no native core change.

## Actionable Conflict Contract

The existing version 2 `review.json` remains the only durable review artifact.
Every conflict must provide exactly one implementable authority outcome:

- `problem` states the contradiction or missing contract;
- `evidence` identifies the current source locations and observed values;
- `requiredOutcome` states one final authority decision;
- each `changes[]` entry identifies one canonical path and the exact semantic
  change required there;
- `acceptance[]` states objective checks that prove closure.

The following are invalid:

- alternative outcomes such as “use A or B”;
- advice without a required outcome;
- replacement prose for an entire document;
- review introductions, conclusions, coverage narratives, or correct-item
  summaries;
- conflicts that do not identify every path that must change.

BGS validates shape, path membership, identity, revision, and digest. It never
rewrites a conflict to make it actionable.

## Remediation Lanes

When the accepted review verdict is `NEEDS_REVISION`, BGS creates exactly three
top-level remediation lanes:

| Lane | Owned paths |
| --- | --- |
| `core-design` | `docs/GDD.md`, `docs/LEVEL_SCENE_DESIGN.md`, `docs/BALANCE_DESIGN.md` |
| `technical-assets` | `docs/TECHNICAL_DESIGN.md`, `docs/ASSET_PLAN.md` |
| `presentation` | `docs/ART_DIRECTION.md`, `docs/UI_UX_SPEC.md`, `docs/AUDIO_DESIGN.md` |

A lane is dispatched only when at least one accepted conflict change targets one
of its owned paths. Each dispatched Agent receives:

- the immutable accepted `review.json` path and digest;
- the complete review authority, not a BGS-authored summary;
- its exact owned mutation paths;
- the current Foundation revision and current digests for its owned files;
- read access to all eight Foundation documents.

Each Agent applies only `changes[]` entries whose path it owns while respecting
the shared `requiredOutcome`. Cross-lane conflicts are safe because all lanes
read the same immutable authority decision; BGS does not decompose or reinterpret
the conflict.

Each lane has its own dispatch, transcript, status, failure reason, and committed
receipt. A lane receipt records its review digest, source revision, owned paths,
and before/after file digests. Duplicate successful receipts are idempotent. A
conflicting receipt is rejected.

## Exact Mutation Boundary

Parallel remediation is forbidden until workflow mutation permissions enforce
`workflowAllowedPaths` exactly.

For a workflow worker:

- a native file mutation targeting an exact authorized path is allowed;
- a project-local mutation outside the worker's authorized paths is denied;
- a mutation outside the project is denied;
- an ambiguous or unresolvable mutation target is denied;
- denial returns immediately and is persisted as an explicit workflow failure;
- denial never becomes an invisible pending permission request.

Path comparison uses resolved project-confined paths and rejects symlink or
prospective-path escapes. Multi-path mutation tools are accepted only when every
target is authorized. This workflow path contract is more specific than the
general project permission setting and applies only to the dispatched workflow
task.

Interactive, non-workflow sessions retain their existing project permission
behavior.

## Coordination and State

Foundation remediation state persists:

- accepted review path and digest;
- source Foundation revision;
- three deterministic lane definitions;
- each lane's status, dispatch ID, owned paths, receipt, and exact failure;
- the resulting Foundation revision after all required lanes complete.

Lane states are `not_required`, `pending`, `running`, `completed`, and `failed`.
An unaffected lane is persisted as `not_required`; it has no dispatch or
receipt and does not participate in the completion barrier.

Routing rules:

1. Dispatch every required pending lane concurrently.
2. Do not start verification while any required lane is pending, running, or
   failed.
3. An explicit retry resets only failed lanes to pending and preserves completed
   lane receipts.
4. Before verification, reread all eight files and recompute the current
   Foundation revision.
5. Reject completion if a completed lane's owned-file digests no longer match
   its receipt.
6. Dispatch exactly one final Reviewer with the new revision and the prior
   byte-bound `review.json`.
7. If the final verdict is still `NEEDS_REVISION`, stop at `needs_action`.

A restart reconstructs lane state from persisted dispatches and receipts. It
does not infer completion from file modification times or from Agent text.

## Dashboard

The Dashboard renders structured workflow state rather than raw JSON or a
Markdown report.

The Foundation review card shows:

- review status and conflict count;
- expandable conflict rows containing problem, evidence, required changes, and
  acceptance criteria;
- three remediation lanes with status, owned affected files, elapsed time, and
  exact failure reason;
- final verification status and prior-conflict closure;
- `ready` or `needs_action` as the terminal semantic state.

Intermediate native subagent responses are not displayed or persisted by BGS.
They are implementation detail inside the parent Reviewer's read-only analysis.

## Failure Handling

- Reviewer process or transport failure: retry the same byte-bound review work.
- Invalid Reviewer JSON: fail the Reviewer dispatch with the original validation
  error; do not synthesize a replacement report.
- Remediation lane failure: preserve successful sibling lanes and retry only the
  failed lane after explicit user action.
- Unauthorized mutation: deny immediately and fail that lane with the exact
  target path and policy reason.
- Source bytes changed outside a lane: reject stale receipt or stale verification
  and require a fresh review authority.
- Final Reviewer still finds conflicts: stop at `needs_action`; do not begin an
  unbounded repair loop.

## Removal of Superseded Behavior

Implementation removes rather than retains compatibility branches for:

- one Agent modifying every affected Foundation document;
- per-document remediation dispatches;
- write-capable remediation subagents;
- long-form `review.md` output;
- BGS-generated conflict summaries or merged decisions;
- project-wide auto-approval for workflow file mutations;
- repeated automatic semantic remediation cycles.

There is one canonical review protocol and one remediation-lane protocol.

## Verification

Implementation follows test-driven development.

Backend tests must prove:

- exact workflow path permission allows only owned paths;
- project-local, project-external, symlink, and multi-target escapes fail without
  a pending approval;
- required lanes dispatch concurrently and empty lanes do not dispatch;
- cross-lane conflicts retain the same immutable review authority;
- successful sibling lanes survive retry of a failed lane;
- verification cannot begin before every required lane has a valid receipt;
- stale document bytes, stale review digests, and conflicting receipts fail
  closed;
- only one semantic remediation cycle occurs.

Frontend tests must prove:

- the conflict list remains structured and actionable;
- each lane status and exact failure is visible;
- final verification and `needs_action` are distinguishable;
- raw JSON and native subagent transcripts are not shown by default.

Final acceptance uses Web/React through Chrome on a copy of the existing completed
eight-document project. It must exercise initial review, concurrent remediation,
and final verification without manually editing the example project. The run
records wall-clock duration, input tokens, cache-input tokens, output tokens,
credits, lane failures, and final document digests. Correctness is the gate;
performance is compared with the existing single-remediation baseline and
reported rather than hidden behind an arbitrary file-size threshold.

## Design Self-Review

- The design has one review authority and no Markdown/JSON dual track.
- BGS routes and validates but never authors or decides document content.
- Read-only subagents cannot own document writes or durable review artifacts.
- Every writer has an independent top-level dispatch and exact path authority.
- Cross-document conflicts retain one immutable semantic decision.
- Recovery and retry operate per persisted lane, not by replaying completed work.
- No native Agent core modification is required.
- No example-specific behavior, MVP path, placeholder, or legacy compatibility
  branch is included.
