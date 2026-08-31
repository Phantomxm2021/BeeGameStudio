# Game IR Phase 5: World/Scene and Presentation Design

Status: Proposed / awaiting review

Date: 2026-08-31

This design is subordinate to
`docs/beegame-game-ir-stage-isolation-redesign.md` and the accepted Phase 4
design in `docs/superpowers/specs/2026-08-31-game-ir-gameplay-balance-design.md`.
It defines only the isolated `world-scene` and `presentation` domain modules.
It is a design specification, not an implementation plan, and does not claim
that Phase 5 is accepted.

## 1. Goal and boundary

Phase 5 adds two strict, immutable, revision-bound domain projections:

- `world-scene`, which describes scene membership, hierarchy, spatial data,
  runtime entity instances, traversal, encounters, checkpoints, camera
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
- `assembleGameplayBalanceModules` and the complete Phase 4
  `GameplayBalanceModulePair` projections.

The shared domain source contract receives an additive Phase 5 manifest entry
for `world-scene` and `presentation`; it remains one source authority and one
canonicalizer. The shared mechanical receipt contract recognizes all four
isolated domain IDs and retains the current empty-mechanical policy. Phase 4
behavior and digests remain unchanged.

The dependency direction is:

```text
Core contracts/model
    -> shared domain source/projection/diagnostic contracts
    -> world-scene and presentation schema manifests
    -> world-scene and presentation semantic producer admission
    -> one Phase 5 World/Presentation closure assembler
```

World/Presentation code may import Core and shared Phase 4 contracts. Core,
Foundation READY adapters, Foundation Reviewer, Foundation Revision, and
production workflow files do not import these domain producers.

## 3. Source envelope and evidence

### 3.1 Fixed service-owned source manifests

The Phase 5 source manifest is immutable, canonical, and service-owned. A
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
The semantic producer must emit a complete source claim for every semantic
target. The service binds those claims to the exact selected envelope and
derives Core owner bindings. It never accepts worker-supplied binding
authority, task identity, revision identity, digest, fallback node, or
default value.

Canonical ordering, projection digests, cross-module target maps, and closure
identity are derived by the existing Core/shared assembler boundaries. No
field may be written by both mechanical and semantic passes, even when the
values are identical.

### 3.3 Diagnostics

`missing-projection` and `ambiguous-projection` results are discriminated,
packet-bound, node-qualified, and immutable. Their identity includes task,
module, Foundation revision, source digest, mechanical receipt digest, and
semantic packet digest. Their `missingSubject` uses the existing canonical
`node:<id>#<target-pointer>` namespace.

Evidence pointers are limited to the exact packet evidence set. A diagnostic
whose target has no owner binding may use the existing immutable section form
`section:<document>#<section>@<sectionDigest>`; it may not use a bare document
or section name. A diagnostic with an existing binding points to the binding's
exact document, section, digest, and source pointer. Neither diagnostic type
contains a Patch or writes Foundation Issue state. An outer workflow adapter
may later turn a proven business defect into the existing
`FoundationDefectReport`; that adapter is outside Phase 5.

## 4. Phase 5 API and four-domain decision

### 4.1 Selected design: one Phase 5 closure API over signed Phase 4 pair

Phase 5 exposes one final projection API:

```ts
export function assembleWorldPresentationClosure(input: {
  phase4: GameplayBalanceModulePair
  worldScene: {
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: WorldSceneSemanticReceipt
  }
  presentation: {
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: PresentationSemanticReceipt
  }
}): WorldPresentationClosure
```

The input object is exact. It has no optional `phase4`, no raw node arrays, no
`ReadonlyMap`, no digest-only identity, no detached module, no stub, and no
placeholder for a later module. `phase4` is the complete output of the
accepted `assembleGameplayBalanceModules` API, including both full modules
and their projection digests. The closure assembler verifies each Phase 4
projection's canonical digest, module ID, task/revision/READY identity, and
the pair's existing Gameplay–Balance typed closure before it is used as a
read-only target set.

The output is:

```ts
type WorldPresentationClosure = Readonly<{
  schemaVersion: 'game-ir-world-presentation-closure.v1'
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  phase4: GameplayBalanceModulePair
  worldScene: WorldSceneModuleProjection
  presentation: PresentationModuleProjection
  phase4ProjectionDigests: Readonly<{
    gameplay: string
    balance: string
  }>
  closureDigest: string
}>
```

`phase4` in the result is the already-admitted immutable value; Phase 5 does
not rewrite, re-sign, or publish either Phase 4 module. `closureDigest`
authenticates the four complete projection values and their source/identity
bindings for this closure only. It is not a replacement for either Phase 4
projection digest and is not a publication receipt.

The closure assembler is the sole Phase 5 writer of
`WorldSceneModuleProjection`, `PresentationModuleProjection`, and
`WorldPresentationClosure`. Domain producers may expose only the existing
packet builder and semantic-result admission functions. Any internal module
preparation functions remain private to the closure assembler; there is no
second public World writer, Presentation writer, or four-domain candidate
writer.

### 4.2 Why this is smaller than a new four-domain assembler

A four-domain assembler would accept and re-emit the two Phase 4 projections,
creating a second place that appears to own Gameplay and Balance. The selected
Phase 5 pair/closure accepts the complete Phase 4 pair as an already-signed,
read-only input, validates it, and writes only the two new modules plus one
closure identity. This is the smallest boundary that can validate World and
Presentation references to actual Gameplay, World, and camera targets without
inventing a complete seven-module candidate.

The closure is not a compatibility layer or a second publication format. It
has one purpose: atomically describe the validated Phase 4 pair together with
the two Phase 5 isolated projections so later Phase 6/7 modules can consume a
stable four-domain value. Complete candidate assembly and publication remain
unavailable.

### 4.3 Closure validation order

On every call, the service:

1. strictly validates the exact input shape;
2. validates the complete Phase 4 pair and recomputes its projection digests;
3. validates both Phase 5 source envelopes and all four mechanical/semantic
   receipts against the same task, Foundation revision, READY receipt, full
   authority Section Index, and compile request;
4. admits World/Scene and Presentation nodes through the one Core
   `parseGameIrModuleCandidate` boundary;
5. builds internal target maps from the complete Phase 4 projections and the
   two admitted local modules; callers cannot supply or alter those maps;
6. validates World/Scene local closure and its allowed Gameplay links;
7. validates Presentation local closure and its allowed Gameplay/World links;
8. checks duplicate IDs, producer ownership, source binding coverage, and
   cross-domain invariants;
9. freezes both new projections and derives their digests, then derives the
   closure digest from those full values.

Any failure is fail-closed. No candidate, partial publication, workflow
state, document, or Foundation issue is written.

## 5. World/Scene schema

### 5.1 Closed node kinds and values

`WORLD_SCENE_DOMAIN_MANIFEST` is the single schema-owned kind/value/role
manifest. V1 contains these closed kinds:

| Kind | Strict value fields | Required relationship roles |
| --- | --- | --- |
| `world-scene.scene` | `label`, `active` | exactly one `root` → `world-scene.node` |
| `world-scene.node` | `label`, `nodeType` (`container`, `anchor`, `volume`, `visual`) | exactly one `scene` → scene; exactly one `transform` → transform; zero/one `parent` → node; zero/one `zone` → zone |
| `world-scene.transform` | `space` (`local` or `world`), `position`, `rotation`, `scale` | exactly one `scene` → scene |
| `world-scene.zone` | `label`, `shape` (closed geometry union) | exactly one `scene` → scene; exactly one `transform` → transform |
| `world-scene.entity-instance` | `label`, `instanceKey`, `enabled` | exactly one `scene` → scene; exactly one `entity` → `gameplay.entity`; exactly one `location` → node; zero/one `zone` → zone |
| `world-scene.route` | `label`, `closed`, `waypointReferenceIndexes` | exactly one `scene` → scene |
| `world-scene.spawn` | `label`, `quantity`, `policy` (`once`, `wave`, `repeat`) | exactly one `scene` → scene; exactly one `location` → node; exactly one `entity` → `gameplay.entity` |
| `world-scene.encounter` | `label`, `mode` (`triggered`, `patrol`, `scripted`) | exactly one `scene` → scene; at least one `spawn` → spawn; exactly one `zone` → zone; zero/one `triggered-by` → `gameplay.event` |
| `world-scene.checkpoint` | `label`, `ordinal`, `resetPolicy` (`restart`, `last-checkpoint`, `manual`) | exactly one `scene` → scene; exactly one `location` → node; exactly one `respawn-state` → `gameplay.state` |
| `world-scene.camera-region` | `label`, `priority`, `blendIn`, `blendOut` | exactly one `scene` → scene; exactly one `zone` → zone; exactly one `anchor` → node |
| `world-scene.objective-placement` | `label`, `enabled` | exactly one `scene` → scene; exactly one `objective` → `gameplay.objective`; exactly one `location` → node; zero/one `zone` → zone |

Every role is a typed Core edge. A relationship target is never hidden as an
ID in a label, geometry, route value, or free-form string. Unknown kinds,
value fields, roles, target types, duplicate singleton roles, and dangling
targets fail closed.

`world-scene.route` uses Core typed references for waypoints. Each reference
target must be a `world-scene.node`, `world-scene.spawn`, or
`world-scene.checkpoint`; `waypointReferenceIndexes` is an explicit ordered
array of reference indices. Every reference is used exactly once, indices are
in range and unique, and a route has at least two waypoints. `closed` means
the route's traversal closes from the last waypoint to the first; it does not
duplicate the first reference. This keeps order explicit without bypassing
Core's canonical reference ordering.

Route cycle handling is explicit: a route may have the one declared closure
edge from its final waypoint back to its first, represented only by
`closed: true`. Duplicate waypoint indices, duplicate waypoint targets,
route-to-route targets, self-targeting route records, and any route relation
that cannot be closed to the route's scene are rejected. No other route cycle
is inferred from labels or ordering.

### 5.2 Transform and zone values

The transform value is closed and finite:

```ts
type WorldTransformValue = Readonly<{
  space: 'local' | 'world'
  position: Readonly<{ x: number; y: number; z: number }>
  rotation: Readonly<{ x: number; y: number; z: number; w: number }>
  scale: Readonly<{ x: number; y: number; z: number }>
}>
```

All components are finite numbers. No unit or coordinate conversion is
inferred from prose. Zone geometry is a closed discriminated union:

```ts
type WorldZoneGeometry =
  | Readonly<{ kind: 'box'; size: Readonly<{ x: number; y: number; z: number }> }>
  | Readonly<{ kind: 'sphere'; radius: number }>
  | Readonly<{ kind: 'capsule'; radius: number; height: number }>
```

Dimensions, radius, and height must be finite and strictly positive. The zone
transform is the only spatial frame for its geometry. No mesh, prefab, asset
path, or delivery artifact is accepted by this module.

### 5.3 Hierarchy, scene closure, and graph guards

The World validator mechanically proves:

- node IDs are canonical, unique, and sorted after admission;
- exactly one scene root exists for each scene;
- every `world-scene.node` belongs to exactly one scene;
- exactly one node has no `parent`, and it is the scene's `root`;
- every non-root node has exactly one parent in the same scene;
- parent traversal has no cycle, and every node reaches the declared root;
- transforms, zones, instances, routes, spawns, encounters, checkpoints,
  camera regions, and objective placements carry one scene membership edge and
  do not point into another scene;
- `instanceKey` is unique across all entity instances in the closure;
- checkpoint ordinals are unique within a scene and are non-negative safe
  integers;
- route waypoint indices are unique, in range, and target only their closed
  waypoint types;
- a route's only legal cycle is its explicit `closed` final-to-first traversal;
  all other route cycles and route-to-route relations fail closed;
- spawn quantities are positive safe integers, and no duplicate singleton role
  or duplicate edge is accepted;
- an encounter has at least one distinct spawn and its zone/trigger types are
  exact;
- every objective placement targets a real Phase 4 `gameplay.objective`;
- a camera region has a real zone and anchor, so Presentation cannot bind to a
  filename or an unlocated camera label.

Scene hierarchy cycles, cross-scene edges, duplicate instance keys, duplicate
route waypoints, dangling references, and wrong-kind references are compiler
integrity failures. No node is silently dropped to make closure pass. There is
no maximum number of scenes, nodes, routes, or points.

World/Scene may target only the implemented Phase 4 Gameplay kinds explicitly
listed in the manifest (`entity`, `event`, `state`, and `objective`) plus its
own World/Scene kinds. It cannot target Presentation, Resource Realization, or
Implementation/Verification placeholders. Balance targets are not needed by
this schema and are rejected rather than represented speculatively.

## 6. Presentation schema

### 6.1 Closed node kinds and values

`PRESENTATION_DOMAIN_MANIFEST` is the single schema-owned kind/value/role
manifest. V1 contains:

| Kind | Strict value fields | Required binding/relationship roles |
| --- | --- | --- |
| `presentation.ui-screen` | `label`, `modal`, `requirements` | one or more `contains` → UI state; exactly one `initial-state` → UI state; exactly one `driven-by` → Gameplay state/event or World scene |
| `presentation.ui-state` | `label`, `initial`, `terminal` | exactly one `screen` → UI screen; exactly one `driven-by` → Gameplay state/event or World scene |
| `presentation.ui-action` | `label`, `input` (`button`, `pointer`, `key`, `gesture`, `system`) | exactly one `screen` → UI screen; exactly one `invokes` → `gameplay.action`; zero/one `available-in` → Gameplay state |
| `presentation.feedback` | `label`, `channel` (`text`, `icon`, `meter`, `haptic`, `flash`) | exactly one `on` → Gameplay event/state/action; zero/one `screen` → UI screen |
| `presentation.camera-behavior` | `label`, `mode` (`follow`, `fixed`, `blend`, `cut`, `shake`), `duration` | exactly one `region` → `world-scene.camera-region`; zero/one `on` → Gameplay event/state/action |
| `presentation.animation-clip` | `label`, `loop`, `playbackRate`, `requirements` | exactly one `on` → Gameplay event/state/action; exactly one `target` → World entity instance or Gameplay entity |
| `presentation.animation-state` | `label`, `initial`, `terminal` | exactly one `clip` → animation clip; exactly one `on` → Gameplay event/state/action |
| `presentation.vfx-cue` | `label`, `trigger` (`instant`, `attached`, `persistent`), `requirements` | exactly one `on` → Gameplay event/state/action; exactly one `at` → World node/zone/camera region |
| `presentation.audio-event` | `label`, `spatial`, `requirements` | exactly one `on` → Gameplay event/state/action; `requirements` is a closed logical requirement list |
| `presentation.audio-cue` | `label`, `volume`, `requirements` | exactly one `event` → audio event; exactly one `on` → Gameplay event/state/action or World scene/camera-region |
| `presentation.music-state` | `label`, `intensity`, `requirements` | exactly one `on` → Gameplay event/state/action |
| `presentation.transition` | `label`, `condition` (`automatic`, `event`, `action`, `state`) | exactly one `from` and one `to` → UI state; exactly one `on` → Gameplay event/state/action or World scene/camera-region |

`duration`, `playbackRate`, `volume`, and `intensity` are finite numbers with
the domain's explicit non-negative/normalized constraints where applicable;
the schema never interprets a file name as a value or binding. UI screen
`requirements` is a logical UI resource list, not a delivery artifact.

Every presentation behavior is attached to at least one implemented gameplay
or World target through a typed edge. Audio cues must bind directly as well as
through their audio event; this prevents a transitive event reference from
masking an unbound cue. A label such as `on-player-death` or a file called
`death.wav` is not evidence of a binding. Presentation does not accept
Balance, Resource Realization, or Implementation/Verification targets.

### 6.2 Logical requirements, not artifacts

Presentation may declare logical requirements that Phase 6 can later project.
They have no path, URL, file name, digest, storage key, generated bytes,
variant, delivery artifact, or provider identity:

```ts
type PresentationLogicalResourceRequirement = Readonly<{
  key: string
  kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
  runtimeRole: 'screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music'
}>
```

Keys are non-empty safe local identifiers and unique within the closure. The
kind/runtime-role combination is closed and must match the owning Presentation
node kind. Requirements are semantic values with source claims and are
immutable logical inputs to Phase 6; they do not make Resource Realization
reachable in Phase 5. Technical artifact constraints, variants, delivery
files, codecs, budgets, ownership, and runtime asset bindings belong entirely
to Phase 6.

### 6.3 UI and presentation graph guards

The Presentation validator proves:

- every UI screen contains at least one UI state and exactly one initial state;
- every contained UI state points back to exactly one screen;
- every UI state is reachable from its screen's initial state through typed
  presentation transitions;
- terminal UI states have no outgoing transition;
- every UI action invokes a real Phase 4 Gameplay action;
- every feedback, animation, VFX, audio event, music state, and presentation
  transition has an explicit gameplay or World binding of the permitted kind;
- every animation state targets a real animation clip, and every audio cue
  targets a real audio event;
- camera behavior targets a real World camera region, and any camera-linked
  presentation transition targets a real World scene or camera region;
- UI transition `from`/`to` endpoints are UI states, singleton roles are not
  duplicated, and wrong-kind/dangling edges fail closed;
- every logical requirement key is unique and its kind/runtime role matches its
  Presentation owner;
- no value embeds a target ID, path, file name, or artifact digest as a hidden
  relationship.

Presentation state cycles are legal when transitions are explicit and
reachable; the validator still rejects dangling endpoints, cycles through a
missing state, duplicate transition edges, and outgoing edges from terminal
states. A cycle is never inferred from a label. There is no fixed number of
screens, states, transitions, clips, cues, or logical requirements.

## 7. Source claims and projection preparation

The World/Scene and Presentation semantic result contracts follow the Phase 4
shape. `Phase5SemanticNode` is a local TypeScript alias for the existing Core
node body with the fixed semantic producer mode; it is not an alternate node
model. `GameIrDomainSourceClaim`
is the existing Phase 4 claim shape (`subject`, `documentPath`, `sectionId`,
`sourcePointer`, and `literal`) specialized to the shared Foundation document
type. The shared packet, receipt identity, claim ordering, and digest helpers
remain the authority.

```ts
type Phase5SemanticNode = Readonly<{
  id: string
  kind: string
  value: Readonly<Record<string, unknown>>
  references: readonly GameIrReference[]
  edges: readonly GameIrRelationshipEdge[]
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

The aliases above only name the existing shared shapes; they do not create a
new source authority, canonicalizer, or diagnostic contract.

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
  nodes: readonly Phase5SemanticNode[]
  sourceClaims: readonly GameIrDomainSourceClaim[]
  receiptDigest: string
}>
```

Presentation uses the same discriminated receipt contract with
`moduleId: 'presentation'` and the same `Phase5SemanticNode`/claim aliases.
There is no Phase 5-specific source authority or
digest algorithm. The shared admission function injects packet identity and
rejects worker relabeling.

For each semantic node, claims cover `/id`, every value leaf, every typed
reference, every typed edge, and every logical requirement leaf. Claim
document/section identities must be in the exact selected envelope. Core then
creates one owner binding per owner-bearing target. Derived values, if later
introduced by a domain-neutral Core rule, must use Core's existing derived
binding closure; Phase 5 does not add a second derived-binding mechanism.

World and Presentation candidate nodes are sorted by canonical ID, carry
`producerMode: 'semantic'`, and are frozen before closure assembly. The
assembler accounts for every semantic target exactly once and rejects
duplicate accounting even if duplicate records are byte-identical.

## 8. Cross-domain closure rules

The closure's internal target map contains the full validated Phase 4 Gameplay
and Balance nodes plus admitted World/Scene and Presentation nodes. Only the
following cross-domain links are allowed:

| Source module | Allowed external targets |
| --- | --- |
| `world-scene` | Phase 4 `gameplay.entity`, `gameplay.event`, `gameplay.state`, `gameplay.objective` |
| `presentation` | Phase 4 `gameplay.action`, `gameplay.event`, `gameplay.state`; Phase 5 `world-scene.scene`, `world-scene.node`, `world-scene.zone`, `world-scene.entity-instance`, `world-scene.camera-region` |

The assembler checks task ID, Foundation revision, READY receipt digest,
compile-request digest, full authority Section Index digest, source digest,
module IDs, projection digests, and all typed target kinds across every input.
It rejects stale Phase 4 projections, mixed revisions, relabeled modules,
duplicate global IDs, wrong-kind targets, missing targets, and references to
not-yet-implemented modules. It does not accept an opposite-domain Map as a
shortcut and never fabricates a resource or implementation node to satisfy a
link.

The Phase 4 pair remains the authority for Gameplay–Balance bidirectional
closure. Phase 5 only proves its own World/Presentation links against those
already-admitted nodes. It does not rerun or replace the Phase 4 pair writer.

## 9. Testing and acceptance evidence

Implementation, when separately authorized, must follow TDD: each contract
and invariant begins with a failing test, then the smallest implementation is
added, and the full boundary suite is rerun. This section states acceptance
evidence, not an implementation task list.

### 9.1 Complete eight-document profiles

At least two complete, distinct fixtures must contain all eight canonical
Foundation documents, a valid READY receipt, exact Section Index bytes, and
valid Phase 4 Gameplay–Balance projections:

1. **Traversal/action profile:** multiple scenes and a rooted hierarchy,
   transformed zones, player/enemy instances, a route with ordered waypoints,
   wave and patrol encounters, checkpoints, camera regions, objective
   placements, HUD/menu UI, action-driven transitions, player animation,
   trigger VFX, spatial audio, and music states.
2. **Branching/puzzle profile:** a different scene topology with branching
   routes, several objective placements, state-driven checkpoints and camera
   regions, a multi-screen UI state graph, feedback bound to gameplay events,
   animation/VFX/audio cues with different logical requirements, and explicit
   presentation transitions.

Both profiles must be valid without delivery artifacts. A profile may have no
real resources; logical Presentation requirements remain allowed and must not
be turned into Resource Realization placeholders. Compiling each profile twice
from the same immutable source must produce byte-identical World, Presentation,
and closure digests; the profiles must produce distinct digests.

### 9.2 Contract, mutation, and boundary matrix

Tests must cover:

- strict unknown-field/kind/role rejection, hidden/accessor property rejection,
  frozen output, canonical ordering, and digest replay;
- exact eight-document authority index, exact selected source closure, altered
  or missing section bytes, extra bytes, stale receipt identity, and narrowed
  caller evidence rejection;
- empty World/Presentation mechanical receipts, non-empty mechanical nodes or
  claims, unsorted/duplicate targets, packet relabeling, worker-supplied
  identity, and mechanical/semantic overlap rejection;
- missing and ambiguous diagnostics with packet/source-bound evidence and
  node-qualified subjects, including section-digest pointers for unbound
  missing facts;
- World parent cycle, missing root, multiple roots, orphan node, cross-scene
  membership, dangling/wrong-kind typed refs, duplicate instance key,
  duplicate singleton edge, route index out of range or repeated, invalid
  geometry, invalid transform number, missing encounter spawn, invalid
  checkpoint ordinal, and objective/camera closure mutations;
- Presentation screen without an initial state, duplicate initial state,
  unreachable UI state, terminal outgoing transition, wrong screen backlink,
  unbound UI action/feedback/animation/VFX/audio/music/camera behavior, wrong
  target kind, missing animation/audio parent, duplicate logical requirement
  key, artifact path/file-name value, and Balance/resource/implementation
  placeholder target mutations;
- closure input with stale/tampered/full-missing Phase 4 projections, mixed
  task/revision/READY identity, changed Phase 4 projection digest, raw Map,
  digest-only object, detached module, duplicate global node ID, forbidden
  cross-domain target, and closure digest tampering;
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

Phase 6 may consume only the immutable `WorldPresentationClosure` and derive
Resource Realization logical requirements from its Presentation nodes. It may
add variants, technical constraints, delivery artifacts, resource authority,
and runtime bindings in its own isolated module; it may not add artifacts back
into the Phase 5 projection or mutate the closure.

Phase 7 may consume the immutable Phase 5 closure together with a validated
Phase 6 projection and derive Implementation/Verification targets and evidence
requirements. It may not create World, Presentation, Gameplay, or Balance
nodes, and it may not make production routing reachable.

Neither phase receives a raw Map, detached module, digest-only reference, or
placeholder. Until Phase 6/7 are implemented and admitted, no complete
seven-module candidate, publication, consumer migration, or Chrome acceptance
exists.

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

This document remains Proposed / awaiting review until reviewed and explicitly
accepted. Phase 5–9 status, production reachability, publication, and Chrome
acceptance must remain accurately unstarted/deferred in the parent roadmap.
