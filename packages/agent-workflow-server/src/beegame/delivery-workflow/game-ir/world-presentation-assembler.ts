import {
  assembleGameplayBalanceModules,
  type GameplayBalanceAssemblyAuthority,
  type GameplayBalanceModulePair,
} from './gameplay-balance-assembler'
import {
  buildPhase5SemanticValidationPacket,
  admitPhase5SemanticValidationResult,
  replayAndBindPhase5SemanticReceipt,
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
import { parseWorldSceneModule } from './world-scene-schema'
import { parsePresentationModule } from './presentation-schema'

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

function targetMap(
  nodes: readonly GameIrNode[],
): ReadonlyMap<string, GameIrNode> {
  return new Map(nodes.map(node => [node.id, node]))
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

export function assembleWorldPresentationClosure(
  authority: WorldPresentationAssemblyAuthority,
): WorldPresentationClosure {
  validateAuthorityShape(authority)

  const phase4 = assembleGameplayBalanceModules(authority.phase4Authority)
  const worldSource = validateGameIrDomainSourceEnvelope(
    authority.worldScene.source,
  )
  assertCrossSourceIdentity(authority.phase4Authority, [worldSource])

  const worldPacket = buildWorldSceneSemanticPacket({
    source: worldSource,
    mechanical: authority.worldScene.mechanical,
  })
  const boundWorld = replayAndBindPhase5SemanticReceipt({
    source: worldSource,
    mechanical: authority.worldScene.mechanical,
    packet: worldPacket,
    semantic: authority.worldScene.semantic,
  })
  assertDisjointIds(
    phase4.gameplay.module.nodes,
    boundWorld.module.nodes,
    'World/Gameplay',
  )
  assertDisjointIds(
    phase4.balance.module.nodes,
    boundWorld.module.nodes,
    'World/Balance',
  )
  const worldModule = parseWorldSceneModule(
    boundWorld.module,
    targetMap(phase4.gameplay.module.nodes),
  ) as WorldSceneModuleProjection['module']
  const worldValidationPacket = buildPhase5SemanticValidationPacket({
    source: worldSource,
    mechanical: authority.worldScene.mechanical,
    semantic: authority.worldScene.semantic,
    module: worldModule,
    externalProjections: { gameplay: phase4.gameplay },
  })
  const worldValidation = admitPhase5SemanticValidationResult(
    worldValidationPacket,
    authority.worldScene.validation,
  )
  requirePass(worldValidation)
  const worldProjection = projection<WorldSceneModuleProjection>({
    schemaVersion: 'game-ir-world-scene-module.v1',
    taskId: worldSource.taskId,
    foundationRevision:
      worldSource.compileRequest.foundation.foundationRevision,
    module: worldModule,
    sourceDigest: worldSource.sourceDigest,
    mechanicalReceiptDigest: boundWorld.mechanicalReceiptDigest,
    semanticReceiptDigest: boundWorld.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(worldValidation),
  })

  const presentationSource = validateGameIrDomainSourceEnvelope(
    authority.presentation.source,
  )
  assertCrossSourceIdentity(authority.phase4Authority, [
    worldSource,
    presentationSource,
  ])

  const presentationPacket = buildPresentationSemanticPacket({
    source: presentationSource,
    mechanical: authority.presentation.mechanical,
  })
  const boundPresentation = replayAndBindPhase5SemanticReceipt({
    source: presentationSource,
    mechanical: authority.presentation.mechanical,
    packet: presentationPacket,
    semantic: authority.presentation.semantic,
  })
  assertDisjointIds(
    phase4.gameplay.module.nodes,
    boundPresentation.module.nodes,
    'Presentation/Gameplay',
  )
  assertDisjointIds(
    phase4.balance.module.nodes,
    boundPresentation.module.nodes,
    'Presentation/Balance',
  )
  assertDisjointIds(
    worldProjection.module.nodes,
    boundPresentation.module.nodes,
    'Presentation/World',
  )
  const presentationModule = parsePresentationModule(
    boundPresentation.module,
    targetMap([
      ...phase4.gameplay.module.nodes,
      ...worldProjection.module.nodes,
    ]),
  ) as PresentationModuleProjection['module']
  const presentationValidationPacket = buildPhase5SemanticValidationPacket({
    source: presentationSource,
    mechanical: authority.presentation.mechanical,
    semantic: authority.presentation.semantic,
    module: presentationModule,
    externalProjections: {
      gameplay: phase4.gameplay,
      worldScene: worldProjection,
    },
  })
  const presentationValidation = admitPhase5SemanticValidationResult(
    presentationValidationPacket,
    authority.presentation.validation,
  )
  requirePass(presentationValidation)
  const presentationProjection = projection<PresentationModuleProjection>({
    schemaVersion: 'game-ir-presentation-module.v1',
    taskId: presentationSource.taskId,
    foundationRevision:
      presentationSource.compileRequest.foundation.foundationRevision,
    module: presentationModule,
    sourceDigest: presentationSource.sourceDigest,
    mechanicalReceiptDigest: boundPresentation.mechanicalReceiptDigest,
    semanticReceiptDigest: boundPresentation.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(presentationValidation),
  })

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
    presentation: presentationProjection,
  } as const
  return Object.freeze({ ...body, closureDigest: digestGameIrValue(body) })
}
