# Game IR World/Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated, immutable, source-bound World/Scene and Presentation Game IR projections and one replayable closure without making production routing or complete candidate publication reachable.

**Architecture:** Extend the accepted Core/Phase 4 boundary with one seven-module source-document authority, one replayable Phase 4 authority, one shared Phase 5 claim/receipt replay boundary, two closed domain schemas, and one fidelity-gated closure assembler. The assembler always rebuilds Phase 4, then World, then Presentation; no detached module, projection, digest, map, publication, or production route is trusted.

**Tech Stack:** TypeScript, Bun test, Node `crypto`/`Buffer`/`TextDecoder`, existing Core canonical JSON/digest/source-binding helpers, Foundation READY/Section Index contracts, and TypeScript AST boundary tests.

**Spec:** `docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md`

## Global Constraints

- Work only in `codex/game-ir-stage-isolation` at `.worktrees/game-ir-stage-isolation`.
- Phase 5 remains an isolated Stage 5 library and is unreachable from `DeliveryRun`, production routing, persistence, controller transitions, provider dispatch, Reviewer, Revision, consumers, publication, and Chrome acceptance.
- Do not modify Foundation Reviewer/Revision production behavior or any protected Stage 3/4 production file.
- Do not add a complete `GameIrCandidate`, seven-module writer, partial publication, Phase 6/7 module, controller/store/provider/persistence interface, fallback, compatibility/migration/legacy reader, dual write, or fixed business cap.
- `GAME_IR_MODULE_SOURCE_DOCUMENTS` is the unique service-owned source-document manifest for all seven canonical modules. Domain-source and semantic-validator closures call the same canonical helper; neither repeats or reorders document lists independently.
- Core `GameIrNode`, `GameIrReference`, `GameIrRelationshipEdge`, `GameIrSourceBinding`, `GameIrModuleCandidate`, `GameIrSourceSection`, parsers, canonicalizers, digest functions, and target-pointer validation remain the sole Core authorities.
- There is one source authority, one diagnostic authority, one Phase 4 Gameplay–Balance pair writer, one Phase 5 receipt replay/binding helper, and one World/Presentation closure writer.
- Phase 4 output bytes and digests remain identical for accepted inputs. Phase 5 replays `GameplayBalanceAssemblyAuthority` through `assembleGameplayBalanceModules` and never accepts a detached Phase 4 pair or projection.
- World/Scene and Presentation mechanical receipts have exactly empty `nodes`, `verifiedClaims`, and `ownedTargets`. Empty mechanical output is policy, not fallback.
- Semantic claims cover `/id`, every value leaf, every reference, and every edge exactly once. References use canonical `{ targetId, targetType }` literals; edges use canonical `{ type, targetId, targetType }` literals.
- Exact byte verification occurs in the single receipt replay/binding boundary, which has both the validated source envelope and the admitted receipt. A worker-result function that receives only `packet + value` performs structural/identity admission and must not pretend to possess source bytes.
- Source ranges are canonical `/bytes/<start>/<end>` pointers with unsigned safe decimal offsets, no leading zero except `0`, `start < end`, exact UTF-8 code-point boundaries, exact decoded literals, and exact value types.
- Fidelity packets contain the full replayed external projections, derive check IDs and target-manifest digests internally, and admit only an exact reconstructed `PASS` with complete check/target coverage.
- Logical Presentation requirements contain only `requirementId`, `kind`, and `runtimeRole`. Artifact rejection is strict unknown-key/value-schema rejection; never infer an artifact from the shape of an arbitrary string or label.
- Missing/ambiguous producer diagnostics are packet/source-bound, node-qualified, immutable, and section-evidence-only. Fidelity mismatch evidence uses exact owner bindings; evidence namespaces cannot cross over.
- Every task must achieve at least one assertion-level RED before implementing the tested behavior. A missing module/export/type error may establish API wiring but does not count as behavioral RED and must not mask the focused assertions.
- Focused RED/GREEN commands run per task. The full Game IR gate runs after the closure task; the full Foundation/parity/typecheck/isolation gate runs once in Task 11. Do not immediately rerun focused tests already covered by the same glob.
- Biome checks TypeScript only. Markdown is checked with explicit status/source scans and `git diff --check`; do not claim Biome processed ignored Markdown files.
- Each task ends in one independently reviewable commit containing every listed source and test file.

## Dependency and Shared-File Matrix

| Task | Depends on | Shared files | Parallel-safe after dependencies |
| --- | --- | --- | --- |
| 1. Source authority + Phase 4 replay | accepted Phase 4 | existing source/semantic/assembler files | no |
| 2. Claim admission + receipt replay | Task 1 | `domain-projection.*`, creates `phase5-admission.*` | no |
| 3. World schema | Task 1 | new World files only | yes, with Task 4 |
| 4. Presentation schema | Task 1 | new Presentation files only | yes, with Task 3 |
| 5. Fidelity packet/result | Tasks 2–4 | modifies only `phase5-admission.*` | no |
| 6. World producer | Tasks 2, 3, 5 | new World producer files only | yes, with Task 7 |
| 7. Presentation producer | Tasks 2, 4, 5 | new Presentation producer files only | yes, with Task 6 |
| 8. Closure assembler | Tasks 1–7 | new assembler files only | no |
| 9. Traversal profile | Task 8 | dedicated traversal integration file | yes, with Task 10 |
| 10. Puzzle profile | Task 8 | dedicated puzzle integration file | yes, with Task 9 |
| 11. Final parity/isolation/status | Tasks 9–10 | parity, boundary, roadmap/spec docs | no |

---

### Task 1: Canonical Source Authority and Golden Phase 4 Replay

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance-assembler.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts`

**Interfaces:**

```ts
export const GAME_IR_MODULE_SOURCE_DOCUMENTS: Readonly<
  Record<GameIrModuleId, readonly FoundationDocumentPath[]>
> = Object.freeze({
  core: Object.freeze(['docs/GDD.md']),
  gameplay: Object.freeze(['docs/GDD.md']),
  balance: Object.freeze(['docs/GDD.md', 'docs/BALANCE_DESIGN.md']),
  'world-scene': Object.freeze([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
  ]),
  presentation: Object.freeze([
    'docs/GDD.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
  ]),
  'resource-realization': Object.freeze([
    'docs/ASSET_PLAN.md',
    'docs/TECHNICAL_DESIGN.md',
    'docs/ART_DIRECTION.md',
    'docs/UI_UX_SPEC.md',
    'docs/AUDIO_DESIGN.md',
    'docs/LEVEL_SCENE_DESIGN.md',
  ]),
  'implementation-verification': Object.freeze([
    'docs/GDD.md',
    'docs/LEVEL_SCENE_DESIGN.md',
    'docs/BALANCE_DESIGN.md',
    'docs/TECHNICAL_DESIGN.md',
  ]),
})

export function canonicalGameIrModuleSourceDocuments(
  moduleId: GameIrModuleId,
): readonly FoundationDocumentPath[]

export type GameIrDomainId =
  | 'gameplay'
  | 'balance'
  | 'world-scene'
  | 'presentation'

export type GameplayBalanceAssemblyAuthority = Readonly<{
  gameplay: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: GameplaySemanticReceipt
  }>
  balance: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: BalanceSemanticReceipt
  }>
}>

export function assembleGameplayBalanceModules(
  authority: GameplayBalanceAssemblyAuthority,
): GameplayBalanceModulePair
```

`GAME_IR_MODULE_SOURCE_DOCUMENTS` contains exactly the seven arrays in design §2/§3. `canonicalGameIrModuleSourceDocuments` validates the module ID and returns one frozen, code-unit-canonical document array. Both `domain-source.ts` and `semantic-admission.ts` call it; `MODULE_DESCRIPTORS` retains only domain check IDs and contains no document arrays.

- [ ] **Step 1: Capture accepted Phase 4 output before the refactor**

Add `toMatchInlineSnapshot()` assertions for canonical pair bytes plus both projection digests to the existing complete Phase 4 fixture. Run the accepted code once with snapshot update, inspect the generated inline literals, then rerun without update.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts -u`

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts`

Expected: PASS before production edits; the checked-in snapshot is the golden byte/digest baseline, not a same-call tautology.

- [ ] **Step 2: Write source-authority RED tests**

Assert exact seven keys, exact canonical arrays, all-eight authority index retention, exact World/Presentation selected closures, and byte-identical canonical document arrays from the domain-source and semantic-validator consumers. Mutate a document order, duplicate, omission, extra document, narrowed Section Index, and source bytes.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts`

Expected: the first run may report missing exports as API-wiring RED. After the exports resolve, at least one assertion must still fail because the two existing private document lists are independent; record that assertion-level RED before implementing the shared helper.

- [ ] **Step 3: Implement the unique canonical source helper**

Move all seven arrays into `GAME_IR_MODULE_SOURCE_DOCUMENTS`, implement `canonicalGameIrModuleSourceDocuments`, and derive domain envelopes and semantic-validator manifests from it. Preserve the complete eight-document authority index and the current Gameplay/Balance selected section order/digests.

- [ ] **Step 4: Export and type the existing replay authority**

Rename only the assembler input type boundary to `GameplayBalanceAssemblyAuthority`. Keep the existing Phase 4 producer receipt aliases and preparation behavior unchanged; do not add a second pair writer or accept projections in the authority.

- [ ] **Step 5: Verify focused behavior and the golden replay**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

Run: `./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance-assembler.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts`

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance-assembler.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance.integration.test.ts
git commit -m "refactor: centralize Game IR source authority"
```

---

### Task 2: Shared Phase 5 Claim Admission and Exact Receipt Replay

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

**Interfaces:**

```ts
export type Phase5SemanticCandidateNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
}>
export type Phase5AdmittedSemanticNode = Phase5SemanticCandidateNode &
  Readonly<{ producerMode: 'semantic' }>
export type GameIrDomainSourceClaim = Readonly<{
  subject: string
  documentPath: FoundationDocumentPath
  sectionId: string
  sourcePointer: string
  literal: string
}>
export type Phase5SemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  outcome: 'PROJECTED'
  taskId: string
  moduleId: 'world-scene' | 'presentation'
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly Phase5AdmittedSemanticNode[]
  sourceClaims: readonly GameIrDomainSourceClaim[]
  receiptDigest: string
}>
export type Phase5SemanticResult =
  | Phase5SemanticReceipt
  | GameIrDomainSemanticDiagnostic
export function admitPhase5SemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): Phase5SemanticResult
export type Phase5BoundSemanticModule = Readonly<{
  source: GameIrDomainSourceEnvelope
  module: GameIrModuleCandidate
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
}>
export function replayAndBindPhase5SemanticReceipt(input: Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  packet: GameIrDomainSemanticPacket
  semantic: Phase5SemanticReceipt
}>): Phase5BoundSemanticModule
```

`admitPhase5SemanticResult` owns strict DTO shape, identity injection, node/claim normalization, target coverage, diagnostics, and receipt digesting. `replayAndBindPhase5SemanticReceipt` is the only Phase 5 function that validates a stored receipt against source/mechanical/packet authority, verifies exact UTF-8 bytes and typed literals, creates Core owner bindings, proves mechanical/semantic disjointness, and Core-admits the isolated module. Producers call the first function; the closure assembler calls the second. Neither reimplements these operations.

- [ ] **Step 1: Write mechanical-policy and claim RED tests**

Cover exact empty `nodes`, `verifiedClaims`, and `ownedTargets` for all four isolated domain IDs; non-empty/unsorted/duplicate ownership; hidden/accessor fields; worker-supplied identity/bindings; duplicate/omitted targets; canonical node/claim ordering; and packet relabeling.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Expected: after API wiring resolves, an assertion fails because current mechanical admission recognizes only Gameplay/Balance or because exact Phase 5 receipt replay is absent.

- [ ] **Step 2: Add exact range/type RED tests**

Test leading-zero, negative, unsafe, empty, reversed, out-of-range, and split-code-point ranges; number/boolean/string/ID mismatch; semantically contrary but byte-valid literals; reference target tampering; and edge role tampering.

```ts
const referenceLiteral = canonicalGameIrJson({
  targetId: reference.targetId,
  targetType: reference.targetType,
})
const edgeLiteral = canonicalGameIrJson({
  type: edge.type,
  targetId: edge.targetId,
  targetType: edge.targetType,
})
```

Expected assertion-level RED: changing only `edge.type` while keeping target ID/type and source range fixed is rejected only after the new replay verifier exists.

- [ ] **Step 3: Implement structural admission and the single replay/binder**

Use Core code-unit sorting, target-pointer parsing, canonical JSON, digesting, and `parseGameIrModuleCandidate`. Decode the exact `Buffer.from(sectionBytes, 'utf8').subarray(start, end)` with fatal `TextDecoder`, explicitly prove both offsets are UTF-8 boundaries, and convert decoder failures into the Phase 5 admission error namespace.

- [ ] **Step 4: Verify focused behavior**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

Run: `./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
git commit -m "feat: replay Phase 5 semantic receipts"
```

---

### Task 3: World/Scene Schema and Graph Guards

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts`

**Interfaces:**

```ts
export type WorldSceneRelationshipCardinality =
  | 'exactly-one'
  | 'zero-or-one'
  | 'at-least-one'
  | 'volume-exactly-one-otherwise-zero'
  | 'triggered-exactly-one-otherwise-zero'
export type WorldSceneRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  cardinality: WorldSceneRelationshipCardinality
}>
export type WorldCoordinateConvention =
  | Readonly<{
      dimensions: '2d'; xDirection: 'left' | 'right'; yDirection: 'up' | 'down'
      distanceUnit: 'pixel' | 'centimeter' | 'meter'
    }>
  | Readonly<{
      dimensions: '3d'; handedness: 'left' | 'right'
      upAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      distanceUnit: 'centimeter' | 'meter'
    }>
export type WorldTransformValue =
  | Readonly<{
      dimensions: '2d'; space: 'local' | 'world'
      position: Readonly<{ x: number; y: number }>; rotationRadians: number
      scale: Readonly<{ x: number; y: number }>
    }>
  | Readonly<{
      dimensions: '3d'; space: 'local' | 'world'
      position: Readonly<{ x: number; y: number; z: number }>
      rotation: Readonly<{ x: number; y: number; z: number; w: number }>
      scale: Readonly<{ x: number; y: number; z: number }>
    }>
export type WorldZoneGeometry =
  | Readonly<{ kind: 'rectangle'; size: Readonly<{ x: number; y: number }> }>
  | Readonly<{ kind: 'circle'; radius: number }>
  | Readonly<{ kind: 'capsule-2d'; radius: number; length: number }>
  | Readonly<{ kind: 'box'; size: Readonly<{ x: number; y: number; z: number }> }>
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'capsule-3d'; radius: number; height: number }>
export const WORLD_SCENE_DOMAIN_MANIFEST: Readonly<
  Record<string, Readonly<{
    valueFields: readonly string[]
    relationships: Readonly<Record<string, WorldSceneRelationshipRole>>
  }>>
>
export function parseWorldSceneModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate
```

The manifest contains exactly the ten approved kinds, value fields, target kinds, roles, and cardinality rules. Conditional node-zone and encounter-trigger cardinality is selected from manifest metadata; no second role/cardinality table exists.

| Kind | Exact value fields | Exact relationship cardinality |
| --- | --- | --- |
| `world-scene.scene` | `label`, `coordinateConvention` | `root` exactly one → `world-scene.node` |
| `world-scene.node` | `label`, `nodeType`, `transform` | `scene` exactly one → scene; `parent` zero/one → node; `zone` → zone exactly once only for `volume`, otherwise zero |
| `world-scene.zone` | `label`, `shape`, `transform` | `scene` exactly one → scene |
| `world-scene.entity-instance` | `label` | `scene` → scene, `entity` → `gameplay.entity`, `location` → node exactly one; `zone` zero/one → zone |
| `world-scene.route` | `label`, `closed`, `waypointReferenceIndexes` | `scene` exactly one → scene; all Core references → node |
| `world-scene.spawn` | `label`, `quantity`, `policy` | `scene` → scene, `location` → node, `entity` → `gameplay.entity` exactly one |
| `world-scene.encounter` | `label`, `mode` | `scene` → scene and `zone` → zone exactly one; `spawn` at least one → spawn; `triggered-by` → `gameplay.event` exactly once only for `triggered`, otherwise zero |
| `world-scene.checkpoint` | `label`, `ordinal`, `resetPolicy` | `scene` → scene, `location` → node, `respawn-state` → `gameplay.state` exactly one |
| `world-scene.camera-region` | `label`, `priority`, `blendIn`, `blendOut` | `scene` → scene, `zone` → zone, `anchor` → node exactly one; anchor node type must be `anchor` |
| `world-scene.objective-placement` | `label` | `scene` → scene, `objective` → `gameplay.objective`, `location` → node exactly one; `zone` zero/one → zone |

Closed values are exact: node type is `container | anchor | volume | visual`; spawn policy is `once | wave | repeat`; encounter mode is `triggered | patrol | scripted`; reset policy is `restart | last-checkpoint | manual`. No Balance, Presentation, Resource, or Implementation target kind is admitted.

- [ ] **Step 1: Write manifest/value assertion-level RED tests**

After API wiring, run a valid minimal scene plus mutations for every geometry, 2D/3D convention, finite transforms, distinct unsigned axes, nonzero quaternion norm, positive scale/geometry, exact value keys, root world-space, and node-type/zone cardinality.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts`

Expected assertion-level RED: a zero quaternion or non-positive scale is initially accepted or fails with the wrong boundary before its guard is implemented.

- [ ] **Step 2: Write graph/number assertion-level RED tests**

Cover exactly one root per scene, parent closure/cycle/orphan/cross-scene failures, instances, routes with repeated visits, every declared reference used, route index range, spawns, all encounter modes, checkpoints, cameras, objectives, duplicate singleton roles, wrong kinds, and dangling targets. Numeric cases explicitly include `spawn.quantity` positive safe integer, checkpoint ordinal non-negative safe integer, camera priority any safe integer, and non-negative finite blends.

- [ ] **Step 3: Implement the closed manifest and parser**

Derive allowed kinds/roles/target types and conditional cardinality dispatch from `WORLD_SCENE_DOMAIN_MANIFEST`. Use only local World nodes plus allowed Phase 4 Gameplay entity/event/state/objective targets. Repeated route indexes remain legal and never create edges.

- [ ] **Step 4: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
git commit -m "feat: validate Game IR world scene graphs"
```

---

### Task 4: Presentation Schema, Requirements, and UI Graph Guards

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts`

**Interfaces:**

```ts
export type PresentationRelationshipCardinality =
  | 'exactly-one'
  | 'zero-or-one'
  | 'transition-trigger-dependent'
  | 'audio-event-spatial-dependent'
export type PresentationRelationshipRole = Readonly<{
  targetKinds: readonly string[]
  cardinality: PresentationRelationshipCardinality
}>
export type PresentationRequirementPolicy = Readonly<{
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRoles: readonly ('screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music')[]
}>
export type PresentationTransitionTrigger =
  | Readonly<{ kind: 'automatic' }> | Readonly<{ kind: 'event' }>
  | Readonly<{ kind: 'action' }> | Readonly<{ kind: 'state' }>
  | Readonly<{ kind: 'world-scene' }> | Readonly<{ kind: 'camera-region' }>
export type PresentationLogicalResourceRequirement = Readonly<{
  requirementId: string
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRole: 'screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music'
}>
export const PRESENTATION_DOMAIN_MANIFEST: Readonly<
  Record<string, Readonly<{
    valueFields: readonly string[]
    optionalValueFields?: readonly string[]
    requirementPolicy?: PresentationRequirementPolicy
    relationships: Readonly<Record<string, PresentationRelationshipRole>>
  }>>
>
export function parsePresentationModule(
  module: GameIrModuleCandidate,
  externalTargets?: ReadonlyMap<string, GameIrNode>,
): GameIrModuleCandidate
```

The manifest contains exactly the twelve approved kinds. Optional `requirements` and each owner/kind/runtime-role policy live only in manifest metadata; there is no separate `requirementOwner` map. Artifact/path/file/digest keys fail as unknown fields, while arbitrary labels are not scanned for filename-like text.

| Kind | Exact value fields | Exact relationship cardinality |
| --- | --- | --- |
| `presentation.ui-screen` | `label`, `modal`; optional `requirements` | `initial-state` exactly one → UI state; `driven-by` exactly one → Gameplay state/event or World scene |
| `presentation.ui-state` | `label`, `terminal` | `screen` exactly one → UI screen; `driven-by` exactly one → Gameplay state/event or World scene |
| `presentation.ui-action` | `label`, `input` | `screen` → UI screen and `invokes` → `gameplay.action` exactly one; `available-in` zero/one → `gameplay.state` |
| `presentation.feedback` | `label`, `channel` | `on` exactly one → Gameplay event/state/action; `screen` zero/one → UI screen |
| `presentation.camera-behavior` | `label`, `mode`, `duration` | `region` exactly one → World camera region; `on` zero/one → Gameplay event/state/action |
| `presentation.animation-clip` | `label`, `loop`, `playbackRate`; optional `requirements` | `target` exactly one → World entity instance or `gameplay.entity` |
| `presentation.animation-state` | `label` | `clip` exactly one → animation clip; `on` exactly one → Gameplay event/state/action |
| `presentation.vfx-cue` | `label`, `trigger`; optional `requirements` | `on` exactly one → Gameplay event/state/action; `at` exactly one → World node/zone/camera region |
| `presentation.audio-event` | `label`, `spatial` | `on` exactly one → Gameplay event/state/action |
| `presentation.audio-cue` | `label`, `volume`; optional `requirements` | `event` exactly one → audio event; `at` exactly one → World scene/node/zone/entity instance/camera region only when referenced event is spatial, otherwise zero |
| `presentation.music-state` | `label`, `intensity`; optional `requirements` | `on` exactly one → Gameplay event/state/action |
| `presentation.transition` | `label`, `trigger` | `from`, `to` exactly one → same-screen UI states; `on` zero for automatic, otherwise exactly one → event/action/state/World scene/camera region matching the discriminant |

Closed values are exact: input is `button | pointer | key | gesture | system`; feedback channel is `text | icon | meter | haptic | flash`; camera mode is `follow | fixed | blend | cut | shake`; VFX trigger is `instant | attached | persistent`. Presentation accepts no Balance, Resource, or Implementation target.

| Requirement owner | Manifest `requirementPolicy` |
| --- | --- |
| `presentation.ui-screen` | `ui` / `screen` |
| `presentation.animation-clip` | `animation` / `clip` |
| `presentation.vfx-cue` | `vfx` / `effect` |
| `presentation.audio-cue` | `audio` / `cue` or `voice` |
| `presentation.music-state` | `music` / `music` |

- [ ] **Step 1: Write manifest/value assertion-level RED tests**

Cover optional requirements on exactly five owners, global safe unique requirement IDs, code-unit ordering, owner policy, trigger discriminants, duration/playback/volume/intensity boundaries, strict unknown fields, and animation-state rejection of initial/terminal/machine fields.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts`

Expected assertion-level RED: omitting optional `requirements` is accepted while adding `fileName` is rejected through strict unknown-key validation.

- [ ] **Step 2: Write UI/behavior graph assertion-level RED tests**

Cover initial-state backlinks, same-screen reachability, terminal states, cross-screen transitions, trigger/on cardinality/kind, UI actions, feedback, camera behavior, entity animation, animation state, VFX, spatial/non-spatial audio, music, missing clip/event, duplicate audio trigger, cue-level `on`, and forbidden Balance/resource/implementation targets.

- [ ] **Step 3: Implement manifest-derived validation**

Derive optional fields, requirement ownership, relationship targets, and conditional cardinality from `PRESENTATION_DOMAIN_MANIFEST`. Graph traversal may implement reachability, but must not restate manifest role/target/requirement tables.

- [ ] **Step 4: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts
git commit -m "feat: validate Game IR presentation graphs"
```

---

### Task 5: Service-Owned Fidelity Packet and Result Admission

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

**Interfaces:**

```ts
export type WorldSceneSemanticValidationResult = Phase5SemanticValidationResult
export type PresentationSemanticValidationResult = Phase5SemanticValidationResult
export type WorldSceneModuleProjection = Readonly<{
  schemaVersion: 'game-ir-world-scene-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'world-scene' }>
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest: string
  projectionDigest: string
}>
type Phase5SemanticValidationPacketBase = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-validation-packet.v1'
  taskId: string
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  sourceSections: readonly GameIrSemanticSourceSection[]
  moduleBytes: string
  moduleDigest: string
  targetManifestDigest: string
  checkIds: readonly string[]
  requiredTargets: readonly string[]
  allowedEvidencePointers: readonly string[]
  packetDigest: string
}>
export type Phase5SemanticValidationPacket = Readonly<
  Phase5SemanticValidationPacketBase &
    (
      | { moduleId: 'world-scene'; externalProjections: Readonly<{
          gameplay: GameplayModuleProjection
        }> }
      | { moduleId: 'presentation'; externalProjections: Readonly<{
          gameplay: GameplayModuleProjection
          worldScene: WorldSceneModuleProjection
        }> }
    )
>
export type Phase5SemanticValidationResult = Readonly<
  | { outcome: 'PASS'; packetDigest: string; checkIds: readonly string[];
      coveredTargets: readonly string[] }
  | Extract<GameIrSemanticValidationResult, { outcome: 'FAIL' | 'AMBIGUOUS' }>
>
export function buildPhase5SemanticValidationPacket(input: Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: Phase5SemanticReceipt
  module: GameIrModuleCandidate
  externalProjections:
    | Readonly<{ gameplay: GameplayModuleProjection }>
    | Readonly<{ gameplay: GameplayModuleProjection;
        worldScene: WorldSceneModuleProjection }>
}>): Phase5SemanticValidationPacket
export function admitPhase5SemanticValidationResult(
  packet: Phase5SemanticValidationPacket,
  value: unknown,
): Phase5SemanticValidationResult
```

These types match design §7.1 exactly. `GameplayModuleProjection` is imported from the accepted Phase 4 assembler; `WorldSceneModuleProjection` has one definition here and is later re-exported by the sole writer. No reduced projection alias or synthetic top-level module ID is introduced. The builder derives `moduleId` from the semantic receipt, obtains the ordered check IDs from the matching entry in `GAME_IR_SEMANTIC_VALIDATOR_MANIFEST`, imports the corresponding domain manifest and derives its digest internally, validates the exact external projection branch, and includes the full projections in `packetDigest`. Callers cannot pass check IDs or a target-manifest digest.

- [ ] **Step 1: Write packet reconstruction assertion-level RED tests**

Cover exact keys, both discriminated branches, full external projection fields, wrong/missing/extra external projection, stale Phase 4/World projection, module relabeling, compile/authority digest changes, caller-supplied check/manifest fields, canonical module bytes, target coverage, and evidence reconstruction.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Expected assertion-level RED after types resolve: mutating a full external projection does not yet invalidate/change the packet until the discriminated packet is implemented.

- [ ] **Step 2: Write result admission RED tests**

Reject boolean/digest-only PASS, partial/extra/duplicate/reordered check or target coverage, stale packet digest, FAIL/AMBIGUOUS closure use, section evidence for mismatch, and owner-binding evidence for missing/ambiguous results.

- [ ] **Step 3: Implement service-owned packet/result admission**

Do not accept `checkIds`, `targetManifestDigest`, detached module digests, or maps from callers. Derive required targets from `/id`, every value leaf, reference, and edge; derive exact owner/section evidence from bindings/source; freeze every nested result.

- [ ] **Step 4: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
git commit -m "feat: admit Phase 5 fidelity results"
```

---

### Task 6: World/Scene Producer Wrapper

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts`

**Interfaces:**

```ts
export type WorldSceneSemanticReceipt = Phase5SemanticReceipt &
  Readonly<{ moduleId: 'world-scene' }>
export type WorldSceneSemanticResult =
  | WorldSceneSemanticReceipt | GameIrDomainSemanticDiagnostic
export function buildWorldSceneSemanticPacket(input: Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}>): GameIrDomainSemanticPacket
export function admitWorldSceneSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): WorldSceneSemanticResult
```

The packet builder derives kinds/roles only from `WORLD_SCENE_DOMAIN_MANIFEST`. The result wrapper delegates structural admission to `admitPhase5SemanticResult`. It exports no preparation, parser, binder, projection writer, or fallback.

- [ ] **Step 1: Write wrapper assertion-level RED tests**

Cover exact GDD/Level closure, empty mechanical policy, manifest-derived kinds/roles, stale/relabelled packet, all World kinds, missing/ambiguous diagnostics, evidence crossover, and a graph beyond ordinary size.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts`

Expected assertion-level RED after API wiring: exact manifest kinds/roles or shared receipt identity is absent.

- [ ] **Step 2: Prove the wrapper delegates replay semantics**

Build a receipt through `admitWorldSceneSemanticResult`, then pass it with source/mechanical/packet to `replayAndBindPhase5SemanticReceipt`. Assert exact transform, geometry, route-index, reference, and edge claims; split UTF-8 and edge-role tampering fail in the shared helper, not domain-local code.

- [ ] **Step 3: Implement the thin wrapper**

No claim parser, UTF-8 decoder, binding loop, receipt digest algorithm, or module merge belongs in this file.

- [ ] **Step 4: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts
git commit -m "feat: admit world scene semantic results"
```

---

### Task 7: Presentation Producer Wrapper

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts`

**Interfaces:**

```ts
export type PresentationSemanticReceipt = Phase5SemanticReceipt &
  Readonly<{ moduleId: 'presentation' }>
export type PresentationSemanticResult =
  | PresentationSemanticReceipt | GameIrDomainSemanticDiagnostic
export function buildPresentationSemanticPacket(input: Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}>): GameIrDomainSemanticPacket
export function admitPresentationSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): PresentationSemanticResult
```

The packet builder derives kinds/roles from `PRESENTATION_DOMAIN_MANIFEST`; the wrapper delegates to shared admission. Requirements remain ordinary semantic leaves and create no Resource Realization node.

- [ ] **Step 1: Write wrapper assertion-level RED tests**

Cover exact GDD/Art/UI/Audio closure, all Presentation kinds, empty mechanical ownership, packet/result relabeling, omitted/overlap claims, requirement leaves, diagnostics, and larger reachable cyclic UI graphs.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts`

Expected assertion-level RED after API wiring: manifest-derived packet fields or shared receipt identity is absent.

- [ ] **Step 2: Prove exact shared replay and stable requirement ordering**

Replay through `replayAndBindPhase5SemanticReceipt`; test exact trigger/requirement/reference/edge claims, split UTF-8, typed role mismatch, and unrelated-node insertion without changing existing requirement IDs/order. Add `path`, `fileName`, `digest`, or provider fields and expect strict unknown-key failure; filename-like label text remains legal.

- [ ] **Step 3: Implement the thin wrapper**

Do not duplicate claim normalization, byte decoding, receipt validation, bindings, or requirement policy metadata.

- [ ] **Step 4: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts
git commit -m "feat: admit presentation semantic results"
```

---

### Task 8: Sole World/Presentation Closure Assembler

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts`
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts`

**Interfaces:**

```ts
export type { WorldSceneModuleProjection } from './phase5-admission'
export type PresentationModuleProjection = Readonly<{
  schemaVersion: 'game-ir-presentation-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'presentation' }>
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest: string
  projectionDigest: string
}>
export type WorldPresentationAssemblyAuthority = Readonly<{
  phase4Authority: GameplayBalanceAssemblyAuthority
  worldScene: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: WorldSceneSemanticReceipt
    validation: WorldSceneSemanticValidationResult
  }>
  presentation: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: PresentationSemanticReceipt
    validation: PresentationSemanticValidationResult
  }>
}>
export type WorldPresentationClosure = Readonly<{
  schemaVersion: 'game-ir-world-presentation-closure.v1'
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  phase4: GameplayBalanceModulePair
  worldScene: WorldSceneModuleProjection
  presentation: PresentationModuleProjection
  closureDigest: string
}>
export function assembleWorldPresentationClosure(
  authority: WorldPresentationAssemblyAuthority,
): WorldPresentationClosure
```

- [ ] **Step 1: Write authority/replay assertion-level RED tests**

Cover exact/frozen keys; stale/tampered/missing Phase 4 authority; a detached/recomputed Phase 4 projection inserted where raw authority is required; raw Map/digest-only/detached module; mixed task/revision/READY/compile/index identities; and duplicate global IDs.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts`

Expected assertion-level RED after API wiring: a forged authority branch reaches preparation or is accepted before exact replay/shape validation exists.

- [ ] **Step 2: Write ordered fidelity/closure RED tests**

Invalid Phase 4 must fail before World; invalid World receipt/schema/fidelity must fail before Presentation; Presentation sees only replayed Gameplay plus admitted World. Cover wrong-kind/forbidden targets, incomplete PASS, FAIL/AMBIGUOUS, stale external projections, altered validation/projection/closure digests, and evidence crossover.

- [ ] **Step 3: Implement ordered replay with explicit fields**

```ts
const phase4 = assembleGameplayBalanceModules(authority.phase4Authority)
const worldPacket = buildWorldSceneSemanticPacket({
  source: authority.worldScene.source,
  mechanical: authority.worldScene.mechanical,
})
const boundWorld = replayAndBindPhase5SemanticReceipt({
  source: authority.worldScene.source,
  mechanical: authority.worldScene.mechanical,
  packet: worldPacket,
  semantic: authority.worldScene.semantic,
})
const worldModule = parseWorldSceneModule(
  boundWorld.module,
  new Map(phase4.gameplay.module.nodes.map(node => [node.id, node])),
)
const worldValidationPacket = buildPhase5SemanticValidationPacket({
  source: authority.worldScene.source,
  mechanical: authority.worldScene.mechanical,
  semantic: authority.worldScene.semantic,
  module: worldModule,
  externalProjections: { gameplay: phase4.gameplay },
})
```

Pass `authority.worldScene.validation` separately. Never spread an authority branch into a strict builder. After exact World PASS, freeze the sole World projection; only then replay/bind/parse/fidelity-admit Presentation using `{ gameplay: phase4.gameplay, worldScene }`.

- [ ] **Step 4: Compute sole projections and closure**

Projection digests exclude only themselves; validation-result digests use admitted results; closure digest includes every preceding field and all four complete projections. Validate global ID disjointness and every typed edge. Emit no candidate, publication, store record, route, fallback, or detached trust receipt.

- [ ] **Step 5: Run the complete Game IR implementation gate**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts`

Run: `bun run typecheck`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

Run: `./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir`

Run: `git diff --check`

- [ ] **Step 6: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts
git commit -m "feat: assemble isolated World Presentation closure"
```

---

### Task 9: Complete Traversal/Action Profile

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`

**Interfaces:** Consumes public producer/authority/closure APIs only. Produces one complete eight-document fixture and no production helper.

- [ ] **Step 1: Build the profile and obtain assertion-level RED**

Include all eight documents, exact Section Index bytes, READY receipt, replayable Phase 4 authority, multiple scenes/rooted hierarchies, 2D/3D transforms/zones, player/enemy instances, route, wave/patrol encounters, checkpoints, cameras, objective placement, HUD/menu UI, action transitions, player animation, VFX, spatial audio, music, and requirements.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`

Expected assertion-level RED: one exact expected kind/edge/route/coverage assertion fails before the fixture or remaining closure behavior is completed; a missing import alone is insufficient.

- [ ] **Step 2: Add deterministic and mutation evidence**

Compile the same frozen authority twice and compare canonical World, Presentation, Phase 4, and closure bytes/digests. Mutate source bytes/ranges, each mechanical ownership array, typed literals, graph/numeric/UI/trigger/requirement rules, Phase 4 authority, identities, external projections, and forbidden targets. Assert exact kinds, edges, route order, requirements, and complete validator coverage rather than only `not.toThrow()`.

- [ ] **Step 3: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts
git commit -m "test: prove traversal World Presentation profile"
```

---

### Task 10: Complete Branching/Puzzle Profile

**Files:**
- Create: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-puzzle.integration.test.ts`

**Interfaces:** Consumes the same public APIs as Task 9, but owns distinct source bytes and does not import Task 9 helpers.

- [ ] **Step 1: Build the profile and obtain assertion-level RED**

Include all eight documents, a different topology, multiple linear routes sharing waypoints, repeated visits, objective placements, state-driven checkpoints/cameras, multi-screen UI, event feedback, different animation/VFX/audio requirements, and same-screen transitions. Include no delivery artifact or Resource node.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-puzzle.integration.test.ts`

Expected assertion-level RED: an exact topology/requirement/coverage assertion fails before the fixture or remaining behavior is completed.

- [ ] **Step 2: Add determinism, distinction, and no-cap evidence**

Compile twice for identical bytes/digests; assert its closure digest differs from a literal expected traversal digest without importing mutable test helpers. Add expanded scene/route/UI/cue graphs, repeated routes, stable requirement IDs, and unrelated-node insertion while preserving existing derived order. Exercise sizes beyond ordinary fixtures without adding a maximum.

- [ ] **Step 3: Verify and commit**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-puzzle.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-traversal.integration.test.ts`

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-puzzle.integration.test.ts
git commit -m "test: prove puzzle World Presentation profile"
```

---

### Task 11: Final Foundation Parity, Isolation, and Status Gate

**Files:**
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`
- Modify: `packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts`
- Modify: `docs/beegame-game-ir-stage-isolation-redesign.md`
- Verify: `docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md`

**Interfaces:** Consumes the final read-only Phase 5 authority/closure API. Produces parity/isolation/status evidence only; no route, publication, consumer, or future module.

- [ ] **Step 1: Write Phase 5 parity assertion-level RED**

Using the existing complete Foundation fixture and real planning APIs, compare Stage 3/4 tasks, Issue Registry, revision patches, targeted rechecks, documents, and READY receipt before and after invoking the read-only Phase 5 boundary. Re-serialize identical documents/state on both sides.

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts`

Expected assertion-level RED: the new invocation/equality evidence executes and fails an equality assertion rather than stopping at a missing import.

- [ ] **Step 2: Split AST isolation rules by authority level**

Maintain three scans:

1. Protected Foundation and non-Game-IR production reject every Game IR import/identifier and the exact 21 protected production files remain byte-identical to `70df2e2c`.
2. Accepted Phase 4 files reject World/Presentation/Resource/Implementation node or projection construction, production APIs, publication, and routes.
3. Phase 5 files allow World/Presentation module IDs only in schema/producer/closure positions; reject Resource/Implementation node construction, complete candidate/publication, production imports/calls, fallback/compatibility/dual-write, and detached closure consumers.

The literal future-module keys are allowed only inside the unique `GAME_IR_MODULE_SOURCE_DOCUMENTS` declaration and the semantic manifest derived from it. This whitelist permits no future node, candidate, producer, route, or projection. Synthetic positive/negative AST fixtures prove every whitelist/rejection; do not scan strings or comments.

- [ ] **Step 3: Update truthful design/roadmap status**

Verify the spec header remains exactly `Status: Approved` and its footer still states that design is approved while implementation acceptance requires plan completion, independent review, and root verification. Update only corresponding Phase 5 roadmap wording; do not mark Phase 6–9 started or claim production reachability/publication/Chrome.

- [ ] **Step 4: Run the final acceptance gate once**

Run: `bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts`

Run:

```bash
bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
```

Run: `bun run typecheck`

Run: `(cd packages/agent-workflow-server && bun run typecheck)`

Run: `./node_modules/.bin/biome check packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir`

Run: `rg -n "^Status: Approved$|Proposed / awaiting user review|Phase 5.*未开始|Phase 5.*unstarted" docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md docs/beegame-game-ir-stage-isolation-redesign.md`

Expected: exactly one approved header, no Proposed footer, and roadmap wording distinguishes approved design from pending implementation acceptance/production reachability.

Run: `git diff --check`

- [ ] **Step 5: Commit**

```bash
git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts docs/beegame-game-ir-stage-isolation-redesign.md
git commit -m "test: gate isolated World Presentation Phase 5"
```

## Specification Coverage Matrix

| Design section | Implementation/evidence tasks |
| --- | --- |
| §1 boundary/non-goals | Global Constraints, Tasks 8 and 11 |
| §2 dependency/source authority | Tasks 1, 2, 5, 8 |
| §3 source envelope, ownership, diagnostics | Tasks 1, 2, 6, 7 |
| §4 replayable closure API/order | Tasks 5 and 8 |
| §5 World schema/graph/coordinates | Task 3; profiles 9–10 |
| §6 Presentation/UI/requirements | Task 4; profiles 9–10 |
| §7 claims and read-only fidelity | Tasks 2, 5, 6, 7, 8 |
| §8 cross-domain closure | Tasks 3–5 and 8 |
| §9 profiles/mutations/parity/isolation | Tasks 9–11 |
| §10 future replay/non-reachability | Task 11 static gate only; no future module is implemented |
| §11 explicit non-goals | Global Constraints and Task 11 |

## Completion Gate

Phase 5 is ready for final review only when all eleven commits have independent task-level review; every task recorded assertion-level RED and focused GREEN evidence; the unique source helper feeds both document consumers; Phase 4 golden bytes/digests are unchanged; mechanical ownership is exactly empty; every semantic target has one exact typed UTF-8 claim; both schema manifests are the only role/requirement/cardinality authorities; fidelity packets bind complete replayed projections and exact service-owned coverage; ordered replay is Phase 4 → World PASS → Presentation PASS; both complete profiles are deterministic and distinct; the protected parity/isolation/typecheck/Biome/diff gate is green; and no complete candidate, publication, route, consumer migration, Resource Realization, Implementation/Verification, or Chrome acceptance exists.
