# Foundation Review JSON Convergence Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Foundation Reviewer Markdown/decision/multi-round workflow with one immutable actionable `review.json`, one coordinated remediation Agent, and one verification review.

**Architecture:** Foundation review gets a dedicated strict JSON contract and atomic acceptance path while checklist and complete review remain outside this change. The server derives permissions and Dashboard projection from accepted conflict changes; it never creates or rewrites findings. One review-remediation task edits the accepted path union, and a second semantic review either reaches READY or stops visibly.

**Tech Stack:** TypeScript, Zod, Bun tests, React, existing delivery workflow persistence and worker runtime, Web/React Chrome acceptance.

## Global Constraints

- Foundation review has exactly one durable artifact: `.beegame/reviews/foundation/<revision>/review.json`.
- Foundation runtime must not read or produce `review.md` or `decision.json`.
- BGS validates, persists, routes, recovers, and displays; it does not generate findings or document prose.
- Reviewer findings contain only actionable blocking conflicts.
- The remediation path set is derived from `conflicts[].changes[].path`.
- One coordinated Agent performs one automatic remediation cycle.
- A verification `NEEDS_REVISION` stops at `needs_action`; it does not start another semantic cycle.
- Existing uncommitted Reviewer drafts are rejected work and must be removed before implementation.
- No native Agent core, model configuration, document generation, or example document is modified.
- Final acceptance must use Web/React in Chrome and an already completed eight-document project.

---

### Task 1: Remove Rejected Drafts and Add the Foundation JSON Contract

**Files:**
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Revert rejected changes: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts`

**Interfaces:**
- Produces: `foundationReviewSchema`, `FoundationReview`, `foundationReviewPath()`, `foundationReviewStagingPath()`, `foundationReviewAffectedPaths()`, `acceptFoundationReview()`.
- Consumes: `CANONICAL_FOUNDATION_DOCUMENTS`, project-confined path helpers, SHA-256 helpers.

- [ ] **Step 1: Remove only the six rejected uncommitted Reviewer drafts**

Restore the listed files to `HEAD` and confirm the only remaining working-tree changes are the implementation plan.

- [ ] **Step 2: Write failing schema tests**

Cover:

```ts
expect(() => foundationReviewSchema.parse(readyWithConflicts)).toThrow()
expect(() => foundationReviewSchema.parse(needsRevisionWithoutConflicts)).toThrow()
expect(() => foundationReviewSchema.parse(duplicateConflictIds)).toThrow()
expect(() => foundationReviewSchema.parse(missingEvidenceOrAcceptance)).toThrow()
expect(() => foundationReviewSchema.parse(outOfScopeChangePath)).toThrow()
expect(foundationReviewAffectedPaths(validReview)).toEqual([
  'docs/GDD.md',
  'docs/AUDIO_DESIGN.md',
])
```

Add prior-review tests proving every prior conflict is exactly `open` or `closed`, open IDs remain current, closed IDs disappear, and `priorReviewDigest` is required when prior conflicts exist.

- [ ] **Step 3: Run the tests and verify RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
```

Expected: module-not-found failure for `./foundation-review`.

- [ ] **Step 4: Implement the minimal strict contract and atomic acceptance**

The schema shape is the approved design. `acceptFoundationReview()` must parse staged JSON, validate revision/prior digest, compute affected paths, atomically commit one file, and return `{ review, path, digest, affectedPaths }`.

- [ ] **Step 5: Run focused tests and typecheck**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
bun run typecheck
git diff --check
```

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts
git commit -m "feat: add canonical foundation review contract"
```

---

### Task 2: Route Foundation Reviewer Output Through `review.json`

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

**Interfaces:**
- Consumes: Task 1 Foundation review functions.
- Produces: one Foundation final assignment with one staging JSON path; accepted Foundation terminals are derived from accepted JSON rather than model-supplied verdict/path arrays.

- [ ] **Step 1: Write failing topology and prompt tests**

Assert that Foundation assignments have exactly one staging and committed output, both named `review.json`; the prompt requests only the approved JSON fields and forbids Markdown, decision files, audit prose, non-blocking advice, preservation lists, and coverage prose.

- [ ] **Step 2: Write failing terminal acceptance tests**

Assert that a Foundation terminal cannot supply its own `affectedPaths` or verdict independently of the accepted JSON and that malformed/stale JSON fails closed.

- [ ] **Step 3: Run focused tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: assertions still observe `review.md`/`decision.json` and legacy prompt content.

- [ ] **Step 4: Implement the Foundation-only JSON branch**

Checklist and complete review behavior remains unchanged. Foundation uses one direct final Reviewer, one JSON output path, strict acceptance, derived affected paths, and prior `review.json` as byte-bound read-only verification input on the verification pass.

- [ ] **Step 5: Run focused tests, typecheck, and diff check**

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-topology.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "refactor: make foundation review json only"
```

---

### Task 3: Replace Per-Document Remediation With One Coordinated Task

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.native-documents.test.ts`

**Interfaces:**
- Consumes: accepted `FoundationReview` and derived affected paths.
- Produces: one `document-author` remediation dispatch whose contract contains `reviewPath`, `reviewDigest`, and all derived allowed paths; terminal `writtenPaths` must remain within and close the accepted path set.

- [ ] **Step 1: Write failing task-planning tests**

Assert that five affected paths produce one remediation task rather than five tasks, and that no path absent from conflict changes enters the contract or write authority.

- [ ] **Step 2: Write failing prompt and session tests**

Assert that the Agent receives the full conflict objects, reads only evidence-relevant sections as needed, coordinates all listed changes, and cannot write outside the derived union.

- [ ] **Step 3: Run focused tests and verify RED**

- [ ] **Step 4: Implement one coordinated Foundation remediation dispatch**

Reuse the existing native document editing tools. Do not add BGS-authored checkpoints, document prose, or a new native Agent core tool.

- [ ] **Step 5: Verify focused tests and commit**

```bash
git commit -m "refactor: coordinate foundation review remediation"
```

---

### Task 4: Enforce One Automatic Semantic Cycle and Exact Prior Closure

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-stage.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-controller-review.test.ts`

**Interfaces:**
- Consumes: initial or verification Foundation review plus prior conflict statuses.
- Produces: initial `NEEDS_REVISION` routes once to coordinated remediation; verification `NEEDS_REVISION` routes to `needs_action`; verification `READY` approves Foundation.

- [ ] **Step 1: Write failing transition tests**

Cover:

```ts
expect(route(initialNeedsRevision).phase).toBe('DOCUMENTS')
expect(route(verificationReady).documentReviewState.approvals.foundation).toBeDefined()
expect(route(verificationNeedsRevision).status).toBe('needs_action')
```

Also prove that interrupted dispatch replay does not increment the semantic cycle and explicit retry cannot silently start a third review/remediation loop.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement the three-step state machine**

Remove the old attempt-limit semantics for Foundation and represent initial versus verification explicitly from the existence of a prior accepted review.

- [ ] **Step 4: Run focused and controller tests**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: bound foundation review convergence"
```

---

### Task 5: Make Single-Artifact Recovery Fail Closed

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Interfaces:**
- Consumes: committed Foundation `review.json`, persisted path/digest, current byte-derived revision.
- Produces: exact crash-after-commit recovery or explicit old-protocol/stale/tampered failure.

- [ ] **Step 1: Write failing recovery tests**

Test committed JSON with missing state, tampered JSON, changed document revision, duplicate/conflicting artifact, and an old active Foundation Markdown/decision state.

- [ ] **Step 2: Verify RED**

- [ ] **Step 3: Implement recovery**

Recover only when the one canonical JSON artifact validates against current document bytes. Old active Foundation protocol becomes `needs_action` with an explicit restart reason; it is never translated.

- [ ] **Step 4: Run recovery and schema suites**

- [ ] **Step 5: Commit**

```bash
git commit -m "fix: recover canonical foundation reviews"
```

---

### Task 6: Project the JSON Conflict List to the Dashboard

**Files:**
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- Consumes: digest-validated accepted Foundation review JSON.
- Produces: API projection containing verdict, conflict count, affected paths, conflicts, prior statuses, stage, and exact failure; UI list with expandable details.

- [ ] **Step 1: Write failing route tests**

Assert that `finalReportMarkdown` is absent, tampered review bytes fail closed, and the API returns structured conflicts from the accepted JSON.

- [ ] **Step 2: Write failing UI tests**

Assert verdict/count/affected paths are visible; conflict details expand to Problem, Change, Evidence, and Acceptance; raw JSON and Markdown are not rendered.

- [ ] **Step 3: Verify RED**

- [ ] **Step 4: Implement server projection and React list**

- [ ] **Step 5: Run backend and frontend focused tests**

```bash
bun test packages/agent-workflow-server/src/__tests__/session-routes.test.ts
bun test apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
```

- [ ] **Step 6: Commit**

```bash
git commit -m "feat: show actionable foundation conflicts"
```

---

### Task 7: Delete Superseded Foundation Protocol Code

**Files:**
- Modify or delete Foundation-only branches in: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.ts`
- Modify tests: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-review-report.test.ts`
- Modify shared state only where required: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify shared schema only where required: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify persistence only where required: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`

**Interfaces:**
- Consumes: Tasks 1–6 replacement paths.
- Produces: no reachable Foundation reference to `review.md`, `decision.json`, specialist consolidation, per-document remediation, Markdown display, or automatic third semantic cycle.

- [ ] **Step 1: Add negative regression assertions**

Tests and source searches must prove Foundation assignments, prompts, persistence, API, and UI no longer contain the superseded names or behavior. Checklist/complete references are not removed by this scoped change.

- [ ] **Step 2: Delete obsolete Foundation code and fixtures**

Do not retain fallback branches or compatibility parsers.

- [ ] **Step 3: Run the complete backend and frontend suites**

```bash
bun test packages/agent-workflow-server/src/beegame packages/agent-workflow-server/src/__tests__
bun test apps/frontend/src/components/Demiurge
bun run typecheck
git diff --check
```

- [ ] **Step 4: Commit**

```bash
git commit -m "refactor: remove legacy foundation reviewer protocol"
```

---

### Task 8: Web/React Chrome Acceptance on Existing Eight Documents

**Files:**
- Modify evidence ledger: `docs/superpowers/specs/2026-08-16-foundation-review-json-convergence-design.md`

**Interfaces:**
- Consumes: completed implementation and an existing completed eight-document project copy.
- Produces: visible Web/React acceptance evidence, tokens, duration, final state, and quality observations.

- [ ] **Step 1: Start all services on the fixed project ports**

Use the repository's fixed-port start command and confirm each bound port before opening Chrome.

- [ ] **Step 2: Open the existing completed eight-document project through Web/React in Chrome**

Do not generate a new example project and do not edit test documents to make the result pass.

- [ ] **Step 3: Run initial review, coordinated remediation, and verification**

Observe Dashboard stage changes and confirm the project produces only `review.json` per Foundation revision.

- [ ] **Step 4: Inspect quality and efficiency**

Verify every conflict is actionable, paths are complete, prior conflicts are accounted for, no audit prose appears, no third semantic cycle starts, and token/time totals are recorded from workflow logs.

- [ ] **Step 5: Run final automated verification**

```bash
bun test packages/agent-workflow-server/src/beegame packages/agent-workflow-server/src/__tests__
bun test apps/frontend/src/components/Demiurge
bun run typecheck
git diff --check
git status --short
```

- [ ] **Step 6: Update evidence and commit**

```bash
git commit -m "docs: record foundation review acceptance"
```
