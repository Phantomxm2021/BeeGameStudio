# Resource Visual Semantic Curation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task with a verification checkpoint after every task.

**Goal:** Replace the existing resource semantic-curation fallback design with one canonical visual-evidence pipeline that renders every renderable resource before usage-tag inference, sends one or two previews individually, sends more than two previews as one Atlas, and never commits tags from structured metadata alone.

**Architecture:** The durable resource-processing job remains the only job and receipt path. Each claimed batch first reads canonical resource bytes and creates ephemeral engine-neutral preview images. A batch of one or two resources sends those images as separate multimodal image blocks; a batch larger than two creates one JPEG Atlas with an explicit cell map. The Workflow bridge accepts exactly one visual-input contract and one structured decision contract. Rendering failure, missing visual evidence, invalid model output, or an incomplete receipt prevents semantic persistence and requeues the affected item through the existing durable queue.

**Tech Stack:** TypeScript, Bun test, Hono, `sharp`/`image-processor-napi`, existing model-runtime bridge, Supabase-backed durable resource-processing jobs.

## Global Constraints

- Rendered previews are Admin semantic-curation evidence only; they never enter Agent resource matching, downloading, or game implementation.
- `category`, `kind`, `assetKind`, technical facts, and dependency facts may identify or describe a resource, but they cannot replace rendered visual evidence for a visual usage-tag decision.
- There is one semantic-curation job kind, one visual-input contract, one decision contract, one persistence path, and one durable receipt path.
- No structured-only fallback, optional-Atlas fallback, legacy semantic path, feedback path, compatibility branch, duplicate queue, or second metadata truth source may remain.
- No filename, path, keyword, regular expression, slot, engine-specific scene, or platform-specific rule may infer usage tags.
- Rendered previews and Atlas bytes are ephemeral and must not be stored as library resources or sent through Agent resource-selection APIs.
- A failed render is retried by the existing durable item queue; it is not converted into a successful low-confidence decision.
- Existing example projects are read-only evidence and must not be modified.

---

### Task 1: Replace the semantic-curation authority document

**Files:**
- Modify: `docs/beegame-resource-semantic-contract.md`
- Modify: `docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md`
- Create: `docs/superpowers/plans/2026-08-08-resource-visual-semantic-curation.md`

**Interfaces:**
- Produces the authoritative rules consumed by Tasks 2–5.
- Defines `visualInput` as either `{ mode: 'individual', images: [...] }` for one or two items or `{ mode: 'atlas', image: ..., cells: [...] }` for more than two items.
- Defines that every renderable resource decision must cite a `content_preview` evidence item tied to its supplied preview/cell.

- [x] **Step 1: Record the old-path removals in the authority.**

  The previous optional `atlas`, structured-only classification, metadata-only preview, audio/document fact-only classification, and “facts alone are acceptable” wording must be removed from the authority documents. The documents must state that a resource with no renderable preview remains unclassified and is requeued; it is never submitted to the model through another path.

- [x] **Step 2: Record the exact visual transport rule.**

  One or two rendered previews are sent as individual images with a structured element-to-image order map. More than two rendered previews are normalized to 128×128 cells and sent as one JPEG Atlas with an ordered element-to-cell map. IDs are not painted onto images.

- [x] **Step 3: Self-review the authority.**

  Search the authority documents for `fallback`, `structured facts alone`, `optional Atlas`, and stale “audio facts are sufficient” wording. Replace every contradictory rule before implementation begins.

- [x] **Step 4: Verify the written authority.**

  Run `rg -n "fallback|structured facts alone|optional Atlas|facts alone|metadata-only" docs/beegame-resource-semantic-contract.md docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md docs/superpowers/plans/2026-08-08-resource-visual-semantic-curation.md` and require no contradictory semantic-curation rule.

---

### Task 2: Define and test the single visual-input contract

**Files:**
- Modify: `packages/beegame-resource-core/src/semantic-curation.ts`
- Modify: `packages/beegame-resource-core/src/index.ts`
- Modify: `packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts`
- Modify: `packages/beegame-resource-server/src/semantic-curation-evidence.ts`
- Modify: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`

**Interfaces:**
- `ResourceSemanticVisualInput` is the only model visual input type.
- `ResourceSemanticVisualInput` has exactly two modes: `individual` for one or two images and `atlas` for three or more images.
- Every image carries an ordered `elementId`; Atlas mode carries ordered cells with the same identities.
- The visual-input builder rejects empty inputs, non-image files, duplicate IDs, incomplete identity maps, and mode/count mismatches.

- [x] **Step 1: Write failing tests for the transport invariant.**

  Add tests that assert: one image uses `individual`; two images use `individual`; three images use `atlas`; an Atlas cell mapping preserves element IDs; a visual model request without a complete visual input is rejected; and an output decision without `content_preview` evidence is rejected for the corresponding visual item.

- [x] **Step 2: Run the focused tests and confirm they fail for the old optional-Atlas behavior.**

  Run `bun test packages/beegame-resource-core/src/__tests__/semantic-curation.test.ts packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`.

- [x] **Step 3: Implement the minimal core contract.**

  Replace the optional Atlas-only model field with the required `visualInput` contract. Keep structured projection fields only as bounded context. Add one canonical validator that checks the visual-input mode/count/identity and requires `content_preview` evidence for visual decisions.

- [x] **Step 4: Implement the preview builder.**

  Normalize each rendered image to the existing bounded JPEG preview. For one or two images, return ordered individual image payloads. For more than two, compose the same 128×128 cells into one Atlas and return the ordered cell map. Do not create a second builder or a provider-specific image path.

- [x] **Step 5: Run the focused tests and confirm they pass.**

  Run the same Bun test command and require zero failures.

---

### Task 3: Rebuild the durable worker around preview-first processing

**Files:**
- Modify: `packages/beegame-resource-server/src/index.ts`
- Modify: `packages/beegame-resource-server/src/resource-processing-jobs.ts`
- Modify: `packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts`
- Modify: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`

**Interfaces:**
- `processBatch` produces one validated semantic receipt containing completed decisions and explicit retry items.
- The worker passes only resources with successfully generated preview images to the model bridge.
- A batch containing an unrenderable visual item records that item for the next durable batch and never sends that item’s structured facts as a replacement.

- [x] **Step 1: Write failing tests for preview-first behavior.**

  Add tests that assert a model without a generated preview is not included in the provider request, a failed preview is requeued, a batch with successful and failed items commits only successful decisions, and no decision receipt is accepted for an item without a rendered preview.

- [x] **Step 2: Run the worker tests and confirm the old behavior fails the new assertions.**

  Run `bun test packages/beegame-resource-server/src/__tests__/resource-processing-jobs.test.ts packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`.

- [x] **Step 3: Remove the old fallback branches.**

  Delete the path that treats `element.preview` metadata as a sufficient semantic preview, the path that allows a loaded structured projection without a visual file into `classifyBatch`, and any optional Atlas spread into the request. Do not change the durable job table or introduce another queue.

- [x] **Step 4: Wire the one visual-input builder.**

  Render every eligible visual resource from canonical bytes, build `individual` or `atlas` according to the exact batch count, and pass the required contract to the one model client. Preserve the existing exact receipt partition and retry ordering.

- [x] **Step 5: Run the worker tests and confirm they pass.**

  Run the same Bun test command and require zero failures.

---

### Task 4: Enforce the visual-only semantic model boundary

**Files:**
- Modify: `packages/beegame-resource-server/src/semantic-curation-model.ts`
- Modify: `packages/agent-workflow-server/src/app.ts`
- Modify: `packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`

**Interfaces:**
- The internal semantic-curation route accepts only the canonical `visualInput` plus bounded structured context.
- The prompt explicitly requires multimodal visual analysis for every visual item and one decision per item.
- The resource-server client is the single parser/validator for model responses; the Workflow bridge does not create a second semantic interpretation path.

- [x] **Step 1: Write failing boundary tests.**

  Add tests that reject: a visual batch with no `visualInput`, a visual batch with a count/mode mismatch, a response whose visual decision has no `content_preview` evidence, and a response containing an Atlas for two or fewer items. Add a positive test for two individual images and one positive test for a three-item Atlas.

- [x] **Step 2: Run the boundary tests and confirm failure under the old `atlas?` contract.**

  Run `bun test packages/beegame-resource-server/src/__tests__/semantic-curation-model.test.ts packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts`.

- [x] **Step 3: Replace the bridge request shape.**

  Change the route and client to accept the required `visualInput`, serialize individual image blocks or one Atlas image according to the mode, and reject missing/extra visual transport fields. Keep provider configuration and billing unchanged.

- [x] **Step 4: Remove the structured-only inference instructions.**

  The prompt may describe technical facts as context, but must state that usage tags require the supplied rendered image and that every visual decision must cite its visual evidence. It must not instruct the model to classify from category, kind, assetKind, filenames, paths, or technical facts alone.

- [x] **Step 5: Run the boundary tests and confirm they pass.**

  Run the same Bun test command and require zero failures.

---

### Task 5: Preserve the Agent/resource-selection separation

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/resource-selection-client.ts`
- Modify: `packages/beegame-resource-core/src/catalog.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts`
- Modify: `packages/beegame-resource-server/src/__tests__/selection-route.test.ts`

**Interfaces:**
- Agent matching receives only confirmed canonical usage tags and structured catalog facts.
- Agent matching never receives `visualInput`, Atlas bytes, rendered preview files, semantic evidence, or pending suggestions.

- [x] **Step 1: Write a regression test for visual-input isolation.**

  Assert that the compact Agent match result contains no `atlas`, `visualInput`, Base64 image data, semantic suggestion, or visual evidence fields while retaining confirmed usage tags and technical facts.

- [x] **Step 2: Run the isolation test and confirm the existing compact result remains the only selection input.**

  Run `bun test packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/beegame-resource-server/src/__tests__/selection-route.test.ts`.

- [x] **Step 3: Remove any accidental visual field propagation.**

  Keep the existing deterministic catalog matcher and exact resolver. If a shared catalog type carries an authored preview descriptor for Admin browsing, do not pass that descriptor through the Agent compact match result; do not add a new Agent resource endpoint.

- [x] **Step 4: Run the isolation tests and confirm they pass.**

  Run the same Bun test command and require zero failures.

---

### Task 6: Update documentation and audit for old paths

**Files:**
- Modify: `docs/beegame-resource-semantic-contract.md`
- Modify: `docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md`
- Test: all modified semantic-curation tests

- [x] **Step 1: Update all documents to the final rules.**

  Replace references to optional Atlas, structured-only audio/document inference, metadata-only preview, or facts-only evidence. State that an unrenderable resource remains unclassified and requeues; no alternate semantic path exists.

- [x] **Step 2: Run the full affected test suites.**

  Run `bun test packages/beegame-resource-core/src/__tests__ packages/beegame-resource-server/src/__tests__ packages/agent-workflow-server/src/beegame/native-resource-library-tool.test.ts packages/agent-workflow-server/src/__tests__/resource-semantic-runtime.test.ts` and require zero failures.

- [x] **Step 3: Run static audits.**

  Run `rg -n "structured-only|structured facts alone|optional.*atlas|atlas\?:|semantic fallback|fallback classifier|content profile.*sufficient|technical facts.*sufficient" packages/beegame-resource-core/src packages/beegame-resource-server/src packages/agent-workflow-server/src/beegame docs/beegame-resource-semantic-contract.md docs/superpowers/specs/2026-08-06-ai-resource-semantic-curation-design.md docs/superpowers/plans/2026-08-08-resource-visual-semantic-curation.md`. Any match must be reviewed and removed when it describes a runtime path rather than a historical prohibition.

- [x] **Step 4: Run repository checks.**

  Run `git diff --check`. Run the resource-server and agent-workflow TypeScript checks. Record pre-existing unrelated alias failures separately; do not weaken the new semantic contracts to hide them.

- [x] **Step 5: Verify no service remains running.**

  Run `lsof -nP -iTCP -sTCP:LISTEN | rg ':(62173|62174|62175|62176|62177|62178|62179|5173|3000|8787)\\b' || true` and stop only services started for this task.

## Final Acceptance

- The 1-item and 2-item paths send individual rendered previews.
- The 3–8 item path sends one rendered Atlas with an exact cell map.
- No visual resource can produce an accepted usage-tag decision without a rendered preview and `content_preview` evidence.
- Preview/render failure produces durable retry only; it never becomes a structured-only decision.
- Agent resource selection remains metadata-only and receives no visual evidence.
- No second semantic route, fallback classifier, feedback path, compatibility path, or old semantic path remains.
- No example project is changed.
