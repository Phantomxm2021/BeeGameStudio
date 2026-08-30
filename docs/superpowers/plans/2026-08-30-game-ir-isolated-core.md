# Isolated Game IR Core Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify the independent Game IR Stage 5 contract, core model, admission, atomic publication, and recovery library without changing the stable Stage 3/4 runtime or routing production workflows into an incomplete IR.

**Architecture:** The Game IR core lives under a new `delivery-workflow/game-ir/` boundary. It consumes a strict DTO projected by an outer integration adapter from Foundation READY authority; no Foundation Reviewer or Revision module imports Game IR. This first plan intentionally leaves `DeliveryRun`, `controller.ts`, `transition.ts`, and production recovery unchanged so an incomplete domain model cannot become reachable.

**Tech Stack:** TypeScript, Bun test, Zod, Node `crypto` and `fs/promises`, existing Bee Game Studio canonical document and workflow types.

**Spec:** `docs/beegame-game-ir-stage-isolation-redesign.md`

## Global Constraints

- Foundation documents remain the sole editable business authority.
- Stage 3/4 behavior and persisted schema remain byte-for-byte unchanged during this plan.
- Foundation Reviewer/Revision modules must not import `game-ir`.
- No legacy reader, migration reader, fallback, dual write, or old/new runtime switch is allowed.
- No production route may enter Game IR until every required domain module and consumer cutover gate is approved.
- Compiler candidate bytes never become authority before strict admission and COMMITTED publication.
- No fixed business attempt, Token, duration, entity, relation, or artifact-count limit is introduced.
- Existing dirty worktree files are reference material only; code is ported by responsibility, never copied as one 844-line unit.

---

### Task 1: Freeze the import and runtime boundary

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`

**Interfaces:**
- Consumes: repository source tree under `packages/agent-workflow-server/src/beegame/delivery-workflow`
- Produces: a permanent architecture test proving Foundation internals cannot depend on Game IR and the incomplete Stage 5 is not reachable

- [ ] **Step 1: Write the boundary characterization test**

Create a Bun test that reads these production files recursively:

```ts
const protectedFoundationFiles = [
  'foundation-audit-artifacts.ts',
  'foundation-audit-authority.ts',
  'foundation-audit-check-definitions.ts',
  'foundation-audit-contracts.ts',
  'foundation-audit-production-manifest.ts',
  'foundation-audit-rules.ts',
  'foundation-audit-state.ts',
  'foundation-fact-definitions.ts',
  'foundation-fact-extraction.ts',
  'foundation-fact-runtime.ts',
  'foundation-fact-store.ts',
  'foundation-impact-analysis.ts',
  'foundation-issue-registry.ts',
  'foundation-patch-validation.ts',
  'foundation-revision-batches.ts',
  'foundation-revision-publication.ts',
  'foundation-revision-round-policy.ts',
  'foundation-revision-stage.ts',
  'foundation-semantic-audit.ts',
  'foundation-semantic-runtime.ts',
  'revision.ts',
] as const
```

Assert each file contains neither an import path matching `/game-ir(?:\/|['"])/` nor the tokens `GameIr`, `GAME_IR`, and `gameIrState`.

Also assert the current production files `types.ts`, `schema.ts`, `controller.ts`, `transition.ts`, and `recovery.ts` do not yet contain `GAME_IR_COMPILATION` or `gameIrState`. This assertion is intentionally removed only in the later production-cutover plan, in the same commit that makes the complete Stage 5 reachable.

- [ ] **Step 2: Run the test and freeze the clean baseline**

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Expected: PASS. This is a characterization test that freezes the already-correct stable boundary before new Stage 5 code exists; it does not justify a production change.

- [ ] **Step 3: Commit the architecture test**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
git commit -m "test: freeze Game IR stage boundary"
```

---

### Task 2: Define strict cross-stage DTOs

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`

**Interfaces:**
- Consumes: `FoundationDocumentPath` and `CANONICAL_FOUNDATION_DOCUMENTS` from `../types`
- Produces:
  - `FoundationReadyReceipt`
  - `GameIrCompileRequest`
  - `FoundationDefectReport`
  - `GameIrReadyReceipt`
  - `parseFoundationReadyReceipt(value)`
  - `parseGameIrCompileRequest(value)`
  - `parseFoundationDefectReport(value)`
  - `parseGameIrReadyReceipt(value)`

- [ ] **Step 1: Write strict schema tests**

Tests must prove the following exact DTO shapes:

```ts
type FoundationReadyReceipt = Readonly<{
  schemaVersion: 'foundation-ready-receipt.v1'
  projectId: string
  foundationRevision: string
  confirmedBriefDigest: string
  documentDigests: Readonly<Record<FoundationDocumentPath, string>>
  sectionIndexPath: string
  sectionIndexDigest: string
  authority:
    | Readonly<{
        kind: 'review'
        reviewDigest: string
        issueRegistryDigest: string
      }>
    | Readonly<{
        kind: 'revision_publication'
        baseRevision: string
        authorityDigest: string
        issueRegistryDigest: string
      }>
  receiptDigest: string
}>

type GameIrCompileRequest = Readonly<{
  schemaVersion: 'game-ir-compile-request.v1'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v1'
  foundation: FoundationReadyReceipt
}>

type FoundationDefectReport = Readonly<{
  schemaVersion: 'foundation-defect-report.v1'
  taskId: string
  foundationRevision: string
  reasonCode: string
  expected: string
  actual: string
  source: Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
    digest: string
  }>
  target: Readonly<{
    documentPath: FoundationDocumentPath
    sectionId: string
  }>
  sourceBindingPointers: readonly string[]
}>

type GameIrReadyReceipt = Readonly<{
  schemaVersion: 'game-ir-ready-receipt.v1'
  taskId: string
  publicationId: string
  gameIrSchemaVersion: 'game-ir.v1'
  foundationRevision: string
  foundationReceiptDigest: string
  manifestDigest: string
  moduleDigests: Readonly<Record<string, string>>
  sourceMapDigests: Readonly<Record<string, string>>
  dependencyGraphDigest: string
  committedPath: string
}>
```

Assert all schemas are strict; reject an unknown field, a missing canonical document digest, an extra document path, malformed SHA-256 digest, unsafe task/publication ID, traversal artifact path, duplicate/unsorted/empty `sourceBindingPointers`, empty reason/expected/actual, a receipt that carries both authority variants, a receipt whose canonical digest is stale, and mismatched Foundation revision between compile request and receipt. `receiptDigest` is SHA-256 over canonical receipt bytes with the `receiptDigest` field omitted; it is never self-hashed.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Expected: FAIL because `contracts.ts` and its parsers do not exist.

- [ ] **Step 3: Implement minimal strict schemas**

Use Zod `.strict()`, one shared SHA-256 schema, one safe relative artifact-path schema, and `Object.freeze` on parsed DTOs and nested records/arrays. Do not import `FoundationAuditState`, Reviewer artifacts, controller, schema, or recovery.

Export:

```ts
export const GAME_IR_STAGE_BOUNDARY = 'foundation-ready-receipt -> game-ir-stage.v1' as const
export const GAME_IR_SCHEMA_VERSION = 'game-ir.v1' as const
```

- [ ] **Step 4: Run tests and verify GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
git commit -m "feat: define isolated Game IR contracts"
```

---

### Task 3: Project Foundation READY through an outer adapter

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.test.ts`

**Interfaces:**
- Consumes: `FoundationAuditState`, project ID, confirmed brief digest
- Produces: `projectFoundationReadyReceipt(input): FoundationReadyReceipt`

- [ ] **Step 1: Write adapter tests**

Build real valid `audit_ready` and `revision_ready` Foundation states using existing test fixtures. Assert the adapter emits a receipt only when:

- status is `audit_ready` or `revision_ready`;
- `issueSummary.total === 0`;
- all eight document digests are present;
- Section Index, review/authority, empty Registry and publication bindings are internally consistent;
- `revision_ready` uses the committed revision publication authority rather than the prior review digest.

Reject `index_staged`, active review/revision substages, non-empty Registry, missing review/publication authority, mismatched revision, and caller-supplied document digests.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.test.ts
```

Expected: FAIL because the adapter does not exist.

- [ ] **Step 3: Implement the adapter**

The adapter may import both Foundation state and Game IR contracts because it is the explicit outer seam. It must not be imported by any `foundation-*` file. Derive every field from the parsed current Foundation state; accept no caller override beyond `projectId` and `confirmedBriefDigest`.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-ready-adapter.test.ts
git commit -m "feat: project Foundation READY receipt"
```

---

### Task 4: Define the Game IR core candidate and source authority

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts`

**Interfaces:**
- Consumes: `GameIrCompileRequest` and validated Section Index entries bound to its `sectionIndexDigest`
- Produces:
  - `GameIrSourceBinding`
  - `GameIrNode`
  - `GameIrModuleCandidate`
  - `GameIrCandidate`
  - `GameIrSourceSection`
  - `parseGameIrCandidate(value, { request, sections })`
  - `canonicalGameIrJson(value)`
  - `digestGameIrValue(value)`

- [ ] **Step 1: Write model tests**

Define a minimal core model that is domain-complete in shape without pretending domain compilation is implemented:

```ts
type GameIrSourceBinding =
  | Readonly<{
      kind: 'owner'
      documentPath: FoundationDocumentPath
      sectionId: string
      sectionDigest: string
      sourcePointer: string
    }>
  | Readonly<{
      kind: 'derived'
      derivationRuleId: string
      inputPointers: readonly string[]
    }>

type GameIrNode = Readonly<{
  id: string
  kind: string
  producerMode: 'mechanical' | 'semantic' | 'derived'
  value: Readonly<Record<string, unknown>>
  bindings: Readonly<Record<string, GameIrSourceBinding>>
}>

type GameIrModuleCandidate = Readonly<{
  moduleId: string
  nodes: readonly GameIrNode[]
}>

type GameIrCandidate = Readonly<{
  schemaVersion: 'game-ir.v1'
  taskId: string
  foundationRevision: string
  modules: readonly GameIrModuleCandidate[]
}>

type GameIrSourceSection = Readonly<{
  documentPath: FoundationDocumentPath
  sectionId: string
  digest: string
}>
```

Tests must reject duplicate/unsorted module IDs, duplicate/unsorted node IDs, unknown producer mode, unsafe JSON pointer, owner binding outside the Foundation receipt, a source section not present in the receipt-bound Section Index, wrong section digest, derived binding with empty/duplicate/unsorted inputs, a binding key that points to neither `/id` nor a leaf in `value`, an owner-bearing identity/value leaf without exactly one binding, and a derived leaf without exactly one derived binding. `kind`, `moduleId` and `producerMode` are service metadata and do not receive owner bindings.

Assert canonical JSON is byte stable under object-key insertion order and that arrays retain declared canonical order.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
```

Expected: FAIL because the core model does not exist.

- [ ] **Step 3: Implement the minimum core model**

Use one recursive JSON-value schema; reject non-finite numbers, `undefined`, functions and class instances. Validate document authority against the compile request and section authority against the supplied receipt-bound Section Index entries. Do not add gameplay, balance, scene, presentation, resource or implementation-specific fields in this task.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/model.test.ts
git commit -m "feat: define Game IR core model"
```

---

### Task 5: Add independent semantic projection admission contracts

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`

**Interfaces:**
- Consumes: the complete admitted candidate, its compile request, the full
  receipt-bound Section Index, one selected canonical module, and the exact
  authored Markdown section bytes used by that module
- Produces:
  - `GAME_IR_SEMANTIC_VALIDATOR_MANIFEST`
  - `GameIrSemanticValidationPacket`
  - `GameIrSemanticValidationResult`
  - `buildGameIrSemanticValidationPacket(input)`
  - `admitGameIrSemanticValidationResult(packet, result)`

- [ ] **Step 1: Write admission tests**

The service-owned validator manifest fixes the canonical Game IR modules and
the checks required for each module. V1 requires `core`, `gameplay`, `balance`,
`world-scene`, `presentation`, `resource-realization`, and
`implementation-verification`; every required module must be present and
non-empty before a packet can be built. Common checks include projection
fidelity, projection completeness, source bounds, ambiguity, and cross-module
invariants; each module also has its domain check from the redesign document.

The builder accepts no detached module or caller-supplied task/revision
identity. It reparses the complete immutable candidate against the compile
request and full Section Index, mechanically recomputes the Section Index
digest, selects the requested module, and derives its exact owner-source
closure. Each packet carries the complete candidate bytes, candidate digest,
Foundation receipt and Section Index identities, selected module ID, fixed
validator manifest identity/digest/check IDs, and the exact Markdown bytes for
the selected source sections. The service verifies each Markdown byte digest
against its Section Index ref before constructing the packet.

Evidence pointers use the exact owner-binding source namespace
`<documentPath>#<sectionId><sourcePointer>`; a coarse section identity is not
admissible. A PASS is a coverage receipt and must return the exact fixed check
IDs in canonical order. The result is exactly one of:

```ts
{ outcome: 'PASS'; packetDigest: string; checkIds: string[] }
{ outcome: 'FAIL'; packetDigest: string; reasonCode: string; actual: string; evidencePointers: string[] }
{ outcome: 'AMBIGUOUS'; packetDigest: string; reasonCode: string; actual: string; evidencePointers: string[] }
```

Reject empty/missing canonical modules, forged Section Index metadata, missing
or extra source bytes, source byte digest mismatch, worker-supplied expected,
target, Patch, replacement candidate, unknown or coarse evidence pointer,
stale packet/manifest/candidate digest, incomplete/duplicate/unsorted PASS
coverage, duplicate evidence pointer and any extra key. Assert validator output
can never modify candidate bytes.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts
```

Expected: FAIL because semantic admission does not exist.

- [ ] **Step 3: Implement packet and result admission**

Keep the implementation pure. It does not dispatch a model in this task and
does not write workflow state. The manifest is service-owned and cannot be
overridden by input. `AMBIGUOUS` is mapped to a FoundationDefectReport only by
a later Stage 5 orchestrator plan.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts
git commit -m "feat: define Game IR semantic admission"
```

---

### Task 6: Add atomic Game IR publication and recovery

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts`

**Interfaces:**
- Consumes one exact `GameIrPublicationAuthority`: publication ID, compile
  request, complete candidate, full receipt-bound Section Index, and the real
  semantic packet plus admitted PASS result for every canonical module
- Produces:
  - a pure expected-artifact builder used by publication and validation
  - `prepareGameIrPublication(input)`
  - `commitGameIrPublication(input)`
  - `recoverGameIrPublication(input)`
  - `validateCommittedGameIr(input)`
  - `GameIrReadyReceipt`

- [ ] **Step 1: Write publication and cut-point tests**

Use a temporary workspace. Assert the sole layout is:

```text
.beegame/ir/game-ir.v1/
  .staging/<publicationId>/
  .journal/<publicationId>.json
  revisions/<foundationRevision>/
    manifest.json
    dependency-graph.json
    modules/<moduleId>.json
    source-maps/<moduleId>.json
    COMMITTED.json
```

The API has one field name for each authority. Do not accept aliases such as
`request`/`compileRequest` or `semanticReceipts`/`semanticPassReceipts`.
Publication must reparse the candidate against the compile request and full
Section Index, then call semantic result admission for each exact packet/result
pair. The seven canonical modules must be present once, sorted, and each packet
must bind the same candidate, receipt, validator manifest and module.

The expected artifact set is rebuilt purely from that external authority and
contains exact canonical bytes for every module, source map, dependency graph,
manifest and marker. Manifest/journal/marker bind the Foundation receipt,
compile request digest, candidate digest, semantic packet/result evidence,
module/source-map digests and dependency graph digest. Recovery and committed
validation always receive the same external authority and compare exact
expected bytes; journal/staging/final files can never self-attest.

Publication uses a complete-directory visibility boundary: write PREPARED
journal first, build and validate the entire private staging tree, write its
COMMITTED marker last, then atomically rename the non-empty staging directory
to the previously absent revision directory. Never copy or overwrite files in
an already-visible final directory. On a rename race, validate the winner
against external authority: exact bytes are an idempotent success, conflicts
fail closed. Recovery fills only missing expected staging files, rejects
unexpected/conflicting bytes, performs the same atomic directory rename, and
reconciles an already complete final directory before cleanup.

All existing path components beneath a canonicalized workspace root must be
checked with `lstat`; stored symlinks and non-directories are rejected.
Revision and publication path segments are validated before any write. New
files use exclusive/no-follow creation where supported. No filesystem mutation
occurs before authority, paths and the complete expected artifact set are
validated. Cross-process Bee Game publishers must coordinate through the same
protocol and reconcile rename races. An unrelated same-user process that
maliciously replaces a checked ancestor between path-based Node/Bun syscalls is
outside this application integrity boundary: this runtime has no portable
`openat`/directory-fd API, and such a process can also rewrite application code
and committed outputs. Validation must detect resulting divergence, but the
design does not claim native sandbox guarantees it cannot perform a first
write.

Test:

- PREPARED journal exists before final publication;
- COMMITTED is written last inside private staging and becomes visible only in
  the atomic directory rename;
- no `latest`, candidate alias or mutable current pointer exists;
- crash after each journal/staging/rename/cleanup cut point rolls forward to
  the same committed receipt using the external authority;
- replay is idempotent;
- conflicting final bytes fail closed;
- coordinated tampering of journal plus staging, and tampered final module,
  source map, dependency graph, manifest or marker fail closed even when all
  attacker-controlled digests are recomputed;
- stale Foundation revision/digest fails closed;
- fake digest-only PASS, mixed/stale packet, detached/empty/invalid candidate,
  missing module and semantic module without real PASS admission cannot publish;
- failed staging is never exposed as READY;
- successful recovery and marker-before-cleanup replay remove shared staging;
  the PREPARED journal is immutable audit evidence and remains bound to its
  never-reused publication ID after READY;
- traversal, pre-existing symlink components and concurrent same-revision
  publishers cannot write outside the root or produce mixed final bytes;
- journal and staging files use temp-write/fsync/rename (or an equivalent
  atomic-file primitive), so a crash during a file write leaves only a
  disposable recognized temp file and never a partial authority artifact;
- strict authority objects and arrays reject symbol, accessor, non-enumerable,
  sparse and custom-property state;
- no arbitrary module/node/artifact count cap exists.

- [ ] **Step 2: Run tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts
```

Expected: FAIL because publication does not exist.

- [ ] **Step 3: Implement minimal atomic publication**

Port only canonical JSON, digest, journal and directory validation ideas from
the old dirty `game-ir.ts`. Replace its per-file final copying with the single
directory publication boundary above. Do not port its typed-owner compiler,
Foundation Issue routing, resource consumer, `GameIrState`, controller/recovery
branches, compatibility aliases or self-signed recovery. Split exact
manifest/source-map/dependency construction from filesystem mutation.

- [ ] **Step 4: Run tests and verify GREEN**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts
git commit -m "feat: publish Game IR atomically"
```

---

### Task 7: Prove Stage 3/4 parity and core readiness

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/publication.test.ts`
- Create: `docs/game-ir-salvage-matrix.md`

**Interfaces:**
- Consumes: stable Foundation fixtures and all Game IR core modules from Tasks 1-6
- Produces: automated non-regression evidence and the audited KEEP/ADAPT/REWRITE/DISCARD/REPROVE ledger

- [ ] **Step 1: Write parity tests**

For at least two variants built from the existing
`complete-game-document-fixture`, run the current complete Foundation planning
path twice: once directly, and once after projecting a
`FoundationReadyReceipt` and strictly parsing only the isolated compile
request boundary. Phase 1 has no Gameplay/Balance/World/etc. producers, so this
parity test must not invent seven placeholder candidates merely to exercise
later APIs. Candidate/domain integration remains RED for the later domain
plans. Assert exact equality of:

- Foundation fact task packets;
- deterministic Issue Registry;
- semantic task identities/packets;
- revision batch and Patch packet identities for a fixture with issues;
- targeted recheck packet;
- Foundation READY state/receipt inputs.

Use `buildFoundationSectionIndex`, normalized fact extraction,
`buildFoundationFactPackets`, fact result admission, production deterministic
audit, real semantic packets/task identities, and—in the issue-bearing
fixture—`buildFoundationRevisionAuthority`, revision batches and targeted
recheck. Do not hand-write fake section positions, fact task packets, Patch
packet identities or source digests.

The Game IR boundary may read copies of receipt-bound documents, but the test
must serialize Foundation documents/state before the call and reserialize the
same objects after it; then rerun Foundation planning from those same inputs.
Assert canonical document digests, state bytes, READY receipt fields and all
Foundation outputs remain unchanged. The compile request must be deterministic
and receipt-bound, but no production route may construct it.

For the Stage 4 fixture, use one admitted production issue from the same
complete-document authority, build the real revision authority, modify only an
authorized staged section, derive PatchOperations from the actual base/staged
bytes and revision receipt, rebuild the Section Index and impacted facts,
validate the patch, and construct the targeted recheck from those resulting
artifacts. A no-op operation or a READY receipt from an unrelated fixture does
not establish parity.

The targeted packet must come from
`buildFoundationSemanticRecheckPacket` using the actual derived PatchOperation,
patched documents, rebuilt Section Index, rebuilt fact store and impact. The
post-revision READY state/receipt must bind those same patched document and
derived digests. Compare the exact targeted packet identity before and after
the isolated compile-request boundary.

Resolve the repository root from `import.meta.url`, not `process.cwd()`. Compare
the protected files byte-for-byte with baseline `70df2e2c`, with an explicit
diagnostic if the Git baseline is unavailable. In addition, parse every
production TypeScript source below `delivery-workflow` outside `game-ir/` and
reject static/dynamic Game IR imports and routing identifiers. The detector
must have synthetic positive and negative self-tests proving it catches an
import/route while ignoring comments and ordinary string literals.
Replace the original raw `source.includes` matcher in `stage-boundary.test.ts`
with the same AST semantics. Cover import declarations, export declarations,
import-equals, literal `require`, literal dynamic import, all `GameIr*` and
`GAME_IR*` runtime identifiers, and common enable/switch identifiers rather
than two exact names.
Object property declarations, assignments and accesses such as
`gameIrState`, `run.gameIrState` and `config.enableGameIr` are routing/state
surface and must not be excluded merely because the identifier is a property
name. The standalone stage-boundary scan must retain import/export/require
violations as well as identifier violations.

- [ ] **Step 2: Run parity tests and verify RED**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts
```

Expected: FAIL until the complete-fixture parity harness and strict outer
boundary are present.

- [ ] **Step 3: Add the minimum test fixture builder**

Keep only parity composition helpers in the test file. They may render complete
existing test documents and construct real Foundation planning inputs, but
must not add production domain defaults, fake Game IR nodes or placeholder
domain modules.

- [ ] **Step 4: Write the salvage matrix**

Inventory the old dirty worktree read-only. Give every dirty Game IR source,
test fixture, plan, exported symbol, direct production consumer path and
Stage 3/4 delta a stable ledger item ID and exactly one category: KEEP, ADAPT,
REWRITE, DISCARD or REPROVE. A file-as-implementation item and a design idea
inside it are distinct IDs; do not classify the same item twice. Include why,
dependencies, and the later plan that may consume it. At minimum enumerate
`game-ir.ts` exports, `game-ir.test.ts`, `typed-owner-records.test.ts`,
`game-ir-resource-fixture.ts`, every production importer/consumer found in the
dirty tree, and all protected controller/schema/types/transition/recovery
deltas. Mark Stage 3/4 replacements and direct Foundation-state mutations
DISCARD; unrelated Reviewer/Revision fixes are REPROVE only when identified as
independent deltas. Explain any classification that refines design §9.2.

Generate the dirty export/import inventory mechanically from the saved dirty
worktree during authoring, then transcribe the exact results. Do not list
symbols from the new isolated contracts as if they were exports of the old
`game-ir.ts`, and do not omit consumers that import only digest/canonical
helpers. The matrix must agree with a fresh `rg`/AST inventory of that saved
checkout.

Do not hand-select a supposed subset of dirty Reviewer/Revision paths. Record
the complete saved-worktree `git status --porcelain=v1 -uall` snapshot with its
HEAD, entry count and SHA-256 digest, and list every returned path/status once
in an artifact ledger. Each dirty artifact delta is `DISCARD`; a future
independent fix starts from the stable baseline and is separately `REPROVE`d.
Export-symbol and consumer-relationship tables are different conceptual item
types and may reference a path already present in the artifact snapshot, but
must say so explicitly.

- [ ] **Step 5: Run the full core and Foundation regression**

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
bun run typecheck
git diff --check
```

Expected: all Game IR core tests pass; Foundation remains at or above the clean baseline of 263 passing tests; typecheck and diff-check pass.

- [ ] **Step 6: Audit forbidden production changes**

Verify `git diff 70df2e2c -- packages/agent-workflow-server/src/beegame/delivery-workflow/types.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/controller.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.ts packages/agent-workflow-server/src/beegame/delivery-workflow/recovery.ts` is empty.

- [ ] **Step 7: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts docs/game-ir-salvage-matrix.md
git commit -m "test: prove isolated Game IR core"
```

---

## Completion Gate

This plan is complete only when:

- the new Game IR core library is fully tested but unreachable from production routing;
- the stable Foundation suite still passes with no Stage 3/4 production diff;
- no protected Foundation module imports Game IR;
- publication/recovery is atomic and revision-bound;
- the salvage matrix is audited;
- there is no legacy reader, fallback, dual write or compatibility path;
- the next plan can implement Gameplay + Balance schemas and producers without changing Stage 3/4.
