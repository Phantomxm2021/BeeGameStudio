import {
  buildGameIrDomainSemanticPacket,
  type GameIrDomainSemanticDiagnostic,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import type { GameIrDomainSourceEnvelope } from './domain-source'
import {
  admitPhase5SemanticResult,
  type Phase5SemanticReceipt,
} from './phase5-admission'
import { compareCodeUnits } from './model'
import { WORLD_SCENE_DOMAIN_MANIFEST } from './world-scene-schema'

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
  return result as WorldSceneSemanticResult
}
