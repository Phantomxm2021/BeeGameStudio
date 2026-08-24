# Bee Game Studio Document Audit and Revision Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the authoritative Fact Store + Rule/Contract + semantic audit + issue-driven batch revision pipeline after the eight canonical Markdown documents are committed.

**Architecture:** Preserve the existing Document Author path byte-for-byte in behavior. After all eight author receipts are committed, derive the Section Index locally, extract only a closed catalog of normalized facts from exact indexed sections with bounded read-only workers, validate and persist those facts locally, run deterministic checks, send only unresolved semantic slices to reviewers, compile one Issue Registry, revise affected documents in parallel batches, and validate only changed facts/contracts before continuing to checklist drafting.

**Tech Stack:** TypeScript, Bun, Zod, existing Bee Game Studio delivery workflow runtime, React workflow task UI.

**Spec:** `docs/Bee_Game_Studio_Doc_Audit_Revision_Optimized.md`

## Global Constraints

- The authority document above is the only product/architecture authority for this work.
- Do not change Document Author prompts, author permissions, author output format, `document-stage.ts`, `foundation-authoring-batch.ts`, or the eight canonical Markdown contracts.
- Fact Store and Section Index are derived only after all eight Markdown documents have durable `committed` checkpoints.
- Delete the legacy candidate/projection/synthesis/B-numbering Reviewer path before adding the replacement; do not preserve dual readers, migrations, compatibility flags, or legacy schema fields.
- Local code owns Markdown indexing, normalized-fact admission, schema checks, rule checks, contract checks, digests, path validation, issue compilation, impact analysis, and targeted validation.
- Fact-extraction workers receive only service-declared fact keys and exact owning section slices; they cannot emit issues or read/write project files.
- Audit workers receive only unresolved checks, exact indexed sections, and normalized required facts; they never receive an unconditional eight-document bundle.
- L3 Deep Audit reuses the same bounded check packet and may receive only explicitly selected additional indexed sections for a specific HIGH/BLOCKER uncertainty; it never receives all eight documents.
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

### Task 2: Derive the Section Index and install the audit-state scaffold

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-section-index.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Test: matching `.test.ts` files for each module
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`

**Interfaces:**
- Produces:

```ts
type SectionRef = { documentPath: FoundationDocumentPath; sectionId: string; heading: string; startLine: number; endLine: number; digest: string }
type FoundationAuditIndexManifest = { revision: string; documentDigests: Record<FoundationDocumentPath, string>; sectionIndexDigest: string }
type FoundationAuditStatus = 'index_staged' | 'extracting_facts' | 'facts_staged' | 'derived_committed' | 'deterministic_ready' | 'semantic_review' | 'audit_ready'
```

- [ ] **Step 1: Write failing tests for heading indexing, deterministic digests, contract-grounded sections, and the eight-committed-doc gate.**
- [ ] **Step 2: Run the new tests and verify missing implementations fail.**
- [ ] **Step 3: Implement local Markdown section indexing only; write the revision-bound index scaffold beneath `.beegame/audit/foundation/<revision>/staging/`. Do not create section-body facts.**
- [ ] **Step 4: Add one strict phase-aware `foundationAuditState` schema for the later fact/audit task collection. Task 2 creates only `index_staged`; controller/recovery switch on the exact status and must never treat object presence as audit completion. Only `derived_committed` with a valid derived `COMMITTED.json` may skip fact derivation. Add no compatibility readers.**
- [ ] **Step 5: Run the focused tests plus the untouched authoring tests.**
- [ ] **Step 6: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: index foundation documents after authoring"
```

### Task 3: Implement Schema, Rule, and Contract checks

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-issue-registry.ts`
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
- [ ] **Step 3: Implement deterministic checks and compile their results into one Issue Registry. Read existing document contracts through their current exports; do not edit `game-document-contracts.ts`.**
- [ ] **Step 4: Verify zero model dispatches are produced when all checks are deterministically decidable.**
- [ ] **Step 5: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: add deterministic foundation audit checks"
```

### Task 4: Replace prose-body facts and wire production deterministic audit

**Direction correction:** The initial Task 2 implementation stored one whole Markdown section body as one string fact, and Task 3 rules were exercised only with injected test facts. That representation is rejected. Task 4 must delete it before any semantic Reviewer is added; no body-fact compatibility reader or dual format may remain.

#### Task 4A — Define the normalized fact contract and bounded packets

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.ts`

**Interfaces:**
- A versioned closed service-owned catalog contains exactly these 24 initial keys: `game.players.max`, `game.boss.count`, `game.mechanics`, `game.resources`, `game.states`, `game.win_conditions`, `game.loss_conditions`, `game.platform`, `level.required_entities`, `level.required_assets`, `level.complexity_budget`, `balance.entity_ids`, `balance.variable_ids`, `technical.supported_actions`, `technical.target_fps`, `technical.content_kinds`, `art.style_constraints`, `ui.supported_actions`, `ui.displayed_resources`, `audio.event_ids`, `asset.inventory_ids`, `asset.boss.count`, `asset.art_constraint_refs`, and `asset.formats`. Every definition names its exact owning document/section, type/enum/range, required/optional policy, absent/uncertain policy, extraction instruction, source-of-truth direction, and downstream check consumers.

| Catalog keys | Exact immutable owner |
|---|---|
| `game.players.max`, `game.platform` | `docs/GDD.md#vision` |
| `game.boss.count`, `game.resources` | `docs/GDD.md#rules_systems` |
| `game.mechanics` | `docs/GDD.md#player_actions` |
| `game.states`, `game.win_conditions`, `game.loss_conditions` | `docs/GDD.md#states_flow` |
| `level.required_entities` | `docs/LEVEL_SCENE_DESIGN.md#encounters` |
| `level.required_assets` | `docs/LEVEL_SCENE_DESIGN.md#content_matrix` |
| `level.complexity_budget` | `docs/LEVEL_SCENE_DESIGN.md#production_acceptance` |
| `balance.entity_ids` | `docs/BALANCE_DESIGN.md#entity_parameters` |
| `balance.variable_ids` | `docs/BALANCE_DESIGN.md#units_variables` |
| `technical.supported_actions` | `docs/TECHNICAL_DESIGN.md#input_interaction` |
| `technical.target_fps` | `docs/TECHNICAL_DESIGN.md#performance` |
| `technical.content_kinds` | `docs/TECHNICAL_DESIGN.md#data_content` |
| `art.style_constraints` | `docs/ART_DIRECTION.md#visual_pillars` |
| `ui.supported_actions` | `docs/UI_UX_SPEC.md#input` |
| `ui.displayed_resources` | `docs/UI_UX_SPEC.md#hud` |
| `audio.event_ids` | `docs/AUDIO_DESIGN.md#event_taxonomy` |
| `asset.inventory_ids`, `asset.boss.count` | `docs/ASSET_PLAN.md#inventory` |
| `asset.art_constraint_refs` | `docs/ASSET_PLAN.md#dependencies` |
| `asset.formats` | `docs/ASSET_PLAN.md#formats_budgets` |
- Each definition declares `mechanical | model_if_unresolved`. Local table/list/numeric parsing runs first; only unresolved catalog keys enter a cheap-model packet. No generic regex may invent a key outside the catalog.
- One extraction packet contains only unresolved declared keys plus exact indexed owning section slices, never a whole-document path selector. Packet size is at most 16 KiB UTF-8.
- Every assigned key is accounted exactly once as `present | absent | uncertain`; `invalid` is a local rejection state. `present` requires a typed value and evidence; `uncertain` requires evidence and a reason; `absent` has no value. Evidence contains exact absolute start/end lines inside the assigned SectionRef plus a digest of those bytes. The Fact Store retains only locally admitted `present` facts; task receipts retain full accounting.
- Catalog policy is explicit: required `absent` produces a Schema issue; required `uncertain` produces one ambiguity Schema issue and is excluded from dependent deterministic rules; optional `absent` is receipt-only; optional `uncertain` either seeds one declared Task 5 semantic clarification check or remains receipt-only according to the catalog. Local `invalid` is an operational task failure, never an issue.
- Local code rejects unknown/duplicate/missing/mis-scoped results, invalid line/digest evidence, enum/range/type violations, and any fact value equal to the entire section body.

- [ ] **Step 1: Write behavioral tests proving the existing section-body facts are rejected and real canonical fixtures produce normalized scalar/list facts with exact SectionRef provenance.**
- [ ] **Step 2: In the same commit, delete `extractFoundationFacts()`, remove its artifact call/import, delete all automatic required-string-body declarations, and convert artifact/state scaffolding to index-only staging. Do not retain both formats or a dead intermediate reader.**
- [ ] **Step 3: Add the exact versioned 24-key catalog and mechanical-first extraction; assert every key has a consumer or an explicit acceptance-only role.**
- [ ] **Step 4: Validate result states, deterministic packet identity, 16 KiB size, evidence bounds/digest, exact key accounting, and stable normalized fact digests.**
- [ ] **Step 5: Commit and review Task 4A before runtime integration.**

#### Task 4B — Run fact extraction as one recoverable bounded task collection

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/worker-prompts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/dispatch.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/run-store.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/recovery-projector.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-worker-session-port.ts`
- Modify: `packages/agent-workflow-server/src/beegame/session-manager.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-foundation-fact-result-tool.ts`
- Test: matching delivery-worker, recovery, session, and artifact tests.

**Interfaces:**
- One new `foundation-fact-extractor` worker type with persisted `modelTier: fast`, no project reads, no writes/platform mutation, one strict terminal tool, and no issue output.
- Persist a single discriminated `foundationAuditState.tasks[]` collection. Every task has stable task ID/kind/revision/packet digest/model tier/status/attempt, its own `DispatchRecord`, terminal digest, usage, duration, and failure reason. Extraction creates at most eight tasks, one per document with unresolved catalog keys.
- Teach the existing dispatcher's `dispatchLocation`/locked update/idempotency/terminal/usage paths to locate audit task entries by stable task ID. `activeDispatch` remains unchanged for unrelated workers. Start at most four running audit tasks; do not create another dispatcher, queue, or recovery track.
- `delivery-worker-session-port.ts` passes an explicit empty read scope for fact/semantic workers. `projectWorkspaceFileAccessAuthority()` denies `Read`, `Grep`, and `Glob` only for those scoped worker types; undefined scope preserves every existing worker's authority. Empty `allowedPaths` continues to deny writes.
- Each extraction packet is ≤16 KiB, output ≤512 tokens, attempts ≤2, aggregate extraction usage ≤32,000 model tokens, and the extraction phase deadline is five minutes. Exceeding any cap fails safely with measured task usage; it never expands context.
- Admitted fact results remain under the revision staging root until the shared atomic publish protocol writes Section Index + Fact Store + derived manifest + `COMMITTED.json` into a same-parent temporary directory, validates all digests, then renames the directory to `derived/`. Recovery accepts only a final directory containing the valid commit marker; partial temp/staging sets are rejected or replayed, never treated as authority. The Issue Registry is a separate review artifact finalized by Task 5 and never mutates `derived/`.
- Restart replays only incomplete tasks by stable task ID + packet digest and never re-reads completed packets.
- Zero-task fast path: when mechanical extraction resolves every catalog key and no model packet exists, transition directly from `index_staged` to `facts_staged`, perform the same derived commit, and dispatch zero workers.

- [ ] **Step 1: Write failing tests for the exact audit-task collection shape, four-way bounded concurrency, durable replay, per-task usage/duration, fast-tier model selection, explicit read/write denial, terminal scope rejection, caps, and crash-safe staged/commit-marker publication.**
- [ ] **Step 2: Extend the Task 2 `index_staged` state through `extracting_facts → facts_staged → derived_committed`; bump schema once and add no compatibility reader. The temporary Task 4A-only boundary remains `index_staged` + deterministic needs-action until this runtime exists.**
- [ ] **Step 3: Implement the single task collection and teach the existing dispatcher, run-store, terminal reconciliation, usage, progress, and recovery lookup to locate those entries while preserving ordinary single-lane dispatch.**
- [ ] **Collection invariant:** claim under the run lock only when status is pending/retryable, packet/revision digests match, and running count is below four; attach the dispatch and increment attempt atomically. Terminal acceptance under the same lock validates task/dispatch/revision/packet/terminal digests and completes once; identical replay is idempotent and conflicting replay is rejected. A failure retries only while attempt < 2, otherwise moves the run to needs-action. Collection finalization occurs exactly once only when every task is completed and no pending/running task remains.
- [ ] **Step 4: Enforce the new workers' explicit empty project read/write/platform scope and fast model selection without changing other worker authority.**
- [ ] **Step 5: Commit and review Task 4B before deterministic orchestration.**

#### Task 4C — Run and persist the real deterministic audit

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-authority.ts`

- [ ] **Step 1: Add one versioned service-owned production check manifest imported directly by the controller. Its schema/rule/contract declarations are grounded only in the closed fact catalog and immutable document contract graph; no caller-supplied production rules are accepted.**
- [ ] **Step 2: Run `runDeterministicFoundationAudit()` automatically after fact admission; zero worker/model dispatches are allowed during evaluation.**
- [ ] **Step 3: Add one source-of-truth/fix resolver that validates every issue target against GDD → Technical → downstream ownership; allow Technical→GDD only for an explicit technical-impossibility BLOCKER reason code.**
- [ ] **Step 4: Persist the deterministic prefix of the sole Issue Registry in revision-bound review staging with catalog/check/section/fact/revision digests; reject stale or duplicate identities and never mutate committed `derived/` facts.**
- [ ] **Step 5: Add a real-fixture test: eight canonical Markdown documents → indexed sections → admitted catalog facts → controller-owned production manifest → deliberate mismatch → deterministic issue, with no caller rule fixture, no audit worker, and no body-string fact.**
- [ ] **Step 6: Commit and review Task 4C.**

**Controller/recovery transition table:** `derived_committed` requires a valid immutable derived commit and advances only after the controller-owned production manifest runs; `deterministic_ready` requires the deterministic registry prefix and all manifest/digest bindings, then either atomically publishes an empty-semantic review and advances to `audit_ready`, or seeds the exact semantic tasks and advances to `semantic_review`; `semantic_review` remains running while any semantic/deep task is pending/running, moves to needs-action on exhausted operational failure/cap, and advances to `audit_ready` only after every check is accounted and the final review `COMMITTED.json` validates. `audit_ready` is the sole Task 6 entry. Controller and recovery use exact status + artifact preconditions only, never object-presence shortcuts.

### Task 5: Add targeted semantic and deep audit workers

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-semantic-audit.test.ts`
- Modify: the single `foundationAuditState` task collection, Task 3 registry admission surface, worker contracts/prompts, existing dispatcher/controller/recovery, delivery-worker session port, and scoped model/read authority introduced in Task 4B.

**Interfaces:**
- One versioned manifest contains exactly 22 high-risk semantic cross-document edges, each validated against immutable contract sections/upstream direction. Every check has stable identity independent of line numbers/digests; changing the manifest changes its digest.
- One task checks one edge from exact upstream/downstream slices plus normalized facts; semantic concurrency is four, packet ≤16 KiB, output ≤768 tokens, attempts ≤2, aggregate semantic usage ≤80,000 model tokens, and the semantic deadline is five minutes. Prose appears once; current body-string facts are forbidden.
- One worker type persists `modelTier: fast | balanced | strong`. LOW/MEDIUM checks use fast, HIGH checks use balanced, and BLOCKER or undecidable results require one strong confirmation over the same packet plus explicitly selected indexed sections. Deep packet ≤24 KiB, output ≤1,024 tokens, attempt ≤1, maximum four deep tasks, aggregate deep usage ≤32,000 tokens, and a separate five-minute deadline. Prompt-only routing is invalid and missing configured tiers fail closed.
- Worker drafts contain no IDs and reference only assigned check/sections; the Task 3 registry remains the only issue compiler.

- [ ] **Step 1: Write failing tests proving workers cannot request all eight documents, read project files, write canonical docs, emit outside assigned sections, or bypass Registry identity.**
- [ ] **Step 2: Add the exact 22-check semantic manifest, bounded packets, persisted fast/balanced/strong routing, and strong confirmation only for BLOCKER/undecidable results.**
- [ ] **Step 3: Reuse the one durable audit task collection for parallel dispatch, replay, usage, and ordinary later UI projection; no second queue/dispatcher/recovery path.**
- [ ] **Step 4: Atomically publish `review/<reviewDigest>/issue-registry.json`, its manifest, and `COMMITTED.json` from the deterministic prefix plus admitted semantic results; bind it to the immutable derived digest and leave `DOCUMENT_REVIEW` in an explicit audit-ready-for-revision state. Do not revise documents or mutate `derived/`.**
- [ ] **Step 5: Run prompt, dispatch, contract, audit, recovery, session-authority, model-tier, usage, and typecheck tests; commit and review.**

```bash
git add packages/agent-workflow-server/src
git commit -m "feat: add bounded semantic foundation audit"
```

### Task 6: Implement issue-driven batch revision and targeted validation

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.ts`
- Create: `packages/agent-workflow-server/src/beegame/native-foundation-revision-result-tool.ts`
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
type RevisionTaskReceipt = { taskId: string; round: 1 | 2 | 3; documentPath: FoundationDocumentPath; issueIds: string[]; baseDocumentDigest: string; stagedDocumentDigest: string; changedSectionIds: string[]; stagedPath: string; terminalDigest: string }
type PatchOperation = { kind: 'INSERT' | 'REPLACE' | 'DELETE'; documentPath: FoundationDocumentPath; sectionId: string; issueIds: string[]; beforeDigest?: string; afterDigest?: string }
type PatchValidation = { validatorTaskId: string; round: 1 | 2 | 3; issueId: string; documentPath: FoundationDocumentPath; baseDocumentDigest: string; postPatchDocumentDigest: string; patchDigest: string; changedSectionIds: string[]; status: 'PASS' | 'FAIL'; checkedFactKeys: string[]; checkedContractIds: string[] }
```

- One affected document creates one revision task per round. The worker receives only assigned issues, exact target sections, normalized required facts, and immutable authority refs; it edits the isolated staged Markdown directly. It never returns the Markdown body or a large JSON patch.
- `SubmitFoundationRevisionResult` returns only the bounded receipt above. Local code derives INSERT/REPLACE/DELETE operations from base/staged bytes, verifies issue and section closure, and rejects unrelated changes.
- Each task packet is ≤24 KiB, attempts ≤2, concurrency ≤4, and a round deadline is ten minutes. Usage/duration is stored per document task.
- Publish is service-owned and crash-safe: after all staged documents and validations pass, write a complete `PREPARED.json` journal with every base/staged/patch digest, roll forward canonical replacements with per-path journal entries, and expose the new document revision only after `COMMITTED.json` exists. Recovery resumes the exact prepared publish; it never re-runs successful writers or exposes a second revision authority.

- [ ] **Step 1: Write failing tests for grouping all issues of one document into one batch, parallel batches across documents, protected unrelated paths, and exact issue coverage.**
- [ ] **Step 2: Implement isolated direct-Markdown revision dispatches, the strict bounded terminal receipt, locally derived patch operations, and prepared/committed publish journal.**
- [ ] **Step 3: Rebuild only changed facts/sections, calculate impacted contracts, and validate only those issues/contracts.**
- [ ] **Step 4: Implement the authority document stop policy: Round 1 fixes BLOCKER/HIGH/MEDIUM; Round 2 fixes new BLOCKER/HIGH; Round 3 fixes BLOCKER; no BLOCKER proceeds with remaining MEDIUM/LOW recorded as Known Issues.**
- [ ] **Step 5: Verify stale base/terminal/patch digests, partial publication, failure, restart, exact roll-forward, and no-progress recovery without a second legacy path.**
- [ ] **Step 6: Commit.**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow
git commit -m "feat: add issue-driven foundation revision"
```

### Task 7: Route ordinary Dashboard tasks and complete end-to-end acceptance

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
- Section-body prose is never stored or transported as a normalized fact; every Fact Store entry follows the closed typed catalog and exact SectionRef evidence.
- Every derived artifact is revision-bound and digest-validated.
- Fact-extraction cost is separately attributed, bounded by selected indexed sections, and never hidden inside deterministic audit usage.
- Deterministic checks consume zero model tokens.
- Semantic/deep workers receive each prose slice once plus only normalized required facts; no worker receives all eight documents.
- Issue Registry is the sole revision authority.
- One affected document creates one revision task per round.
- Recheck is limited to changed facts, impacted contracts, and unresolved issues.
- No legacy Reviewer, compatibility reader, revision dual track, or Reviewer-specific UI remains.
- Workflow proceeds automatically to checklist drafting when the stop policy passes.
