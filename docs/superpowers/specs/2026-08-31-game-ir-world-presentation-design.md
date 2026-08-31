# Game IR Phase 5: World/Scene and Presentation Design

Status: Proposed / awaiting user review

Date: 2026-08-31

This design is subordinate to
`docs/beegame-game-ir-stage-isolation-redesign.md` and the accepted Phase 4
design in `docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md`.
It defines only the isolated `world-scene` and `presentation` domain modules.
It is a design specification, not an implementation plan, and does not claim
that Phase 5 is accepted.

## 1. Goal and boundary

Phase 5 adds two strict, immutable, revision-bound domain projections:

- `world-scene`, which describes scene membership, hierarchy, inline spatial
  data, runtime entity instances, traversal, encounters, checkpoints, camera
  regions, and objective placement;
- `presentation`, which describes UI state and action, feedback, camera
  behavior, animation, VFX, audio, music, and presentation transitions.

Both modules are isolated Stage 5 libraries. They are reachable only after a
validated Foundation READY boundary and are not reachable from the production
workflow in this phase. Phase 5 does not change `DeliveryRun`, production
routing, persistence, controller transitions, provider dispatch, reviewer or
revision code, consumer readers, publication, or Chrome acceptance.

The modules are projections of the canonical Foundation documents. They are
not a second editable product authority. A missing or ambiguous owner fact is
reported through the existing packet-bound semantic diagnostic contract; it
does not mutate Foundation state or enter the Issue Registry from inside Game
IR.

The phase has no fixed token, duration, attempt, entity, node, relationship,
route point, requirement, or file limit. Structural validity may require a
non-empty root, endpoint, or binding where the schema cannot have meaning
without one; those are type invariants, not throughput caps.

## 2. Reused authority and dependency direction

Phase 5 reuses the Phase 3/4 Core and domain contracts. It must not copy or
reimplement any of the following:

- Core `GameIrNode`, `GameIrReference`, `GameIrRelationshipEdge`,
  `GameIrSourceBinding`, `GameIrModuleCandidate`, and `GameIrSourceSection`;
- `parseGameIrModuleCandidate` and the complete-candidate parser boundary;
- `canonicalizeGameIrSourceSections`, `canonicalGameIrJson`,
  `digestGameIrValue`, safe target pointers, or Core binding validation;
- `buildGameIrDomainSourceEnvelope` and
  `validateGameIrDomainSourceEnvelope`;
- `admitGameIrMechanicalProjectionReceipt`,
  `buildGameIrDomainSemanticPacket`, `assertDisjointDomainTargets`, and
  `parseGameIrDomainSemanticDiagnosticValue`;
- the shared packet/source-bound `FAIL/missing-projection` and
  `AMBIGUOUS/ambiguous-projection` diagnostic authority;
- `assembleGameplayBalanceModules`, its exported complete
  `GameplayBalanceAssemblyAuthority`, and the derived admitted
  `GameplayBalanceModulePair` projections.

`GAME_IR_MODULE_SOURCE_DOCUMENTS` is the one service-owned source-document
manifest for all seven canonical modules. The shared domain source envelope
and complete semantic validator manifest both derive their document closures
from that constant; neither repeats document lists. Phase 5 activates its
already-declared `world-scene` and `presentation` entries. The shared
mechanical receipt contract recognizes all four isolated domain IDs and
retains the current empty-mechanical policy. Phase 4 behavior and digests
remain unchanged.

The dependency direction is:

```text
Core contracts/model
    -> shared domain source/projection/diagnostic contracts
    -> world-scene and presentation schema manifests
    -> world-scene and presentation semantic producer admission and read-only fidelity validation
    -> one Phase 5 World/Presentation closure assembler
```

World/Presentation code may import Core and shared Phase 4 contracts. Core,
Foundation READY adapters, Foundation Reviewer, Foundation Revision, and
production workflow files do not import these domain producers.

## 3. Source envelope and evidence

### 3.1 Fixed service-owned source manifests

The Phase 5 source closure is immutable, canonical, and derived from
`GAME_IR_MODULE_SOURCE_DOCUMENTS`. A
producer cannot narrow the closure, choose documents by filename, or request
only the section that makes its candidate pass.

| Module | Selected Foundation documents |
| --- | --- |
| `world-scene` | `docs/GDD.md`, `docs/LEVEL_SCENE_DESIGN.md` |
| `presentation` | `docs/GDD.md`, `docs/ART_DIRECTION.md`, `docs/UI_UX_SPEC.md`, `docs/AUDIO_DESIGN.md` |

The input envelope still carries the complete READY-bound
`authoritySectionIndex` for all eight Foundation documents. Its module-local
`sectionIndex` is the exact subset of that authority index for the manifest
above, in the existing canonical source order. The caller supplies exact
UTF-8 section bytes for every selected entry, neither more nor less. Each
byte string is checked against the Section Index digest and the Foundation
READY receipt before producer dispatch.

The producer reads only the validated selected envelope. It does not read
working-tree files, raw document paths, a Checklist, an old IR, a Manifest,
worker prose outside the envelope, or a caller-supplied section list. The
complete authority index is retained for identity and evidence; it is not
copied into a second source authority.

### 3.2 Producer ownership

No Phase 5 source section currently declares a fixed machine-readable role for
these domains. Therefore both Phase 5 mechanical receipts must be empty:
`nodes`, `verifiedClaims`, and `ownedTargets` are all empty. A heading, table
shape, filename, number, keyword, or future-looking format is not a role
declaration and cannot activate a parser.

All declared World/Scene and Presentation semantic nodes, values, references,
relationship edges, and logical presentation requirements are semantic-owned.
The semantic producer must emit one complete source claim for every semantic
target. Every claim uses a canonical `/bytes/<start>/<end>` range into one
selected UTF-8 section. `start` and `end` are canonical unsigned base-10 safe
integers with no leading zero except `0`, measured as byte offsets, with
`start < end`. Admission checks that both offsets lie on UTF-8 code-point
boundaries, the exact byte slice decodes to `literal`, and the literal
preserves the claimed target type: strict JSON syntax for numbers and
booleans, exact text for strings and IDs, and exact typed target/role text for
references and edges. The service then binds those claims to the exact
selected envelope and derives Core owner bindings. It never accepts
worker-supplied binding authority, task identity, revision identity, digest,
fallback node, or default value.

Canonical ordering, projection digests, cross-module target maps, and closure
identity are derived by the existing Core/shared assembler boundaries. No
field may be written by both mechanical and semantic passes, even when the
values are identical.

### 3.3 Diagnostics

Producer `missing-projection` and `ambiguous-projection` results are discriminated,
packet-bound, node-qualified, and immutable. Their identity includes task,
module, Foundation revision, source digest, mechanical receipt digest, and
semantic packet digest. Their `missingSubject` uses the existing canonical
`node:<id>#<target-pointer>` namespace.

Because these producer diagnostics replace a projected result and no partial
candidate is admitted, their evidence pointers are limited to the packet's
immutable `section:<document>#<section>@<sectionDigest>` set. Bare document or
section names and binding pointers are rejected. Exact binding pointers belong
only to the later read-only fidelity validator's mismatch diagnostics, after a
complete admitted module exists. Neither diagnostic type contains a Patch or
writes Foundation Issue state. An outer workflow adapter may later turn a
proven business defect into the existing `FoundationDefectReport`; that
adapter is outside Phase 5.

## 4. Phase 5 API and four-domain decision

### 4.1 Selected design: one Phase 5 closure API over replayable authority

Phase 5 exposes one final projection API:

```ts
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

export function assembleWorldPresentationClosure(
  authority: WorldPresentationAssemblyAuthority,
): WorldPresentationClosure
```

The authority object is exact. It has no optional Phase 4 input, raw node
arrays, `ReadonlyMap`, digest-only identity, detached module, stub, or future
module placeholder. The closure assembler calls the accepted
`assembleGameplayBalanceModules(authority.phase4Authority)` on every
invocation. The returned pair is a derived admitted value, not a signature or
an input trust boundary. Replaying the Phase 4 authority revalidates both
sources, all receipts, canonical projection digests, module IDs,
task/revision/READY/compile-request identity, full authority Section Index,
and Gameplay–Balance typed closure.

The two Phase 5 projection schemas are exact:

```ts
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
```

The output is:

```ts
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
```

`phase4` in the result is the immutable value rebuilt by the one Phase 4
assembler; Phase 5 does not rewrite, sign, or publish either module.
For each Phase 5 projection, `sourceDigest` and both receipt digests are copied
only from admitted authority, `semanticValidationResultDigest` is
`digestGameIrValue` of the admitted validation result, and `projectionDigest`
is `digestGameIrValue` of every projection field except itself.
`compileRequestDigest` is `digestGameIrValue` of the admitted complete request,
and `authoritySectionIndexDigest` is `digestGameIrValue` of the canonical full
authority index. `closureDigest` is the canonical digest of every preceding
field and the four complete module projections. These unkeyed digests detect
stale or mutated values but confer no independent trust; downstream trust
comes from authority replay. The closure is not a publication receipt.

The closure assembler is the sole Phase 5 writer of
`WorldSceneModuleProjection`, `PresentationModuleProjection`, and
`WorldPresentationClosure`. Domain producers may expose only the existing
packet builder and semantic-result admission functions. Any internal module
preparation functions remain private to the closure assembler; there is no
second public World writer, Presentation writer, or four-domain candidate
writer.

### 4.2 Why this is smaller than a new four-domain assembler

A four-domain writer would accept caller-supplied Phase 4 projections and
appear to own Gameplay and Balance. The selected closure instead replays the
complete Phase 4 assembly authority through its existing sole writer, then
writes only the two new modules plus one closure identity. This is the
smallest boundary that validates World and Presentation references to actual
Gameplay, World, and camera targets without a complete seven-module candidate.

The closure is not a compatibility layer, trust receipt, or second publication
format. It atomically describes the replayed Phase 4 pair together with the
two Phase 5 isolated projections. Later phases receive the exported assembly
authority and rebuild this value rather than trusting a detached copy.
Complete candidate assembly and publication remain unavailable.

### 4.3 Closure validation order

On every call, the service:

1. strictly validates the exact authority shape;
2. replays the complete Phase 4 authority through
   `assembleGameplayBalanceModules`;
3. validates both Phase 5 source envelopes and all four mechanical/semantic
   receipts against the same task, Foundation revision, READY receipt, full
   authority Section Index, and compile request;
4. Core-admits World/Scene, derives its target map from replayed Phase 4,
   validates local/cross-domain closure and global ID disjointness, rebuilds
   its fidelity packet, admits exact `PASS`, and freezes its projection;
5. Core-admits Presentation, derives its target map from replayed Phase 4 and
   the admitted World projection, validates local/cross-domain closure and
   global ID disjointness, rebuilds its fidelity packet, admits exact `PASS`,
   and freezes its projection;
6. checks producer ownership, source binding coverage, and every remaining
   cross-domain invariant;
7. derives the closure digest from the complete immutable output fields.

Any failure is fail-closed. No candidate, partial publication, workflow
state, document, or Foundation issue is written.

## 5. World/Scene schema

### 5.1 Closed node kinds and values

`WORLD_SCENE_DOMAIN_MANIFEST` is the single schema-owned authority for kinds,
value fields, reference target kinds, relationship roles, and cardinality.
Producer packets and local/cross-domain validators derive their allowed kinds
and targets from it. V1 contains:

| Kind | Strict value fields | Required relationship roles |
| --- | --- | --- |
| `world-scene.scene` | `label`, `coordinateConvention` | exactly one `root` → `world-scene.node` |
| `world-scene.node` | `label`, `nodeType` (`container`, `anchor`, `volume`, `visual`), `transform` | exactly one `scene` → scene; zero/one `parent` → node; `volume` has exactly one `zone`, other types have none |
| `world-scene.zone` | `label`, `shape`, `transform` | exactly one `scene` → scene |
| `world-scene.entity-instance` | `label` | exactly one `scene` → scene; exactly one `entity` → `gameplay.entity`; exactly one `location` → node; zero/one `zone` → zone |
| `world-scene.route` | `label`, `closed`, `waypointReferenceIndexes` | exactly one `scene` → scene |
| `world-scene.spawn` | `label`, `quantity`, `policy` (`once`, `wave`, `repeat`) | exactly one `scene` → scene; exactly one `location` → node; exactly one `entity` → `gameplay.entity` |
| `world-scene.encounter` | `label`, `mode` (`triggered`, `patrol`, `scripted`) | exactly one `scene` → scene; at least one `spawn` → spawn; exactly one `zone` → zone; `triggered` has exactly one `triggered-by` → `gameplay.event`, other modes have none |
| `world-scene.checkpoint` | `label`, `ordinal`, `resetPolicy` (`restart`, `last-checkpoint`, `manual`) | exactly one `scene` → scene; exactly one `location` → node; exactly one `respawn-state` → `gameplay.state` |
| `world-scene.camera-region` | `label`, `priority`, `blendIn`, `blendOut` | exactly one `scene` → scene; exactly one `zone` → zone; exactly one `anchor` → node |
| `world-scene.objective-placement` | `label` | exactly one `scene` → scene; exactly one `objective` → `gameplay.objective`; exactly one `location` → node; zero/one `zone` → zone |

Every role is a typed Core edge. A relationship target is never hidden as an
ID in a label, geometry, route value, or free-form string. Unknown kinds,
value fields, roles, target types, duplicate singleton roles, and dangling
targets fail closed.

`world-scene.route` is a linear traversal value over Core typed references.
Every reference targets only a `world-scene.node` and remains unique and sorted
by Core. `waypointReferenceIndexes` supplies traversal order, contains at least
two valid reference indices, may repeat an index to revisit a waypoint, and
must use every declared reference at least once. Every waypoint node belongs
to the route's scene. `closed: true` means only that traversal continues from
the last ordered waypoint to the first; it does not create or duplicate a Core
edge. Spawn and checkpoint nodes participate by sharing their explicit
`location` node. Branching is represented by multiple linear routes that may
share waypoint nodes, not by hidden route-to-route links.

### 5.2 Coordinate, transform, and zone values

Each scene declares one closed coordinate convention; no engine default or
conversion is inferred:

```ts
type WorldCoordinateConvention =
  | Readonly<{
      dimensions: '2d'
      xDirection: 'left' | 'right'
      yDirection: 'up' | 'down'
      distanceUnit: 'pixel' | 'centimeter' | 'meter'
    }>
  | Readonly<{
      dimensions: '3d'
      handedness: 'left' | 'right'
      upAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z'
      distanceUnit: 'centimeter' | 'meter'
    }>

type WorldTransformValue =
  | Readonly<{
      dimensions: '2d'
      space: 'local' | 'world'
      position: Readonly<{ x: number; y: number }>
      rotationRadians: number
      scale: Readonly<{ x: number; y: number }>
    }>
  | Readonly<{
      dimensions: '3d'
      space: 'local' | 'world'
      position: Readonly<{ x: number; y: number; z: number }>
      rotation: Readonly<{ x: number; y: number; z: number; w: number }>
      scale: Readonly<{ x: number; y: number; z: number }>
    }>
```

For 3D, `upAxis` and `forwardAxis` must use different unsigned axes. Every
position, angle, rotation, and scale component is finite. A 3D quaternion must
have a finite squared norm strictly greater than zero; the owner value is not
silently normalized. Every scale component is strictly positive. A scene root
uses world space. A non-root node's local space is relative to its parent; a
zone's local space is relative to its scene convention. Either may use world
space only when that exact choice is source-supported. Node and zone transforms
are inline owner values, so no standalone transform can be orphaned or shared.

Zone geometry is closed and must match its scene dimensions:

```ts
type WorldZoneGeometry =
  | Readonly<{ kind: 'rectangle'; size: Readonly<{ x: number; y: number }> }>
  | Readonly<{ kind: 'circle'; radius: number }>
  | Readonly<{ kind: 'capsule-2d'; radius: number; length: number }>
  | Readonly<{ kind: 'box'; size: Readonly<{ x: number; y: number; z: number }> }>
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'capsule-3d'; radius: number; height: number }>
```

Sizes, radius, length, and height are finite and strictly positive. The inline
zone transform is its only spatial frame. No mesh, prefab, asset path, or
delivery artifact is accepted by this module.

### 5.3 Hierarchy, scene closure, and graph guards

The World validator mechanically proves:

- node IDs are canonical, unique, and sorted after admission;
- each scene's exact one `root` edge targets a node in that scene;
- every `world-scene.node` belongs to exactly one scene;
- within each scene, exactly one node has no `parent`, and it is that scene's
  `root`;
- every non-root node has exactly one parent in the same scene;
- parent traversal has no cycle, and every node reaches the declared root;
- a runtime entity instance is uniquely identified by its canonical global
  Game IR node ID; there is no second `instanceKey` identity;
- every inline transform and zone geometry matches its scene's dimension and
  coordinate convention;
- zones, instances, routes, spawns, encounters, checkpoints, camera regions,
  and objective placements carry one scene membership edge and do not point
  into another scene;
- checkpoint ordinals are unique within a scene and are non-negative safe
  integers;
- route waypoint indices are in range, target only World nodes, use every
  declared reference, contain at least two entries, and remain in one scene;
- spawn quantities are positive safe integers, and no duplicate singleton role
  or duplicate edge is accepted;
- every route index is a non-negative safe integer strictly below the reference
  array length; camera priority is a safe integer; and camera `blendIn` and
  `blendOut` are finite and at least zero;
- an encounter has at least one distinct spawn and its zone/trigger types are
  exact; its mode matches `triggered-by` cardinality;
- every objective placement targets a real Phase 4 `gameplay.objective`;
- a camera region's zone and `nodeType: 'anchor'` node are in the same scene,
  so Presentation cannot bind to a filename or an unlocated camera label.

Scene hierarchy cycles, cross-scene edges, invalid coordinate values, dangling
references, and wrong-kind references are compiler integrity failures. Repeated
route waypoint indices remain legal revisits. No node is silently dropped to
make closure pass. There is no maximum number of scenes, nodes, routes, or
points.

World/Scene may target only the implemented Phase 4 Gameplay kinds explicitly
listed in the manifest (`entity`, `event`, `state`, and `objective`) plus its
own World/Scene kinds. It cannot target Presentation, Resource Realization, or
Implementation/Verification placeholders. Balance targets are not needed by
this schema and are rejected rather than represented speculatively.

## 6. Presentation schema

### 6.1 Closed node kinds and values

`PRESENTATION_DOMAIN_MANIFEST` is the single schema-owned authority for kinds,
value fields, reference target kinds, relationship roles, conditional
cardinality, and all permitted local and external target kinds. Producer
packets and closure validation derive their allowed-target sets from it. V1
contains:

| Kind | Strict value fields | Required binding/relationship roles |
| --- | --- | --- |
| `presentation.ui-screen` | `label`, `modal` (boolean), optional `requirements` | exactly one `initial-state` → UI state; exactly one `driven-by` → Gameplay state/event or World scene |
| `presentation.ui-state` | `label`, `terminal` (boolean) | exactly one `screen` → UI screen; exactly one `driven-by` → Gameplay state/event or World scene |
| `presentation.ui-action` | `label`, `input` (`button`, `pointer`, `key`, `gesture`, `system`) | exactly one `screen` → UI screen; exactly one `invokes` → `gameplay.action`; zero/one `available-in` → Gameplay state |
| `presentation.feedback` | `label`, `channel` (`text`, `icon`, `meter`, `haptic`, `flash`) | exactly one `on` → Gameplay event/state/action; zero/one `screen` → UI screen |
| `presentation.camera-behavior` | `label`, `mode` (`follow`, `fixed`, `blend`, `cut`, `shake`), `duration` | exactly one `region` → `world-scene.camera-region`; zero/one `on` → Gameplay event/state/action |
| `presentation.animation-clip` | `label`, `loop` (boolean), `playbackRate`, optional `requirements` | exactly one `target` → World entity instance or Gameplay entity |
| `presentation.animation-state` | `label` | exactly one `clip` → animation clip; exactly one `on` → Gameplay event/state/action |
| `presentation.vfx-cue` | `label`, `trigger` (`instant`, `attached`, `persistent`), optional `requirements` | exactly one `on` → Gameplay event/state/action; exactly one `at` → World node/zone/camera region |
| `presentation.audio-event` | `label`, `spatial` (boolean) | exactly one `on` → Gameplay event/state/action |
| `presentation.audio-cue` | `label`, `volume`, optional `requirements` | exactly one `event` → audio event; exactly one `at` → World scene/node/zone/entity-instance/camera-region when that event is spatial, otherwise none |
| `presentation.music-state` | `label`, `intensity`, optional `requirements` | exactly one `on` → Gameplay event/state/action |
| `presentation.transition` | `label`, `trigger` (closed union below) | exactly one `from` and one `to` → UI state; conditional `on` below |

All numeric rules are exact: camera `duration` is finite and at least zero;
animation `playbackRate` is finite and strictly positive; audio `volume` and
music `intensity` are finite in the inclusive range `[0, 1]`. World camera
`priority` is a safe integer, and `blendIn`/`blendOut` are finite and at least
zero. The schema never interprets a file name as a value or binding.

Transition trigger values form a strict discriminated union:

```ts
type PresentationTransitionTrigger =
  | Readonly<{ kind: 'automatic' }>
  | Readonly<{ kind: 'event' }>
  | Readonly<{ kind: 'action' }>
  | Readonly<{ kind: 'state' }>
  | Readonly<{ kind: 'world-scene' }>
  | Readonly<{ kind: 'camera-region' }>
```

`automatic` requires no `on` edge and rejects one. Every other variant
requires exactly one `on`, whose target kind must respectively be
`gameplay.event`, `gameplay.action`, `gameplay.state`, `world-scene.scene`, or
`world-scene.camera-region`. Both transition endpoints must belong to the same
UI screen. Cross-screen navigation is not represented in V1.

Every non-automatic presentation behavior is attached, directly or through
its uniquely referenced audio event, to an implemented Gameplay or World
target through typed edges. An audio event uniquely owns its Gameplay trigger.
An audio cue owns its logical requirements, references that event, and may
separately declare World context through `at`; it cannot repeat or contradict
the event's `on` relation. A label such as
`on-player-death` or a file called `death.wav` is not evidence of a binding.
Presentation does not accept Balance, Resource Realization, or
Implementation/Verification targets.

### 6.2 Logical requirements, not artifacts

Presentation may declare logical requirements that Phase 6 can later project.
They have no path, URL, file name, digest, storage key, generated bytes,
variant, delivery artifact, or provider identity:

```ts
type PresentationLogicalResourceRequirement = Readonly<{
  requirementId: string
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRole: 'screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music'
}>
```

`requirementId` is a non-empty safe identifier, globally unique in the closure.
Each node's requirement array is code-unit sorted by it. Ownership combinations
are exact:

| Presentation owner | Required `kind` / allowed `runtimeRole` |
| --- | --- |
| `ui-screen` | `ui` / `screen` |
| `animation-clip` | `animation` / `clip` |
| `vfx-cue` | `vfx` / `effect` |
| `audio-cue` | `audio` / `cue` or `voice` |
| `music-state` | `music` / `music` |

No other Presentation kind owns a requirement. Requirements are semantic
values with exact source claims and immutable logical inputs to Phase 6; they
do not create Resource Realization nodes or placeholders in Phase 5. Phase 6
projects each leaf into exactly one derived logical-resource node with a
derived binding to that leaf. Technical constraints, variants, delivery files,
codecs, budgets, resource ownership, and runtime artifact bindings belong to
Phase 6.

### 6.3 UI and presentation graph guards

The Presentation validator proves:

- every UI state points to exactly one screen, and every screen's exact one
  `initial-state` points to a state whose `screen` points back to that screen;
- every UI state is reachable from its screen's initial state through typed
  same-screen presentation transitions;
- terminal UI states have no outgoing transition;
- every UI action invokes a real Phase 4 Gameplay action;
- every feedback, animation state, VFX, audio event, music state, and
  non-automatic transition has an explicit Gameplay or World binding of the
  permitted kind;
- every animation state targets a real animation clip, and every audio cue
  targets a real audio event; spatial events require exact World context on
  every cue, while non-spatial events reject it;
- camera behavior targets a real World camera region, and any camera-linked
  presentation transition targets a real World scene or camera region;
- UI transition `from`/`to` endpoints are states of the same screen, trigger
  discriminants match exact `on` cardinality/kind, singleton roles are not
  duplicated, and wrong-kind/dangling edges fail closed;
- every logical `requirementId` is globally unique, arrays are canonical, and
  kind/runtime role matches the exact Presentation owner;
- no value embeds a target ID, path, file name, or artifact digest as a hidden
  relationship.

UI state cycles are legal when transitions are explicit, same-screen, and
reachable; the validator rejects dangling endpoints, duplicate transition
edges, and outgoing edges from terminal states. Animation state in V1 is only
an explicit Gameplay trigger-to-clip mapping. It has no `initial`, `terminal`,
machine, transition, or reachability authority and is not described as a
state machine. There is no fixed number of screens, states, transitions,
clips, cues, or logical requirements.

## 7. Source claims and projection preparation

The worker-facing candidate node omits both Core bindings and producer mode.
Admission injects `producerMode: 'semantic'`, verifies exact claims, then Core
constructs bindings. These are receipt-stage DTOs around the existing Core
model, not alternate Core node definitions. The shared packet identity,
target-pointer parser, claim ordering, and digest helpers remain authoritative.

```ts
type Phase5SemanticCandidateNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
}>

type Phase5AdmittedSemanticNode = Phase5SemanticCandidateNode & Readonly<{
  producerMode: 'semantic'
}>

type GameIrDomainSourceClaim = Readonly<{
  subject: string
  documentPath: FoundationDocumentPath
  sectionId: string
  sourcePointer: string
  literal: string
}>
```

These three shapes are exported once by the shared Phase 5 admission boundary
and imported by both domain producers; neither producer redeclares them. The
aliases create no source authority, canonicalizer, binding writer, or
diagnostic authority.

The result contract is:

```ts
type WorldSceneSemanticReceipt = Readonly<{
  schemaVersion: 'game-ir-domain-semantic-receipt.v1'
  outcome: 'PROJECTED'
  taskId: string
  moduleId: 'world-scene'
  foundationRevision: string
  sourceDigest: string
  mechanicalReceiptDigest: string
  packetDigest: string
  nodes: readonly Phase5AdmittedSemanticNode[]
  sourceClaims: readonly GameIrDomainSourceClaim[]
  receiptDigest: string
}>
```

Presentation uses the same discriminated receipt contract with
`moduleId: 'presentation'` and the same candidate/admitted node and claim
shapes. There is no Phase 5-specific source authority or digest algorithm. The
shared admission function injects packet identity and producer mode, verifies
every UTF-8 slice and target type, and rejects worker relabeling.

For each semantic node, claims cover `/id`, every value leaf, every typed
reference, and every typed edge exactly once; logical requirements are covered
through their ordinary value leaves. Claim document/section identities and
byte ranges must be in the exact selected envelope. Core then creates one owner
binding per target. Derived values, if later introduced by a domain-neutral
Core rule, use Core's existing derived-binding closure; Phase 5 adds no second
derived-binding mechanism.

### 7.1 Read-only semantic fidelity validation

Structural admission and exact byte claims do not by themselves prove semantic
fidelity. After Core admission, the service builds one immutable validation
packet per module from the validated selected source sections and bytes,
canonical admitted module bytes, semantic receipt, full replayed external
projections for the module's permitted target kinds, and the single domain
target manifest:

```ts
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

type Phase5SemanticValidationPacket = Readonly<
  Phase5SemanticValidationPacketBase &
    (
      | {
          moduleId: 'world-scene'
          externalProjections: Readonly<{
            gameplay: GameplayModuleProjection
          }>
        }
      | {
          moduleId: 'presentation'
          externalProjections: Readonly<{
            gameplay: GameplayModuleProjection
            worldScene: WorldSceneModuleProjection
          }>
        }
    )
>

type Phase5SemanticValidationResult = Readonly<
  | {
      outcome: 'PASS'
      packetDigest: string
      checkIds: readonly string[]
      coveredTargets: readonly string[]
    }
  | Extract<
      GameIrSemanticValidationResult,
      { outcome: 'FAIL' | 'AMBIGUOUS' }
    >
>

type WorldSceneSemanticValidationResult = Phase5SemanticValidationResult
type PresentationSemanticValidationResult = Phase5SemanticValidationResult
```

`moduleBytes` is `canonicalGameIrJson` of the admitted module and
`moduleDigest` is `digestGameIrValue` of that module. `packetDigest` is
`digestGameIrValue` of every packet field except itself, including the full
external projections rather than caller-supplied projection digests. The
service owns the ordered `checkIds`. `requiredTargets` is the complete
canonical set of node identities, value leaves, references, and edges in the
admitted module. `allowedEvidencePointers` is derived only from exact owner
bindings and digest-bound selected sections. A `PASS` must echo the rebuilt
packet digest and both the check list and target coverage must match their
packet lists exactly and without duplicates; target order is canonical and
check order is service-owned. Boolean PASS, digest-only PASS,
partial coverage, extra coverage, or caller-supplied packet fields fail
admission.
The `FAIL` and `AMBIGUOUS` arms are the existing shared semantic result
discriminants and reason codes, not a Phase 5 diagnostic schema.
`projection-mismatch` evidence points to exact admitted owner bindings;
missing/ambiguous facts may use only exact digest-bound section evidence. The
assembler derives `semanticValidationResultDigest` from the admitted result;
the result carries no self-authenticating or caller-selected result digest.

The validator is read-only. It cannot create, edit, reorder, or drop a node;
write a candidate, document, Issue, or workflow state; or choose a fallback.
The closure assembler rebuilds each packet from authority and admits the
provided result. Only two admitted `PASS` results can produce projections.

World and Presentation admitted nodes are sorted by canonical ID and frozen
before closure assembly. The assembler accounts for every semantic target
exactly once and rejects duplicate accounting even when records are identical.

## 8. Cross-domain closure rules

The closure's internal target map contains the replayed Phase 4 Gameplay and
Balance nodes plus admitted World/Scene and Presentation nodes. The following
external targets are the projection of the two domain manifests, not a second
hand-written validator list:

| Source module | Allowed external targets |
| --- | --- |
| `world-scene` | Phase 4 `gameplay.entity`, `gameplay.event`, `gameplay.state`, `gameplay.objective` |
| `presentation` | Phase 4 `gameplay.action`, `gameplay.entity`, `gameplay.event`, `gameplay.state`; Phase 5 `world-scene.scene`, `world-scene.node`, `world-scene.zone`, `world-scene.entity-instance`, `world-scene.camera-region` |

The assembler checks task ID, Foundation revision, READY receipt digest,
compile-request digest, full authority Section Index digest, source digest,
module IDs, replayed projection digests, validation results, and all typed
target kinds across every input. It rejects stale or forged authority, mixed
revisions, relabeled modules, duplicate global IDs, wrong-kind targets,
missing targets, and references to not-yet-implemented modules. It does not
accept an opposite-domain Map as a shortcut and never fabricates a resource or
implementation node to satisfy a link.

The Phase 4 assembly authority remains the replayable authority for
Gameplay–Balance bidirectional closure; the pair is only its derived admitted
value. Phase 5 invokes, but does not replace, the Phase 4 pair writer. It then
proves World links against replayed Gameplay targets before proving
Presentation links against replayed Gameplay and admitted World targets.

## 9. Testing and acceptance evidence

Implementation, when separately authorized, must follow TDD: each contract
and invariant begins with a failing test, then the smallest implementation is
added, and the full boundary suite is rerun. This section states acceptance
evidence, not an implementation task list.

### 9.1 Complete eight-document profiles

At least two complete, distinct fixtures must contain all eight canonical
Foundation documents, a valid READY receipt, exact Section Index bytes, and
valid replayable Phase 4 Gameplay–Balance assembly authority:

1. **Traversal/action profile:** multiple scenes and a rooted hierarchy,
   transformed zones, player/enemy instances, a route with ordered waypoints,
   wave and patrol encounters, checkpoints, camera regions, objective
   placements, HUD/menu UI, action-driven transitions, player animation,
   trigger VFX, spatial audio, and music states.
2. **Branching/puzzle profile:** a different scene topology with multiple
   linear routes sharing waypoint nodes, repeated waypoint visits, several
   objective placements, state-driven checkpoints and camera regions, a
   multi-screen UI state graph, feedback bound to gameplay events,
   animation/VFX/audio cues with different logical requirements, and explicit
   same-screen presentation transitions.

Both profiles must be valid without delivery artifacts. A profile may have no
real resources; logical Presentation requirements remain allowed and must not
be turned into Resource Realization placeholders. Tests assert the exact
expected kinds, typed edges, route traversal order, UI reachability,
requirement IDs, and validator coverage rather than only checking that assembly
does not throw. Compiling each profile twice from the same immutable source
must produce byte-identical World, Presentation, and closure digests; the
profiles must produce distinct digests.

### 9.2 Contract, mutation, and boundary matrix

Tests must cover:

- strict unknown-field/kind/role rejection, hidden/accessor property rejection,
  frozen output, canonical ordering, and digest replay;
- exact eight-document authority index, exact selected source closure, altered
  or missing section bytes, extra bytes, stale receipt identity, and narrowed
  caller evidence rejection;
- one `GAME_IR_MODULE_SOURCE_DOCUMENTS` authority whose domain-source and
  semantic-validator projections are byte-identical for all seven modules;
- empty World/Presentation mechanical receipts, non-empty mechanical nodes or
  claims, unsorted/duplicate targets, packet relabeling, worker-supplied
  identity, and mechanical/semantic overlap rejection;
- exact UTF-8 claim range boundaries, out-of-range or split-code-point ranges,
  literal/type mismatch, subject/claim omission, and byte-valid but
  semantically contrary source rejection;
- producer missing/ambiguous diagnostics with packet/source-bound section
  evidence and node-qualified subjects; validator mismatch diagnostics with
  exact binding evidence; evidence-form crossover is rejected;
- validation packet reconstruction, exact ordered PASS coverage, missing or
  extra check/target coverage, digest-only or boolean PASS, relabeling, stale
  external projection digest, and FAIL/AMBIGUOUS closure rejection;
- World parent cycle, missing root, multiple roots, orphan node, cross-scene
  membership, dangling/wrong-kind typed refs, duplicate singleton edge, route
  with fewer than two ordered waypoints, index out of range, unused route
  reference, repeated-route-waypoint positive case, fabricated closure edge,
  route cross-scene waypoint, invalid 2D/3D coordinate convention, mismatched
  geometry dimension, zero quaternion, non-positive scale, invalid transform
  number, node-type/zone cardinality mismatch, missing encounter spawn, invalid
  checkpoint ordinal, and objective/camera closure mutations;
- Presentation screen without an initial state, duplicate initial state,
  unreachable UI state, terminal outgoing transition, wrong screen backlink,
  cross-screen transition, automatic trigger with `on`, non-automatic trigger
  without `on`, discriminant/target mismatch, unbound UI action/feedback/
  animation/VFX/audio/music/camera behavior, wrong target kind, missing
  animation clip/audio event, animation-state `initial`/`terminal`/machine
  fields, duplicate or unsorted logical requirement ID, owner/kind/runtime-role
  mismatch, duplicate audio trigger, an audio cue with its own `on`, spatial
  cue without `at`, non-spatial cue with `at`, invalid numeric boundary,
  artifact path/file-name value, and Balance/resource/implementation
  placeholder target mutations;
- a valid Presentation animation target to Phase 4 `gameplay.entity`;
- closure input with stale/tampered/missing Phase 4 authority, mixed
  task/revision/READY/compile identity, a forged Phase 4 module with its
  `projectionDigest` recomputed, raw Map, digest-only object, detached module,
  duplicate global node ID, forbidden cross-domain target, and detached
  closure rejection;
- stable logical requirement IDs and unchanged derived ordering when unrelated
  Presentation nodes are inserted;
- expanded scene, route, UI, and cue graphs beyond ordinary fixture sizes to
  prove that no business count cap was introduced.

### 9.3 Phase 4 parity and isolation gate

The existing Phase 4 and Core suites must remain green. Given the same complete
Foundation documents, READY receipt, and planning inputs, enabling or
disabling Phase 5 after the READY boundary must leave Stage 3/4 behavior
byte-identical: tasks, Issue Registry, revision patches, targeted rechecks,
and Foundation READY receipt are unchanged. The parity test calls only the
read-only compile/source boundary after reserializing the same documents; it
does not make a partial candidate or a fake seven-module projection.

The protected Foundation Reviewer/Revision production set remains byte-
identical, no Foundation file imports `game-ir`, no `DeliveryRun` or workflow
state contains a Phase 5 route, and no production source can call the closure
assembler. Core `parseGameIrCandidate` continues to require all canonical
modules; Phase 5 tests use only the isolated module parser and closure API.

The acceptance evidence includes the full Game IR test suite, Phase 4 parity,
package/root typechecks, formatting/diff checks, static scans for controller,
store, provider, persistence, Reviewer/Revision, Foundation Issue, legacy
reader, fallback, dual-write, and placeholder symbols, plus the two complete
profile runs. Chrome acceptance is not part of this gate.

## 10. Phase 6/7 interfaces

Phase 6 does not trust a detached `WorldPresentationClosure`. Its exact input
boundary is:

```ts
type ResourceRealizationAssemblyAuthority = Readonly<{
  phase5Authority: WorldPresentationAssemblyAuthority
  resourceRealization: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ResourceRealizationSemanticReceipt
    validation: ResourceRealizationSemanticValidationResult
  }>
}>
```

The future Phase 6 assembler must first call
`assembleWorldPresentationClosure(phase5Authority)`, then validate its own
READY-bound source, receipts, fidelity result, and cross-domain bindings. It
projects Phase 5 Presentation requirement leaves into derived logical-resource
nodes whose derived bindings name those exact leaves. Requirements for models,
meshes, materials, textures, rigs, shaders, fonts, scenes/prefabs, and
content/config that are not owned by Presentation are semantic-owned from the
Phase 6 source closure declared by `GAME_IR_MODULE_SOURCE_DOCUMENTS`. Phase 6
may add variants, technical constraints, delivery artifacts, resource
authority, and runtime bindings only in its isolated module; it cannot add
artifacts back into Phase 5 or mutate the rebuilt closure.

Phase 7 likewise receives replayable Phase 5 and validated Phase 6 assembly
authority, rebuilds both earlier values, and only then derives
Implementation/Verification targets and evidence requirements. It may not
create World, Presentation, Gameplay, Balance, or Resource facts, and it may
not make production routing reachable.

Neither phase receives a raw Map, detached closure/module, digest-only
reference, or placeholder. Until Phase 6/7 are implemented and admitted, no
complete seven-module candidate, publication, consumer migration, or Chrome
acceptance exists. The Phase 5 gate tests only the exported authority shape and
absence of a detached-closure consumer; it does not fabricate either future
module.

## 11. Explicit non-goals

Phase 5 does not include:

- Foundation document authoring, canonical source ownership, Reviewer Fact
  Store, Issue Registry admission, Patch, Revision, or FoundationDefectReport
  routing;
- production controller, `DeliveryRun` schema/state, provider dispatch,
  persistence, journal, recovery, route, or consumer migration;
- complete `GameIrCandidate`, seven-module assembly, Game IR publication,
  COMMITTED receipt, or production `GameIrReadyReceipt`;
- legacy readers, migration readers, fallback values, compatibility overloads,
  dual writes, old/new state machines, or speculative parser aliases;
- Resource Realization artifacts, paths, URLs, files, codecs, variants,
  budgets, storage bindings, or runtime asset providers;
- Implementation/Verification nodes, acceptance evidence, Chrome use, or
  real-workflow cutover;
- a second canonicalizer, source authority, diagnostic authority, Core parser,
  Phase 4 pair writer, or four-domain writer;
- interpreting labels, filenames, headings, common keywords, or model
  preferences as machine-readable role or cross-domain binding.

This document remains Proposed / awaiting user review until reviewed and
explicitly accepted. Phase 5–9 status, production reachability, publication,
and Chrome acceptance must remain accurately unstarted/deferred in the parent
roadmap.
