# Foundation Review Worker Pipeline Design

## Status

Approved in conversation; written specification pending user review.

This specification replaces the Reviewer execution design in
`2026-08-16-foundation-review-parallel-remediation-design.md`. The existing
canonical Foundation documents, version 2 `review.json`, exact mutation-path
authority, three remediation lanes, byte-bound receipts, and one verification
review remain authoritative. The parent-Reviewer/native-subagent design and
the checklist/complete Markdown Reviewer framework are superseded and must be
removed rather than retained as compatibility paths.

## Goal

Provide one reliable Reviewer pipeline for the eight canonical Foundation
documents that finds actionable cross-document conflicts, repairs them in
parallel, and verifies the resulting bytes without depending on model-context
state for orchestration.

The pipeline must reduce repeated reading and prevent context compaction from
restarting completed work. BGS routes, validates, persists, recovers, and
renders workflow state; Agents remain solely responsible for semantic review
and document editing.

## Canonical Workflow

The only Foundation review workflow is:

1. BGS dispatches `contract-specialist` and `integration-specialist` as two
   independent read-only workflow workers.
2. Each specialist commits one bounded JSON evidence packet bound to the
   current Foundation revision.
3. After both packets are accepted, BGS dispatches one independent `final`
   Reviewer.
4. The final Reviewer reads the two packets and performs targeted source-byte
   verification before committing the sole canonical version 2 `review.json`.
5. `READY` advances to checklist drafting.
6. `NEEDS_REVISION` creates the three deterministic remediation lanes and
   dispatches only affected lanes concurrently.
7. After every required lane commits a valid receipt, BGS dispatches one
   independent verification Reviewer. Verification does not launch
   specialists.
8. Verification `READY` advances to checklist drafting. Verification
   `NEEDS_REVISION` stops at `needs_action`; no second automatic remediation
   cycle exists.
9. Checklist drafting is followed by a deterministic checklist commit gate,
   not another LLM Reviewer.
10. Resource Production is followed by the existing deterministic Resource
    Gate and then Atomic Task Planning, not a comprehensive Markdown Reviewer.

## BGS Boundary

BGS may:

- dispatch independent workflow workers;
- assign immutable read and write paths;
- enforce exact mutation-path ownership;
- validate JSON schemas, identities, revisions, digests, receipts, and state
  transitions;
- persist and recover per-worker state;
- retry explicitly selected failed execution units;
- render structured workflow state and exact failures in the Dashboard.

BGS may not:

- identify, merge, deduplicate, rewrite, prioritize, or resolve semantic
  conflicts;
- choose the final verdict or an authority outcome;
- write or rewrite game-document content;
- manage Reviewer subagents inside a model session;
- generate document checkpoints or control Write/Edit counts;
- convert legacy Markdown reports into canonical JSON;
- infer successful review or remediation from prose, timestamps, or file
  existence alone.

## Review Roles

The Foundation Reviewer has exactly three roles:

- `contract-specialist`: authority, enumeration, cardinality, state and
  outcome totality, arithmetic, units, formulas, budgets, duplicated facts,
  and owner-to-consumer references.
- `integration-specialist`: runtime and production closure, asset ownership,
  art/UI/audio/accessibility mappings, unresolved assumptions, external
  dependencies, and implementer usability.
- `final`: reconciles candidate evidence, rejects unsupported or duplicate
  candidates, verifies exact cited bytes, writes every actionable change and
  acceptance condition, and owns the sole verdict.

The roles are independent top-level workflow workers. They do not use native
Agent, Task, TaskOutput, teams, or background subagents. A specialist cannot
write source documents or a canonical verdict. The final Reviewer cannot
modify source documents or start another worker.

## Specialist Evidence Packet

Each specialist writes one internal evidence file:

```text
.beegame/reviews/foundation/<revision>/parts/contract.json
.beegame/reviews/foundation/<revision>/parts/integration.json
```

The schema is strict and contains only:

```ts
type FoundationReviewCandidate = {
  title: string
  problem: string
  evidence: Array<{
    path: FoundationDocumentPath
    location: string
    observed: string
  }>
  blockingReason: string
}

type FoundationReviewEvidencePacket = {
  version: 1
  scope: 'foundation'
  revision: string
  role: 'contract-specialist' | 'integration-specialist'
  candidates: FoundationReviewCandidate[]
}
```

Each packet is bounded to at most 32 candidates. Field lengths use the same or
stricter bounds as canonical `review.json`. Candidate evidence must cite exact
current source bytes. Packets contain no verdict, conflict ID, required change,
replacement prose, correct-item summary, coverage narrative, preservation
list, or non-blocking register.

Evidence packets are durable workflow inputs, not review authority. No
downstream stage except the final Reviewer reads them. The Dashboard displays
their status, duration, usage, digest, and exact failure, but not their raw
contents by default.

## Canonical Review Authority

The sole review authority remains:

```text
.beegame/reviews/foundation/<revision>/review.json
```

It uses the existing strict version 2 schema. Each conflict contains only:

- `id`;
- `title`;
- `problem`;
- exact `evidence`;
- one `requiredOutcome`;
- every required path-specific `changes` action;
- mechanically checkable `acceptance` conditions.

The final Reviewer receives both packet paths and accepted digests. It reads
the packets, then performs targeted reads of cited locations and directly
dependent authority. It does not repeat a complete sequential read of all
eight documents unless packet evidence proves that a document-wide invariant
must be checked. BGS validates packet digests and current document revision
before accepting the final result; it does not merge packet contents.

The initial review contains no prior-review fields. The one verification
review is bound to the accepted prior `review.json` path and digest, accounts
for every prior conflict in `priorConflictStatus`, and may report new blocking
conflicts caused by remediation. Open prior conflicts retain their IDs; closed
conflicts are absent from current conflicts.

## Remediation Lanes

The existing three exclusive writer lanes remain:

| Lane | Owned paths |
| --- | --- |
| `core-design` | `docs/GDD.md`, `docs/LEVEL_SCENE_DESIGN.md`, `docs/BALANCE_DESIGN.md` |
| `technical-assets` | `docs/TECHNICAL_DESIGN.md`, `docs/ASSET_PLAN.md` |
| `presentation` | `docs/ART_DIRECTION.md`, `docs/UI_UX_SPEC.md`, `docs/AUDIO_DESIGN.md` |

Each required lane receives the same immutable `review.json` authority, its
owned affected paths, the source revision, and before-file digests. It reads
all eight documents as needed but mutates only owned paths. Every completed
lane commits one receipt containing review digest, source revision, owned
paths, before/after digests, duration, and usage.

Unaffected lanes remain `not_required`. Required lanes are dispatched
concurrently. Explicit retry resets only failed lanes to `pending`; successful
sibling receipts remain accepted. Verification cannot start until every
required receipt still matches current bytes.

## Verification Reviewer

Verification is one new independent `final` worker in `verification` mode. It
receives:

- the prior canonical `review.json` path and digest;
- all required lane receipts and digests;
- current Foundation revision;
- read-only access to all eight documents;
- one staging path for the new canonical `review.json`.

It first verifies every prior conflict and acceptance condition against current
bytes, then checks directly dependent authority touched by the repairs. It does
not dispatch specialists or perform a second unrestricted initial audit. A
remaining or new blocking conflict produces `NEEDS_REVISION` and the workflow
stops at `needs_action`.

## Checklist and Resource Gates

`CHECKLIST_REVIEW` and `COMPREHENSIVE_REVIEW` are deleted.

After checklist drafting, BGS deterministically verifies:

- the canonical checklist path and current document revision;
- strict checklist schema and unique stable IDs;
- required requirement/reference coverage;
- committed bytes and digest;
- the existing author receipt identity.

A passing checklist gate advances directly to Resource Production. It does
not claim semantic review authority; semantic correctness remains owned by the
accepted Foundation review and the checklist author contract.

After Resource Production, the existing Resource Gate remains responsible for
resource manifest, inventory, content, provenance, and digest closure. A
passing Resource Gate advances directly to Atomic Task Planning. Later
implementation audit and acceptance validation remain unchanged because they
validate implementation delivery, not the eight-document Foundation contract.

## State Model

The generic three-scope review model is removed. Foundation state becomes:

```ts
type FoundationReviewRole =
  | 'contract-specialist'
  | 'integration-specialist'
  | 'final'

type FoundationReviewMode = 'initial' | 'verification'

type FoundationReviewReportState = {
  role: FoundationReviewRole
  path: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dispatch?: DispatchRecord
  digest?: string
  durationMs?: number
  usage?: WorkflowUsage
  failureReason?: string
}

type FoundationReviewState = {
  revision: string
  mode: FoundationReviewMode
  attempt: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: FoundationReviewReportState[]
  priorReviewPath?: string
  priorReviewDigest?: string
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: 'READY' | 'NEEDS_REVISION'
  failureReason?: string
}
```

Initial state contains the two specialist reports followed by `final`.
Verification state contains only `final`. A worker is identified by
`revision + mode + role + attempt`. Completed report bytes and digests are the
only completion authority.

The schema version is bumped once. Migration discards legacy Reviewer execution
state and approvals while preserving canonical documents, confirmed brief,
resource data, implementation data, and accepted version 2 Foundation review
files as historical evidence only. Preserved files never recreate approval or
skip the new pipeline. An interrupted or previously approved legacy review
restarts from the current Foundation revision under the new pipeline. No
runtime branch parses or converts legacy Markdown reports after migration.

## Failure, Retry, and Recovery

- Failed specialist: explicit retry resets only that role.
- Completed specialist: its accepted packet and digest are reused.
- Failed final Reviewer: explicit retry reruns only `final` with the same packet
  digests and revision.
- Changed source document before final acceptance: reject the stale result and
  create a fresh initial review for the new revision.
- Changed packet after acceptance: reject final result.
- Invalid packet or review JSON: fail the owning dispatch with the original
  schema error; do not synthesize a replacement.
- Failed remediation lane: preserve successful siblings and retry only the
  failed lane.
- Changed lane-owned bytes after receipt: reject verification.
- Verification `NEEDS_REVISION`: stop at `needs_action`.
- Transport/API/model failure: preserve the exact original failure and require
  explicit user retry; no automatic API retry is introduced.

Recovery reconstructs work only from persisted dispatch records, accepted
packet/report digests, and lane receipts. Model transcripts, compaction
summaries, temporary background files, and tool prose are never workflow
state.

## Token and Time Boundaries

- Each specialist is one independent session and one bounded output file.
- Each specialist reads each assigned document at most once in full and uses
  targeted rereads only for exact evidence.
- Candidate packets are capped at 32 candidates and contain no narrative
  repetition.
- The final Reviewer reads packets first and verifies only cited/dependent
  source locations.
- Verification does not rerun specialists.
- No workflow unit may launch another Agent or restart completed analysis.
- Dashboard metrics report input, cache input, output, credit, duration, and
  retries per specialist, final Reviewer, lane, and verification Reviewer.

These are protocol constraints, not BGS-authored review decisions. Performance
is measured in Chrome acceptance and reported without replacing correctness
with an arbitrary file-size threshold.

## Dashboard

The Foundation review card displays:

- Contract specialist status, duration, input/cache/output/credit, and exact
  failure;
- Integration specialist status and the same metrics;
- final synthesis status;
- accepted structured conflict list;
- three remediation lane states, owned affected documents, metrics, receipts,
  and failures;
- verification status and prior-conflict closure;
- terminal `READY` or `needs_action`.

The UI does not display raw specialist packets, raw JSON, Markdown review
reports, native subagent state, obsolete 0/8 per-document review tasks, or a
single aggregate remediation task. API projection contains only fields used by
this card.

## Removal of Superseded Behavior

Implementation deletes rather than deprecates:

- Reviewer-specific native Agent definitions and CLI `--agents` plumbing;
- parent Reviewer Agent/Task/TaskOutput instructions and tests;
- Reviewer background-output parsing and temporary-file workarounds when no
  other workflow consumer remains;
- Foundation specialist Markdown roles and historical role aliases;
- Foundation `review.md`, `decision.json`, and Markdown part acceptance;
- `CHECKLIST_REVIEW` and `COMPREHENSIVE_REVIEW` steps;
- checklist/complete Reviewer roles, attempts, approvals, recovery, prompts,
  routing, UI, and tests;
- `document-review-report.ts` and generic Markdown topology after their last
  consumers are removed;
- legacy report conversion and compatibility branches;
- the obsolete single `foundation-remediation` task projection and API fields;
- any project-wide or native-core behavior added solely to support the removed
  parent-subagent design.

The exact workflow mutation-permission enforcement, lane usage persistence,
current-byte revision checks, report digest checks, final-report display
integrity, per-role failure display, canonical version 2 schema, and three-lane
state machine are retained.

## Implementation Order

1. Commit the already verified lane-usage persistence fix and obsolete display
   cleanup without the TaskOutput prompt workaround.
2. Remove the parent Reviewer/native-subagent chain and prove no native Agent
   launch remains reachable from Foundation review.
3. Remove checklist/complete Markdown Reviewer scopes and connect checklist and
   resource deterministic gates directly to their next phases.
4. Introduce the strict evidence-packet schema and file acceptance.
5. Introduce Foundation-only review state and two concurrent specialist
   dispatches.
6. Add final synthesis dispatch, packet-digest binding, current-byte checks, and
   canonical `review.json` acceptance.
7. Reconnect the retained three remediation lanes and implement the standalone
   verification Reviewer.
8. Remove remaining legacy schemas, migrations, prompts, paths, UI projections,
   and tests; run an unreachable-symbol/reference audit.
9. Update the Dashboard to the new role/synthesis/lane/verification model.
10. Verify backend, frontend, schema evolution, recovery, permissions, retry,
    revision tamper, and digest tamper tests.
11. Run Web/React acceptance through Chrome on a copied completed eight-document
    project without manually changing the example project.
12. Record duration, input, cache input, output, credit, retries, conflict count,
    final verdict, and document/report digests in this specification.

## Acceptance Criteria

- Chrome shows two specialist workers starting concurrently.
- Each specialist has a separate dispatch, log, usage record, evidence packet,
  digest, and failure surface.
- No Reviewer session invokes Agent, Task, TaskOutput, teams, or background
  subagents.
- A completed specialist is not rerun after restart, compaction elsewhere, or
  retry of its sibling.
- Final synthesis starts only after both packet digests are accepted.
- Exactly one authoritative initial `review.json` is committed.
- `NEEDS_REVISION` starts only affected remediation lanes concurrently.
- Lane usage persists and no completed lane is marked failed by usage lookup.
- Verification starts only after all required receipts match current bytes.
- Verification never starts specialists and produces exactly one new canonical
  `review.json`.
- Verification `NEEDS_REVISION` stops at `needs_action`.
- Checklist commit advances without `CHECKLIST_REVIEW`.
- Resource Gate success advances without `COMPREHENSIVE_REVIEW`.
- No source reference remains to legacy Markdown review paths, legacy Reviewer
  roles, Reviewer-specific `workflowAgentDefinitions`, or obsolete aggregate
  remediation display fields.
- Backend, frontend, typecheck, and diff-check pass.
- Chrome acceptance exposes exact failures and reports complete token, credit,
  and duration measurements.

## Design Self-Review

- There is one semantic review authority: version 2 `review.json`.
- Specialist packets are typed inputs with no verdict and cannot compete with
  canonical authority.
- BGS performs orchestration and deterministic validation only.
- Model context and compaction summaries carry no workflow cursor.
- Checklist and resource stages use their own deterministic contracts rather
  than a generic Reviewer compatibility layer.
- The implementation removes obsolete paths before adding the replacement, so
  no dual execution track exists.
- The design adds no native-core modification, example-specific behavior,
  feature flag, MVP path, placeholder, or automatic semantic repair loop.

## Automated Cutover Evidence

Recorded on 2026-08-17 after the atomic Reviewer cutover:

- The backend suite passed 571 tests across 95 files with 2,117 assertions,
  one explicitly retired calibration test skipped, and zero failures.
- The focused Dashboard suite passed all 54 tests across
  `WorkflowCard.test.tsx` and `useWorkflowCardDeck.test.tsx`.
- Repository TypeScript checking and `git diff --check` passed.
- The retired Markdown review report, stage, topology, controller-review, and
  their dedicated tests were deleted rather than kept behind compatibility
  routing.
- Remaining historical `documentReviewState`, old phase, and Markdown report
  names occur only in the schema-21 migration fixture that proves destructive
  cutover, or in negative assertions proving the new prompts and UI exclude
  them.
- Generic native `TaskOutput` telemetry remains solely for passive usage
  accounting of unrelated native background Agents. Foundation Reviewer
  prompts, dispatch, evidence acceptance, synthesis, remediation, and
  verification have no `Agent`, `Task`, or `TaskOutput` execution path.

Chrome/Web acceptance and its live duration/token/credit evidence are recorded
separately after the automated gate is committed.
