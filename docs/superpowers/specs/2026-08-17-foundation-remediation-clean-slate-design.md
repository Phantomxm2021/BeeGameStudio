# Foundation Remediation Clean-Slate Removal Design

## Status

Accepted removal decision. The Foundation workflow now ends at the accepted
Reviewer verdict and contains no automatic document-repair execution system.

## Decision

The former Foundation repair domain was removed as one dependency-closed unit.
It is not disabled behind a feature flag, reconstructed from persisted state,
or exposed through a compatibility execution path.

The accepted Foundation Reviewer remains the authority that reads the eight
canonical documents and commits one byte-bound `review.json`. Any future
document-correction workflow requires a separate approved design and explicit
entry point.

## Preserved Reviewer Boundary

The current Reviewer behavior is unchanged:

- three disjoint read-only specialist lanes;
- one packet-only synthesis task;
- native `Read`, `Grep`, and `Glob` plus schema-backed `StructuredOutput`;
- one canonical version 2 `review.json` bound to the current document revision;
- exact evidence, required outcome, per-path changes, and mechanical acceptance
  for every blocking conflict;
- four ordinary Dashboard tasks for core design, technical/assets,
  presentation, and synthesis;
- no source-document mutation by Reviewer workers.

The authoritative topology, packet, report, capability, retry, and display
contract is defined in
`docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md`.

## Current Workflow Behavior

After Foundation Reviewer synthesis commits an accepted report:

- `READY` advances to the existing checklist stage.
- `NEEDS_REVISION` sets the delivery run to the generic `needs_action` status,
  preserves the accepted report path and digest, and stops dispatching work.

An accepted `NEEDS_REVISION` report does not dispatch a document author,
post-report Reviewer, repair worker, or automatic file mutation. It is a
terminal workflow outcome for this architecture.

## Absent Runtime Contracts

The current production tree has no Foundation post-report repair state, lane
or receipt model, repair task ID, repair authoring mode, repair completion
event, verification-review mode, repair recovery branch, repair retry loop,
repair API field, or Dashboard repair-task projection.

Current snapshot parsing rejects removed fields and task contracts. It does
not translate or project them. Project documents and already committed reports
remain ordinary project files and are not modified by schema rejection.

## Failure Policy

- A Reviewer transport or schema failure retains the existing failed-unit
  retry behavior for incomplete Reviewer units only.
- An accepted `NEEDS_REVISION` report is not a transport failure and is not
  retried as review work.
- Unknown post-report task IDs, authoring modes, or terminal payloads are
  rejected by current contracts.
- No native runtime core code is changed by this removal.

## Closure Evidence

Closure requires all of the following on the same production tree:

- static search finds no production reference to the removed state, task IDs,
  authoring mode, creation events, or Dashboard labels;
- the complete affected suite and TypeScript typecheck pass;
- Chrome/Web React creates a fresh review copy of the accepted eight-document
  project and completes only the four Reviewer tasks;
- a schema-valid `NEEDS_REVISION` report leaves the workflow in `needs_action`;
- no post-report repair or verification dispatch exists;
- all eight canonical source-document SHA-256 values remain unchanged.

Exact runtime evidence is recorded in
`docs/superpowers/reviews/2026-08-17-remediation-clean-slate-chrome-acceptance.md`.

## Non-Goals

- designing or implementing a replacement document-correction workflow;
- preserving resumability of snapshots containing removed execution state;
- changing native runtime tools or behavior;
- changing initial document generation;
- redesigning Reviewer semantics, report format, or Dashboard presentation;
- adding feature flags, adapters, aliases, migrations, or dual-write state.
