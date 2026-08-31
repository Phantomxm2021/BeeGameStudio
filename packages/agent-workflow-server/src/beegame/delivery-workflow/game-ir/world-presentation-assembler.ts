import {
  assembleGameplayBalanceModules,
  type GameplayBalanceAssemblyAuthority,
  type GameplayBalanceModulePair,
} from './gameplay-balance-assembler'
import {
  buildPhase5SemanticValidationPacket,
  admitPhase5SemanticValidationResult,
  replayAndBindPhase5SemanticReceipt,
  type Phase5SemanticValidationPacket,
  type WorldSceneModuleProjection,
  type WorldSceneSemanticValidationResult,
  type PresentationSemanticValidationResult,
} from './phase5-admission'
import {
  buildPresentationSemanticPacket,
  type PresentationSemanticReceipt,
} from './presentation-producer'
import {
  buildWorldSceneSemanticPacket,
  type WorldSceneSemanticReceipt,
} from './world-scene-producer'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import type { GameIrMechanicalProjectionReceipt } from './domain-projection'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  parseWorldSceneModule,
  WORLD_SCENE_DOMAIN_MANIFEST,
} from './world-scene-schema'
import {
  parsePresentationModule,
  PRESENTATION_DOMAIN_MANIFEST,
} from './presentation-schema'

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

export type WorldSceneValidationPreparationAuthority = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: WorldSceneSemanticReceipt
  phase4: GameplayBalanceModulePair
}>

export type PresentationValidationPreparationAuthority = Readonly<{
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
  }>
  phase4: GameplayBalanceModulePair
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

function fail(message: string): never {
  throw new Error(`invalid Game IR World/Presentation assembly: ${message}`)
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function exactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Reflect.ownKeys(value)
  for (const key of keys) {
    if (typeof key !== 'string') fail(`${label} has a symbol property`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor || !('value' in descriptor) || !descriptor.enumerable)
      fail(`${label} has a hidden or accessor property`)
  }
  const actual = (keys as string[]).sort(compareCodeUnits)
  const wanted = [...expected].sort(compareCodeUnits)
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
}

function validateAuthorityShape(
  value: unknown,
): asserts value is WorldPresentationAssemblyAuthority {
  if (!isPlainRecord(value)) fail('authority must be a plain object')
  exactKeys(
    value,
    ['phase4Authority', 'worldScene', 'presentation'],
    'authority',
  )
  if (!isPlainRecord(value.phase4Authority))
    fail('phase4Authority must be a plain object')
  exactKeys(value.phase4Authority, ['gameplay', 'balance'], 'phase4Authority')
  for (const [name, branch] of [
    ['gameplay', value.phase4Authority.gameplay],
    ['balance', value.phase4Authority.balance],
    ['worldScene', value.worldScene],
    ['presentation', value.presentation],
  ] as const) {
    if (!isPlainRecord(branch)) fail(`${name} must be a plain object`)
    const expected =
      name === 'worldScene' || name === 'presentation'
        ? ['source', 'mechanical', 'semantic', 'validation']
        : ['source', 'mechanical', 'semantic']
    exactKeys(branch, expected, name)
  }
}

function identity(source: GameIrDomainSourceEnvelope): Readonly<{
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
}> {
  return {
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    foundationReceiptDigest: source.compileRequest.foundation.receiptDigest,
    compileRequestDigest: digestGameIrValue(source.compileRequest),
    authoritySectionIndexDigest: digestGameIrValue(
      source.authoritySectionIndex,
    ),
  }
}

function sameIdentity(
  left: ReturnType<typeof identity>,
  right: ReturnType<typeof identity>,
): boolean {
  return canonicalGameIrJson(left) === canonicalGameIrJson(right)
}

function assertCrossSourceIdentity(
  phase4Authority: GameplayBalanceAssemblyAuthority,
  sources: readonly GameIrDomainSourceEnvelope[],
): void {
  const allSources = [
    phase4Authority.gameplay.source,
    phase4Authority.balance.source,
    ...sources,
  ]
  const expected = identity(allSources[0]!)
  for (const source of allSources.slice(1))
    if (!sameIdentity(expected, identity(source)))
      fail(
        'all modules must bind one task, revision, READY receipt, compile request, and authority index',
      )
}

type DomainManifest = Readonly<
  Record<
    string,
    Readonly<{
      relationships: Readonly<
        Record<string, Readonly<{ targetKinds: readonly string[] }>>
      >
      references?: Readonly<{ targetKinds: readonly string[] }>
    }>
  >
>

function externalTargetKinds(manifest: DomainManifest): ReadonlySet<string> {
  const localKinds = new Set(Object.keys(manifest))
  const targetKinds = new Set<string>()
  for (const descriptor of Object.values(manifest)) {
    for (const relationship of Object.values(descriptor.relationships))
      relationship.targetKinds.forEach(kind => targetKinds.add(kind))
    descriptor.references?.targetKinds.forEach(kind => targetKinds.add(kind))
  }
  return new Set([...targetKinds].filter(kind => !localKinds.has(kind)))
}

function targetMap(
  nodes: readonly GameIrNode[],
  manifest: DomainManifest,
  localNodes: readonly GameIrNode[],
): ReadonlyMap<string, GameIrNode> {
  const allowedKinds = externalTargetKinds(manifest)
  const localIds = new Set(localNodes.map(node => node.id))
  const seen = new Set<string>()
  return new Map(
    nodes
      .filter(node => {
        if (
          !allowedKinds.has(node.kind) ||
          localIds.has(node.id) ||
          seen.has(node.id)
        )
          return false
        seen.add(node.id)
        return true
      })
      .map(node => [node.id, node]),
  )
}

function assertDisjointIds(
  left: readonly GameIrNode[],
  right: readonly GameIrNode[],
  label: string,
): void {
  const ids = new Set(left.map(node => node.id))
  for (const node of right)
    if (ids.has(node.id))
      fail(`${label} has duplicate global node ID ${node.id}`)
}

function projection<
  T extends WorldSceneModuleProjection | PresentationModuleProjection,
>(body: Omit<T, 'projectionDigest'>): T {
  return Object.freeze({
    ...body,
    projectionDigest: digestGameIrValue(body),
  }) as T
}

function requirePass(
  result:
    | WorldSceneSemanticValidationResult
    | PresentationSemanticValidationResult,
): asserts result is Extract<typeof result, { outcome: 'PASS' }> {
  if (result.outcome !== 'PASS')
    fail(`semantic fidelity must be PASS, received ${result.outcome}`)
}

type PreparedWorld = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: WorldSceneSemanticReceipt
  bound: ReturnType<typeof replayAndBindPhase5SemanticReceipt>
  module: WorldSceneModuleProjection['module']
  packet: Phase5SemanticValidationPacket
}>

function prepareWorld(
  authority: WorldSceneValidationPreparationAuthority,
  parseModule: boolean,
): PreparedWorld {
  const source = validateGameIrDomainSourceEnvelope(authority.source)
  if (source.moduleId !== 'world-scene')
    fail('World validation preparation requires a world-scene source')
  const mechanical = authority.mechanical
  const semantic = authority.semantic
  const packet = buildWorldSceneSemanticPacket({ source, mechanical })
  const bound = replayAndBindPhase5SemanticReceipt({
    source,
    mechanical,
    packet,
    semantic,
  })
  assertDisjointIds(
    authority.phase4.gameplay.module.nodes,
    bound.module.nodes,
    'World/Gameplay',
  )
  assertDisjointIds(
    authority.phase4.balance.module.nodes,
    bound.module.nodes,
    'World/Balance',
  )
  const module = parseModule
    ? (parseWorldSceneModule(
        bound.module,
        targetMap(
          authority.phase4.gameplay.module.nodes,
          WORLD_SCENE_DOMAIN_MANIFEST,
          bound.module.nodes,
        ),
      ) as WorldSceneModuleProjection['module'])
    : (bound.module as WorldSceneModuleProjection['module'])
  return {
    source,
    mechanical,
    semantic,
    bound,
    module,
    packet: buildPhase5SemanticValidationPacket({
      source,
      mechanical,
      semantic,
      module,
      externalProjections: { gameplay: authority.phase4.gameplay },
    }),
  }
}

function makeWorldProjection(
  prepared: PreparedWorld,
  validation: WorldSceneSemanticValidationResult,
): WorldSceneModuleProjection {
  requirePass(validation)
  const body = {
    schemaVersion: 'game-ir-world-scene-module.v1' as const,
    taskId: prepared.source.taskId,
    foundationRevision:
      prepared.source.compileRequest.foundation.foundationRevision,
    module: prepared.module,
    sourceDigest: prepared.source.sourceDigest,
    mechanicalReceiptDigest: prepared.bound.mechanicalReceiptDigest,
    semanticReceiptDigest: prepared.bound.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(validation),
  }
  return projection<WorldSceneModuleProjection>(body)
}

type PreparedPresentation = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  semantic: PresentationSemanticReceipt
  bound: ReturnType<typeof replayAndBindPhase5SemanticReceipt>
  module: PresentationModuleProjection['module']
  packet: Phase5SemanticValidationPacket
}>

function preparePresentation(
  authority: PresentationValidationPreparationAuthority,
  world: WorldSceneModuleProjection,
  parseModule: boolean,
): PreparedPresentation {
  const source = validateGameIrDomainSourceEnvelope(
    authority.presentation.source,
  )
  if (source.moduleId !== 'presentation')
    fail('Presentation validation preparation requires a presentation source')
  const mechanical = authority.presentation.mechanical
  const semantic = authority.presentation.semantic
  const packet = buildPresentationSemanticPacket({ source, mechanical })
  const bound = replayAndBindPhase5SemanticReceipt({
    source,
    mechanical,
    packet,
    semantic,
  })
  assertDisjointIds(
    authority.phase4.gameplay.module.nodes,
    bound.module.nodes,
    'Presentation/Gameplay',
  )
  assertDisjointIds(
    authority.phase4.balance.module.nodes,
    bound.module.nodes,
    'Presentation/Balance',
  )
  assertDisjointIds(
    world.module.nodes,
    bound.module.nodes,
    'Presentation/World',
  )
  const module = parseModule
    ? (parsePresentationModule(
        bound.module,
        targetMap(
          [...authority.phase4.gameplay.module.nodes, ...world.module.nodes],
          PRESENTATION_DOMAIN_MANIFEST,
          bound.module.nodes,
        ),
      ) as PresentationModuleProjection['module'])
    : (bound.module as PresentationModuleProjection['module'])
  return {
    source,
    mechanical,
    semantic,
    bound,
    module,
    packet: buildPhase5SemanticValidationPacket({
      source,
      mechanical,
      semantic,
      module,
      externalProjections: {
        gameplay: authority.phase4.gameplay,
        worldScene: world,
      },
    }),
  }
}

function makePresentationProjection(
  prepared: PreparedPresentation,
  validation: PresentationSemanticValidationResult,
): PresentationModuleProjection {
  requirePass(validation)
  const body = {
    schemaVersion: 'game-ir-presentation-module.v1' as const,
    taskId: prepared.source.taskId,
    foundationRevision:
      prepared.source.compileRequest.foundation.foundationRevision,
    module: prepared.module,
    sourceDigest: prepared.source.sourceDigest,
    mechanicalReceiptDigest: prepared.bound.mechanicalReceiptDigest,
    semanticReceiptDigest: prepared.bound.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(validation),
  }
  return projection<PresentationModuleProjection>(body)
}

function exactWorldPreparationShape(
  authority: WorldSceneValidationPreparationAuthority,
): void {
  if (!isPlainRecord(authority))
    fail('World preparation authority must be an object')
  exactKeys(
    authority,
    ['source', 'mechanical', 'semantic', 'phase4'],
    'World preparation authority',
  )
}

function exactPresentationPreparationShape(
  authority: PresentationValidationPreparationAuthority,
): void {
  if (!isPlainRecord(authority))
    fail('Presentation preparation authority must be an object')
  exactKeys(
    authority,
    ['worldScene', 'presentation', 'phase4'],
    'Presentation preparation authority',
  )
  if (
    !isPlainRecord(authority.worldScene) ||
    !isPlainRecord(authority.presentation)
  )
    fail('Presentation preparation branches must be objects')
  exactKeys(
    authority.worldScene,
    ['source', 'mechanical', 'semantic', 'validation'],
    'Presentation worldScene authority',
  )
  exactKeys(
    authority.presentation,
    ['source', 'mechanical', 'semantic'],
    'Presentation authority',
  )
}

export function prepareWorldSceneSemanticValidationPacket(
  authority: WorldSceneValidationPreparationAuthority,
): Phase5SemanticValidationPacket {
  exactWorldPreparationShape(authority)
  return prepareWorld(authority, false).packet
}

export function preparePresentationSemanticValidationPacket(
  authority: PresentationValidationPreparationAuthority,
): Phase5SemanticValidationPacket {
  exactPresentationPreparationShape(authority)
  const worldAuthority: WorldSceneValidationPreparationAuthority = {
    source: authority.worldScene.source,
    mechanical: authority.worldScene.mechanical,
    semantic: authority.worldScene.semantic,
    phase4: authority.phase4,
  }
  const preparedWorld = prepareWorld(worldAuthority, false)
  const worldValidation = admitPhase5SemanticValidationResult(
    preparedWorld.packet,
    authority.worldScene.validation,
  )
  const world = makeWorldProjection(preparedWorld, worldValidation)
  return preparePresentation(authority, world, false).packet
}

export function assembleWorldPresentationClosure(
  authority: WorldPresentationAssemblyAuthority,
): WorldPresentationClosure {
  validateAuthorityShape(authority)

  const phase4 = assembleGameplayBalanceModules(authority.phase4Authority)
  const worldSource = validateGameIrDomainSourceEnvelope(
    authority.worldScene.source,
  )
  assertCrossSourceIdentity(authority.phase4Authority, [worldSource])
  const preparedWorld = prepareWorld(
    {
      source: worldSource,
      mechanical: authority.worldScene.mechanical,
      semantic: authority.worldScene.semantic,
      phase4,
    },
    true,
  )
  const worldValidation = admitPhase5SemanticValidationResult(
    preparedWorld.packet,
    authority.worldScene.validation,
  )
  const worldProjection = makeWorldProjection(preparedWorld, worldValidation)
  const presentationSource = validateGameIrDomainSourceEnvelope(
    authority.presentation.source,
  )
  assertCrossSourceIdentity(authority.phase4Authority, [
    worldSource,
    presentationSource,
  ])
  const preparedPresentation = preparePresentation(
    {
      phase4,
      worldScene: {
        source: worldSource,
        mechanical: authority.worldScene.mechanical,
        semantic: authority.worldScene.semantic,
        validation: worldValidation,
      },
      presentation: authority.presentation,
    },
    worldProjection,
    true,
  )
  const presentationValidation = admitPhase5SemanticValidationResult(
    preparedPresentation.packet,
    authority.presentation.validation,
  )
  const presentationProjectionValue = makePresentationProjection(
    preparedPresentation,
    presentationValidation,
  )

  const sourceIdentity = identity(worldSource)
  const body = {
    schemaVersion: 'game-ir-world-presentation-closure.v1' as const,
    taskId: sourceIdentity.taskId,
    foundationRevision: sourceIdentity.foundationRevision,
    foundationReceiptDigest: sourceIdentity.foundationReceiptDigest,
    compileRequestDigest: sourceIdentity.compileRequestDigest,
    authoritySectionIndexDigest: sourceIdentity.authoritySectionIndexDigest,
    phase4,
    worldScene: worldProjection,
    presentation: presentationProjectionValue,
  } as const
  return Object.freeze({ ...body, closureDigest: digestGameIrValue(body) })
}
