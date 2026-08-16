# Human-Team Foundation Review Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the two all-document Reviewer workers with three disjoint human-team review tasks, packet-only synthesis, existing parallel remediation, targeted verification, and the original Workflow Card Task presentation.

**Architecture:** One shared lane registry owns both review and remediation document groups. Each lane worker receives its own full documents plus one deterministic cross-lane section projection and commits one bounded packet. Synthesis reads only accepted packets; the UI receives ordinary Tasks and no Reviewer-specific display object.

**Tech Stack:** TypeScript, Bun, Zod, React, Vitest, project-local JSON artifacts, SHA-256 revision binding.

## Global Constraints

- Do not modify the native runtime core or model behavior.
- Bee Game Studio routes and validates bytes but never decides semantic conflicts or writes game-document content.
- Keep one Foundation review runtime path; no feature flag, alias, compatibility parser, or fallback.
- Preserve the existing Workflow Card and Task interaction exactly.
- Assign each canonical document in full to exactly one initial review lane.
- Use TDD for every production change and Chrome only after automated verification is green.

---

### Task 1: Shared Review and Repair Ownership

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts`

**Interfaces:**
- Produces `FoundationDocumentLaneId = 'core-design' | 'technical-assets' | 'presentation'`.
- Produces `FOUNDATION_DOCUMENT_LANES`, the sole immutable lane/path registry.
- Produces `writeFoundationReviewProjection({ workspacePath, revision, laneId })` returning `{ path, digest, byteLength }`.

- [x] **Step 1: Write failing partition tests**

```ts
expect(FOUNDATION_DOCUMENT_LANES.flatMap(lane => lane.ownedPaths))
  .toEqual(CANONICAL_FOUNDATION_DOCUMENTS)
expect(new Set(FOUNDATION_DOCUMENT_LANES.flatMap(lane => lane.ownedPaths)).size)
  .toBe(CANONICAL_FOUNDATION_DOCUMENTS.length)
```

- [x] **Step 2: Write failing projection tests**

Use marked fixtures for all eight documents. Assert each projection contains
only external upstream `(path, sectionId)` pairs declared by owned document
contracts, in canonical order, with exact content, line range, source digest,
revision, lane ID, and tamper rejection.

- [x] **Step 3: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.test.ts
```

Expected: module-not-found failures.

- [x] **Step 4: Implement the registry and projection**

Projection files use this strict shape and live under
`.beegame/reviews/foundation/<revision>/projections/<lane>.json`:

```ts
type FoundationReviewProjection = {
  version: 1
  revision: string
  lane: FoundationDocumentLaneId
  sources: Array<{ path: FoundationDocumentPath; sectionId: string; startLine: number; lineCount: number; content: string; digest: string }>
}
```

Extract marker-bounded bytes without summarizing them. Replace the remediation
lane constant with an import from the shared registry.

- [x] **Step 5: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: define foundation review ownership lanes"
```

---

### Task 2: Lane Packets Replace Role Specialists

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts`

**Interfaces:**
- Produces strict `FoundationReviewLanePacket` with fixed lane/revision and at most 24 candidates.
- Produces `acceptFoundationReviewLanePacket()` with source-authority and exact-observed-byte checks.
- Removes `contract-specialist` and `integration-specialist` prompt vocabulary.

- [x] **Step 1: Write failing packet tests**

Cover strict fields, candidate cap, invalid UTF-8/JSON, stale revision, wrong
lane, duplicate commit, evidence outside lane/projection authority, and an
`observed` value absent from accepted source bytes.

- [x] **Step 2: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
```

- [x] **Step 3: Implement the unreachable lane-packet boundary**

Use `.beegame/reviews/foundation/<revision>/parts/<lane>.json`. Do not delete
or route away from the old evidence module yet: the packet boundary remains
unreachable until Task 3 atomically replaces every old role and prompt.

- [x] **Step 4: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-lane-packet.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "refactor: replace reviewer specialists with lane packets"
```

---

### Task 3: Atomic State-Machine Cutover

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Modify tests: same basenames with `.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-evidence.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts`

**Interfaces:**
- Initial units: `core-design`, `technical-assets`, `presentation`, `synthesis`.
- Verification unit: `verification` only.
- Lane dispatches receive owned full paths and one projection path.
- Synthesis receives exactly three accepted packet paths and no canonical full document.
- Delivery schema becomes 23 with one schema-22 migration.

- [x] **Step 1: Write failing topology tests**

```ts
expect(initial.reports.map(report => report.role)).toEqual([
  'core-design', 'technical-assets', 'presentation', 'synthesis',
])
expect(new Set(laneDispatches.flatMap(item => item.assignment.sourcePaths)).size).toBe(8)
expect(laneDispatches.every(item => item.assignment.sourcePaths.length < 8)).toBe(true)
```

After three accepted packets, assert one synthesis dispatch whose only sources
are those packet paths.

- [x] **Step 2: Add failing recovery and migration tests**

Cover completed-sibling reuse, failed-only retry, reversed completion order,
source/projection/packet tamper, synthesis failure, restart, schema-22 in-flight
review reset, and completed-delivery preservation without executable old roles.

- [x] **Step 3: Run RED**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

- [x] **Step 4: Implement one atomic role/protocol cutover**

Change state invariants, paths, terminal roles, dispatch IDs, usage attribution,
failure/retry/recovery, synthesis barrier, and controller routing together. Do
not support old and new roles simultaneously. In the same commit, replace the
old specialist prompts with lane prompts that list owned full paths and one
projection path; forbid prose/style findings, verdicts, replacement text,
source mutation, and Agent launch. Delete the old evidence module only after
all runtime imports have moved to lane packets.

- [x] **Step 5: Implement schema 22 to 23 migration**

Restart unsuccessful/in-flight old review from current document revision;
preserve brief, documents, resources, implementation evidence, and completed
delivery result. Retain no runtime old-packet adapter.

- [x] **Step 6: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src
git commit -m "refactor: route foundation review through document lanes"
```

---

### Task 4: Parallel Repair and Targeted Verification

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: corresponding remediation, stage, and prompt tests.

**Interfaces:**
- Retains three exclusive repair lanes and receipts.
- Starts only affected repair lanes.
- Verification receives prior review, accepted receipts, modified paths, and directly dependent contract sections, not all eight full documents.

- [ ] **Step 1: Write RED repair/verification scope tests**

Assert affected lanes launch concurrently, unaffected lanes stay
`not_required`, write paths are disjoint, sibling receipts survive retry, and
verification starts only after the receipt barrier without unrelated documents.

- [ ] **Step 2: Implement targeted verification and run GREEN**

Verification checks every prior conflict and direct dependency, preserves open
IDs, writes one canonical review, and stops at `needs_action` rather than
starting initial reviewers or a second repair cycle.

- [ ] **Step 3: Commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-remediation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src/beegame
git commit -m "feat: verify foundation repairs by affected scope"
```

---

### Task 5: Restore Original Workflow Card Tasks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Modify: `apps/frontend/src/types/message.ts`
- Modify: `apps/frontend/src/viewModels/displayModels.ts`
- Test: `apps/frontend/src/viewModels/displayModels.test.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Test: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`

**Interfaces:**
- `projectDocumentDisplayTasks()` returns ordinary review, synthesis, repair, and verification Tasks during `FOUNDATION_REVIEW`.
- API/frontend remove the custom `foundationReview` display object.
- Existing Task layout, icons, status text, progress, controls, and deck remain unchanged.

- [ ] **Step 1: Write RED backend Task tests**

```ts
expect(projected.map(task => [task.title, task.status])).toEqual([
  ['审查核心设计', 'completed'],
  ['审查技术与资产', 'running'],
  ['审查表现体验', 'running'],
  ['汇总阻塞问题', 'pending'],
])
```

Add repair and verification fixtures and assert exact failure propagation.

- [ ] **Step 2: Write RED frontend Task tests**

Assert existing completed/running/pending/failed/stopped Task icons and progress.
Assert no custom Reviewer container, role row, token row, conflict panel,
verdict badge, or remediation panel.

- [ ] **Step 3: Remove the custom display path**

Delete `foundationReviewForDisplay()`, `WorkflowFoundationReviewDisplay`, all
normalizers/adapters for it, and JSX beginning at
`data-testid="workflow-review-report"`. Feed persisted review/remediation state
to ordinary Task projection. Do not change Task CSS or icons.

- [ ] **Step 4: Run GREEN and commit**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/viewModels/displayModels.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add packages/agent-workflow-server/src apps/frontend/src
git commit -m "refactor: show foundation review as workflow tasks"
```

---

### Task 6: Delete Superseded Reviewer Guidance and Protocols

**Files:**
- Delete Reviewer plans dated 2026-08-16 under `docs/superpowers/plans/`.
- Delete: `docs/superpowers/plans/2026-08-17-foundation-review-worker-pipeline.md`
- Delete Reviewer specs dated 2026-08-16 under `docs/superpowers/specs/`.
- Delete: `docs/superpowers/specs/2026-08-17-foundation-review-worker-pipeline-design.md`
- Modify: `docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md`

**Interfaces:** Leaves this approved design/plan as the only active Foundation Reviewer guidance.

- [ ] **Step 1: Delete superseded files with `apply_patch`**

Git history preserves them; the working tree no longer presents rejected
architectures as current guidance.

- [ ] **Step 2: Run the static legacy audit**

```bash
rg -n "contract-specialist|integration-specialist|foundation-review-evidence|workflow-review-report|foundationReviewForDisplay|WorkflowFoundationReviewDisplay|review\.md|decision\.json|CHECKLIST_REVIEW|COMPREHENSIVE_REVIEW" packages/agent-workflow-server/src apps/frontend/src
```

Expected: no production reference. A schema-22 rejection fixture may retain old
literals only when explicitly testing migration.

- [ ] **Step 3: Run full automated verification and commit cleanup**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/viewModels/displayModels.test.ts
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git status --short
git add packages/agent-workflow-server/src apps/frontend/src docs/superpowers
git commit -m "refactor: remove superseded reviewer protocols"
```

---

### Task 7: Chrome Acceptance

**Files:**
- Modify: `docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md`

**Interfaces:** Uses fixed ports and Web/React only; never edits the source acceptance project.

- [ ] **Step 1: Start the fixed-port stack**

```bash
/Users/nswell/.bun/bin/bun run beegame:dev
```

- [ ] **Step 2: Through Chrome, copy the completed eight-document project and start review**

Confirm three Task workers start concurrently, full-document assignments are
disjoint and union to eight, synthesis starts once after three packets, and the
original Task list shows normal status icons without a custom Reviewer panel.

- [ ] **Step 3: Verify repair and targeted verification**

For `NEEDS_REVISION`, confirm only affected repair Tasks run, receipts persist,
successful siblings survive retry, and one verification Task runs without
restarting initial reviewers.

- [ ] **Step 4: Record performance and quality evidence**

Record IDs, full Read count, projection bytes, per-task input/cache/output/
credit/duration, compaction, packet/review/receipt digests, conflict count,
actionability, and final state. Reject if any initial worker compacts, a full
document is assigned twice, synthesis rereads all eight, or Task checkmarks do
not match persisted state.

- [ ] **Step 5: Stop services, rerun verification, and commit acceptance**

```bash
/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src
/Users/nswell/.bun/bin/bunx vitest run apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx
/Users/nswell/.bun/bin/bun run typecheck
git diff --check
git add docs/superpowers/specs/2026-08-17-human-team-foundation-review-design.md
git commit -m "test: accept human-team foundation review"
```

## Plan Self-Review

- Every approved requirement maps to a testable task.
- Review and repair share one ownership map.
- The old topology is removed in the same cutover that activates the new one.
- No task adds Reviewer-specific UI or changes native runtime behavior.
- Schema migration has one boundary and no continuing legacy parser.
- Chrome acceptance combines runtime metrics, Task UI, and report quality.
