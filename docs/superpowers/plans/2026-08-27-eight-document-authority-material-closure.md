# Eight-Document Authority and Material Closure Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce semantic duplication in the eight canonical Foundation documents by assigning fact-level authority to every Production Material, collapsing Art's three boards into one visual board, and mechanically rejecting copied Balance literals and formulas from reference-only materials.

**Architecture:** Keep the existing raw-Markdown author lane, closed H2 section protocol, canonical block index, and Stage 3/Stage 4 workflow unchanged. Replace the global “all Production Materials are derived views” assumption with per-material `authorityMode` and `authorityRule`; use those contracts in the shared author prompt and in the existing complete-document Markdown gate.

**Tech Stack:** TypeScript, Bun test, existing Foundation document contracts, raw Markdown validation.

**Spec:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Global Constraints

- Keep raw Markdown author output; do not introduce JSON document author transport.
- Do not change Reviewer behavior, check count/objectives, Stage 3, Stage 4, revision dispatch, or UI. The only permitted semantic-manifest edit is replacing deleted Art material IDs with the single new board ID so no stale or compatibility path remains.
- Do not add compatibility aliases, fallback readers, a second author path, or a second validator path.
- Do not impose fixed token, word, time, heading, table, row, diagram, or example limits.
- Keep the existing canonical H2 section IDs because the existing audit index consumes them; reduce duplicated content through fact ownership and section purposes.
- Every mutable fact has one owner representation. An owner material replaces duplicated section rows; a reference-only material contains stable owner references, not copied literals or formulas.
- Art has one compact `visual-language-board`; the prior three-board contract is removed rather than supported in parallel.
- Exact material authority mapping: GDD both materials are `reference_only`; Level world structure, route choice, and pacing beat are `owner` while scene transition is `reference_only`; Balance variable/parameter is `owner` and its other three materials are `reference_only`; Technical save/recovery is `owner` and its other three materials are `reference_only`; both Art materials are `owner`; all five UI materials are `owner`; Audio event/cue, music state, bus/ducking, and loudness/delivery are `owner` while sound references are `reference_only`; all five Asset materials are `owner`.
- Follow TDD: add a behavioral test, observe the expected failure, implement the smallest shared-path change, then observe it pass.

---

### Task 1: Assign material-level authority and align eight document prompts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`

**Interfaces:**
- Produces: `GameDocumentProductionMaterialContract.authorityMode: 'owner' | 'reference_only'` and `authorityRule: string`.
- Produces: one shared raw-Markdown author instruction that explains owner materials, reference-only materials, one-representation-per-fact, concise N/A handling, and the eight per-document responsibility boundaries.
- Removes: `GameDocumentOutputPolicy.productionMaterialStyle` and `derivedViewAuthority`.

- [ ] Add failing contract tests proving every material has a non-empty authority rule, the approved owner/reference-only mapping is exact, Art contains only `visual-language-board` and `animation-vfx-state-table`, and the obsolete global derived-view fields are absent.
- [ ] Add failing prompt tests proving initial and parallel authors receive each material's authority mode/rule exactly once, raw Markdown remains required, and no global “Production Materials are derived compact views” instruction remains.
- [ ] Run the focused tests and confirm RED because per-material authority is absent and Art still has three boards.
- [ ] Add the two fields to the existing material contract/helper, encode the approved mapping, remove the two obsolete output-policy fields, and revise the existing section purposes/merge rules to name what is owned, referenced, merged, or omitted without changing H2 IDs.
- [ ] Replace only the shared authoring sentence that assumes every material is derived; reuse the serialized complete-document contract rather than adding a second prompt table.
- [ ] Run the focused tests and confirm GREEN.

### Task 2: Reject copied Balance facts in reference-only Markdown materials

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`

**Interfaces:**
- Consumes: `GameDocumentProductionMaterialContract.authorityMode`.
- Produces: existing `validateCompleteGameDocumentMarkdown(path, value)` rejects copied numeric literals, percentages/ranges, complete formula expressions, and non-reference inline-code expressions inside Balance reference-only material blocks.

- [ ] Add a failing test using the real rejected Balance fragment forms: `[0,1]`, `0.1`, `clamp(V_P_FLOOR,V_P_CEIL)`, `clamp(1,5)`, `0–3`, and `≤1`.
- [ ] Add a passing fixture containing prose plus stable variable, formula, scenario, and acceptance references, proving the validator does not require empty or JSON materials.
- [ ] Run the focused test and confirm RED because the current validator checks only Markdown format.
- [ ] Extract each material body once in the existing validation loop and apply the minimal reference-only Balance checks there; do not create another document validation pipeline.
- [ ] Run the focused tests and confirm GREEN.

### Task 3: Revise authority documentation and verify the authoring boundary

**Files:**
- Modify: `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts` only to replace the deleted Art material IDs with `material.visual-language-board`.
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts` only for that exact ID replacement.
- Modify as required by exact contract fixtures: existing Foundation author/complete-document tests only.

**Interfaces:**
- Produces: normative per-material authority rules and the eight document ownership/omission rules.
- Preserves: Reviewer and revision stages exactly as currently specified.

- [ ] Replace the blanket “Production Materials are derived views” rule with fact-level owner/reference-only semantics and document the exact material mapping.
- [ ] Document the eight content-reduction rules: GDD delegates numeric and interaction details; Level owns spatial facts only; Balance owns variables/formulas and references them elsewhere; Technical owns runtime boundaries; Art owns one compact visual board and no resource production facts; UI owns interaction/layout mappings; Audio owns cue/mix mappings and no resource production facts; Asset alone owns resource production facts.
- [ ] State that SVG is not intrinsically required while visual acceptance evidence is, and that the one Art board may use compact inline SVG without three parallel boards.
- [ ] State that quality and performance are evaluated by correctness and measured comparison, not fixed business limits.
- [ ] Replace the two existing semantic-scope references to the three deleted Art boards with the one canonical `material.visual-language-board`; preserve all ten checks, objectives, models and workflow behavior.
- [ ] Run contract, prompt, complete-document, author-session, and document-stage focused tests; then run the complete server suite, typecheck, and `git diff --check`.
- [ ] Review the final diff for a second author lane, stale three-board markers, global derived-view assumptions, fixed business limits, or Reviewer/Stage changes; correct any load-bearing finding through a new RED→GREEN cycle.

### Task 4: Run one clean eight-document Chrome acceptance

**Files:**
- Create through the application only: one new project from the same polar-station brief used by the baseline.
- Read: generated eight canonical Foundation Markdown files and local workflow logs.

**Interfaces:**
- Produces: measured Stage 2 wall time, token usage, output bytes, retry/dispatch count, and an eight-document authority/duplication audit.
- Stops: immediately when Stage 3 Reviewer becomes available; does not execute Reviewer or revision.

- [ ] Start the verified local stack and create a fresh project from zero through Chrome.
- [ ] Wait for all eight Foundation documents to complete, then pause before Reviewer work begins.
- [ ] Verify zero stale canonical paths, zero Balance reference-only literals/formulas, zero Art/Audio resource-production ownership, one Art visual board, and no duplicate author dispatch/retry lane.
- [ ] Compare actual time, token usage, and output bytes with the current baseline without imposing a pass/fail hard cap.
- [ ] Record any case-specific content defect separately from a generalized contract defect; do not patch the generated project.
