# Foundation Document Quality Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the existing ten semantic risk checks detect and repair cross-section layout, scene, derived-value, and stale-authority defects without adding a second audit track or manually patching one test project.

**Architecture:** Keep the single Foundation audit/revision state machine and its ten authority-selected risk domains. Extend the existing immutable block index so Executive Summary and each service-marked Production Material are addressable derived blocks, then widen only the relevant existing semantic packets. Revision remains Issue-driven and may change only admitted block IDs in one document.

**Tech Stack:** TypeScript, Bun test, existing Foundation document contracts, section index, semantic audit manifest, revision packet/patch validation.

**Spec:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Global Constraints

- Reviewer/audit remains display Stage 3; revision remains display Stage 4.
- Keep one `foundationAuditState`, one Issue Registry, and one reviewer→revision loop until the Registry is empty.
- Do not add fixed business token, time, round, Issue-count, or document-size limits.
- Do not add compatibility fields, fallback readers, a second block index, another queue, or new UI.
- Every mutable fact has one authoritative owner; Executive Summary and Production Materials are derived views and cannot create independent authority.
- Existing ten semantic checks remain ten risk-domain tasks; improve their declared scope instead of multiplying generic audits.
- Revision may change only exact admitted block IDs in one canonical document, and all other bytes remain immutable.
- Follow TDD: add a failing behavioral test, verify RED, implement the smallest shared-path fix, verify GREEN.

---

### Task 1: Revise the authority and authoring contract

**Files:**
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`

**Interfaces:**
- Produces: output-policy rules that make Executive Summary an authority index and Production Materials derived compact views with owner references and no independently maintained mutable totals.
- Consumes: existing `GameDocumentOutputPolicy` and shared Foundation author instruction.

- [ ] Add failing contract/prompt tests requiring derived-view ownership, prohibiting copied mutable facts and stale “upstream unavailable” branches when the upstream path is present.
- [ ] Run the focused tests and confirm they fail because the new rules are absent.
- [ ] Update the authority document and the shared contract/prompt once; do not add per-document keyword rules.
- [ ] Run the focused tests and confirm they pass.
- [ ] Commit the task.

### Task 2: Make summaries and production materials addressable blocks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts`
- Modify as required by existing tests: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts`

**Interfaces:**
- Produces: stable patchable block IDs `executive_summary` and `material.<materialId>` from existing service-owned markers.
- Consumes: existing `beegame-executive-summary`, `beegame-section:*`, and `beegame-material:*` markers; no new document format.

- [ ] Add failing index tests proving exact boundaries, order and digests for summary, canonical sections and every material.
- [ ] Add failing revision tests proving admitted derived blocks may change while unlisted derived and authoritative blocks remain byte-identical.
- [ ] Run focused tests and confirm RED for missing derived-block support.
- [ ] Extend the one existing index and canonical block validation; reuse it in revision parsing and admission.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit the task.

### Task 3: Close semantic coverage with the existing ten checks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts`
- Modify as required by exact manifest fixtures: Foundation semantic/recovery integration tests that snapshot the manifest.
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

**Interfaces:**
- Produces: expanded exact scopes/objectives for existing checks covering spatial geometry/layout, numeric derivation consistency, derived-view consistency, and stale upstream-authority assumptions.
- Consumes: block IDs from Task 2 and the unchanged single semantic manifest/packet path.

- [ ] Add failing manifest tests for the expanded exact scopes and assert the manifest still contains exactly ten checks.
- [ ] Add packet tests proving only declared derived blocks enter the relevant packets and unrelated blocks remain excluded.
- [ ] Run focused tests and confirm RED.
- [ ] Update the existing checks and authority table, without adding a generic full-document scan or an eleventh task.
- [ ] Run focused tests and confirm GREEN.
- [ ] Commit the task.

### Task 4: Verify system behavior and audit the eight generated documents

**Files:**
- Read: the eight staged documents under the current test project's Foundation revision directory.
- Create: `.superpowers/sdd/2026-08-27-foundation-document-quality-closure/eight-document-audit.md`

**Interfaces:**
- Produces: a document-by-document defect and redundancy report, plus generalized authoring/audit corrections; no manual edits to the generated project.
- Consumes: the revised authority, contracts, semantic scopes, and all eight staged documents.

- [ ] Run all focused Foundation tests, the complete server suite, typecheck, and `git diff --check`.
- [ ] Audit every document for authority ownership, internal consistency, cross-document consistency, layout/scene implementability, derived-value reproducibility, obsolete assumptions, and safely removable repetition.
- [ ] Separate case-specific content mistakes from general system failures and map each general failure to its owner prompt, contract, semantic check, or revision admission rule.
- [ ] Review the full branch diff for unnecessary abstractions, duplicated logic, compatibility paths, and uncovered behavior.
- [ ] Correct any load-bearing findings through the same TDD path, re-run verification, and commit.

