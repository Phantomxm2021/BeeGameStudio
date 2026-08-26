# Foundation Document Quality Closure Implementation Plan

> **Execution:** Implementation tasks are delegated to the authorized Luna/high subagents; the primary agent performs Sol/medium audit, correction and final acceptance. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- The service owns the canonical Markdown frame; authors submit only exact contract-bound block bodies. No full-Markdown author stream or fallback remains.
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

- [x] Add failing contract/prompt tests requiring derived-view ownership, prohibiting copied mutable facts and stale “upstream unavailable” branches when the upstream path is present.
- [x] Run the focused tests and confirm they fail because the new rules are absent.
- [x] Update the authority document and the shared contract/prompt once; do not add per-document keyword rules.
- [x] Run the focused tests and confirm they pass.
- [x] Commit the task.

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

- [x] Add failing index tests proving exact boundaries, order and digests for summary, canonical sections and every material.
- [x] Add failing revision tests proving admitted derived blocks may change while unlisted derived and authoritative blocks remain byte-identical.
- [x] Run focused tests and confirm RED for missing derived-block support.
- [x] Extend the one existing index and canonical block validation; reuse it in revision parsing and admission.
- [x] Run focused tests and confirm GREEN.
- [x] Commit the task.

### Task 3: Close semantic coverage with the existing ten checks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts`
- Modify as required by exact manifest fixtures: Foundation semantic/recovery integration tests that snapshot the manifest.
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

**Interfaces:**
- Produces: expanded exact scopes/objectives for existing checks covering spatial geometry/layout, numeric derivation consistency, derived-view consistency, and stale upstream-authority assumptions.
- Consumes: block IDs from Task 2 and the unchanged single semantic manifest/packet path.

- [x] Add failing manifest tests for the expanded exact scopes and assert the manifest still contains exactly ten checks.
- [x] Add packet tests proving only declared derived blocks enter the relevant packets and unrelated blocks remain excluded.
- [x] Run focused tests and confirm RED.
- [x] Update the existing checks and authority table, without adding a generic full-document scan or an eleventh task.
- [x] Run focused tests and confirm GREEN.
- [x] Commit the task.

### Task 4: Verify system behavior and audit the eight generated documents

**Files:**
- Read: the eight staged documents under the current test project's Foundation revision directory.
- Create: `.superpowers/sdd/2026-08-27-foundation-document-quality-closure/eight-document-audit.md`

**Interfaces:**
- Produces: a document-by-document defect and redundancy report, plus generalized authoring/audit corrections; no manual edits to the generated project.
- Consumes: the revised authority, contracts, semantic scopes, and all eight staged documents.

- [x] Run all focused Foundation tests, the complete server suite, typecheck, and `git diff --check`.
- [x] Audit every document for authority ownership, internal consistency, cross-document consistency, layout/scene implementability, derived-value reproducibility, obsolete assumptions, and safely removable repetition.
- [x] Separate case-specific content mistakes from general system failures and map each general failure to its owner prompt, contract, semantic check, or revision admission rule.
- [x] Review the full branch diff for unnecessary abstractions, duplicated logic, compatibility paths, and uncovered behavior.
- [x] Correct any load-bearing findings through the same TDD path, re-run verification, and commit.

### Task 8: Remove late full-document structural failure and semantic restatement

**Files:**
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/authored-document-receipt.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Delete the obsolete Foundation full-Markdown stream implementation and its dedicated tests; remove its session/runner wiring.
- Add or update focused contract, terminal, receipt, controller and prompt tests.

**Interfaces:**
- Produces: one strict author payload containing a human title plus exact `executive_summary`, Section ID and `material.<materialId>` bodies.
- Consumes: the current `GameDocumentContract`; the service derives JSON Schema and assembles all canonical H2/H3 headings, markers and frontmatter from that sole authority.

- [x] Prove RED: a model-authored misspelled/duplicated/out-of-order heading is currently accepted into the stream and rejected only after the whole completion.
- [x] Add the strict block-body schema and service assembly; reject missing, extra or empty block IDs and retain the 2 MiB infrastructure safeguard.
- [x] Route initial and parallel Foundation authors exclusively through the new payload/receipt path.
- [x] Delete full-Markdown stream wiring and tests; do not retain it as compatibility or fallback.
- [x] Strengthen the shared author instruction: one mutable fact is defined in one owner Section; later Sections and derived blocks reference that owner instead of repeating literals or narrating tables.
- [x] Keep final complete-document validation as a strict commit gate and make any remaining structure diagnostic identify missing versus duplicate/extra/order errors precisely.
- [x] Run focused tests, full BeeGame tests, typecheck and `git diff --check`; commit only after main-agent audit.
- [ ] Restart the fixed-port stack and create another brand-new Chrome project from zero. The stopped failed run is read-only evidence and must not be resumed.
