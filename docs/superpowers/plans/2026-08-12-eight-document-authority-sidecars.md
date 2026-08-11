# Eight-Document Authority Sidecars Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Preserve eight complete human game-development documents while replacing repeated upstream prose transfer with Claude-authored, contract-selected authority sidecars and accurate token telemetry.

**Architecture:** Add a strict sidecar contract beside each Foundation Markdown file, extend the existing canonical document receipt so Markdown and sidecar complete as one recoverable unit, and materialize a run-private projection containing only records allowed by `upstreamSections`. Keep Claude Code's normal tools and context; BGS performs only deterministic validation, persistence, projection, and measurement.

**Tech Stack:** TypeScript, Bun test, Zod v4, Node filesystem/crypto primitives, React/Vitest, existing delivery workflow journal and Chrome UI test stack.

---

## File Map

- Create `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts`: schema, path mapping, canonical bytes, digest and contract validation.
- Create `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts`: strict contract and tamper tests.
- Modify `packages/agent-workflow-server/src/beegame/complete-game-document.ts`: canonicalize service-owned marker whitespace before validation.
- Modify `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`: marker normalization regression.
- Modify `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`: accept sidecars, prepare/reconcile the document pair and support sidecar-only completion.
- Modify `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`: pair commit, repair and restart tests.
- Replace `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`: project validated records instead of Markdown section bodies.
- Modify `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`: exact selection, stable order and stale-sidecar tests.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`: persist a run-private projection and point document authors at it.
- Modify `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`: prompt/projection and no-full-body tests.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`: authority repair mode and per-document measurements.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`: persisted schema for the new fields.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`: require sidecars before advancing and schedule sidecar-only backfill.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`: reconcile prepared document pairs.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`: restore authority-backed accepted units.
- Modify delivery workflow tests for progression, backfill and restart.
- Modify `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`: persist per-document attempt usage and retry reason.
- Modify `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`: label fresh/cache/output/raw/weighted/retry separately.
- Modify `apps/frontend/src/components/Demiurge/DashboardView.tsx`: pass billing-authority weighted usage.
- Modify `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`: visible metric regression.
- Create `docs/superpowers/evidence/2026-08-12-eight-document-authority-sidecars.md` after automated and Chrome verification; it contains only commands, run identity, output paths and measurements.

### Task 1: Define the strict authority sidecar

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts`
- Create: `packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts`

- [ ] **Step 1: Write the failing contract tests**

Create tests using a canonical GDD string and this helper shape:

```ts
const validSidecar = {
  schemaVersion: 1 as const,
  documentPath: 'docs/GDD.md' as const,
  documentDigest: sha256(markdown),
  records: getGameDocumentContract('docs/GDD.md').sections.map(section => ({
    authorityId: `gdd.${section.sectionId}.primary`,
    sectionId: section.sectionId,
    kind: 'fact' as const,
    state: 'confirmed' as const,
    statement: `Confirmed authority for ${section.sectionId}.`,
    responsibilityIds: [...section.responsibilityIds].sort(bytewise),
  })).sort((left, right) => bytewise(left.authorityId, right.authorityId)),
}
```

Assert that validation accepts this value and rejects: wrong document digest, wrong path, duplicate/unsorted IDs, unknown section, responsibility not owned by the section, empty section coverage, `open_decision` not deferred, a dimensional metric without `unit`, multiline Markdown statements, and canonical JSON larger than 96 KiB. Assert `authoritySidecarPath('docs/GDD.md') === 'docs/GDD.authority.json'`.

- [ ] **Step 2: Run the test and confirm RED**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts
```

Expected: FAIL with `Cannot find module './foundation-authority-sidecar'`.

- [ ] **Step 3: Implement the schema and canonical serializer**

Export exactly these public APIs:

```ts
export const FOUNDATION_AUTHORITY_KINDS = [
  'fact', 'decision', 'constraint', 'metric',
  'dependency', 'risk', 'open_decision',
] as const

export type FoundationAuthoritySidecar = Readonly<{
  schemaVersion: 1
  documentPath: FoundationDocumentPath
  documentDigest: string
  records: readonly FoundationAuthorityRecord[]
}>

export function authoritySidecarPath(path: FoundationDocumentPath): string
export function foundationDocumentDigest(markdown: string): string
export function validateFoundationAuthoritySidecar(input: {
  documentPath: FoundationDocumentPath
  markdown: string
  value: unknown
}): FoundationAuthoritySidecar
export function createFoundationAuthoritySidecar(input: {
  documentPath: FoundationDocumentPath
  markdown: string
  submission: unknown
}): FoundationAuthoritySidecar
export function canonicalFoundationAuthoritySidecarBytes(
  sidecar: FoundationAuthoritySidecar,
): string
```

Use Zod for runtime shape validation, `Buffer.compare` for bytewise order, `createHash('sha256')` for the document digest, `TextEncoder` for the 96 KiB limit, and `Object.freeze` for the returned sidecar and nested arrays. `createFoundationAuthoritySidecar` accepts only `{ records }` from Claude Code and injects `schemaVersion`, `documentPath`, and `documentDigest`; `validateFoundationAuthoritySidecar` validates already persisted sidecars. Scope `authorityId` to `${CANONICAL_PROJECT_DOCUMENT_IDS[path].toLowerCase()}.${sectionId}.` and reject identifiers outside `[a-z0-9._-]`.

- [ ] **Step 4: Run GREEN and typecheck**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts
bun run typecheck
```

Expected: sidecar tests pass and TypeScript exits 0.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.ts packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts
git commit -m "feat: define foundation authority sidecars"
```

### Task 2: Normalize BGS-owned Markdown syntax before validation

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.ts`
- Modify: `packages/agent-workflow-server/src/beegame/complete-game-document.test.ts`

- [ ] **Step 1: Add the marker-whitespace regression**

Starting from a valid rendered document, replace canonical markers with variants such as:

```ts
authored
  .replace('<!-- beegame-section:vision -->', '<!-- beegame-section: vision -->')
  .replace('<!-- beegame-material:core-loop-diagram -->', '<!-- beegame-material: core-loop-diagram -->')
```

Assert `canonicalizeCompleteGameDocumentMarkdown` returns canonical no-space markers and valid service-owned front matter. Also assert an unknown section or material ID still fails.

- [ ] **Step 2: Run the regression and confirm RED**

```bash
bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
```

Expected: FAIL with the canonical section-order error.

- [ ] **Step 3: Add deterministic marker normalization**

Before heading normalization and `validateCompleteGameDocumentMarkdown`, map only known contract markers:

```ts
const canonicalMarkers = new Map([
  ...contract.sections.map(section => [
    `beegame-section:${section.sectionId}`,
    `<!-- beegame-section:${section.sectionId} -->`,
  ] as const),
  ...contract.productionMaterials.map(material => [
    `beegame-material:${material.materialId}`,
    `<!-- beegame-material:${material.materialId} -->`,
  ] as const),
])

for (let index = 0; index < bodyLines.length; index += 1) {
  const match = bodyLines[index]!.trim().match(/^<!--\s*(beegame-(?:section|material):\s*[^\s]+)\s*-->$/)
  if (!match) continue
  const normalizedKey = match[1]!.replace(': ', ':')
  const canonical = canonicalMarkers.get(normalizedKey)
  if (canonical) bodyLines[index] = canonical
}
```

Do not normalize unknown IDs or content prose.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/complete-game-document.ts packages/agent-workflow-server/src/beegame/complete-game-document.test.ts
git commit -m "fix: canonicalize document protocol markers"
```

### Task 3: Commit Markdown and sidecar as one recoverable workflow unit

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts`
- Modify: `packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts`

- [ ] **Step 1: Write failing pair-commit tests**

Extend the complete-document tests so the tool call uses:

```ts
function authorityFor(path: FoundationDocumentPath) {
  const documentId = CANONICAL_PROJECT_DOCUMENT_IDS[path].toLowerCase()
  return {
    records: getGameDocumentContract(path).sections
      .map(section => ({
        authorityId: `${documentId}.${section.sectionId}.primary`,
        sectionId: section.sectionId,
        kind: 'fact' as const,
        state: 'confirmed' as const,
        statement: `Confirmed authority for ${section.sectionId}.`,
        responsibilityIds: [...section.responsibilityIds].sort(bytewise),
      }))
      .sort((left, right) => bytewise(left.authorityId, right.authorityId)),
  }
}

await call({
  body: renderCompleteGameDocument(path, submission),
  authority: authorityFor(path),
})
```

Assert the Markdown and `*.authority.json` both exist, the receipt contains both digests, and a second identical call returns the same receipt. Add tests proving:

- a bad sidecar leaves canonical Markdown durable but no committed receipt;
- `{ authority }` alone completes that prepared document without resending `body`;
- restart reconciliation refuses a missing or stale sidecar;
- a prepared document plus valid sidecar reconciles to committed;
- a non-Foundation canonical document retains the existing body-only contract.

- [ ] **Step 2: Run and confirm RED**

```bash
bun test packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts
```

Expected: FAIL because `authority` is rejected by the strict input schema and no sidecar is written.

- [ ] **Step 3: Extend the input and receipt contracts**

Use a strict discriminated union for complete Foundation commits:

```ts
const completeDocumentInputSchema = z.union([
  z.object({ body: z.string().trim().min(1), authority: z.object({ records: z.array(z.unknown()) }).strict() }).strict(),
  z.object({ authority: z.unknown() }).strict(),
])

type CanonicalDocumentCommitReceipt = {
  schemaVersion: 2
  dispatchId: string
  targetPath: string
  baselineDigest: string | null
  finalDigest: string
  authorityPath: string
  authorityDigest: string | null
  documentId: string
  version: string
  updatedAt: string
  status: 'document_prepared' | 'committed'
}
```

Keep a parser for schema-version-1 body-only receipts. For Foundation completion, canonicalize the Markdown first, durably write it with a `document_prepared` receipt, validate authority against those exact bytes, durably write canonical sidecar bytes, and finally write the committed receipt. Sidecar-only calls must load the prepared Markdown and refuse any receipt already prepared with different document bytes.

Update `reconcileCanonicalDocumentCommitReceipt` so a v2 receipt is committed only when both on-disk digests match. Update the tool prompt to say one normal `{body, authority}` submission and a bounded `{authority}` retry after `document_prepared`; it must not ask for Markdown regeneration.

- [ ] **Step 4: Run focused recovery tests**

```bash
bun test packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
bun run typecheck
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/native-canonical-document-tool.ts packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts
git commit -m "feat: commit document authority pairs"
```

### Task 4: Project authority records instead of upstream prose

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts`

- [ ] **Step 1: Replace prose expectations with sidecar expectations in tests**

Define the projection result as:

```ts
type FoundationAuthorityProjection = Readonly<{
  targetPath: FoundationDocumentPath
  sourceDigests: Readonly<Record<string, string>>
  records: readonly FoundationAuthorityRecord[]
  byteLength: number
}>
```

Assert UI/UX receives only records from the GDD and Level section IDs in its contract, preserves source-contract order and authority-ID order, and never contains source headings or production-material prose. Reject missing sidecars, wrong Markdown digests, duplicate selected IDs and an uncontracted source section.

In the session-port test assert the assignment points to exactly one run-private projection path, contains no upstream body, and says full source sections are optional authorized fallback rather than default input.

- [ ] **Step 2: Run and confirm RED**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
```

Expected: FAIL because the projector still returns Markdown `content`.

- [ ] **Step 3: Implement exact record projection**

Change the pure projector API to accept canonical Markdown and parsed sidecars:

```ts
export function projectFoundationAuthority(input: {
  targetPath: FoundationDocumentPath
  documents: ReadonlyMap<FoundationDocumentPath, string>
  sidecars: ReadonlyMap<FoundationDocumentPath, unknown>
}): FoundationAuthorityProjection
```

For each `target.upstreamSections` entry, call `validateFoundationAuthoritySidecar`, filter by `sectionIds`, and append records in contract order. Calculate `byteLength` from canonical JSON bytes of the selected projection.

Add a helper in `delivery-worker-session-port.ts` that writes:

```text
.beegame/workflow/authority-projections/<dispatchId>.json
```

using a durable temporary-file rename. The prompt names this file, lists authorized source sections, and contains neither complete sidecar JSON nor Markdown bodies. Do not change Claude Code tool availability.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/foundation-authority-projection.ts packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts
git commit -m "feat: project compact document authority"
```

### Task 5: Gate progression, backfill old projects and recover safely

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow-document-order.test.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [ ] **Step 1: Write workflow-level failing tests**

Cover these state transitions:

```text
new Markdown + committed sidecar -> accept document -> dispatch next document
new Markdown + missing/stale sidecar -> remain on same document -> authority-only repair
legacy completed Markdown + no sidecar -> authority-only backfill -> preserve Markdown digest
restart at document_prepared -> reconcile pair -> no duplicate model dispatch
invalid static upstream selector -> blocked code error -> no model retry
```

Assert `completedPaths` advances only after a v2 committed receipt and that backfill never includes a Markdown write path.

- [ ] **Step 2: Run and confirm RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
```

Expected: FAIL because progression currently checks only the Markdown receipt.

- [ ] **Step 3: Add the authority-only dispatch state**

Add to the document-author contract:

```ts
authorityMode?: 'document_and_sidecar' | 'sidecar_only'
authoritySourceDigest?: string
authorityProjectionPath?: string
authorityProjectionBytes?: number
```

Persist these fields in `schema.ts`. In `document-stage.ts`, resolve the current document pair before accepting a terminal. If Markdown is canonical but its sidecar is absent or stale, create a `sidecar_only` author dispatch whose allowed write target is the sidecar and whose source digest is fixed to the Markdown bytes. If a downstream document is next, validate every required upstream pair before dispatching it.

In recovery, reconcile v2 receipts before projecting accepted units. Never convert a schema-v1 receipt into trusted sidecar authority; schedule backfill instead. A code-invalid upstream contract throws a deterministic blocked error without incrementing the author attempt.

- [ ] **Step 4: Run workflow GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/document-stage.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts packages/agent-workflow-server/src/beegame/delivery-workflow-document-order.test.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "feat: require authority sidecars for document progress"
```

### Task 6: Persist useful per-document usage instead of one misleading total

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts`

- [ ] **Step 1: Write a failing document-performance test**

Complete one successful document dispatch and one rejected sidecar attempt. Assert the journal contains stable per-attempt measurements:

```ts
{
  targetPath: 'docs/GDD.md',
  authorityMode: 'document_and_sidecar',
  usage: {
    input_tokens: 100,
    cache_read_tokens: 500,
    cache_creation_tokens: 0,
    completion_tokens: 40,
    total_tokens: 640,
  },
  markdownBytes: 12000,
  sidecarBytes: 4500,
  projectionBytes: 0,
  modelTurns: 3,
  toolCalls: 2,
  retryReason: null,
}
```

The rejected attempt must retain its own usage and `retryReason: 'authority_validation'` instead of being merged invisibly into the successful attempt.

- [ ] **Step 2: Run and confirm RED**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts --test-name-pattern "document performance"
```

Expected: FAIL because document dispatches do not emit `documentPerformance`.

- [ ] **Step 3: Add document performance beside reviewer performance**

In `dispatch.ts`, add `documentPerformance()` parallel to `reviewerPerformance()`. Use the existing `usageDelta` function; do not recalculate provider usage. Read byte counts from the committed receipt/projection metadata and counts from the terminal result. Store the result on terminal evidence and recovery events. Keep raw usage fields unchanged for compatibility.

Add `weightedTokens` only when returned by the billing settlement authority; never reproduce the pricing formula inside the workflow server.

- [ ] **Step 4: Run GREEN and commit**

```bash
bun test packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
bun run typecheck
git add packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
git commit -m "feat: record document generation efficiency"
```

### Task 7: Show fresh, cache, output, raw and weighted values distinctly

**Files:**
- Modify: `apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx`
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.tsx`
- Modify: `apps/frontend/src/components/Demiurge/DashboardView.test.tsx`

- [ ] **Step 1: Write the failing UI test**

Render a project with:

```ts
tokenUsage: {
  input_tokens: 76_241,
  cache_read_tokens: 507_112,
  cache_creation_tokens: 0,
  output_tokens: 27_469,
  total_tokens: 610_822,
},
creditSummary: {
  weightedTokens: 264_297,
  consumedCredits: 7,
},
```

Open the project-info tooltip. Assert rows labelled Fresh Input, Cache Read, Output, Raw Processed and Weighted Consumption show the five distinct values. Assert no row labels `610,822` as cost or billable tokens.

- [ ] **Step 2: Run and confirm RED**

```bash
cd apps/frontend && bun --bun node_modules/vitest/vitest.mjs run --config vitest.config.ts src/components/Demiurge/DashboardView.test.tsx
```

Expected: FAIL because the tooltip still renders generic Input/Cached/Total rows and omits weighted tokens.

- [ ] **Step 3: Wire billing-authority weighted usage**

Expand the preview `credits` prop to:

```ts
credits?: {
  consumedCredits: number
  weightedTokens: number
} | null
```

Return `{ freshInput, cacheRead, cacheCreation, output, rawProcessed }` from `normalizeProjectTokenUsage`. Render weighted usage from `creditSummary.weightedTokens`. Keep credits as a separate monetary row. Add translation fallbacks in English text so missing locale entries remain understandable.

- [ ] **Step 4: Run GREEN and commit**

```bash
cd apps/frontend && bun --bun node_modules/vitest/vitest.mjs run --config vitest.config.ts src/components/Demiurge/DashboardView.test.tsx
cd ../.. && bun run typecheck
git add apps/frontend/src/components/Demiurge/BeeGameLivePreviewPage.tsx apps/frontend/src/components/Demiurge/DashboardView.tsx apps/frontend/src/components/Demiurge/DashboardView.test.tsx
git commit -m "fix: distinguish document token metrics"
```

### Task 8: Full automated verification and real Chrome eight-document acceptance

**Files:**
- Create: `docs/superpowers/evidence/2026-08-12-eight-document-authority-sidecars.md` only after collecting results.
- Runtime output: do not commit the Chrome test idea or generated project.

- [ ] **Step 1: Run all focused document and workflow tests**

```bash
bun test \
  packages/agent-workflow-server/src/beegame/foundation-authority-sidecar.test.ts \
  packages/agent-workflow-server/src/beegame/foundation-authority-projection.test.ts \
  packages/agent-workflow-server/src/beegame/complete-game-document.test.ts \
  packages/agent-workflow-server/src/beegame/native-canonical-document-tool.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-worker-session-port.complete-documents.test.ts \
  packages/agent-workflow-server/src/beegame/delivery-workflow-document-order.test.ts \
  packages/agent-workflow-server/src/__tests__/delivery-workflow-recovery.test.ts
bun run typecheck
git diff --check
```

Expected: all tests pass, typecheck exits 0, and diff-check prints nothing.

- [ ] **Step 2: Start the fixed service-port stack**

Use the existing fixed contract:

```text
frontend 62273
workflow runtime 62274
billing 62275
skills 62276
resources 62277
```

Verify each health endpoint before opening Chrome. Do not substitute dynamic ports.

- [ ] **Step 3: Generate all eight documents through Chrome**

Use the configured model and normal BGS UI. Create a fresh runtime-only test project, start Idea-to-documents, and stop immediately after the eighth document and sidecar are committed. Do not start implementation or resource generation.

- [ ] **Step 4: Verify durable outputs and quality**

Confirm all eight Markdown files and eight sidecars exist and match digests. Audit each Markdown for its discipline contract, required production materials, human clarity, Agent implementability, redundant prose and empty structure. Sample every sidecar against source text and verify later documents cite or apply projected authority correctly.

- [ ] **Step 5: Compare real consumption**

Report per document and total:

```text
fresh input
cache read
cache creation
output
raw processed
weighted tokens
credits
turns
tool calls
retry tokens and reasons
Markdown bytes
sidecar bytes
projected authority bytes
authorized full-section reads
```

Compare documents two through eight with the prior full-section baseline. Pass only if default projected upstream bytes are materially lower, no BGS syntax/sidecar fault causes a full-document rewrite, and document quality does not regress. Record the observed result rather than changing a threshold after the run.

- [ ] **Step 6: Update evidence and commit**

Create the evidence file with exact commands, pass counts, run ID, output paths and measurements. Do not commit the generated user project.

```bash
git add docs/superpowers/evidence/2026-08-12-eight-document-authority-sidecars.md
git commit -m "test: verify authority sidecar document flow"
```

## Plan Self-Review

- Spec coverage: sidecar schema, document-pair durability, exact projection, sidecar-only repair/backfill, recovery, telemetry, UI clarity and Chrome verification each have a task.
- Boundary check: Claude authors all semantic content; BGS only validates, persists, projects and measures.
- Token check: no context reset, thinking disablement, tool filtering, prose truncation or enlarged write chunks are introduced.
- Migration check: existing Markdown is preserved and receives sidecar-only backfill.
- Verification check: automated behavior and actual Chrome output quality are both required before completion.
