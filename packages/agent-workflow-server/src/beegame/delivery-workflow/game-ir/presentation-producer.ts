import type {
  GameIrDomainSemanticDiagnostic,
  GameIrDomainSemanticPacket,
  GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import { buildGameIrDomainSemanticPacket } from './domain-projection'
import type { GameIrDomainSourceEnvelope } from './domain-source'
import {
  admitPhase5SemanticResult,
  type Phase5SemanticReceipt,
} from './phase5-admission'
import { compareCodeUnits } from './model'
import { PRESENTATION_DOMAIN_MANIFEST } from './presentation-schema'

export type PresentationSemanticReceipt = Phase5SemanticReceipt &
  Readonly<{ moduleId: 'presentation' }>
export type PresentationSemanticResult =
  | PresentationSemanticReceipt
  | GameIrDomainSemanticDiagnostic

function manifestNodeKinds(): readonly string[] {
  return Object.freeze(
    Object.keys(PRESENTATION_DOMAIN_MANIFEST).sort(compareCodeUnits),
  )
}

function manifestRelationshipTypes(): readonly string[] {
  return Object.freeze(
    [
      ...new Set(
        Object.values(PRESENTATION_DOMAIN_MANIFEST).flatMap(entry =>
          Object.keys(entry.relationships),
        ),
      ),
    ].sort(compareCodeUnits),
  )
}

export function buildPresentationSemanticPacket(
  input: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
  }>,
): GameIrDomainSemanticPacket {
  if (input.source.moduleId !== 'presentation')
    throw new Error('invalid Presentation semantic source module')
  return buildGameIrDomainSemanticPacket({
    source: input.source,
    mechanical: input.mechanical,
    allowedNodeKinds: manifestNodeKinds(),
    allowedRelationshipTypes: manifestRelationshipTypes(),
  })
}

export function admitPresentationSemanticResult(
  packet: GameIrDomainSemanticPacket,
  value: unknown,
): PresentationSemanticResult {
  const result = admitPhase5SemanticResult(packet, value)
  if (result.moduleId !== 'presentation')
    throw new Error('invalid Presentation semantic result module')
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
    throw new Error('invalid Presentation semantic packet manifest identity')
  if (result.outcome === 'PROJECTED') {
    for (const node of result.nodes) {
      if (!nodeKinds.includes(node.kind))
        throw new Error('invalid Presentation semantic result node kind')
      for (const edge of node.edges)
        if (!relationshipTypes.includes(edge.type))
          throw new Error('invalid Presentation semantic result relationship')
    }
  }
  return result as PresentationSemanticResult
}
