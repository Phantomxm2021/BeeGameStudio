# Foundation Remediation Clean-Slate Removal Design

## Decision

Remove the current Foundation remediation system as one dependency-closed unit. Do not disable it behind a flag, retain it as a fallback, translate its persisted state, or reuse its execution model for the replacement.

The accepted Foundation Reviewer remains the authority that reads the eight canonical documents and commits one byte-bound `review.json`. This change stops at the Reviewer result. A new remediation design will be created only after the old implementation and its contracts are absent.

## Why the Current Direction Must Be Removed

The current remediation behavior is not one replaceable component. It is distributed across workflow state, document dispatch, document-author prompts, completion handling, recovery, retry, schema persistence, post-remediation verification, Dashboard projection, and historical design artifacts. Disabling only the controller transition would leave dormant execution paths and two competing meanings for document authoring and review.

The correct cleanup unit is therefore the complete remediation dependency closure, not individual failing branches.

## Preserved Reviewer Boundary

The following accepted Reviewer behavior is frozen:

- three disjoint read-only specialist lanes;
- one packet-only synthesis task;
- native `Read`, `Grep`, and `Glob` tools plus schema-backed `StructuredOutput`;
- one canonical version 2 `review.json` bound to the current document revision;
- exact evidence, required outcome, per-path changes, and mechanical acceptance for every blocking conflict;
- the four ordinary Dashboard tasks for core design, technical/assets, presentation, and synthesis;
- no source-document mutation by Reviewer workers.

Removal may simplify Reviewer runtime state that exists solely to execute a post-remediation verification pass, but it must not change the initial Reviewer prompt semantics, topology, native tool envelope, report schema, accepted report bytes, or Dashboard task presentation.

## Removed Domain

### Remediation model

Delete:

- `FoundationRemediationLaneId`;
- `FoundationRemediationLaneStatus`;
- `FoundationRemediationReceipt`;
- `FoundationRemediationLane`;
- `FoundationRemediationState`;
- the `foundationRemediationState` field on delivery runs;
- remediation pass limits and repair-lane ownership definitions;
- baseline, before-digest, after-digest, and resulting-revision repair state.

Delete `foundation-remediation.ts` and its test instead of replacing it with an empty adapter.

### Scheduling and execution

Delete every branch that:

- converts `NEEDS_REVISION` into `DOCUMENT_DRAFTING`;
- creates or dispatches `foundation-remediation:<lane>` tasks;
- treats a document author as `authoringMode: 'remediation'`;
- injects conflict or lane authority into a document-author prompt;
- accepts a remediation terminal or commits a remediation receipt;
- waits on a repair-lane barrier;
- creates a post-remediation Reviewer verification run;
- retries, resumes, fails, cancels, or recovers a remediation lane;
- changes a document because of Reviewer output.

There is no replacement scheduler in this cleanup.

### Reviewer verification execution

Delete the executable `verification` review mode, its prior-review dispatch fields, remediation receipt barrier, affected-path verification projection, and verification-only task projection. Preserve the initial Reviewer and its report schema unchanged.

### Persistence and recovery

Delete remediation fields from current schemas, run storage, recovery projection, cursor reconstruction, and durable snapshots. Delete schema migrations and recovery branches whose only purpose is to translate or resume remediation state.

Old runs containing remediation execution state are unsupported and cannot be resumed. The cleanup does not translate them into the new current schema. Their project documents and committed Reviewer reports remain ordinary files and are not deleted.

### Dashboard and API

Delete repair-task projections and repair-specific API fields, including:

- `修订核心设计`;
- `修订技术与资产`;
- `修订表现体验`;
- `修订结果`;
- remediation lane status, failure, receipt, and verification summaries.

Do not add a replacement card, panel, button, or compatibility display. The existing Reviewer tasks and accepted report display remain.

### Tests and normative documentation

Delete tests that assert remediation lanes, receipts, automatic repair, verification review, remediation retry, or remediation recovery. Rewrite mixed Reviewer/remediation tests so they assert only the initial Reviewer boundary and terminal outcome. Add absence tests that fail if the removed state, task IDs, authoring mode, prompts, or dispatch routes return.

Delete normative plans and design sections that describe the removed remediation workflow. Historical project files and user documents are not modified, but repository documentation must no longer present the removed design as current architecture.

## Resulting Workflow Behavior

After Foundation Reviewer synthesis commits its report:

- `READY` continues to the existing checklist stage.
- `NEEDS_REVISION` sets the delivery run to the existing generic `needs_action` status, preserves the accepted report path and digest, and stops dispatching work.
- no repair worker, document author, verification Reviewer, retry loop, or automatic file mutation starts.

`needs_action` is a terminal workflow outcome for this cleanup, not an interim remediation state. A future remediation system must define its own explicit entry point and state model in a separate approved design.

## Failure and Compatibility Policy

- A Reviewer transport or schema failure retains the existing Reviewer retry behavior for incomplete Reviewer roles only.
- An accepted `NEEDS_REVISION` report is not a transport failure and must not be retried as review work.
- Removed remediation snapshots fail current-schema loading; no hidden fallback reconstructs them.
- Unknown repair task IDs, remediation authoring modes, or remediation terminal payloads are rejected by the remaining generic contracts.
- No native runtime core code changes are permitted.

## Implementation Boundary

The removal is complete only when static search finds no production reference to the deleted remediation state, lane IDs, authoring mode, receipt, events, or repair task labels. Generic uses of the English word “remediation” outside Foundation document repair are not part of this deletion.

Expected primary production files include:

- `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`;
- `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`;
- `packages/agent-workflow-server/src/app.ts`.

This is an audit inventory, not permission for unrelated refactoring. Each edit must remove a dependency on the deleted domain.

## Verification

### Static closure

Require no production matches for:

- `foundationRemediationState`;
- `FoundationRemediation`;
- `foundation-remediation:`;
- `authoringMode: 'remediation'` or equivalent comparisons;
- remediation-created, remediation-planned, or verification-created Foundation events;
- the four removed Dashboard repair labels.

### Automated behavior

Require tests proving:

- Reviewer `READY` still advances normally;
- Reviewer `NEEDS_REVISION` commits the report and ends in generic `needs_action`;
- no dispatch exists after accepted `NEEDS_REVISION`;
- Reviewer prompt, tools, topology, report schema, revision binding, retry, and source immutability remain intact;
- current schema has no remediation state;
- removed remediation task IDs and terminal contracts are rejected;
- document-author initial authoring remains unchanged;
- typecheck and diff checks pass.

### Web/React acceptance

Using Chrome and the fixed-port stack, create a fresh review copy of the accepted eight-document project and run Reviewer only. Acceptance requires:

- the four Reviewer tasks appear and complete;
- `review.json` is committed and displayed;
- a `NEEDS_REVISION` verdict leaves the run in `needs_action`;
- no remediation task or remediation worker starts after the report;
- all eight source-document SHA-256 values remain unchanged;
- Reviewer token and time measurements exclude all later stages because no later stage is dispatched.

## Non-Goals

- designing or implementing the replacement remediation workflow;
- preserving resumability of old remediation runs;
- changing native runtime tools or behavior;
- changing initial document generation;
- redesigning Reviewer semantics, report format, or Dashboard presentation;
- adding feature flags, adapters, fallbacks, aliases, or dual-write state.
