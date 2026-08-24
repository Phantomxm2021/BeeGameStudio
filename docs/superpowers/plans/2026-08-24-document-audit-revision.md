# Bee Game Studio Document Audit and Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the authoritative Fact Store + Rule/Contract + semantic audit + issue-driven batch revision pipeline after the eight canonical Markdown documents are committed.

**Architecture:** Preserve the existing Document Author path byte-for-byte in behavior. After all eight author receipts are committed, derive section indexes and facts, run deterministic checks, send only unresolved semantic slices to reviewers, compile one Issue Registry, revise affected documents in parallel batches, and validate only changed facts/contracts before continuing to checklist drafting.

**Tech Stack:** TypeScript, Bun, Zod, existing Bee Game Studio delivery workflow runtime, React workflow task UI.

**Spec:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Global Constraints

- The authority document above is the only product/architecture authority for this work.
- Do not change Document Author prompts, author permissions, author output format, `document-stage.ts`, `foundation-authoring-batch.ts`, or the eight canonical Markdown contracts.
- Fact Store and Section Index are derived only after all eight Markdown documents have durable `committed` checkpoints.
- Delete the legacy candidate/projection/synthesis/B-numbering Reviewer path before adding the replacement; do not preserve dual readers, migrations, compatibility flags, or legacy schema fields.
- Local code owns parsing, schema checks, rule checks, contract checks, digests, path validation, issue compilation, impact analysis, and targeted validation.
- LLM workers receive only unresolved issues, target sections, and required facts; they never receive an unconditional eight-document bundle.
- Only L3 Deep Audit may receive full-document content, and only for a specific HIGH/BLOCKER uncertainty that cannot be resolved from indexed sections.
- Revision groups issues by target document and edits only assigned Markdown sections in isolated staging.
- Persist duration and token usage per extraction, semantic audit, deep audit, revision, and targeted validation task so actual cost can be audited by task.
- Dashboard output remains ordinary workflow tasks with pending/running/completed/failed states; do not add a Reviewer-specific panel or raw JSON display.
- Existing projects using the deleted schema are not migrated in this feature branch; only new runs on the single new schema are supported.

---

### Task 1: Remove the legacy Reviewer control plane and install a clean boundary

**Files:**
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-document-lanes.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-assembly.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-markdown.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-projection.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-stage.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review-state.test.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.ts`
- Delete: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-review.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/delivery-gate.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-boundary.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-author-boundary.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts`

**Interfaces:**
- Consumes: eight committed `FoundationDocumentCheckpoint` values.
- Produces: `canStartFoundationAudit(run: DeliveryRun): boolean` and a compile-safe `DOCUMENT_REVIEW` boundary with no legacy Reviewer dispatches or artifacts.

- [ ] **Step 1: Write failing boundary tests**

```ts
test('does not enter document review before all eight author receipts commit', () => {
  expect(canStartFoundationAudit(runWithSevenCommittedDocs())).toBe(false)
})

test('does not dispatch a legacy reviewer after the eighth author receipt', async () => {
  const dispatches = await resumeAfterEighthAuthorReceipt()
  expect(dispatches).toEqual([])
  expect(await readRunStatus()).toMatchObject({
    phase: 'DOCUMENT_REVIEW',
    status: 'needs_action',
    blockedReason: 'foundation audit implementation unavailable',
  })
})
```

- [ ] **Step 2: Run the focused tests and verify they fail against the legacy control plane**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-author-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts`

Expected: FAIL because legacy Reviewer modules/state/dispatches still exist.

- [ ] **Step 3: Delete the listed legacy modules and remove every import, state field, schema branch, recovery path, prompt branch, and delivery-gate dependency that exists only for candidate/projection/synthesis/review.json v3**

The temporary clean boundary must keep `DOCUMENT_REVIEW` stopped with a deterministic `foundation audit implementation unavailable` state until Task 2 installs the new state. It must never fall back to legacy dispatch.

- [ ] **Step 4: Verify authoring regression and deletion completeness**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/document-author-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.test.ts`

Run: `rg -n "foundation-review-(assembly|markdown|projection|stage|state)|candidateReferences|FOUNDATION_REVIEW_VERSION|B[1-9]" packages/agent-workflow-server/src apps/frontend/src`

Expected: tests PASS; search returns no production legacy authority references.

- [ ] **Step 5: Commit the clean cutover**

```bash
git add -A
git commit -m "refactor: remove legacy foundation reviewer control plane"
```

### Task 2: Derive Section Index and Fact Store after authoring

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Test: matching `.test.ts` files for each module
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Interfaces:**
- Produces:

```ts
type SectionRef = { documentPath: FoundationDocumentPath; sectionId: string; heading: string; startLine: number; endLine: number; digest: string }
type FactValue = string | number | boolean | string[] | number[]
type FoundationFact = { key: string; value: FactValue; source: SectionRef }
type FoundationAuditManifest = { revision: string; sectionIndexDigest: string; factStoreDigest: string }
```

- [ ] **Step 1: Write failing tests for heading indexing, deterministic digests, duplicate fact rejection, and the eight-committed-doc gate.**
- [ ] **Step 2: Run the new tests and verify missing implementations fail.**
- [ ] **Step 3: Implement local Markdown section indexing and contract-defined fact extraction; write artifacts beneath `.beegame/audit/foundation/<revision>/derived/`.**
- [ ] **Step 4: Add one strict `foundationAuditState` schema; do not add compatibility readers.**
- [ ] **Step 5: Run the focused tests plus the untouched authoring tests.**
- [ ] **Step 6: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: derive foundation audit facts after authoring"
```

### Task 3: Implement Schema, Rule, and Contract checks

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-issue-registry.ts`
- Test: matching `.test.ts` files

**Interfaces:**

```ts
type AuditIssue = {
  id: string
  severity: 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
  type: 'schema' | 'rule' | 'contract' | 'semantic'
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  fixDocument: FoundationDocumentPath
  fixSectionId: string
}
```

- [ ] **Step 1: Write failing tests for missing fields, inconsistent numeric facts, missing referenced entities, cross-document contract mismatch, stable issue IDs, and duplicate issue rejection.**
- [ ] **Step 2: Run tests and confirm failures.**
- [ ] **Step 3: Implement deterministic checks and compile their results into one Issue Registry.**
- [ ] **Step 3: Implement deterministic checks and compile their results into one Issue Registry. Read existing document contracts through their current exports; do not edit `game-document-contracts.ts`.**
- [ ] **Step 4: Verify zero model dispatches are produced when all checks are deterministically decidable.**
- [ ] **Step 5: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: add deterministic foundation audit checks"
```

### Task 4: Add targeted semantic and deep audit workers

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Interfaces:**
- Consumes: unresolved check ID, required facts, and exact section slices.
- Produces: bounded semantic issues accepted by `foundation-issue-registry.ts`.

- [ ] **Step 1: Write failing tests proving semantic workers cannot request all eight documents, cannot write canonical docs, and cannot emit issues outside assigned sections.**
- [ ] **Step 2: Add the cheap semantic worker contract and strong-model escalation only for HIGH/BLOCKER uncertainty.**
- [ ] **Step 3: Ensure local code merges worker issues into the registry and rejects unstable or duplicate identities.**
- [ ] **Step 4: Run prompt, dispatch, contract, and audit tests.**
- [ ] **Step 5: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: add targeted semantic foundation audit"
```

### Task 5: Implement issue-driven batch revision and targeted validation

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.ts`
- Test: matching `.test.ts` files
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/delivery-gate.ts`

**Interfaces:**

```ts
type RevisionBatch = { documentPath: FoundationDocumentPath; sectionIds: string[]; issueIds: string[] }
type PatchValidation = { issueId: string; status: 'PASS' | 'FAIL'; checkedFactKeys: string[]; checkedContractIds: string[] }
```

- [ ] **Step 1: Write failing tests for grouping all issues of one document into one batch, parallel batches across documents, protected unrelated paths, and exact issue coverage.**
- [ ] **Step 2: Implement isolated Markdown revision dispatches and atomic publish only after every batch succeeds.**
- [ ] **Step 3: Rebuild only changed facts/sections, calculate impacted contracts, and validate only those issues/contracts.**
- [ ] **Step 4: Implement the authority document stop policy: Round 1 fixes BLOCKER/HIGH/MEDIUM; Round 2 fixes new BLOCKER/HIGH; Round 3 fixes BLOCKER; no BLOCKER proceeds with remaining MEDIUM/LOW recorded as Known Issues.**
- [ ] **Step 5: Verify failure, restart, and no-progress recovery without a second legacy path.**
- [ ] **Step 6: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: add issue-driven foundation revision"
```

### Task 6: Route ordinary Dashboard tasks and complete end-to-end acceptance

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-display-tasks.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/display-progress.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/workflow-stage-card-history.ts`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowStageCard.tsx`
- Modify: `apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx`
- Modify: `apps/frontend/src/viewModels/displayModels.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/session-routes.test.ts`
- Test: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

**Interfaces:**
- Audit tasks: deterministic checks, semantic checks, and issue compilation.
- Revision tasks: one ordinary task per affected document; completed tasks display a checkmark.

- [ ] **Step 1: Write failing display tests for ordinary audit/revision tasks and completed checkmarks; remove expectations for core-design/technical-assets/presentation/synthesis cards.**
- [ ] **Step 2: Project new audit and revision state into existing workflow task display models without exposing raw JSON.**
- [ ] **Step 3: Add the end-to-end workflow test: eight committed docs → derived artifacts → audit → issue tasks → batch revisions → targeted validation → checklist drafting.**
- [ ] **Step 4: Run full delivery workflow tests, frontend tests, and typecheck.**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow`

Run: `bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/__tests__/session-routes.test.ts`

Run: `bun test apps/frontend/src/components/Demiurge/WorkflowCard.test.tsx apps/frontend/src/viewModels/displayModels.test.ts`

Run: `bun run typecheck`

- [ ] **Step 5: Start Bee Game Studio from this worktree and create one new Chrome project; verify all eight docs commit before audit, revision tasks complete with checkmarks, targeted validation reaches PASS, and checklist drafting starts automatically. Keep Chrome open.**
- [ ] **Step 6: Run the legacy/double-track scan and commit.**

Run: `rg -n "candidateReferences|Foundation Review Selection|FOUNDATION_REVIEW_VERSION|core-design|technical-assets|presentation|synthesis|foundationRevisionCycle|legacy" packages/agent-workflow-server/src/beegame/delivery-workflow apps/frontend/src`

Expected: no old Reviewer/revision authority or dual-track production code remains.

```bash
git add packages/agent-workflow-server/src apps/frontend/src
git commit -m "feat: deliver incremental document audit and revision"
```

## Final Acceptance

- Eight canonical Markdown documents are unchanged in authoring behavior and must commit before audit starts.
- Every derived artifact is revision-bound and digest-validated.
- Deterministic checks consume zero model tokens.
- Semantic workers receive only bounded facts/sections.
- Issue Registry is the sole revision authority.
- One affected document creates one revision task per round.
- Recheck is limited to changed facts, impacted contracts, and unresolved issues.
- No legacy Reviewer, compatibility reader, revision dual track, or Reviewer-specific UI remains.
- Workflow proceeds automatically to checklist drafting when the stop policy passes.
