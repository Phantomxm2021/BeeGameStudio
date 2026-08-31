import {
  admitGameIrDomainSemanticResult,
  admitGameIrMechanicalProjectionReceipt,
  buildGameIrDomainSemanticPacket,
  normalizeGameIrDomainSemanticPacket,
  normalizeGameIrDomainSemanticReceipt,
  gameIrSemanticTargetPointers,
  type GameIrDomainSemanticDiagnostic,
  type GameIrDomainSemanticPacket,
  type GameIrDomainSemanticReceipt,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
  type GameIrSourceBinding,
} from './model'
import {
  createSemanticFidelityPrimitives,
  verifyGameIrSemanticClaimBytes,
} from './semantic-fidelity'
import {
  IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
  parseImplementationVerificationModule,
} from './implementation-verification-schema'

const ERROR_PREFIX = 'invalid Implementation/Verification producer'
const fidelity = createSemanticFidelityPrimitives(ERROR_PREFIX)
const { exactKeys, deepFreeze } = fidelity

const NODE_KINDS = Object.freeze(
  Object.keys(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST).sort(
    compareCodeUnits,
  ),
)
const RELATIONSHIP_TYPES = Object.freeze(
  [
    ...new Set(
      Object.values(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST).flatMap(
        descriptor => Object.keys(descriptor.relationships),
      ),
    ),
  ].sort(compareCodeUnits),
)

export type ImplementationVerificationSemanticProjectionPacket =
  GameIrDomainSemanticPacket &
    Readonly<{ moduleId: 'implementation-verification' }>

export type ImplementationVerificationSemanticProjectionAuthority = Readonly<{
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}>

export type ImplementationVerificationSemanticReceipt =
  GameIrDomainSemanticReceipt &
    Readonly<{ moduleId: 'implementation-verification' }>

export type ImplementationVerificationSemanticResult =
  | ImplementationVerificationSemanticReceipt
  | GameIrDomainSemanticDiagnostic

export type ImplementationVerificationModulePreparation = Readonly<{
  source: GameIrDomainSourceEnvelope
  module: GameIrModuleCandidate &
    Readonly<{ moduleId: 'implementation-verification' }>
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
}>

function fail(message: string): never {
  throw new Error(`${ERROR_PREFIX}: ${message}`)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype ||
      Object.getPrototypeOf(value) === null)
  )
}

function validateAuthority(
  value: unknown,
): asserts value is ImplementationVerificationSemanticProjectionAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(value, ['source', 'mechanical'], 'authority')
  const source = validateGameIrDomainSourceEnvelope(value.source)
  if (source.moduleId !== 'implementation-verification')
    fail('source moduleId must be implementation-verification')
  admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: value.mechanical,
  })
}

function validatedAuthority(
  value: ImplementationVerificationSemanticProjectionAuthority,
): {
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
} {
  validateAuthority(value)
  const source = validateGameIrDomainSourceEnvelope(value.source)
  const mechanical = admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: value.mechanical,
  })
  return { source, mechanical }
}

function buildPacketFromAuthority(
  authority: ImplementationVerificationSemanticProjectionAuthority,
): ImplementationVerificationSemanticProjectionPacket {
  const { source, mechanical } = validatedAuthority(authority)
  return deepFreeze(
    buildGameIrDomainSemanticPacket({
      source,
      mechanical,
      allowedNodeKinds: NODE_KINDS,
      allowedRelationshipTypes: RELATIONSHIP_TYPES,
    }),
  ) as ImplementationVerificationSemanticProjectionPacket
}

export function buildImplementationVerificationSemanticPacket(
  input: ImplementationVerificationSemanticProjectionAuthority,
): ImplementationVerificationSemanticProjectionPacket {
  return buildPacketFromAuthority(input)
}

function canonicalPacket(
  authority: ImplementationVerificationSemanticProjectionAuthority,
  packet: unknown,
): ImplementationVerificationSemanticProjectionPacket {
  const expected = buildPacketFromAuthority(authority)
  const normalized = normalizeGameIrDomainSemanticPacket(
    packet as GameIrDomainSemanticPacket,
    {
      errorPrefix: ERROR_PREFIX,
      allowedModuleIds: ['implementation-verification'],
    },
  )
  if (canonicalGameIrJson(expected) !== canonicalGameIrJson(normalized))
    fail('semantic packet is stale, relabeled, or detached from authority')
  return normalized as ImplementationVerificationSemanticProjectionPacket
}

function verifySourceClaims(
  source: GameIrDomainSourceEnvelope,
  result: ImplementationVerificationSemanticReceipt,
): void {
  for (const claim of result.sourceClaims)
    verifyGameIrSemanticClaimBytes(
      {
        sectionIndex: source.sectionIndex,
        sectionBytes: source.sectionBytes,
      },
      claim,
      ERROR_PREFIX,
    )
}

export function admitImplementationVerificationSemanticResult(
  authority: ImplementationVerificationSemanticProjectionAuthority,
  packet: ImplementationVerificationSemanticProjectionPacket,
  value: unknown,
): ImplementationVerificationSemanticResult {
  const expectedPacket = canonicalPacket(authority, packet)
  const { source } = validatedAuthority(authority)
  const result = admitGameIrDomainSemanticResult(expectedPacket, value, {
    errorPrefix: ERROR_PREFIX,
    allowedModuleIds: ['implementation-verification'],
    receiptAuthorityDigest: expectedPacket.packetDigest,
  })
  if (result.outcome === 'PROJECTED')
    verifySourceClaims(
      source,
      result as ImplementationVerificationSemanticReceipt,
    )
  return result as ImplementationVerificationSemanticResult
}

export function replayImplementationVerificationSemanticReceipt(
  authority: ImplementationVerificationSemanticProjectionAuthority,
  packet: ImplementationVerificationSemanticProjectionPacket,
  receipt: unknown,
): ImplementationVerificationSemanticReceipt {
  const expectedPacket = canonicalPacket(authority, packet)
  const { source } = validatedAuthority(authority)
  const replayed = normalizeGameIrDomainSemanticReceipt(
    expectedPacket,
    receipt,
    {
      errorPrefix: ERROR_PREFIX,
      allowedModuleIds: ['implementation-verification'],
      receiptAuthorityDigest: expectedPacket.packetDigest,
    },
  ) as ImplementationVerificationSemanticReceipt
  verifySourceClaims(source, replayed)
  return replayed
}

export function replayImplementationVerificationSemanticResult(
  authority: ImplementationVerificationSemanticProjectionAuthority,
  packet: ImplementationVerificationSemanticProjectionPacket,
  result: unknown,
): ImplementationVerificationSemanticResult {
  const expectedPacket = canonicalPacket(authority, packet)
  if (!isRecord(result)) fail('semantic result must be a plain object')
  if (result.outcome === 'PROJECTED')
    return replayImplementationVerificationSemanticReceipt(
      authority,
      expectedPacket,
      result,
    )
  if (result.outcome !== 'FAIL' && result.outcome !== 'AMBIGUOUS')
    fail('semantic result outcome is invalid')
  exactKeys(
    result,
    [
      'schemaVersion',
      'outcome',
      'taskId',
      'moduleId',
      'foundationRevision',
      'sourceDigest',
      'mechanicalReceiptDigest',
      'packetDigest',
      'reasonCode',
      'actual',
      'missingSubject',
      'expectedProjection',
      'evidencePointers',
      'diagnosticDigest',
    ],
    'semantic diagnostic',
  )
  const diagnosticBody = {
    outcome: result.outcome,
    reasonCode: result.reasonCode,
    actual: result.actual,
    missingSubject: result.missingSubject,
    expectedProjection: result.expectedProjection,
    evidencePointers: result.evidencePointers,
  }
  const admitted = admitImplementationVerificationSemanticResult(
    authority,
    expectedPacket,
    diagnosticBody,
  )
  if (canonicalGameIrJson(admitted) !== canonicalGameIrJson(result))
    fail('semantic diagnostic is stale or detached from authority')
  return admitted
}

function bindSemanticNodes(
  source: GameIrDomainSourceEnvelope,
  semantic: ImplementationVerificationSemanticReceipt,
): readonly GameIrNode[] {
  const claims = new Map(
    semantic.sourceClaims.map(claim => [claim.subject, claim]),
  )
  const sections = new Map(
    source.sectionIndex.map(section => [
      `${section.documentPath}#${section.sectionId}`,
      section,
    ]),
  )
  return semantic.nodes.map(node => {
    const bindings: Record<string, GameIrSourceBinding> = {}
    for (const subject of gameIrSemanticTargetPointers([node])) {
      const pointer = subject.slice(`node:${node.id}#`.length)
      const claim = claims.get(subject)
      if (!claim) fail(`semantic source claim is missing for ${subject}`)
      const section = sections.get(`${claim.documentPath}#${claim.sectionId}`)
      if (!section)
        fail(`semantic source claim is outside exact source closure`)
      bindings[pointer] = {
        kind: 'owner',
        documentPath: claim.documentPath,
        sectionId: claim.sectionId,
        sectionDigest: section.digest,
        sourcePointer: claim.sourcePointer,
      }
    }
    return { ...node, producerMode: 'semantic' as const, bindings }
  })
}

export function prepareImplementationVerificationModule(
  input: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ImplementationVerificationSemanticReceipt
    priorModules: readonly unknown[]
  }>,
): ImplementationVerificationModulePreparation {
  if (!isRecord(input)) fail('module preparation input must be a plain object')
  exactKeys(
    input,
    ['source', 'mechanical', 'semantic', 'priorModules'],
    'module preparation input',
  )
  const authority = {
    source: input.source,
    mechanical: input.mechanical,
  } as ImplementationVerificationSemanticProjectionAuthority
  const { source, mechanical } = validatedAuthority(authority)
  const packet = buildPacketFromAuthority(authority)
  const semantic = replayImplementationVerificationSemanticReceipt(
    authority,
    packet,
    input.semantic,
  )
  const nodes = bindSemanticNodes(source, semantic)
  const module = parseImplementationVerificationModule(
    { moduleId: 'implementation-verification', nodes },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
      priorModules: input.priorModules,
    },
  )
  return deepFreeze({
    source,
    module: module as ImplementationVerificationModulePreparation['module'],
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
  })
}
