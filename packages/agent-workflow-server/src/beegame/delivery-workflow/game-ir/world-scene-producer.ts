import {
  buildGameIrDomainSemanticPacket,
  type GameIrDomainSemanticDiagnostic,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitPhase5SemanticResult,
  type Phase5SemanticReceipt,
} from './phase5-admission'
import { canonicalGameIrJson, compareCodeUnits } from './model'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'
import {
  assembleGameplayBalanceModules,
  type GameplayBalanceAssemblyAuthority,
} from './gameplay-balance-assembler'
import {
  deriveOperationTargets,
  buildDomainProjectionEnvelope,
  normalizeDomainProjectionEnvelope,
  operationExactKeys,
  operationIsRecord,
  operationTargets,
  emptyOperationMechanicalReceipt,
  type DomainProjectionEnvelope,
  type OperationTarget,
} from './operation-packet-primitives'
import { digestGameIrValue } from './model'

export type WorldSceneProjectionOperationPacket = DomainProjectionEnvelope<
  WorldSceneProjectionOperationDependencies,
  GameIrDomainSemanticPacket,
  'game-ir-world-scene-projection-operation-packet.v1'
>
export type WorldSceneProjectionOperationDependencies = Readonly<{
  phase4ClosureDigest: string
  priorTargets: readonly OperationTarget[]
}>

export type WorldSceneProjectionOperationInput = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
  phase4Authority: GameplayBalanceAssemblyAuthority
}>

function worldExternalTargetKinds(): ReadonlySet<string> {
  const localKinds = new Set(Object.keys(WORLD_SCENE_DOMAIN_MANIFEST))
  const kinds = new Set<string>()
  for (const descriptor of Object.values(WORLD_SCENE_DOMAIN_MANIFEST))
    for (const relationship of Object.values(descriptor.relationships))
      for (const kind of relationship.targetKinds)
        if (!localKinds.has(kind)) kinds.add(kind)
  return kinds
}

function worldPriorTargets(
  closure: ReturnType<typeof assembleGameplayBalanceModules>,
): readonly OperationTarget[] {
  const allowed = worldExternalTargetKinds()
  return deriveOperationTargets(
    [...closure.gameplay.module.nodes, ...closure.balance.module.nodes]
      .filter(node => allowed.has(node.kind))
      .map(node => ({ id: node.id, kind: node.kind })),
    'World/Scene operation priorTargets',
  )
}

function worldOperationIdentity(
  source: GameIrDomainSourceEnvelope,
  phase4Authority: GameplayBalanceAssemblyAuthority,
): void {
  const expectedSources = [
    phase4Authority.gameplay.source,
    phase4Authority.balance.source,
  ]
  for (const expected of expectedSources)
    if (
      source.taskId !== expected.taskId ||
      source.compileRequest.foundation.foundationRevision !==
        expected.compileRequest.foundation.foundationRevision ||
      source.compileRequest.foundation.receiptDigest !==
        expected.compileRequest.foundation.receiptDigest ||
      digestGameIrValue(source.compileRequest) !==
        digestGameIrValue(expected.compileRequest) ||
      digestGameIrValue(source.authoritySectionIndex) !==
        digestGameIrValue(expected.authoritySectionIndex)
    )
      throw new Error(
        'World/Scene operation source is detached from Phase 4 authority',
      )
}

function worldOperationDependencies(
  phase4Authority: GameplayBalanceAssemblyAuthority,
): WorldSceneProjectionOperationDependencies {
  const closure = assembleGameplayBalanceModules(phase4Authority)
  return {
    phase4ClosureDigest: digestGameIrValue(closure),
    priorTargets: worldPriorTargets(closure),
  }
}

export function buildWorldSceneProjectionOperationPacket(
  input: WorldSceneProjectionOperationInput,
): WorldSceneProjectionOperationPacket {
  if (!operationIsRecord(input))
    throw new Error('invalid World/Scene operation input')
  operationExactKeys(
    input,
    ['source', 'mechanical', 'phase4Authority'],
    'World/Scene operation input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'world-scene')
    throw new Error('invalid World/Scene operation source module')
  worldOperationIdentity(source, input.phase4Authority)
  const dependencies = worldOperationDependencies(input.phase4Authority)
  const semanticPacket = buildWorldSceneSemanticPacket({
    source,
    mechanical: input.mechanical,
  })
  return buildDomainProjectionEnvelope({
    schemaVersion: 'game-ir-world-scene-projection-operation-packet.v1',
    moduleId: 'world-scene',
    source,
    semanticPacket,
    dependencies,
  })
}

export function normalizeWorldSceneProjectionOperationPacket(
  value: unknown,
  phase4Authority: GameplayBalanceAssemblyAuthority,
): WorldSceneProjectionOperationPacket {
  const normalized = normalizeDomainProjectionEnvelope(value, {
    schemaVersion: 'game-ir-world-scene-projection-operation-packet.v1',
    moduleId: 'world-scene',
    label: 'World/Scene operation packet',
    parseDependencies: dependency => {
      if (!operationIsRecord(dependency))
        throw new Error('World/Scene operation dependencies must be an object')
      operationExactKeys(
        dependency,
        ['phase4ClosureDigest', 'priorTargets'],
        'World/Scene operation dependencies',
      )
      if (
        typeof dependency.phase4ClosureDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(dependency.phase4ClosureDigest)
      )
        throw new Error(
          'World/Scene operation phase4 closure digest is invalid',
        )
      return {
        phase4ClosureDigest: dependency.phase4ClosureDigest,
        priorTargets: operationTargets(
          dependency.priorTargets,
          'World/Scene operation priorTargets',
        ),
      }
    },
  })
  worldOperationIdentity(normalized.source, phase4Authority)
  const expectedSemanticPacket = buildWorldSceneSemanticPacket({
    source: normalized.source,
    mechanical: emptyOperationMechanicalReceipt(normalized.source),
  })
  if (
    canonicalGameIrJson(normalized.semanticPacket) !==
    canonicalGameIrJson(expectedSemanticPacket)
  )
    throw new Error(
      'World/Scene operation semantic packet is stale or detached',
    )
  const expectedDependencies = worldOperationDependencies(phase4Authority)
  if (
    canonicalGameIrJson(normalized.dependencies) !==
    canonicalGameIrJson(expectedDependencies)
  )
    throw new Error('World/Scene operation dependencies are stale or detached')
  return normalized
}

export type WorldSceneSemanticReceipt = Phase5SemanticReceipt &
  Readonly<{ moduleId: 'world-scene' }>
export type WorldSceneSemanticResult =
  | WorldSceneSemanticReceipt
  | GameIrDomainSemanticDiagnostic

function manifestNodeKinds(): readonly string[] {
  return Object.freeze(
    Object.keys(WORLD_SCENE_DOMAIN_MANIFEST).sort(compareCodeUnits),
  )
}

function manifestRelationshipTypes(): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.values(WORLD_SCENE_DOMAIN_MANIFEST).flatMap(entry =>
          Object.keys(entry.relationships),
        ),
      ),
    ].sort(compareCodeUnits),
  )
}

export function buildWorldSceneSemanticPacket(
  input: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
  }>,
): GameIrDomainSemanticPacket {
  if (input.source.moduleId !== 'world-scene')
    throw new Error('invalid World/Scene semantic source module')
  return buildGameIrDomainSemanticPacket({
    source: input.source,
    mechanical: input.mechanical,
    allowedNodeKinds: manifestNodeKinds(),
    allowedRelationshipTypes: manifestRelationshipTypes(),
  })
}

export function admitWorldSceneSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): WorldSceneSemanticResult {
  const result = admitPhase5SemanticResult(packet, value)
  if (result.moduleId !== 'world-scene')
    throw new Error('invalid World/Scene semantic result module')
  const nodeKinds = manifestNodeKinds()
  const relationshipTypes = manifestRelationshipTypes()
  if (
    packet.allowedNodeKinds.length !== nodeKinds.length ||
    packet.allowedNodeKinds.some((kind, index) => kind !== nodeKinds[index]) ||
    packet.allowedRelationshipTypes.length !== relationshipTypes.length ||
    packet.allowedRelationshipTypes.some(
      (relationship, index) => relationship !== relationshipTypes[index],
    )
  )
    throw new Error('invalid World/Scene semantic packet manifest identity')
  if (result.outcome === 'PROJECTED') {
    for (const node of result.nodes) {
      if (!nodeKinds.includes(node.kind))
        throw new Error('invalid World/Scene semantic result node kind')
      for (const edge of node.edges)
        if (!relationshipTypes.includes(edge.type))
          throw new Error('invalid World/Scene semantic result relationship')
    }
  }
  return result as WorldSceneSemanticResult
}
