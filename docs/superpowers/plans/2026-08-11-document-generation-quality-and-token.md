# Complete Game Document Quality and Token Optimization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate the same eight complete professional game documents with discipline-specific production materials, document-level audit appendices, bounded section authority projection, and substantially fewer model/tool turns.

**Architecture:** Keep `GAME_DOCUMENT_CONTRACTS` as the single responsibility authority. Extend each contract with exact production-material and upstream-section contracts, validate one compact document-level Markdown structure, and project only those exact canonical upstream sections into each document author session. Claude Code writes one complete file with native tools; BGS validates after the turn and permits at most one targeted structural correction.

**Tech Stack:** TypeScript, Bun test, Zod v4, existing BeeGame delivery workflow, native Claude Code file tools, Chrome end-to-end verification.

---

## Mandatory Chrome Acceptance Gate

This work is not accepted from code review, API calls, fixtures, or unit tests alone. After implementation, run the real Idea → document-authoring flow through the user's Chrome session and preserve one evidence packet for the complete writing stage.

The Chrome run must:

- create a disposable project from a neutral, project-independent idea entered through the visible UI; never hard-code the acceptance idea into product code or test fixtures;
- use the model and permissions selected in BeeGame Studio settings without BGS rewriting Claude Code's reasoning, tools, prompts, or native configuration;
- observe the workflow from document authoring start until all eight required documents are durably written, or until the first real failure;
- record wall-clock start/end time, per-document duration, total duration, model request count, tool-call count, input tokens, cache-read tokens, cache-creation tokens, output tokens, total tokens, retries, and corrections from persisted workflow evidence;
- retain the eight on-disk documents and audit each document for its owned responsibility, professional completeness, production usability, readability for humans and agents, required production materials, excessive repetition, template residue, and unsupported metadata;
- report token and time concentration by document so unusually expensive or slow stages are visible rather than hidden in an aggregate;
- verify through the UI that completion state, usage, errors, and written paths agree with persisted server evidence;
- delete only the disposable acceptance project after evidence has been captured, leaving all existing user projects untouched.

Acceptance requires all eight documents to exist at the configured external project root, pass their canonical structural contracts, and be usable as implementation authority. The final report must state observed quality, speed, and consumption with raw measurements. Do not invent a pass threshold before measuring the run, and do not mark the work complete if Chrome, persisted usage evidence, or on-disk outputs disagree.

---

### Task 1: Restore a compilable baseline

**Files:**
- Modify: `src/QueryEngine.ts`
- Verify: `src/utils/__tests__/cacheSafeParamsSlot.test.ts`

- [ ] **Step 1: Preserve the observed red state**

Run: `/Users/nswell/.bun/bin/bun run typecheck`

Expected: FAIL with duplicate `promptCacheKeyOverride` identifier and variable errors.

- [ ] **Step 2: Remove only duplicate declarations and spreads**

Keep exactly one config field, one destructured variable, and one conditional state spread in each state-construction path:

```ts
promptCacheKeyOverride?: string

const { promptCacheKeyOverride } = config

...(promptCacheKeyOverride ? { promptCacheKeyOverride } : {}),
```

- [ ] **Step 3: Verify the baseline**

Run: `/Users/nswell/.bun/bin/bun test src/utils/__tests__/cacheSafeParamsSlot.test.ts`

Expected: PASS.

Run: `/Users/nswell/.bun/bin/bun run typecheck`

Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/QueryEngine.ts
git commit -m "fix: deduplicate workflow cache override"
```

### Task 2: Add discipline production-material and upstream-section contracts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

- [ ] **Step 1: Write failing contract tests**

Add tests asserting every document has unique production material IDs, supported formats, and only existing section IDs in every upstream projection:

```ts
test('binds every document to exact production materials and upstream sections', () => {
  for (const contract of Object.values(GAME_DOCUMENT_CONTRACTS)) {
    expect(contract.productionMaterials.length).toBeGreaterThan(0)
    expect(new Set(contract.productionMaterials.map(item => item.materialId)).size)
      .toBe(contract.productionMaterials.length)
    for (const projection of contract.upstreamSections) {
      const upstream = getGameDocumentContract(projection.path)
      expect(projection.sectionIds.every(id =>
        upstream.sections.some(section => section.sectionId === id),
      )).toBe(true)
    }
  }
})
```

- [ ] **Step 2: Run the test and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

Expected: FAIL because `productionMaterials` and `upstreamSections` do not exist.

- [ ] **Step 3: Extend the contract types**

Add:

```ts
export type GameDocumentProductionMaterialContract = {
  materialId: string
  title: string
  purpose: string
  format: 'markdown_table' | 'mermaid' | 'inline_svg'
}

export type GameDocumentUpstreamProjection = {
  path: FoundationDocumentPath
  sectionIds: readonly string[]
}
```

`GameDocumentContract` receives immutable `productionMaterials` and `upstreamSections`. `allowedUpstreamPaths` remains derived from `INITIAL_FOUNDATION_UPSTREAM_PATHS` and every projection path must belong to it.

- [ ] **Step 4: Declare the exact material matrix**

Use stable project-independent IDs:

| Document | Required production material IDs |
| --- | --- |
| GDD | `product-gameplay-overview`, `core-loop-diagram`, `game-state-flow` |
| Level/Scene | `world-structure-diagram`, `route-choice-diagram`, `pacing-beat-table`, `scene-transition-diagram` |
| Balance | `variable-parameter-table`, `formula-boundary-table`, `economy-flow-diagram`, `tuning-validation-matrix` |
| Technical | `architecture-diagram`, `data-flow-diagram`, `runtime-lifecycle-diagram`, `save-recovery-table` |
| Art | `visual-pillar-board`, `palette-board`, `silhouette-scale-board`, `animation-vfx-state-table` |
| UI/UX | `information-architecture-diagram`, `player-flow-diagram`, `screen-state-table`, `wireframe-board`, `focus-accessibility-matrix` |
| Audio | `event-cue-matrix`, `music-state-diagram`, `bus-ducking-diagram`, `loudness-delivery-table`, `sound-reference-register` |
| Asset Plan | `asset-inventory-table`, `responsibility-matrix`, `dependency-integration-diagram`, `license-register`, `milestone-maturity-table` |

Use Mermaid for flows, Markdown tables for registries/matrices, and inline SVG for Art/UI boards.

- [ ] **Step 5: Declare exact upstream section projections**

Use only canonical section IDs already present in the upstream contract. The mapping is discipline-owned, not inferred from user text:

```ts
const FOUNDATION_UPSTREAM_SECTIONS = {
  'docs/GDD.md': [],
  'docs/LEVEL_SCENE_DESIGN.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'progression', 'content_narrative', 'challenge_recovery', 'accessibility_localization', 'scope_risks'),
  ],
  'docs/BALANCE_DESIGN.md': [
    upstream('docs/GDD.md', 'core_loop', 'rules_systems', 'states_flow', 'progression', 'challenge_recovery', 'metrics', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'level_sequence', 'objectives_routes', 'pacing_beats', 'encounters', 'spawn_checkpoint', 'content_matrix', 'production_acceptance'),
  ],
  'docs/TECHNICAL_DESIGN.md': [
    upstream('docs/GDD.md', 'player_actions', 'rules_systems', 'states_flow', 'accessibility_localization', 'metrics', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'spawn_checkpoint', 'camera_readability', 'scene_states', 'content_matrix', 'production_acceptance'),
    upstream('docs/BALANCE_DESIGN.md', 'units_variables', 'formulas', 'bounds_exploits', 'tuning_validation', 'risks_dependencies'),
  ],
  'docs/ART_DIRECTION.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'rules_systems', 'content_narrative', 'accessibility_localization', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'camera_readability', 'content_matrix', 'production_acceptance'),
  ],
  'docs/UI_UX_SPEC.md': [
    upstream('docs/GDD.md', 'core_loop', 'player_actions', 'rules_systems', 'states_flow', 'challenge_recovery', 'accessibility_localization', 'content_narrative'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'objectives_routes', 'pacing_beats', 'spawn_checkpoint', 'camera_readability', 'scene_states'),
  ],
  'docs/AUDIO_DESIGN.md': [
    upstream('docs/GDD.md', 'experience_pillars', 'core_loop', 'rules_systems', 'states_flow', 'content_narrative', 'accessibility_localization'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'world_structure', 'pacing_beats', 'encounters', 'scene_states'),
    upstream('docs/UI_UX_SPEC.md', 'hud', 'input', 'feedback_errors', 'onboarding', 'accessibility'),
  ],
  'docs/ASSET_PLAN.md': [
    upstream('docs/GDD.md', 'scope_risks'),
    upstream('docs/LEVEL_SCENE_DESIGN.md', 'content_matrix', 'production_acceptance'),
    upstream('docs/TECHNICAL_DESIGN.md', 'data_content', 'performance', 'build_release', 'risks'),
    upstream('docs/ART_DIRECTION.md', 'asset_specifications', 'pipeline_risks'),
    upstream('docs/UI_UX_SPEC.md', 'screen_inventory', 'localization', 'prototype_acceptance'),
    upstream('docs/AUDIO_DESIGN.md', 'implementation', 'production'),
  ],
} as const
```

Do not project an upstream path not already allowed by `INITIAL_FOUNDATION_UPSTREAM_PATHS`.

- [ ] **Step 6: Verify and commit**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts`

Expected: PASS.

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts
git commit -m "feat: define focused document production contracts"
```

### Task 3: Replace the repeated per-section template with the compact document structure

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`

- [ ] **Step 1: Write failing Markdown contract tests**

Add one canonical fixture containing:

```md
# Document Title

<!-- beegame-executive-summary -->
## Executive Summary
Concise owned scope, principal decisions, production outcome, and completion definition.

<!-- beegame-section:SECTION_ID -->
## Exact Contract Title
Substantive discipline-owned content with stable authority IDs and production requirements.

<!-- beegame-production-materials -->
## Production Materials
<!-- beegame-material:MATERIAL_ID -->
### Exact Material Title
<required table, Mermaid, or inline SVG body>

<!-- beegame-audit-appendix -->
## Audit Appendix
### Acceptance Criteria
- Observable acceptance evidence.
```

Tests must reject missing summary, missing or out-of-order canonical sections, missing material markers, wrong material format, empty acceptance criteria, repeated substantive blocks, and exact empty-template sentences.

- [ ] **Step 2: Run and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`

Expected: FAIL because the current validator requires five headings inside every section and knows no document-level material contract.

- [ ] **Step 3: Simplify the structured submission schema**

Use document-level fields:

```ts
{
  title: string,
  executiveSummary: string,
  sections: Array<{ sectionId: string, title: string, body: string }>,
  productionMaterials: Array<{
    materialId: string,
    title: string,
    format: 'markdown_table' | 'mermaid' | 'inline_svg',
    body: string,
  }>,
  auditAppendix: {
    acceptanceCriteria: string[],
    upstreamReferences: Array<{ path: FoundationDocumentPath, authorityId: string }>,
    risks: Array<{ riskId: string, statement: string, mitigation: string, owner: string }>,
    openDecisions: Array<{ decisionId: string, question: string, owner: string, neededBy: string }>,
  },
}
```

Sections and production materials must exactly match contract order. Upstream paths remain constrained by the target contract.

- [ ] **Step 4: Implement exact-marker Markdown validation**

Use exact string markers and line boundaries, not content keywords or regex semantic inference. Require summary → canonical sections → production materials → audit appendix order. Validate format mechanically: Markdown-table material contains table rows, Mermaid material contains a Mermaid fence, inline-SVG material contains an SVG element. Reject only exact known empty-template sentences rather than guessing semantic emptiness.

- [ ] **Step 5: Verify and commit**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`

Expected: PASS.

```bash
git add packages/agent-workflow-server/src/beegame/complete-game-document.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
git commit -m "feat: render compact production-ready game documents"
```

### Task 4: Project exact upstream sections instead of complete files

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Create: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [ ] **Step 1: Write failing projection tests**

Build synthetic canonical documents from contract section IDs, call:

```ts
projectFoundationAuthority({
  targetPath: 'docs/UI_UX_SPEC.md',
  documents: new Map([['docs/GDD.md', gdd], ['docs/LEVEL_SCENE_DESIGN.md', level]]),
})
```

Assert the result contains every explicitly contracted upstream section, excludes an uncontracted section, preserves source path/section identity, and rejects missing, duplicated or out-of-order source markers.

- [ ] **Step 2: Run and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`

Expected: FAIL because the module does not exist.

- [ ] **Step 3: Implement exact section extraction**

Split only on exact `<!-- beegame-section:ID -->` markers obtained from the upstream `GameDocumentContract`. Do not inspect prose, headings, test ideas, game names or keywords. Return immutable `{ path, sectionId, content }` projections in contract order.

- [ ] **Step 4: Wire the projection into the author authority block**

Replace full upstream file interpolation in `buildDocumentAuthorAuthorityBlock()` with projected sections. Preserve the complete target only for a controlled change/restart baseline. The prompt boundary becomes:

```text
--- BEGIN CANONICAL AUTHORITY: docs/GDD.md#states_flow ---
...
--- END CANONICAL AUTHORITY: docs/GDD.md#states_flow ---
```

- [ ] **Step 5: Verify and commit**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts`

Expected: PASS.

```bash
git add packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "feat: project only required document authority"
```

### Task 5: Simplify the document-author prompt and native write cycle

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts`

- [ ] **Step 1: Write failing prompt tests**

Require the author prompt to contain the four document-level layers, exact material contracts and one complete native write instruction. Reject the old five subsection headings, `No unresolved section decisions.`, per-section file operations, reviewer simulation, disabled thinking, and generic full-project reload instructions.

- [ ] **Step 2: Run and verify RED**

Run: `/Users/nswell/.bun/bin/bun test packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts`

Expected: FAIL on the existing repeated-template and incremental-write expectations.

- [ ] **Step 3: Replace the initial-author instruction**

Keep a short boundary: current target, current contract, user settings, projected authority, service-owned metadata, one fact owner, full production quality, required material markers, one complete file write, one native verification, normal turn completion. Remove resource-planning instructions from disciplines that do not own them and remove every reference to the old five-heading template.

- [ ] **Step 4: Preserve Claude Code autonomy**

`getBeeGameWorkflowThinkingConfig('document-author')` remains `undefined`; no max-thinking override, watchdog, special completion JSON, or permission interception is added. The author may use native tools, but the task requires one complete target write rather than one write per section.

- [ ] **Step 5: Verify and commit**

Run:

```bash
/Users/nswell/.bun/bin/bun test \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: PASS.

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts
git commit -m "fix: keep document authors focused and autonomous"
```

### Task 6: Enforce the new structure at durable document completion

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts`

- [ ] **Step 1: Write failing completion tests**

Assert the workflow advances only when all eight files use the compact structure and exact discipline materials. Assert a legacy five-heading document, missing material, empty audit acceptance, or missing file does not advance. Assert no ninth Foundation document is created.

- [ ] **Step 2: Run and verify RED**

Run:

```bash
/Users/nswell/.bun/bin/bun test \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts \
  packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts
```

Expected: FAIL until the stage uses the new validator and fixtures.

- [ ] **Step 3: Use one deterministic validator path**

`document-stage.ts`, native canonical commit and readiness audit must all call `validateCompleteGameDocumentMarkdown()` rather than reproducing structural checks. Preserve service-owned front matter and durable revision metadata.

- [ ] **Step 4: Verify and commit**

Run:

```bash
/Users/nswell/.bun/bin/bun test \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts \
  packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts
```

Expected: PASS.

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/document-readiness-audit.ts packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts
git commit -m "fix: gate complete discipline document delivery"
```

### Task 7: Full automated verification

**Files:**
- No production changes expected.

- [ ] **Step 1: Run the complete focused workflow suite**

Run:

```bash
/Users/nswell/.bun/bin/bun test \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/game-document-contracts.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts \
  packages/agent-workflow-server/src/beegame/document-readiness-audit.test.ts \
  packages/agent-workflow-server/src/__tests__/idea-to-complete-documents.test.ts \
  packages/agent-workflow-server/src/__tests__/query-engine-runner.test.ts
```

Expected: all pass, zero failures.

- [ ] **Step 2: Run typecheck and diff check**

Run: `/Users/nswell/.bun/bin/bun run typecheck`

Expected: exit 0.

Run: `git diff --check`

Expected: no output.

### Task 8: Real Chrome generation and output audit

**Files:**
- Runtime output only; do not add the test Idea or generated project to product source.

- [ ] **Step 1: Start all services on the existing fixed port contract**

Use frontend 62273, workflow runtime 62274, billing 62275, skills 62276 and resources 62277. Confirm each health endpoint before opening Chrome.

- [ ] **Step 2: Run the real UI flow in Chrome**

Use the configured user model and settings. Enter a runtime test Idea through the UI; do not store that Idea in source, fixtures, prompts or product logic. Start Idea → Foundation generation through the normal BGS layer.

- [ ] **Step 3: Stop at document completion**

After all eight files are durably written, pause the workflow before later implementation/resource work. Confirm no document-author process remains active.

- [ ] **Step 4: Audit the actual eight files**

Check discipline responsibility, required materials, human scanability, Agent usability, redundant structure, file size and missing production information. Do not use content-conflict analysis to substitute for this document-quality review.

- [ ] **Step 5: Audit usage**

Report per document and total fresh input, cache read, output, model turns, elapsed time and cost. Pass target: total ≤ 4,000,000 tokens and 50–70 turns. If the target fails, identify the exact remaining prompt/context/tool cycle from logs before making another code change.

- [ ] **Step 6: Record evidence and commit only code-owned evidence**

Update the existing document-generation evidence ledger with commands, counts and output paths. Do not commit generated user project documents or the runtime Idea.
