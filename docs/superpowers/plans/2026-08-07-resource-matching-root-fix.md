# Resource Matching Root-Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Resource Library selection return usable, semantically correct candidates for mixed Packs, compose multiple assets when a requirement needs multiple parts, and allow only a proven no-match to create a replaceable placeholder.

**Architecture:** Resource Library remains the only source of resource facts and `CommitResourceInventory` remains the only resource mutation. Pack publication controls visibility only; each candidate is independently checked through its dependency closure. A requirement has one atomic candidate contract and, when needed, one explicit `coverage` contract solved into one deterministic candidate bundle. Existing placeholders are replaced by reopening the current resource stage, never by rerunning documents, review, or Checklist.

**Tech Stack:** TypeScript, Bun/Vitest, Zod, Supabase resource repository, durable BeeGame workflow receipts, React resource-library UI.

## Global Constraints

- One canonical resource-selection path: `ResourceLibrary.match_requirements` → `CommitResourceInventory`.
- No second matcher, fallback matcher, compatibility layer, feedback path, or parallel inventory ledger.
- No filename, path, regex, keyword, or Pack-name inference.
- `assetKind` describes the technical asset type; `usageTags` describe game role; `capabilities` describe verified facts.
- `usageTagsMode` remains only as the element lifecycle state (`inherit` means unclassified, `override` means accepted, and `manual-only` means excluded); Pack/folder semantic defaults and their UI write paths are removed. Only element-owned accepted tags enter matching.
- Any source format is eligible when a configured delivery adapter can deliver it; FBX is not rejected by extension alone.
- Placeholders remain independent replaceable project resources and are permitted only after the service proves a no-match.
- Existing documents, review results, Checklist output, and example projects are not rewritten by this change.
- The workflow has no token or wall-clock kill switch for resource matching; bounded output is achieved by deterministic projection, not by aborting work.

---

### Task 1: Make the resource contract authoritative

**Files:**
- Modify: `docs/beegame-resource-semantic-contract.md`
- Modify: `docs/resource-library-production.md`
- Modify: `packages/beegame-resource-core/src/types.ts`
- Test: `packages/beegame-resource-core/src/__tests__/validation.test.ts`

**Interfaces:**
- Consumes: current `ResourceAcquisitionProfile`, `ResourceCoverageObligation`, `ResourceElement`, and `ResourcePack` contracts.
- Produces: one documented rule set used by both catalog matching and inventory commit validation.

- [ ] **Step 1: Specify the single semantic source.** Document that project matching reads only confirmed element-level `usageTags`; Pack/folder semantic defaults are removed from the schema, API, and UI.
- [ ] **Step 2: Specify requirement boundaries.** `dimensions` and `styles` constrain every selected candidate. `assetKinds`, `usageTags`, and `capabilities` describe one atomic candidate when `coverage` is absent. A multi-part requirement must put its independent obligations in `coverage`; the same capability cannot be required both as an atomic all-of constraint and as a separate coverage obligation.
- [ ] **Step 3: Add validation for ambiguous profiles.** Reject a profile that declares multi-part coverage while also declaring aggregate capabilities that would force one file to satisfy the whole composition. Return a structured validation message naming the requirement and field.
- [ ] **Step 4: Remove the old inheritance path completely.** Keep `usageTagsMode` only to distinguish unclassified, accepted, and manually excluded elements. Remove Pack/folder semantic-default writes and UI controls. Matching requires element-owned accepted tags (`usageTagsMode: 'override'`); unclassified and `manual-only` elements are never candidate evidence.
- [ ] **Step 5: Run the contract tests.**

Run: `bun test packages/beegame-resource-core/src/__tests__/validation.test.ts`

Expected: profiles with explicit atomic requirements pass; ambiguous aggregate profiles fail before matching; unsupported usage tags and asset kinds remain rejected.

### Task 2: Separate Pack visibility from element selection readiness

**Files:**
- Modify: `packages/beegame-resource-core/src/publish-readiness.ts`
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Test: `packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts`
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`

**Interfaces:**
- Consumes: `evaluateResourceElementSelectionReadiness`, `evaluateResourcePackPublishReadiness`, and `matchResourceRequirements`.
- Produces: a published Pack whose valid elements remain selectable even when unrelated siblings are incomplete.

- [ ] **Step 1: Keep Pack-level blocking limited to Pack facts.** Pack publication may require identity, version, license, and at least one ready element. Per-element usage tags, unresolved dependencies, missing hashes, unsupported delivery, and inspection failures are reported as element issues, not a reason to hide every sibling.
- [ ] **Step 2: Make element readiness the only candidate gate.** For every candidate, evaluate the root plus its dependency and binding closure. Do not call Pack-wide readiness from the matcher and do not inspect unrelated elements as a prerequisite for the candidate.
- [ ] **Step 3: Emit diagnostic counts without losing candidates.** A no-match result must identify how many elements were excluded for `technical_not_ready`, `dependency_not_ready`, `delivery_unsupported`, `missing_semantics`, and `coverage_gap`. Do not convert an element-level exclusion into a whole-Pack exclusion.
- [ ] **Step 4: Add the regression tests.** Cover a published mixed Pack with one invalid sibling and one valid model; the valid model must match. Cover a valid root with a missing dependency; it must remain no-match. Cover a Pack with no ready elements; it must remain unpublished/unselectable.
- [ ] **Step 5: Run the focused tests.**

Run: `bun test packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts packages/beegame-resource-core/src/__tests__/catalog.test.ts`

Expected: sibling defects do not suppress valid candidates; dependency defects still suppress the affected root only.

### Task 3: Rebuild semantic tags per element

**Files:**
- Modify: `packages/beegame-resource-core/src/metadata-policy.ts`
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/beegame-resource-core/src/repository.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `packages/beegame-resource-server/src/app.ts`
- Test: `packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts`
- Test: `packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/curation-route.test.ts`

**Interfaces:**
- Consumes: technical facts, content profile, preview/atlas evidence, and the existing structured semantic-curation decision.
- Produces: an element whose accepted `usageTags` are explicit, deduplicated, canonical, and used identically by UI, catalog, and matcher.

- [ ] **Step 1: Stop treating inherited Pack tags as semantic confirmation.** The curation queue must include every ready element without an element-level accepted tag set; there is no Pack/folder semantic fallback that can make the display or matcher non-empty.
- [ ] **Step 2: Make validated AI decisions write the element itself.** Every accepted decision writes `usage_tags` with `usage_tags_mode: 'override'` and the current content hash remains the stale-result guard. A full AI reanalysis may replace an existing AI-owned tag set; `manual-only` remains excluded. There is no pending suggestion state.
- [ ] **Step 3: Remove broad defaults from mixed Packs.** The migration drops the obsolete Pack/folder default columns, clears unclassified element tags, and queues affected elements for semantic curation. It does not guess replacements from filenames or copy a broad default onto every element.
- [ ] **Step 4: Keep technical and semantic identities separate.** A model uses `assetKind: model` or `mesh`; a texture uses `assetKind: texture`; neither uses a fake `texture` role tag. Role tags such as `creature`, `weapon-equipment`, `terrain`, or `building` are assigned only when supported by content evidence.
- [ ] **Step 5: Add representative semantic tests.** A mixed Pack containing environment meshes, enemies, weapons, and textures must produce different accepted element tags. A model with a texture dependency must retain the model role and dependency relation without being classified as a texture.
- [ ] **Step 6: Run the focused tests.**

Run: `bun test packages/beegame-resource-core/src/__tests__/metadata-policy.test.ts packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts packages/beegame-resource-server/src/__tests__/curation-route.test.ts`

Expected: no resource can become a selectable candidate through a removed Pack/folder semantic path.

### Task 4: Replace aggregate capability matching with deterministic composition

**Files:**
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/beegame-resource-core/src/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-selection-client.ts`
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts`

**Interfaces:**
- Consumes: one canonical Asset Manifest requirement and its explicit `coverage` obligations.
- Produces: one stable `matched` bundle or one evidence-backed `no-match` group.

- [ ] **Step 1: Filter atomic candidates only by atomic constraints.** Do not require one candidate to contain capabilities that belong to separate coverage obligations. Preserve dimension, style, asset-kind, role, and delivery checks at the level defined by the contract.
- [ ] **Step 2: Solve coverage exactly and deterministically.** Build an obligation bit set for each eligible candidate, find the smallest complete bundle, then sort ties by direct delivery, Pack ID, and element ID. Do not truncate candidates before a complete bundle is found.
- [ ] **Step 3: Return a compact complete result.** `ResourceLibrary` receives one canonical bundle per requirement plus diagnostics; it does not receive the entire Pack, raw binary content, or a second candidate-search route.
- [ ] **Step 4: Preserve the placeholder invariant.** `CommitResourceInventory` continues to reject a placeholder whenever the frozen match observation contains a complete bundle. It accepts a placeholder only when the corresponding group is proven `no-match`.
- [ ] **Step 5: Add regression tests.** Cover separate model/material/texture candidates satisfying one composition; cover an all-in-one candidate remaining valid for an atomic requirement; cover a real candidate preventing placeholder commit; cover a genuine no-match allowing a replaceable placeholder.
- [ ] **Step 6: Run the focused tests.**

Run: `bun test packages/beegame-resource-core/src/__tests__/catalog.test.ts packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`

Expected: a mixed resource set produces a library bundle instead of a false no-match, while the commit guard still blocks unauthorized placeholders.

### Task 5: Repair dependency bindings and delivery-format handling

**Files:**
- Modify: `packages/beegame-resource-core/src/publish-readiness.ts`
- Modify: `packages/beegame-resource-server/src/resource-inspection.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Test: `packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/lifecycle-handlers.test.ts`

**Interfaces:**
- Consumes: inspected external references, `dependencyBindings`, and configured delivery adapters.
- Produces: a candidate whose complete dependency closure can be acquired and whose source format can be delivered directly or converted.

- [ ] **Step 1: Persist external-reference bindings.** When inspection reports a model reference to a texture, resolve it to the exact resource element and persist both the dependency ID and reference path. An unresolved or unbound reference keeps only that root out of matching.
- [ ] **Step 2: Keep FBX and other source formats eligible.** Match by `deliveryCapabilities`; use `direct` or `convert` delivery. Reject only when no configured adapter can deliver the requested target format.
- [ ] **Step 3: Test a model with an external texture.** The model must match when the texture dependency is ready and be excluded when that dependency is missing or not ready.
- [ ] **Step 4: Test direct and conversion delivery.** The same source model must be eligible for direct delivery when supported and conversion when an adapter is configured; extension-only rejection must fail the test.

### Task 6: Correct Pack summary counts with one canonical aggregate

**Files:**
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/beegame-resource-server/src/supabase-resource-repository.ts`
- Modify: `docs/beegame-resource-pack-catalog-migration.sql`
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`
- Test: `packages/beegame-resource-server/src/__tests__/app.test.ts`

**Interfaces:**
- Consumes: the same element readiness and tag state used by matching.
- Produces: a Pack list count that agrees with the Pack detail tree and catalog candidate count.

- [ ] **Step 1: Define one count source.** `readyElementCount` counts only selectable ready roots after element-level dependency closure checks. Do not maintain a separate UI-only count.
- [ ] **Step 2: Refresh the persisted catalog aggregate transactionally after element/tag/dependency mutations.** The list endpoint and Pack detail endpoint must read the same aggregate revision.
- [ ] **Step 3: Backfill existing Pack summaries once.** Recompute counts from current elements after the semantic/dependency migration; do not change source files or example projects.
- [ ] **Step 4: Add a mismatch regression test.** After an element mutation, the Pack list count, detail count, and matching candidate count must agree.

### Task 7: Reopen only the current resource stage for existing placeholder receipts

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/resource-match-observation.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Test: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts`

**Interfaces:**
- Consumes: the existing plan revision, durable match observation, and committed inventory receipt.
- Produces: a resource-only reselection that replaces a placeholder when the new catalog revision contains a valid bundle.

- [ ] **Step 1: Preserve the current workflow position.** A catalog improvement must reopen only `RESOURCE_INVENTORY`; document drafting, document review, Checklist, and implementation remain completed.
- [ ] **Step 2: Allow one active transaction to refresh its catalog observation.** When the plan revision is unchanged and the previous receipt contains a placeholder, a newer catalog revision may replace that observation and receipt. There must never be two active inventory transactions for one plan revision.
- [ ] **Step 3: Apply the replacement atomically.** Stage the new library resource and bindings, verify hashes and dependency closure, then replace the placeholder binding and receipt. A failed replacement leaves the previous committed placeholder usable.
- [ ] **Step 4: Keep the existing commit tool as the only mutation.** Do not add a second repair tool, compatibility route, or agent-side file rewrite.
- [ ] **Step 5: Test recovery.** Cover service restart before commit, restart after a committed placeholder, catalog revision change yielding a match, and catalog revision change still yielding no-match. In every case the workflow resumes at Resource Inventory and never re-enters earlier phases.

### Task 8: System-level verification and library re-curation

**Files:**
- Test: `packages/beegame-resource-core/src/__tests__/catalog.test.ts`
- Test: `packages/beegame-resource-core/src/__tests__/publish-readiness.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/resource-inventory-commit.test.ts`
- Test: `packages/agent-workflow-server/src/beegame/delivery-workflow/resource-stage.test.ts`
- Verify: `apps/frontend/src/components/ResourceLibrary/ResourceLibraryView.tsx`
- Verify: `apps/frontend/src/components/ResourceLibrary/CurationWorkbench.tsx`

**Interfaces:**
- Consumes: the complete implementation from Tasks 1–7.
- Produces: evidence that the same tags, candidates, dependencies, counts, and durable receipt are observed end-to-end.

- [ ] **Step 1: Run package tests and type checks.**

Run: `bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ packages/agent-workflow-server/src/beegame`

Run: `bunx tsc -p packages/beegame-resource-core/tsconfig.json --noEmit && bunx tsc -p packages/beegame-resource-server/tsconfig.json --noEmit && bunx tsc -p packages/agent-workflow-server/tsconfig.json --noEmit`

Expected: all focused and integration tests pass with no schema or type drift.

- [ ] **Step 2: Run a synthetic mixed-Pack acceptance fixture.** Include unrelated invalid siblings, distinct environment/enemy/weapon elements, a model with a texture dependency, one convertible FBX source, and one genuinely missing role. Verify the service returns valid candidates for the first four and only the last one permits a placeholder.
- [ ] **Step 3: Re-curate the actual mixed Pack through the Resource Library UI.** Confirm each element has explicit accepted tags, the model/texture relationship is bound, and no broad Pack default is used as the match source. This operation changes resource-library metadata only; it does not touch any example project.
- [ ] **Step 4: Use Chrome for read-only verification.** Confirm Pack summary count equals detail count, representative elements show their own tag source, matching returns library candidates, and `CommitResourceInventory` receives a bundle instead of a false no-match.
- [ ] **Step 5: Audit for old paths.** Search the final diff for the removed usage-mode matching path, whole-Pack candidate gate, aggregate capability `every` check, alternate resource mutation tool, filename/regex selection, and project-file placeholder writers. Any remaining executable path is a failure, not a compatibility case.

## Self-review

- The plan covers the observed false no-match causes: whole-Pack exclusion, aggregate capability matching, inherited broad tags, missing dependency bindings, and stale Pack counts.
- It keeps the existing authoritative mutation boundary and does not add a second matcher, repair ledger, or fallback protocol.
- It preserves placeholders as valid replaceable resources while preventing them when a real bundle exists.
- It does not require changing documents or example projects and tests the system with synthetic mixed resources before one real Resource Library re-curation.
- It does not use filenames, paths, keywords, regexes, engine-specific formats, token limits, or worker wall-clock limits to decide suitability.
