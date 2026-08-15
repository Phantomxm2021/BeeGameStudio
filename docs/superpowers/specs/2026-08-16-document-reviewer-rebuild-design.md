# Document Reviewer Rebuild Design

## Purpose

Replace the existing document Reviewer implementation as one retired subsystem.
The replacement must preserve the product workflow:

```text
foundation documents
  -> foundation review
  -> remediation and re-review when blocked
  -> acceptance checklist
  -> checklist review
  -> resource preparation
  -> complete review
  -> atomic task planning
```

This is not an incremental repair of the current Reviewer. The old packet,
criterion, reference, semantic-ledger and closure-cycle architecture is removed
before the replacement becomes the only runnable path.

## Scope boundary

This change owns only Reviewer-specific design and implementation.

It removes or replaces:

- `SubmitDocumentReviewPacket` and its native tool contract;
- review check packets, criteria and `referenceId` projections;
- Reviewer-specific terminal JSON;
- Reviewer finding ledgers and per-check evidence digests;
- initial/closure review modes and partial-check inheritance;
- Reviewer-specific dispatch, persistence, recovery and UI projections;
- Reviewer compatibility parsers, output repair and retired tests;
- obsolete Reviewer specifications and implementation plans.

It does not redesign or modify:

- model selection or provider configuration;
- native Agent core behavior;
- general workflow logs;
- general permission infrastructure;
- the eight-document authoring system;
- resource production;
- atomic task planning;
- unrelated workflow phases.

Reviewer source documents remain read-only. A Reviewer may write only its
assigned report files below the reviewed project's own workspace.

## Rejected architectures

### Patch the current structured Reviewer

Rejected. The current system couples review meaning to packets, strict terminal
JSON, model-specific output behavior, server-side normalization and a large
state machine. Replacing prompts or adding parsers preserves the faulty
boundary.

### One Reviewer reads all eight documents

Rejected. The frozen acceptance document set is large enough to create context
pressure when combined with native instructions, tool results and a detailed
report. The previous one-session topology already stalled after reading only a
subset of the documents.

### One native session per criterion

Rejected. It repeatedly reads the same documents and turns a document audit
into transport orchestration. The measured seventeen-task attempt added about
2.06 million tokens without completing the review.

### Custom structured submission transport

Rejected. MCP or another complex result tool is unnecessary for reviewing
documents. It would solve a terminal JSON problem created by the old design,
not the review problem itself.

## Architecture

### Specialist reports

Foundation review launches five independent native Reviewer sessions:

| Role | Readable source documents | Responsibility |
| --- | --- | --- |
| Gameplay | `GDD.md`, `LEVEL_SCENE_DESIGN.md`, `BALANCE_DESIGN.md` | loops, rules, strategy, economy, pacing and numeric feasibility |
| Technical | `GDD.md`, `TECHNICAL_DESIGN.md`, `ASSET_PLAN.md` | implementation, performance, data, runtime and asset feasibility |
| Experience | `GDD.md`, `ART_DIRECTION.md`, `UI_UX_SPEC.md` | player comprehension, visual language, interaction and accessibility |
| Presentation | `GDD.md`, `UI_UX_SPEC.md`, `AUDIO_DESIGN.md` | state feedback and UI/audio consistency |
| Production | `ART_DIRECTION.md`, `AUDIO_DESIGN.md`, `ASSET_PLAN.md` | production scope, deliverables, provenance, licensing and resource closure |

Each session receives one role, a fixed source allowlist and one fixed output
path. It independently reads the source files and authors one Markdown report.
Bee Game Studio does not summarize source documents or create report content.

Specialist reports use a human-readable contract:

1. scope reviewed;
2. blocking findings;
3. non-blocking improvements;
4. responsibilities that passed;
5. evidence as source path and one-based line range;
6. impact and required outcome for every blocking finding.

The service does not parse findings from these reports. It verifies only that
the assigned report file was created in the expected project directory and
that the reviewed source revision did not change.

### Final review

After all specialist reports commit, one Final Reviewer reads them. It may read
only the cited source ranges required to verify or resolve duplicate and
cross-specialty conclusions. It authors:

- one final Markdown report;
- one small routing decision file.

The Final Reviewer, not Bee Game Studio, consolidates duplicate findings,
decides whether a finding blocks downstream development, and declares the
affected project paths.

The decision file is limited to workflow routing:

```json
{
  "version": 1,
  "scope": "foundation",
  "revision": "<sha256>",
  "verdict": "NEEDS_REVISION",
  "affectedPaths": [
    "docs/GDD.md",
    "docs/BALANCE_DESIGN.md"
  ],
  "reportPath": ".beegame/reviews/foundation/<revision>/review.md"
}
```

The service validates exact enums, revision identity and project-relative
paths. It computes the report digest from the persisted bytes. It does not
infer, rewrite, deduplicate or repair semantic conclusions.

## Project-local persistence

Every result belongs to the reviewed game project:

```text
<workspacePath>/.beegame/reviews/<scope>/<revision>/
  parts/
    gameplay.md
    technical.md
    experience.md
    presentation.md
    production.md
  review.md
  decision.json
```

Scopes that require fewer specialists contain only their contracted part
reports. No review report is written to the Bee Game Studio source repository,
a development worktree, a global configuration directory or a shared temporary
directory.

Reports are immutable for a revision. A changed source revision creates a new
directory. Previous reports remain project history but are never accepted as
authority for the new revision.

## Workflow behavior

### Foundation

After all eight foundation documents commit, the five specialist reports and
the final report run. `READY` advances to checklist authoring.
`NEEDS_REVISION` advances to foundation remediation.

### Remediation

The remediation planner reads the final report and produces one coherent repair
decision for the affected paths. Existing document authors perform the edits
within their owned paths. Bee Game Studio transports the report path and
enforces path ownership; it does not translate report prose into edits.

After all repairs commit, the workflow calculates a new document revision and
runs a complete new review for that revision. It does not inherit old check
results or maintain a closure-check ledger.

Three consecutive `NEEDS_REVISION` results for the same scope stop in
`needs_action` and expose the latest report. The workflow never enters an
unbounded semantic repair loop.

### Checklist

Checklist review uses one native Reviewer with the checklist, GDD and accepted
foundation report. `READY` advances to resource preparation. A blocking result
routes to checklist remediation and then a new checklist review revision.

### Complete review

After resource preparation, complete review uses bounded specialist reports for
gameplay acceptance, technical/resource feasibility and experience delivery,
followed by one Final Reviewer. A blocking result routes to the owner of the
affected path: foundation document, checklist or resource. A ready result
advances to atomic task planning.

## Minimal durable state

The replacement stores operational facts, not a second semantic copy of the
report:

```ts
type DocumentReviewRun = {
  scope: 'foundation' | 'checklist' | 'complete'
  revision: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: Array<{
    role: string
    path: string
    digest?: string
    status: 'pending' | 'running' | 'completed' | 'failed'
    failureReason?: string
  }>
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: 'READY' | 'NEEDS_REVISION'
  affectedPaths?: string[]
  attempt: number
  failureReason?: string
}
```

There are no check packets, assessment arrays, finding ledgers, criterion IDs,
reference IDs, closure modes or accepted-check inheritance.

## Permissions and integrity

- Source documents are readable but not writable by Reviewer sessions.
- A specialist can write only its assigned part report.
- The Final Reviewer can write only `review.md` and `decision.json`.
- Every path is resolved below the active `<workspacePath>`.
- The service records source revision before dispatch and verifies it before
  accepting each result.
- Review acceptance fails if any source document changes during review.
- The report digest is computed from bytes after the final atomic rename.
- Provider text is diagnostic only; file commitment is the terminal authority.

## Error handling and recovery

- Missing specialist report: fail only that role; preserve accepted sibling
  reports for the same unchanged revision.
- Invalid output path: reject the result and expose the original path error.
- Source mutation by a Reviewer: reject the result and stop the review run.
- Invalid decision file: reject with the exact schema or identity error. Do not
  repair it and do not accept terminal prose as a fallback.
- Final report missing: fail the Final Reviewer even if the provider turn says
  success.
- Revision changed: invalidate the entire run and start a new revision.
- Process interruption: resume only committed reports whose stored digest still
  matches their bytes and the active revision.
- Provider or transport failure: expose the original error. Do not introduce an
  automatic semantic retry.

## User interface

The existing workflow card is replaced only where it presents Reviewer state.
It shows:

- specialist role progress;
- final consolidation progress;
- `READY` or `NEEDS_REVISION`;
- affected project paths;
- a rendered final Markdown report;
- the original failure reason;
- elapsed time and token usage.

It does not display internal JSON, check packets, criteria or a server-generated
summary of findings.

## Removal and migration policy

The implementation contains one Reviewer path only. Old Reviewer runtime types,
tools, parsers, state transitions, UI projections and tests are deleted rather
than retained behind a feature flag.

Persisted, incomplete workflows that have reached or passed an old review
boundary are returned to foundation review on their current canonical document
revision before further downstream work. Old approvals are not converted into
new semantic reports and cannot authorize a new downstream transition.
Already completed workflows remain immutable historical runs; any later
canonical revision starts the new Reviewer. No dual execution or compatibility
parser remains.

## Verification

### Static removal gate

Repository searches must prove that retired Reviewer terms and imports no
longer exist in production code, including `SubmitDocumentReviewPacket`, review
check packets, criteria projections, `referenceId` review evidence and closure
cycle state.

### Automated tests

Tests must prove:

1. each specialist receives only its contracted source paths and output path;
2. source documents cannot be written by Reviewer sessions;
3. reports commit only below the active project workspace;
4. a missing or invalid report cannot become a successful terminal;
5. the decision file validates revision, verdict, affected paths and report
   identity without semantic repair;
6. a changed revision invalidates all stale reports;
7. one failed specialist can resume without rerunning accepted siblings;
8. `NEEDS_REVISION` routes to remediation and a new full review;
9. `READY` advances through checklist, resources and atomic planning correctly;
10. the third failed review attempt stops in `needs_action`;
11. UI displays the persisted Markdown and exact failure;
12. old Reviewer production symbols and execution paths are absent.

### Web/React Chrome acceptance

Acceptance runs through Web/React on fixed ports `62173` and `62174`. It uses a
project-local acceptance copy so the frozen eight-document source project is
not mutated.

The run must verify:

- all contracted reports are written under the acceptance project;
- every original document hash is unchanged during review;
- the final report contains actionable evidence and is understandable by both
  developers and non-technical readers;
- the remediation path edits only declared affected files and then performs a
  new review revision;
- errors remain visible in API logs and the workflow card;
- no hidden fallback, legacy Reviewer or native-core change is used;
- foundation review incremental tokens are at most half of the measured
  incomplete seventeen-task attempt, approximately 1.03 million tokens;
- elapsed time and token composition are recorded, not inferred from UI
  weighted totals.

Unit tests alone are not acceptance.

## Architecture reflection gate

Implementation stops for architecture review before another patch when any of
the following occurs:

- the same class of failure appears twice;
- a proposed fix requires Bee Game Studio to parse or repair review prose;
- a proposed fix adds a second terminal or compatibility path;
- a Reviewer requires source write access;
- a real Chrome run contradicts a core design assumption;
- token or latency regressions are explained only by changing prompts rather
  than locating the responsible data flow.

At that point the team preserves logs, identifies the invalid assumption and
either revises this design explicitly or abandons the approach. It does not
continue adding local fixes to preserve the design.
