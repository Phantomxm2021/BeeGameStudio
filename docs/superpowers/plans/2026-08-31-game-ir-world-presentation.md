# Game IR World/Presentation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add isolated, immutable, source-bound world-scene and presentation Game IR projections and one replayable closure without making production routing or complete candidate publication reachable.

**Architecture:** Extend the existing Core/domain boundary with one seven-module source manifest, one exported replayable Phase 4 Gameplay-Balance authority, and one shared Phase 5 semantic/fidelity admission boundary. World/Scene and Presentation each own a closed schema and producer packet/result wrapper; one closure assembler replays Phase 4, admits both new modules, and emits the only Phase 5 closure.

**Tech Stack:** TypeScript, Bun test, Node crypto/TextDecoder, existing Core canonical JSON/digest and source-binding helpers, Foundation READY/Section Index contracts, and TypeScript AST boundary tests.

**Spec:** docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md

## Global Constraints

- Work only in codex/game-ir-stage-isolation at .worktrees/game-ir-stage-isolation.
- Phase 5 remains an isolated Stage 5 library and is unreachable from DeliveryRun, production routing, persistence, controller transitions, provider dispatch, Reviewer, Revision, consumers, publication, and Chrome acceptance.
- Do not modify Foundation Reviewer/Revision production behavior or any protected Stage 3/4 file.
- Do not add a complete GameIrCandidate, seven-module writer, partial publication, Phase 6/7 module, controller/store/provider/persistence interface, fallback, compatibility reader, migration reader, dual write, legacy reader, or fixed business cap.
- GAME_IR_MODULE_SOURCE_DOCUMENTS is the unique service-owned source manifest for all seven canonical modules; domain-source and semantic-validator projections derive from it and do not repeat document lists.
- Core GameIrNode, GameIrReference, GameIrRelationshipEdge, GameIrSourceBinding, GameIrModuleCandidate, GameIrSourceSection, parseGameIrModuleCandidate, parseGameIrCandidate, canonicalizeGameIrSourceSections, canonicalGameIrJson, digestGameIrValue, and target-pointer validation remain the sole Core authorities.
- There is one Core parser/canonicalizer, one source authority, one diagnostic authority, and one Phase 4 Gameplay-Balance pair writer.
- Phase 4 output and digests remain byte-identical for existing inputs. Phase 5 replays GameplayBalanceAssemblyAuthority through assembleGameplayBalanceModules and never trusts a detached pair or digest-only identity.
- Mechanical World/Scene and Presentation receipts are empty (nodes, verifiedClaims, ownedTargets); semantic ownership is declared before dispatch and is disjoint from mechanical ownership.
- Mechanical emptiness is policy, not fallback. Semantic claims cover /id, every value leaf, every reference, and every edge exactly once.
- Semantic source claims use exact canonical /bytes/<start>/<end> pointers, safe unsigned decimal offsets, strict UTF-8 code-point boundaries, exact decoded literals, and exact typed reference/edge literals.
- Producer missing-projection and ambiguous-projection diagnostics are packet-bound, source-bound, node-qualified, immutable, and use only exact section evidence; fidelity mismatch diagnostics use exact owner bindings.
- Fidelity validation is read-only, has full canonical target/check coverage, and accepts only an exact PASS reconstructed from the server packet.
- Logical Presentation requirements contain only requirementId, kind, and runtimeRole; no path, URL, filename, digest, storage key, artifact, variant, codec, budget, provider, or Resource Realization node is admitted.
- Every task uses TDD, includes a failing test before implementation, runs the full Game IR suite, full Foundation exact-21 test set, both typechecks, Biome, protected parity, full-server unreachable scan, and git diff --check, then commits its files.

---

### Task 1: Shared source manifest, Phase 4 replay authority, and Phase 5 fidelity contracts

**Files:**
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance-assembler.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
- Test: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts
- Test: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.test.ts

**Interfaces:**
- Consumes: existing GameIrCompileRequest, GameIrSourceSection, GameIrModuleCandidate, GameIrMechanicalProjectionReceipt, and current Phase 4 assembler inputs.
- Produces the single manifest:

    export const GAME_IR_MODULE_SOURCE_DOCUMENTS = Object.freeze({
      core: Object.freeze(['docs/GDD.md']),
      gameplay: Object.freeze(['docs/GDD.md']),
      balance: Object.freeze(['docs/GDD.md', 'docs/BALANCE_DESIGN.md']),
      'world-scene': Object.freeze(['docs/GDD.md', 'docs/LEVEL_SCENE_DESIGN.md']),
      presentation: Object.freeze(['docs/GDD.md', 'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md']),
      'resource-realization': Object.freeze(['docs/ASSET_PLAN.md',
        'docs/TECHNICAL_DESIGN.md', 'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md', 'docs/AUDIO_DESIGN.md',
        'docs/LEVEL_SCENE_DESIGN.md']),
      'implementation-verification': Object.freeze(['docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md', 'docs/BALANCE_DESIGN.md',
        'docs/TECHNICAL_DESIGN.md']),
    } as const)

    export type GameIrDomainId =
      'gameplay' | 'balance' | 'world-scene' | 'presentation'

- Produces the exact replay authority:

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

- Produces shared Phase 5 types and functions, exported exactly once from phase5-admission.ts:

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

    export type Phase5GameplayExternalProjection = Readonly<{
      moduleId: 'gameplay'
      module: GameIrModuleCandidate & Readonly<{ moduleId: 'gameplay' }>
      projectionDigest: string
    }>
    export type Phase5WorldSceneExternalProjection = Readonly<{
      moduleId: 'world-scene'
      module: GameIrModuleCandidate & Readonly<{ moduleId: 'world-scene' }>
      projectionDigest: string
    }>
    export type Phase5ExternalProjections =
      | Readonly<{ gameplay: Phase5GameplayExternalProjection }>
      | Readonly<{
          gameplay: Phase5GameplayExternalProjection
          worldScene: Phase5WorldSceneExternalProjection
        }>

    export type Phase5SemanticValidationPacket = Readonly<{
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

    export type Phase5SemanticValidationResult = Readonly<
      | { outcome: 'PASS'; packetDigest: string; checkIds: readonly string[];
          coveredTargets: readonly string[] }
      | Extract<GameIrSemanticValidationResult, { outcome: 'FAIL' | 'AMBIGUOUS' }>
    >

    export function buildPhase5SemanticValidationPacket(input: {
      source: GameIrDomainSourceEnvelope
      mechanical: GameIrMechanicalProjectionReceipt
      semantic: Phase5SemanticReceipt
      module: GameIrModuleCandidate
      externalProjections: Phase5ExternalProjections
      checkIds: readonly string[]
      targetManifestDigest: string
    }): Phase5SemanticValidationPacket

    export function admitPhase5SemanticValidationResult(
      packet: Phase5SemanticValidationPacket,
      value: unknown,
    ): Phase5SemanticValidationResult

- Phase5ExternalProjections is a named discriminated union: World validation carries an admitted Phase 4 GameplayModuleProjection; Presentation validation carries that plus an admitted WorldSceneModuleProjection. It is not a map and has no digest-only arm.

- [ ] Step 1: Write RED tests for all seven manifest keys, exact document arrays, equivalent Gameplay/Balance source closures and digests, exported authority shape, and pair replay determinism. Mutate task, revision, READY receipt, selected bytes, receipt, projection, and authority fields.

    expect(Object.keys(GAME_IR_MODULE_SOURCE_DOCUMENTS).sort()).toEqual([
      'balance', 'core', 'gameplay', 'implementation-verification',
      'presentation', 'resource-realization', 'world-scene',
    ])
    expect(canonicalGameIrJson(assembleGameplayBalanceModules(authority)))
      .toBe(canonicalGameIrJson(assembleGameplayBalanceModules(authority)))
    expect(() => assembleGameplayBalanceModules(
      { ...authority, gameplay: pair.gameplay } as never,
    )).toThrow(/authority|source|mechanical|semantic/i)

- [ ] Step 2: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.test.ts

  Expected: the new Phase 5 exports are absent or reject the new identities.

- [ ] Step 3: Move source-document ownership to GAME_IR_MODULE_SOURCE_DOCUMENTS. Derive selected closures from the module key and import the same constant from semantic-admission.ts when constructing MODULE_DESCRIPTORS. Remove duplicated document arrays while preserving all-eight authority index validation and Phase 4 closures.

- [ ] Step 4: Extend the shared domain identity to four isolated IDs and retain the strict empty mechanical policy for every isolated domain. Export GameplayBalanceAssemblyAuthority and type the current assembler with it. Keep preparation helpers private and keep Phase 4 bytes/digests unchanged.

- [ ] Step 5: Implement shared Phase 5 claim admission and fidelity packet/result admission. Normalize nodes once, sort by Core code units, reject hidden/accessor properties and embedded IDs, and verify exact UTF-8 slices. /id and string leaves use exact text; numbers use strict JSON number syntax; booleans use true/false; references and edges use canonicalGameIrJson({ targetId, targetType }) as the typed literal. Derive moduleBytes, moduleDigest, requiredTargets, check IDs, and evidence from admitted authority; reject boolean/digest-only/partial/extra/stale PASS.

    const literal = canonicalGameIrJson({
      targetId: edge.targetId,
      targetType: edge.targetType,
    })
    const bytes = Buffer.from(sectionBytes, 'utf8')
    const decoded = new TextDecoder('utf-8', { fatal: true }).decode(
      bytes.subarray(start, end),
    )
    if (decoded !== claim.literal || !isUtf8Boundary(bytes, start, end))
      fail('claim does not identify the exact UTF-8 literal')

- [ ] Step 6: Run:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
    bun run typecheck
    (cd packages/agent-workflow-server && bun run typecheck)
    ./node_modules/.bin/biome check docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md docs/superpowers/plans/2026-08-31-game-ir-world-presentation.md packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
    git diff --check

  Commit all Task 1 files with:
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-source.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/domain-projection.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/semantic-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/gameplay-balance-assembler.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/phase5-admission.test.ts
    git commit -m "feat: define shared Phase 5 Game IR authority"

---

### Task 2: World/Scene schema, manifest, graph, and number guards

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts

**Interfaces:**
- Consumes: Core-admitted GameIrModuleCandidate with moduleId world-scene, optional Gameplay target map, and shared source/manifest types.
- Produces:

    export type WorldCoordinateConvention =
      | Readonly<{ dimensions: '2d'; xDirection: 'left' | 'right';
          yDirection: 'up' | 'down';
          distanceUnit: 'pixel' | 'centimeter' | 'meter' }>
      | Readonly<{ dimensions: '3d'; handedness: 'left' | 'right';
          upAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
          forwardAxis: '+x' | '-x' | '+y' | '-y' | '+z' | '-z';
          distanceUnit: 'centimeter' | 'meter' }>
    export type WorldTransformValue =
      | Readonly<{ dimensions: '2d'; space: 'local' | 'world';
          position: { x: number; y: number }; rotationRadians: number;
          scale: { x: number; y: number } }>
      | Readonly<{ dimensions: '3d'; space: 'local' | 'world';
          position: { x: number; y: number; z: number };
          rotation: { x: number; y: number; z: number; w: number };
          scale: { x: number; y: number; z: number } }>
    export type WorldZoneGeometry =
      | Readonly<{ kind: 'rectangle'; size: { x: number; y: number } }>
      | Readonly<{ kind: 'circle'; radius: number }>
      | Readonly<{ kind: 'capsule-2d'; radius: number; length: number }>
      | Readonly<{ kind: 'box'; size: { x: number; y: number; z: number } }>
      | Readonly<{ kind: 'sphere'; radius: number }>
      | Readonly<{ kind: 'capsule-3d'; radius: number; height: number }>
    export const WORLD_SCENE_DOMAIN_MANIFEST: Readonly<Record<string, {
      valueFields: readonly string[]
      relationships: Readonly<Record<string, WorldSceneRelationshipRole>>
    }>>
    export function parseWorldSceneModule(
      module: GameIrModuleCandidate,
      externalTargets?: ReadonlyMap<string, GameIrNode>,
    ): GameIrModuleCandidate

- Manifest must include exactly scene, node, zone, entity-instance, route, spawn, encounter, checkpoint, camera-region, and objective-placement with the value fields, typed roles, singleton/required cardinality, and allowed target kinds in the approved spec. No Balance, Presentation, Resource Realization, or Implementation/Verification target is allowed.

- [ ] Step 1: Write RED two-scene fixture and mutations for roots, nested container/anchor/volume/visual nodes, 2D/3D transforms, every geometry shape, instances, repeated waypoints, all encounter modes, checkpoints, camera regions, and objectives. Mutate unknown kind/field/role, duplicate ID, missing/multiple root, orphan/cycle/cross-scene parent, wrong kind, duplicate singleton, route under two points, out-of-range/unused index, cross-scene waypoint, invalid axis/quaternion/scale/number, geometry mismatch, node-type/zone mismatch, encounter cardinality, checkpoint ordinal, objective/camera closure.

    expect(() => parseWorldSceneModule(cycleFixture(), gameplayTargets))
      .toThrow(/cycle/i)
    expect(() => parseWorldSceneModule(repeatedWaypointFixture(), gameplayTargets))
      .not.toThrow()
    expect(() => parseWorldSceneModule(routeWithUnusedReference(), gameplayTargets))
      .toThrow(/every declared reference|unused/i)

- [ ] Step 2: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts

- [ ] Step 3: Implement exact-key value parsers. Enforce finite numeric components, safe integer quantities/ordinals/priorities, non-negative blends, positive scale/geometry measures, finite nonzero quaternion norm, distinct 3D axes, scene-dimension geometry, world-space roots, and no inferred defaults or normalization.

- [ ] Step 4: Implement local/cross-domain guards. Build targets from local World nodes plus only Gameplay entity/event/state/objective nodes. Prove one scene/root and one parent path for every node, no cycles, scene-local memberships, encounter spawn/zone/mode cardinalities, checkpoint uniqueness, route traversal indexes and scene closure, camera anchor/zone closure, and objective closure. Repeated route indexes are legal revisits and never become fabricated edges.

- [ ] Step 5: Run the full Game IR/Foundation exact-21/parity/typecheck/Biome/diff-check commands in Task 1, then:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
    git commit -m "feat: validate Game IR world scene graphs"

---

### Task 3: Presentation schema, UI graph, trigger, and requirement guards

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts

**Interfaces:**
- Consumes: Core-admitted Presentation module, replayed Gameplay target map, admitted World target map, and shared Phase 5 types.
- Produces:

    export type PresentationTransitionTrigger =
      | Readonly<{ kind: 'automatic' }> | Readonly<{ kind: 'event' }>
      | Readonly<{ kind: 'action' }> | Readonly<{ kind: 'state' }>
      | Readonly<{ kind: 'world-scene' }>
      | Readonly<{ kind: 'camera-region' }>
    export type PresentationLogicalResourceRequirement = Readonly<{
      requirementId: string
      kind: 'ui' | 'animation' | 'vfx' | 'audio' | 'music'
      runtimeRole: 'screen' | 'clip' | 'effect' | 'cue' | 'voice' | 'music'
    }>
    export const PRESENTATION_DOMAIN_MANIFEST: Readonly<Record<string, {
      valueFields: readonly string[]
      relationships: Readonly<Record<string, PresentationRelationshipRole>>
    }>>
    export function parsePresentationModule(
      module: GameIrModuleCandidate,
      externalTargets?: ReadonlyMap<string, GameIrNode>,
    ): GameIrModuleCandidate

- Manifest must include exactly ui-screen, ui-state, ui-action, feedback, camera-behavior, animation-clip, animation-state, vfx-cue, audio-event, audio-cue, music-state, and transition with the approved strict fields and roles. Requirements are allowed only on ui-screen, animation-clip, vfx-cue, audio-cue, and music-state, with exact owner kind/runtime-role pairs.

- [ ] Step 1: Write RED multi-screen fixture and mutations for initial states, reachable same-screen transitions, terminal states, action/state/event triggers, feedback, camera behavior, entity animation, animation state, VFX, spatial/non-spatial audio, music, and requirements. Mutate missing/duplicate initial state, backlink, unreachable state, terminal outgoing edge, cross-screen transition, automatic on, missing non-automatic on, discriminant mismatch, unbound behavior, wrong targets, missing clip/event, state-machine fields, requirement order/ownership, duplicate audio trigger, cue-level on, spatial at mismatch, numeric boundaries, artifacts, and forbidden modules.

    expect(() => parsePresentationModule(terminalWithOutgoingTransition(), targets))
      .toThrow(/terminal/i)
    expect(() => parsePresentationModule(entityAnimationFixture(), targets))
      .not.toThrow()
    expect(() => parsePresentationModule(nonSpatialCueWithAt(), targets))
      .toThrow(/spatial|at/i)

- [ ] Step 2: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts

- [ ] Step 3: Implement strict value/requirement/trigger parsing. Enforce finite duration and positive playback rate, volume/intensity in [0,1], safe globally unique requirement IDs, and automatic/no-on versus non-automatic/exactly-one-on. Reject artifact-shaped fields and embedded target IDs.

    function requirementOwner(nodeKind: string) {
      return {
        'presentation.ui-screen': { kind: 'ui', runtimeRoles: ['screen'] },
        'presentation.animation-clip': { kind: 'animation', runtimeRoles: ['clip'] },
        'presentation.vfx-cue': { kind: 'vfx', runtimeRoles: ['effect'] },
        'presentation.audio-cue': { kind: 'audio', runtimeRoles: ['cue', 'voice'] },
        'presentation.music-state': { kind: 'music', runtimeRoles: ['music'] },
      }[nodeKind]
    }

- [ ] Step 4: Implement UI reachability and closure. Prove screen/state backlinks, reachability from each initial state through explicit same-screen transitions, no terminal outgoing edges, exact trigger target kind, gameplay/world bindings, spatial audio context, non-spatial absence of context, and valid Gameplay entity animation. Animation state remains only a trigger-to-clip mapping.

- [ ] Step 5: Run the full gate commands from Task 1 and commit:
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts
    git commit -m "feat: validate Game IR presentation graphs"

---

### Task 4: World/Scene producer and exact UTF-8 semantic admission

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts

**Interfaces:**
- Consumes: GameIrDomainSourceEnvelope, empty GameIrMechanicalProjectionReceipt, WORLD_SCENE_DOMAIN_MANIFEST, and shared Phase5 candidate/claim/diagnostic types.
- Produces only these public producer functions; preparation stays private to the closure assembler:

    export type WorldSceneSemanticReceipt = Phase5SemanticReceipt &
      Readonly<{ moduleId: 'world-scene' }>
    export type WorldSceneSemanticResult =
      | WorldSceneSemanticReceipt | GameIrDomainSemanticDiagnostic
    export function buildWorldSceneSemanticPacket(input: {
      source: GameIrDomainSourceEnvelope
      mechanical: GameIrMechanicalProjectionReceipt
    }): GameIrDomainSemanticPacket
    export function admitWorldSceneSemanticResult(
      packet: GameIrDomainSemanticPacket,
      value: unknown,
    ): WorldSceneSemanticResult

- [ ] Step 1: Write RED tests for exact World selected closure (GDD and LEVEL_SCENE_DESIGN), empty mechanical receipts, stale identities, packet relabeling, unknown kind/role, omitted/overlapping claims, and exact UTF-8 byte ranges (leading zero, split code point, out-of-range, type mismatch, semantically contrary literal). Test packet-bound node-qualified missing/ambiguous diagnostics and reject bare section or binding evidence crossover.

    const packet = buildWorldSceneSemanticPacket({ source, mechanical })
    expect(() => admitWorldSceneSemanticResult(packet, {
      outcome: 'PROJECTED', nodes, sourceClaims: claimsWithSplitUtf8Range,
    })).toThrow(/UTF-8|boundary|literal/i)

- [ ] Step 2: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts

- [ ] Step 3: Implement wrappers over shared admission. The worker result has no Core bindings or identity. The service injects producerMode, binds exact source claims later, and derives kinds/roles from WORLD_SCENE_DOMAIN_MANIFEST. Producers do not read working-tree files, old IR, Checklist, Manifest, or caller-selected sections.

- [ ] Step 4: Require one claim for every ID, value leaf, reference, edge, transform leaf, geometry leaf, and route index. Assert a graph larger than the ordinary fixture remains valid without a scene/node/route/point cap.

- [ ] Step 5: Run full Game IR/Foundation exact-21/parity/typechecks/Biome/diff-check and:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-schema.test.ts
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts
    git commit -m "feat: admit world scene semantic projections"

---

### Task 5: Presentation producer and exact UTF-8 semantic admission

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts

**Interfaces:**
- Consumes: GameIrDomainSourceEnvelope, empty GameIrMechanicalProjectionReceipt, PRESENTATION_DOMAIN_MANIFEST, shared Phase5 candidate/claim/diagnostic types, and exact GDD/ART_DIRECTION/UI_UX_SPEC/AUDIO_DESIGN sections.
- Produces only:

    export type PresentationSemanticReceipt = Phase5SemanticReceipt &
      Readonly<{ moduleId: 'presentation' }>
    export type PresentationSemanticResult =
      | PresentationSemanticReceipt | GameIrDomainSemanticDiagnostic
    export function buildPresentationSemanticPacket(input: {
      source: GameIrDomainSourceEnvelope
      mechanical: GameIrMechanicalProjectionReceipt
    }): GameIrDomainSemanticPacket
    export function admitPresentationSemanticResult(
      packet: GameIrDomainSemanticPacket,
      value: unknown,
    ): PresentationSemanticResult

- [ ] Step 1: Write RED tests for all Presentation kinds, exact claims including requirement leaves, selected-source closure, empty mechanical ownership, stale/relabelled packet/result, omitted/overlap claims, source range/type mismatch, artifact-shaped requirements, and diagnostic evidence namespace.

    expect(() => admitPresentationSemanticResult(packet, {
      outcome: 'PROJECTED', nodes, sourceClaims: claimsWithArtifactPath,
    })).toThrow(/path|artifact|filename/i)

- [ ] Step 2: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts

- [ ] Step 3: Implement wrappers over shared admission with manifest-derived kinds/roles. Keep requirements logical and immutable and leave Phase 6 resource realization absent.

- [ ] Step 4: Prove complete claims for UI values, trigger discriminants, requirement leaves, references and edges. Compile a larger reachable multi-screen cyclic graph and assert unrelated node insertion cannot reorder existing requirement IDs.

- [ ] Step 5: Run full gate commands from Task 1 plus:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-schema.test.ts
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts
    git commit -m "feat: admit presentation semantic projections"

---

### Task 6: Sole World/Presentation closure assembler and fidelity PASS gate

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts

**Interfaces:**
- Consumes: GameplayBalanceAssemblyAuthority, Phase 5 source/mechanical/semantic receipts, shared fidelity packet/results, Core module parser, World/Presentation parsers, and replayed Phase 4 projections.
- Produces:

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

- [ ] Step 1: Write RED authority/replay tests for exact keys and frozen authority; stale/tampered/missing Phase 4 authority; forged recomputed projection digest; raw Map, digest-only object, detached module; duplicate global ID; wrong-kind and forbidden targets; mixed task/revision/READY/compile identity.

    const closure = assembleWorldPresentationClosure(authority)
    expect(Object.isFrozen(closure)).toBe(true)
    expect(closure.phase4).toEqual(
      assembleGameplayBalanceModules(authority.phase4Authority),
    )

- [ ] Step 2: Write RED fidelity/mutation tests for incomplete or extra check/target coverage, duplicate coverage, boolean/digest-only PASS, stale external projection, FAIL/AMBIGUOUS result, evidence crossover, World graph mutations, Presentation graph mutations, and altered projection/closure digests.

- [ ] Step 3: Run RED:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts

- [ ] Step 4: Implement ordered replay. Validate authority shape; call assembleGameplayBalanceModules(authority.phase4Authority) first; validate both source/receipt identities; privately bind semantic claims to Core owner bindings; Core-admit World and run parseWorldSceneModule against replayed Gameplay; rebuild/admit exact World PASS; Core-admit Presentation against replayed Gameplay plus World; rebuild/admit exact Presentation PASS.

    const phase4 = assembleGameplayBalanceModules(authority.phase4Authority)
    const world = prepareWorldScene(authority.worldScene, phase4)
    const packet = buildPhase5SemanticValidationPacket({
      ...authority.worldScene, module: world.module,
      externalProjections: { gameplay: phase4.gameplay },
      checkIds: WORLD_SCENE_CHECK_IDS,
      targetManifestDigest: digestGameIrValue(WORLD_SCENE_DOMAIN_MANIFEST),
    })
    const validation = admitPhase5SemanticValidationResult(
      packet, authority.worldScene.validation,
    )
    if (validation.outcome !== 'PASS')
      fail('World fidelity validation did not PASS')

- [ ] Step 5: Keep module preparation, binding, merge, and projection helpers private to this assembler. Compute validation result digests, projection digests excluding themselves, and closure digest from every preceding field and complete projection. Validate global ID disjointness and every typed edge. Emit no candidate, publication, store record, or fallback node.

- [ ] Step 6: Run full Game IR/Foundation exact-21/parity/typechecks/Biome/diff-check and:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-scene-producer.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/presentation-producer.test.ts
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation-assembler.test.ts
    git commit -m "feat: assemble isolated World Presentation closure"

---

### Task 7: Complete profiles, mutation/isolation gate, and status documentation

**Files:**
- Create: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation.integration.test.ts
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
- Modify: packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts
- Modify: docs/beegame-game-ir-stage-isolation-redesign.md
- Modify: docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md

**Interfaces:**
- Consumes: assembleWorldPresentationClosure, WorldPresentationAssemblyAuthority, exact eight-document Foundation READY/Section Index fixtures, Phase 4 authority, producer functions, and both schema manifests.
- Produces: two complete-profile integration evidence sets and an isolation/status gate; no complete candidate, publication, production route, or Chrome run.

- [ ] Step 1: Build the traversal/action profile from all eight canonical documents and a valid READY receipt. Include multiple scenes and rooted hierarchies, transformed zones, player/enemy instances, ordered route, wave/patrol encounters, checkpoints, cameras, objective placement, HUD/menu UI, action transitions, player animation, trigger VFX, spatial audio, and music. Assert exact kinds, typed edges, route order, UI reachability, requirements, and validator coverage.

- [ ] Step 2: Build the distinct branching/puzzle profile with different scene topology, multiple linear routes sharing waypoints, repeated visits, objective placements, state-driven checkpoint/camera behavior, multi-screen UI, event feedback, different logical requirements, and explicit same-screen transitions. Keep it valid with no delivery artifacts or resource nodes.

- [ ] Step 3: Compile each profile twice from the same immutable authority and compare canonical World, Presentation, Phase 4, and closure bytes/digests; assert profiles differ. Mutate source bytes/ranges, mechanical ownership, producer diagnostics, graph/number/UI/trigger/requirement rules, stale Phase 4, mixed identities, forged recomputed projection digest, raw map/detached module, and forbidden target. Add graphs beyond ordinary sizes.

    expect(first.worldScene.projectionDigest).toBe(second.worldScene.projectionDigest)
    expect(first.presentation.projectionDigest).toBe(second.presentation.projectionDigest)
    expect(first.closureDigest).not.toBe(branchingPuzzle.closureDigest)
    expect(() => assembleWorldPresentationClosure(
      mutateStalePhase4(authority),
    )).toThrow(/stale|identity|authority/i)

- [ ] Step 4: Extend foundation-parity.test.ts so enabling the read-only Phase 5 boundary after READY leaves Stage 3/4 tasks, Issue Registry, revision patches, targeted rechecks, and READY receipt byte-identical. Extend stage-boundary.test.ts to scan all production sources and reject closure/producer imports, controller/store/provider/persistence/Reviewer/Revision symbols, Phase 6/7 names, partial candidate/publication calls, fallback/compatibility/dual-write symbols, and placeholder targets. Preserve the exact 21-file manifest and empty diff against 70df2e2c.

- [ ] Step 5: Keep this spec line exactly Status: Approved. Update only the parent roadmap wording to state that the Phase 5 design is approved while implementation/production reachability, complete candidate assembly/publication, and Chrome acceptance remain unstarted/unavailable. Do not change Phase 6–9 status.

- [ ] Step 6: Run the final gate:
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/*.test.ts
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-artifacts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-check-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-contracts.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-cutover.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-production-manifest.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-rules.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-audit-state.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-definitions.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-extraction.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-runtime.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-fact-store.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-impact-analysis.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-patch-validation.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-batches.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-publication.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-round-policy.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/foundation-revision-stage.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/schema-evolution.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/transition.test.ts
    bun run typecheck
    (cd packages/agent-workflow-server && bun run typecheck)
    ./node_modules/.bin/biome check docs/beegame-game-ir-stage-isolation-redesign.md docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md docs/superpowers/plans/2026-08-31-game-ir-world-presentation.md packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir
    bun test packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts
    git diff --check

  Commit:
    git add packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/world-presentation.integration.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/stage-boundary.test.ts packages/agent-workflow-server/src/beegame/delivery-workflow/game-ir/foundation-parity.test.ts docs/beegame-game-ir-stage-isolation-redesign.md docs/superpowers/specs/2026-08-31-game-ir-world-presentation-design.md
    git commit -m "test: prove isolated World Presentation Phase 5"

## Completion Gate

The implementation is ready for final review only when Tasks 1-7 have independent task-level reviews, every Phase 5 specification section maps to a task, World and Presentation ownership is explicit and disjoint, every owner leaf/reference/edge has one exact claim, all graph/number/UI/trigger/requirement invariants are mechanically enforced, both fidelity validators require complete exact PASS coverage, Phase 4 replay produces unchanged pair bytes/digests, two complete profiles produce deterministic distinct closure digests, and the full Game IR/Foundation/parity/typecheck/Biome/diff-check/isolation gate is green. Phase 5 output remains isolated and unreachable; no complete seven-module candidate, publication, consumer migration, Resource Realization, Implementation/Verification, or Chrome acceptance exists.
