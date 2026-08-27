# Foundation Authority Owner Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the remaining duplicate Production Material/reference-view model with a closed owner catalog, deterministic owner-scoped authority gates, and a same-author Stage 2 correction loop for the eight canonical Foundation Markdown documents.

**Architecture:** The authoritative document is the normative specification at `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`; the approved audit decisions below amend its old material mapping and must be recorded there before code depends on them. Contracts remain the single server-owned catalog, and the existing raw-Markdown author plus existing validation path enforce ownership. Stage 3 Reviewer, Stage 4 revision, and UI behavior remain unchanged.

**Tech Stack:** TypeScript, Bun test, existing Foundation document contracts, raw Markdown parsing and validation, existing Chrome acceptance harness.

**Spec:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md` (normative source of truth; its authority section must state the approved owner catalog before implementation proceeds).

## Global Constraints

- Keep the author transport as one complete raw Markdown body; do not add JSON author output, sidecars, or a second serialization path.
- Treat the spec as authority. The implementation may not invent a mapping that is absent from the reconciled spec.
- The final catalog has no reference-only Production Materials. Delete the `reference_only` enum/member, branches, prompt language, fixtures, and compatibility readers; do not preserve a legacy alias or fallback.
- Exact surviving Production Materials are all owners: GDD `core-loop-diagram`, `game-state-flow`; Level `world-structure-diagram`, `route-choice-diagram`, `pacing-beat-table`; Balance `variable-parameter-table`; Technical `architecture-diagram`, `data-flow-diagram`, `runtime-lifecycle-diagram`, `save-recovery-table`; Art `visual-language-board`, `animation-vfx-state-table`; all five UI materials; Audio `event-cue-matrix`, `music-state-diagram`, `bus-ducking-diagram`, `loudness-delivery-table`; all five Asset materials.
- Delete Level `scene-transition-diagram` and Audio `sound-reference-register`. No stale IDs, titles, manifests, fixtures, semantic scopes, or generated-document expectations may remain.
- Every mutable fact has one owner Section or owner material. GDD delegates numeric values to Balance and interaction/layout to UI; Audio and Art may reference Asset IDs but never own resource production facts; Asset Plan alone owns resource ID, count, source/license, responsibility, and schedule facts.
- Enforce stable IDs as lower-case ASCII dotted namespaces (for example `param.gen.fuel_consumption`); reject CJK IDs, placeholders, aliases such as `action.*` versus `ACTION_*`, and references to undefined owners.
- Mechanical checks are owner-scoped. Never reject a document from a global number count, keyword count, or generic “unresolved” search. Legitimate Level coordinates, UI geometry, Audio loudness, Technical capacity, formulas, and acceptance IDs remain valid in their owner scope.
- Detect malformed Markdown in the existing validation path: unclosed fences/backticks, concatenated IDs, malformed table widths, and invalid material blocks fail closed.
- A downstream author may consume only an existing committed upstream path and its committed Section/Material authority. If the path exists, stale “unavailable” prose is invalid; an unresolved decision is allowed only in the existing dependency/risk location when the contract has no upstream path.
- Stage 2 validation failure is corrected by the same document author against the same staged path. Retry with an unchanged document digest and unchanged violation-set digest is no progress and must fail closed; do not impose fixed token, time, or retry/round caps.
- Do not change Stage 3 Reviewer semantics, Stage 4 Patch Revision semantics, UI, Issue Registry shape, or the existing derived-audit JSON artifacts. Do not add a second author, validator, or compatibility path.
- Completion is measured by correctness and recorded comparison (time, tokens, bytes, dispatches), not by fixed business caps.

---

### Task 1: Reconcile the normative authority spec and closed material catalog

**Files:**
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

**Interfaces:**
- Produces `GameDocumentProductionMaterialContract.authorityMode: 'owner'` as a closed invariant; no `reference_only` type, field value, or branch remains.
- Produces the exact `Record<FoundationDocumentPath, readonly GameDocumentProductionMaterialContract[]>` catalog and per-material `authorityRule`.
- Preserves canonical Section IDs and document paths.

- [ ] **Step 1: Write failing contract tests.** Assert the exact surviving material IDs and order above; assert the two deleted IDs are absent; assert every material has a non-empty owner rule; assert no contract output contains `reference_only`, `derivedViewAuthority`, or a legacy three-board Art contract.
- [ ] **Step 2: Run the focused test and observe RED.** Run `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`; it must fail because the current catalog still contains the deleted materials and reference-only mapping.
- [ ] **Step 3: Update the spec first.** Rewrite the spec’s authority section and content-reduction rules so they state: GDD loop/state diagrams are owners; Level scene transition is deleted; Technical architecture/data-flow/runtime-lifecycle diagrams are owners; Audio sound register is deleted; all survivors are owners; Audio points one-way to Asset resource authority. Remove wording that describes any surviving material as a reference-only view.
- [ ] **Step 4: Implement the minimal catalog change.** Change only the existing contract catalog/helper and output-policy references needed for the closed owner model. Delete the Level scene-transition and Audio sound-reference entries, make the five newly promoted diagrams owners, and remove the `reference_only` union/constructor argument/branch and obsolete derived-view policy fields. Keep all other Section IDs and upstream topology intact.
- [ ] **Step 5: Run the focused test and observe GREEN.** Run the same Bun test and confirm the mapping, order, format, owner rules, and absence assertions pass.

---

### Task 2: Collapse author prompts to owner-only Markdown instructions

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify fixtures only where the deleted material IDs are referenced: existing Foundation author/complete-document tests.

**Interfaces:**
- Initial and parallel Foundation author prompts serialize the same owner rule exactly once per material.
- The prompt requires one complete raw Markdown body and one representation per fact.
- The prompt contains no reference-only, derived-view, parallel-author, alias, or compatibility instruction.
- Existing Reviewer/revision/Stage 3/Stage 4 prompt branches remain byte- and behavior-equivalent except for compile-time catalog updates.

- [ ] **Step 1: Write failing prompt tests.** For both `initial` and `parallel-draft`, count each material’s serialized owner rule once; assert raw Markdown is required; assert no prompt contains `reference-only`, `reference_only`, or “all Production Materials are derived”; assert the prompt rejects aliases and directs Audio resource facts to Asset.
- [ ] **Step 2: Run the focused tests and observe RED.** Run `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`; current prompt text and conditional material serialization must fail the new owner-only assertions.
- [ ] **Step 3: Replace only the shared Foundation author instruction.** Describe owner materials as the single canonical representation, stable IDs as the only cross-document reference, and the eight responsibility boundaries. Keep the existing committed-upstream conditional: present paths must be used directly; only a contract with no path may record an unresolved dependency/risk row.
- [ ] **Step 4: Remove dead prompt code.** Delete reference-only formatting/validation branches and deleted material-specific wording. Do not alter packet workers, Reviewer behavior, revision dispatch, or UI-facing prompt contracts.
- [ ] **Step 5: Run the focused tests and observe GREEN.** Re-run the prompt tests and the compile-time fixture tests that build complete Foundation documents.

---

### Task 3: Add stable-ID and owner-scoped authority checks to the existing Markdown gate

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Test: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Test/modify existing fixture builders only when their material list follows the new catalog.

**Interfaces:**
- `validateCompleteGameDocumentMarkdown(path, value): string` remains the sole complete-document admission function.
- Its material loop resolves each material body against the contract owner rule and rejects undefined IDs, aliases, placeholders, and facts outside their declared owner scope.
- No new JSON output, sidecar, or parallel validator is introduced.

- [ ] **Step 1: Write failing gate tests.** Add Markdown fixtures that reject an undefined `param.repair_crew_effort`, `action.attack` paired with `ACTION_ATTACK`, a CJK/placeholder ID, a resource ID invented by Audio or Art, and a copied Balance value/formula in a non-owner location. Add passing fixtures for Level coordinates, UI responsive geometry, Audio loudness, Technical capacity, formula IDs, and acceptance IDs in their owner materials.
- [ ] **Step 2: Add the explicit Balance regression cases.** The rejection fixture must cover `[0,1]`, `0.1`, `clamp(V_P_FLOOR,V_P_CEIL)`, `clamp(1,5)`, `0–3`, and `≤1` in a Balance non-owner block; the passing fixture must contain prose plus stable variable, formula, scenario, and acceptance references without requiring empty material content.
- [ ] **Step 3: Run the focused tests and observe RED.** Run `bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`; the existing gate should accept at least some of these invalid authority forms.
- [ ] **Step 4: Implement owner-scoped extraction and resolution.** Extract each complete Section/Material body once, collect only IDs and literals governed by that owner’s rule, resolve references against the committed owner catalog, and fail closed on unresolved/aliased ownership. Use the contract’s owner scope rather than global numeric or keyword heuristics.
- [ ] **Step 5: Run the focused tests and observe GREEN.** Re-run the complete-document tests and verify legitimate literals remain accepted while copied facts and invalid references fail with location-bearing diagnostics.

---

### Task 4: Harden Markdown integrity and upstream freshness without a second gate

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Test: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts` only for the existing upstream-path contract.

**Interfaces:**
- The existing validator returns the normalized Markdown string or throws a deterministic diagnostic; it does not emit a new artifact.
- Existing author readiness continues to expose only committed upstream paths through `readyDraftPaths`.
- A document cannot pass when its known committed upstream authority is described as unavailable or when an unresolved row is outside the existing dependency/risk sections.

- [ ] **Step 1: Write failing integrity tests.** Feed the existing validator an unclosed code fence, unclosed inline backtick, concatenated material/ID token, uneven Markdown table pipes, malformed Mermaid fence, and a deleted material marker; each must fail with the relevant material/line diagnostic.
- [ ] **Step 2: Write failing freshness tests.** Build a Level/Balance/Technical/Asset author packet with a committed upstream path and stale “unavailable” prose; assert rejection. Build a packet with no contract upstream path and an unresolved dependency/risk row; assert acceptance. Assert no separate validator function or output file is needed.
- [ ] **Step 3: Run the focused tests and observe RED.** Run both focused Bun test files; current structural checks do not cover all corruption and freshness cases.
- [ ] **Step 4: Extend the existing scan once.** Reuse the current fence, heading, block, table, and canonical-path scan; add deterministic diagnostics for backticks, concatenated IDs, table widths, and stale upstream claims. Feed committed-path state into the existing author contract/readiness check; do not scan arbitrary prose for the word “unresolved.”
- [ ] **Step 5: Run the focused tests and observe GREEN.** Confirm malformed raw Markdown and stale upstream claims fail, while valid owner-scoped Markdown and explicitly permitted unresolved dependency rows pass.

---

### Task 5: Add same-author Stage 2 correction and no-progress fail-closed behavior

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts`

**Interfaces:**
- Recoverable Stage 2 validation failures re-dispatch the same `document-author` identity for the same canonical document path and staged authority.
- Retry prompt carries only the structured validation diagnostics and keeps the original author’s scope; it never creates a parallel author or writes a second document.
- A retry may continue only when either document digest or the deterministic violation-set digest changes.
- An unchanged pair `{documentDigest, violationSetDigest}` is terminal fail-closed evidence; no candidate publication or silent PASS is allowed.

- [ ] **Step 1: Write failing integration tests.** Simulate a malformed author result, assert the next dispatch has the same worker type, document path, author identity, and staged base, and assert the prompt contains the exact diagnostics. Simulate a changed document that fixes one violation and assert revalidation continues.
- [ ] **Step 2: Write the no-progress test.** Return identical document bytes and identical sorted violation set twice; assert the controller stops retrying, records an authority-no-progress failure, does not publish canonical bytes, and does not enter Reviewer/Stage 3.
- [ ] **Step 3: Run focused tests and observe RED.** Run `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts`; current failure handling marks recoverable author failures directly rather than closing the same-author loop.
- [ ] **Step 4: Implement the minimal Stage 2 retry transition.** Preserve the existing document author dispatch record, staged path, and upstream authority; attach a stable digest of normalized Markdown and sorted violations; auto-dispatch the same author after a recoverable gate failure. Mark only unchanged digest plus unchanged violations as fail-closed no progress. Do not add a fixed token, duration, attempt, or round cap.
- [ ] **Step 5: Run focused tests and regression tests.** Re-run both files plus existing transition/recovery tests and assert Stage 3 Reviewer, Stage 4 revision, Issue Registry, and UI state transitions remain unchanged.

---

### Task 6: Validate the final implementation and run a clean eight-document acceptance

**Files:**
- Test/modify only existing tests and harness assertions: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`, `worker-prompts.test.ts`, `complete-game-document.test.ts`, `foundation-authoring-batch.test.ts`, `foundation-fact-runtime.integration.test.ts`, `foundation-semantic-audit.test.ts`.
- Runtime output: one fresh test project and its existing local workflow logs; do not commit generated project documents or a new report artifact.

**Interfaces:**
- Produces measured wall time, token usage, output bytes, dispatch/retry count, and validation diagnostics for the eight canonical Markdown documents.
- Stops immediately before Reviewer/Stage 3 execution; no Stage 3 Reviewer or Stage 4 revision call is made.

- [ ] **Step 1: Run all focused tests.** Run `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-authoring-batch.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts`; all must pass.
- [ ] **Step 2: Run repository verification.** Run `bun run typecheck`, `bun test`, and `git diff --check`; investigate failures without weakening owner gates or adding compatibility.
- [ ] **Step 3: Start a fresh project from the same polar-station brief through the existing Chrome workflow.** Run only Stage 2 generation and same-author correction until all eight documents are admitted.
- [ ] **Step 4: Audit the generated Markdown before Reviewer.** Confirm exactly eight canonical paths; zero deleted material IDs; zero reference-only strings; zero undefined/aliased IDs; zero owner-scope violations; zero malformed Markdown; zero stale “unavailable” claims where upstream is committed; one owner representation per mutable fact; Audio references Asset one-way; no second author dispatch lane.
- [ ] **Step 5: Pause before Reviewer and record comparison data.** Capture actual duration, input/output/cache tokens, UTF-8 output bytes, dispatch/retry events, and any violation-set changes. Compare with the baseline for diagnosis only; do not impose a hard business cap and do not run Reviewer or revision.
- [ ] **Step 6: Perform final plan self-review before handoff.** Search the implementation diff for `reference_only`, deleted IDs, “derived view,” global number/keyword heuristics, fixed caps, second author/validator, JSON author output, and Stage 3/Stage 4/UI changes. Every remaining hit must be either an intentional test asserting absence or be removed through a new RED-to-GREEN cycle.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-08-27-eight-document-authority-material-closure.md`. Execute with `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans`; each task must keep its RED-to-GREEN evidence and make a small implementation commit before the next task.
