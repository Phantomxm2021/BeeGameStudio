import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import { readSecureWorkspaceFile } from '../secure-file'
import {
  compareCodeUnits,
  digestGameIrSourceSectionIndex,
  digestGameIrValue,
} from './model'
import {
  buildGameIrDomainSourceEnvelope,
  GAME_IR_MODULE_SOURCE_DOCUMENTS,
  type GameIrDomainId,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import {
  admitGameIrMechanicalProjectionReceipt,
  type GameIrDomainSemanticPacket,
  type GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import {
  GAME_IR_PROTOCOL_STEPS,
  type GameIrCheckpointLoad,
  type GameIrCheckpointRecord,
  type GameIrProtocolStep,
} from './stage-checkpoint'
import {
  buildGameplayProjectionOperationPacket,
  admitGameplaySemanticResult,
  normalizeGameplayProjectionOperationPacket,
  prepareGameplayModule,
  type GameplaySemanticResult,
} from './gameplay-producer'
import {
  buildBalanceProjectionOperationPacket,
  admitBalanceSemanticResult,
  normalizeBalanceProjectionOperationPacket,
  type BalanceSemanticResult,
} from './balance-producer'
import {
  buildWorldSceneProjectionOperationPacket,
  buildWorldSceneSemanticPacket,
  admitWorldSceneSemanticResult,
  normalizeWorldSceneProjectionOperationPacket,
  type WorldSceneSemanticResult,
} from './world-scene-producer'
import {
  admitPresentationSemanticResult,
  type PresentationSemanticResult,
} from './presentation-producer'
import { normalizePresentationProjectionOperationPacket } from './world-presentation-assembler'
import {
  buildResourceRealizationProjectionOperationPacket,
  prepareResourceRealizationSemanticProjectionPacket,
  admitResourceRealizationSemanticResult,
  normalizeResourceRealizationProjectionOperationPacket,
  type ResourceRealizationSemanticProjectionAuthority,
  type ResourceRealizationSemanticResult,
} from './resource-realization-producer'
import { admitPhase5SemanticValidationResult } from './phase5-admission'
import type { Phase5SemanticValidationPacket } from './phase5-admission'
import {
  prepareWorldSceneSemanticValidationPacket,
  preparePresentationSemanticValidationPacket,
} from './world-presentation-assembler'
import {
  prepareResourceRealizationSemanticValidationPacket,
  admitResourceRealizationSemanticValidationResult,
  type ResourceRealizationSemanticValidationPacket,
  type ResourceRealizationValidationPreparationAuthority,
} from './phase6-admission'
import {
  buildImplementationVerificationSemanticPacket,
  admitImplementationVerificationSemanticResult,
} from './implementation-verification-producer'
import {
  prepareImplementationVerificationSemanticValidationPacket,
  admitImplementationVerificationSemanticValidationResult,
  type ImplementationVerificationSemanticValidationPacket,
  type ImplementationVerificationValidationPreparationAuthority,
} from './phase7-admission'
import {
  assembleGameplayBalanceModules,
  type GameplayBalanceAssemblyAuthority,
} from './gameplay-balance-assembler'
import {
  assembleWorldPresentationClosure,
  buildPresentationProjectionOperationPacket,
  type WorldPresentationAssemblyAuthority,
} from './world-presentation-assembler'
import {
  assembleResourceRealizationClosure,
  type ResourceRealizationAssemblyAuthority,
} from './resource-realization-assembler'
import {
  assembleImplementationVerificationClosure,
  buildImplementationVerificationProjectionOperationPacket,
  normalizeImplementationVerificationProjectionOperationPacket,
  type ImplementationVerificationAssemblyAuthority,
} from './implementation-verification-assembler'
import type { FoundationReadyReceipt, GameIrCompileRequest } from './contracts'
import {
  GameIrProjectionSliceJournal,
  type GameIrProjectionOperationPacket,
} from './projection-slice-journal'
import type { GameIrDomainSemanticResult } from './domain-projection'
import {
  deriveGameIrSemanticSourceClaims,
  type GameIrSemanticCandidateNode,
  type GameIrSourceEvidenceGroup,
} from './semantic-fidelity'
import { deriveProjectionSlicePlan } from './projection-slices'

export const GAME_IR_STAGED_OPERATIONS = Object.freeze(
  GAME_IR_PROTOCOL_STEPS.map(step => {
    const [phase, domain, operation] = step.split('/') as [
      'phase4' | 'phase5' | 'phase6' | 'phase7',
      GameIrDomainId,
      'projection' | 'validation',
    ]
    return Object.freeze({ step, phase, domain, operation })
  }),
)
export type GameIrStagedOperation = (typeof GAME_IR_STAGED_OPERATIONS)[number]

export function nextGameIrOperation(
  load?: Pick<GameIrCheckpointLoad, 'nextStep'>,
): GameIrStagedOperation | undefined {
  const step = load?.nextStep ?? GAME_IR_PROTOCOL_STEPS[0]
  return GAME_IR_STAGED_OPERATIONS.find(operation => operation.step === step)
}

export function stagedCompilerContract(input: {
  operation: GameIrStagedOperation
  packet: unknown
  correctionDiagnostic?: Readonly<{
    step: string
    reason: string
  }>
}): Record<string, unknown> {
  return {
    kind: input.operation.operation,
    packet: input.packet,
    ...(input.operation.operation === 'validation' && input.correctionDiagnostic
      ? { correctionDiagnostic: input.correctionDiagnostic }
      : {}),
  }
}

function sameDocumentDigests(
  left: readonly { path: string; digest: string }[],
  right: readonly { path: string; digest: string }[],
): boolean {
  return (
    JSON.stringify([...left].sort((a, b) => a.path.localeCompare(b.path))) ===
    JSON.stringify([...right].sort((a, b) => a.path.localeCompare(b.path)))
  )
}

export async function buildGameIrSourcePacket(input: {
  workspacePath: string
  request: GameIrCompileRequest
  receipt: FoundationReadyReceipt
  domain: GameIrDomainId
}): Promise<GameIrDomainSourceEnvelope> {
  const workspace = resolve(input.workspacePath)
  const sectionArtifact = JSON.parse(
    await readSecureWorkspaceFile(workspace, input.receipt.sectionIndexPath),
  ) as {
    revision?: unknown
    documentDigests?: unknown
    sections?: unknown
    digest?: unknown
  }
  const documentDigests = Array.isArray(sectionArtifact.documentDigests)
    ? sectionArtifact.documentDigests
    : []
  const expectedDocumentDigests = CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
    path,
    digest: input.receipt.documentDigests[path],
  }))
  if (
    Object.keys(sectionArtifact).sort().join('\0') !==
      'digest\0documentDigests\0revision\0sections' ||
    sectionArtifact.revision !== input.receipt.foundationRevision ||
    !Array.isArray(sectionArtifact.sections) ||
    sectionArtifact.digest !== input.receipt.sectionIndexDigest ||
    documentDigests.length !== expectedDocumentDigests.length ||
    !sameDocumentDigests(
      documentDigests as Array<{ path: string; digest: string }>,
      expectedDocumentDigests,
    )
  )
    throw new Error('Foundation READY Section Index artifact is invalid')
  const sectionIndex =
    sectionArtifact.sections as readonly import('../foundation-section-index').SectionRef[]
  if (
    sectionIndex.length === 0 ||
    digestGameIrSourceSectionIndex(sectionIndex) !==
      input.receipt.sectionIndexDigest
  )
    throw new Error('Foundation READY Section Index digest mismatch')
  const allowed = GAME_IR_MODULE_SOURCE_DOCUMENTS[input.domain]
  const documents = new Map(
    await Promise.all(
      [...new Set(allowed)].map(async path => {
        const bytes = await readSecureWorkspaceFile(workspace, path)
        if (
          createHash('sha256').update(bytes, 'utf8').digest('hex') !==
          input.receipt.documentDigests[path]
        )
          throw new Error(`Foundation READY document digest mismatch: ${path}`)
        return [path, bytes] as const
      }),
    ),
  )
  const bytes = Object.fromEntries(
    sectionIndex
      .filter(section => allowed.includes(section.documentPath))
      .map(section => [
        `${section.documentPath}#${section.sectionId}`,
        documents
          .get(section.documentPath)!
          .split('\n')
          .slice(section.startLine - 1, section.endLine)
          .join('\n'),
      ]),
  )
  return buildGameIrDomainSourceEnvelope({
    moduleId: input.domain,
    request: input.request,
    sectionIndex,
    sectionBytes: bytes,
  })
}

function emptyMechanical(
  source: GameIrDomainSourceEnvelope,
): GameIrMechanicalProjectionReceipt {
  const body = {
    schemaVersion: 'game-ir-mechanical-projection-receipt.v1' as const,
    taskId: source.taskId,
    moduleId: source.moduleId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    sourceDigest: source.sourceDigest,
    nodes: Object.freeze([]),
    verifiedClaims: Object.freeze([]),
    ownedTargets: Object.freeze([]),
  }
  return admitGameIrMechanicalProjectionReceipt({
    source,
    receipt: { ...body, receiptDigest: digestGameIrValue(body) },
  })
}

export type GameIrStagedRecords = ReadonlyMap<
  GameIrCheckpointRecord['kind'],
  unknown
>
type Records = GameIrStagedRecords
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
const get = <T>(records: Records, kind: GameIrCheckpointRecord['kind']): T => {
  const value = records.get(kind)
  if (value === undefined) throw new Error(`missing ${kind}`)
  return value as T
}
function gameplayAuthority(
  records: Records,
): GameplayBalanceAssemblyAuthority['gameplay'] {
  return {
    source: get(records, 'phase4/gameplay/source'),
    mechanical: get(records, 'phase4/gameplay/mechanical'),
    semantic: get(records, 'phase4/gameplay/semantic'),
  }
}
function phase4(records: Records): GameplayBalanceAssemblyAuthority {
  return {
    gameplay: gameplayAuthority(records),
    balance: {
      source: get(records, 'phase4/balance/source'),
      mechanical: get(records, 'phase4/balance/mechanical'),
      semantic: get(records, 'phase4/balance/semantic'),
    },
  }
}
function worldCandidate(records: Records) {
  const p4 = phase4(records)
  const worldScene: WorldPresentationAssemblyAuthority['worldScene'] = {
    source: get(records, 'phase5/world-scene/source'),
    mechanical: get(records, 'phase5/world-scene/mechanical'),
    semantic: get(records, 'phase5/world-scene/semantic'),
    validation: get(records, 'phase5/world-scene/validation'),
  }
  return {
    phase4Authority: p4,
    worldScene: {
      source: worldScene.source,
      mechanical: worldScene.mechanical,
      semantic: worldScene.semantic,
    },
  }
}
function worldAdmitted(records: Records) {
  const candidate = worldCandidate(records)
  return {
    ...candidate,
    worldScene: {
      ...candidate.worldScene,
      validation: get<
        WorldPresentationAssemblyAuthority['worldScene']['validation']
      >(records, 'phase5/world-scene/validation'),
    },
  }
}
function phase5Candidate(
  records: Records,
): Parameters<typeof preparePresentationSemanticValidationPacket>[0] {
  const authority = worldAdmitted(records)
  return {
    phase4Authority: authority.phase4Authority,
    worldScene: authority.worldScene,
    presentation: {
      source: get(records, 'phase5/presentation/source'),
      mechanical: get(records, 'phase5/presentation/mechanical'),
      semantic: get(records, 'phase5/presentation/semantic'),
    },
  }
}
function phase5Closed(records: Records): WorldPresentationAssemblyAuthority {
  const candidate = phase5Candidate(records)
  return {
    ...candidate,
    presentation: {
      ...candidate.presentation,
      validation: get(records, 'phase5/presentation/validation'),
    },
  }
}
function phase6Candidate(
  records: Records,
): ResourceRealizationValidationPreparationAuthority {
  return {
    phase5Authority: phase5Closed(records),
    resourceRealization: {
      source: get(records, 'phase6/resource-realization/source'),
      mechanical: get(records, 'phase6/resource-realization/mechanical'),
      semantic: get(records, 'phase6/resource-realization/semantic'),
    },
  }
}
function phase6Closed(records: Records): ResourceRealizationAssemblyAuthority {
  const candidate = phase6Candidate(records)
  return {
    ...candidate,
    resourceRealization: {
      ...candidate.resourceRealization,
      validation: get(records, 'phase6/resource-realization/validation'),
    },
  }
}
function phase7Candidate(
  records: Records,
): ImplementationVerificationValidationPreparationAuthority {
  return {
    phase6Authority: phase6Closed(records),
    implementationVerification: {
      source: get(records, 'phase7/implementation-verification/source'),
      mechanical: get(records, 'phase7/implementation-verification/mechanical'),
      semantic: get(records, 'phase7/implementation-verification/semantic'),
    },
  }
}
function phase7Closed(
  records: Records,
): ImplementationVerificationAssemblyAuthority {
  const candidate = phase7Candidate(records)
  return {
    ...candidate,
    implementationVerification: {
      ...candidate.implementationVerification,
      validation: get(records, 'phase7/implementation-verification/validation'),
    },
  }
}

export function buildStagedOperationPacket(input: {
  operation: GameIrStagedOperation
  source?: GameIrDomainSourceEnvelope
  records: Records
}): unknown {
  const projectionInput = (): {
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
  } => {
    if (!input.source)
      throw new Error('projection operation requires a current source packet')
    return { source: input.source, mechanical: emptyMechanical(input.source) }
  }
  switch (input.operation.step) {
    case 'phase4/gameplay/projection': {
      const { source, mechanical } = projectionInput()
      return buildGameplayProjectionOperationPacket({ source, mechanical })
    }
    case 'phase4/balance/projection': {
      const { source, mechanical } = projectionInput()
      return buildBalanceProjectionOperationPacket({
        source,
        mechanical,
        gameplay: gameplayAuthority(input.records),
      })
    }
    case 'phase5/world-scene/projection': {
      const { source, mechanical } = projectionInput()
      return buildWorldSceneProjectionOperationPacket({
        source,
        mechanical,
        phase4Authority: phase4(input.records),
      })
    }
    case 'phase5/world-scene/validation': {
      return prepareWorldSceneSemanticValidationPacket({
        phase4Authority: phase4(input.records),
        worldScene: {
          source: get(input.records, 'phase5/world-scene/source'),
          mechanical: get(input.records, 'phase5/world-scene/mechanical'),
          semantic: get(input.records, 'phase5/world-scene/semantic'),
        },
      })
    }
    case 'phase5/presentation/projection': {
      const { source, mechanical } = projectionInput()
      const authority = worldAdmitted(input.records)
      return buildPresentationProjectionOperationPacket({
        source,
        mechanical,
        phase4Authority: authority.phase4Authority,
        worldScene: authority.worldScene,
      })
    }
    case 'phase5/presentation/validation': {
      return preparePresentationSemanticValidationPacket(
        phase5Candidate(input.records),
      )
    }
    case 'phase6/resource-realization/projection': {
      const { source, mechanical } = projectionInput()
      return buildResourceRealizationProjectionOperationPacket({
        phase5Authority: phase5Closed(input.records),
        resourceRealization: { source, mechanical },
      })
    }
    case 'phase6/resource-realization/validation': {
      const authority = phase6Candidate(input.records)
      return prepareResourceRealizationSemanticValidationPacket(authority)
    }
    case 'phase7/implementation-verification/projection': {
      const { source, mechanical } = projectionInput()
      return buildImplementationVerificationProjectionOperationPacket({
        phase6Authority: phase6Closed(input.records),
        source,
        mechanical,
      })
    }
    case 'phase7/implementation-verification/validation':
      return prepareImplementationVerificationSemanticValidationPacket(
        phase7Candidate(input.records),
      )
  }
}

function normalizeStagedProjectionPacket(input: {
  operation: GameIrStagedOperation
  packet: unknown
  records: Records
}): GameIrProjectionOperationPacket {
  if (
    input.operation.operation !== 'projection' ||
    !isRecord(input.packet) ||
    !isRecord(input.packet.source)
  )
    throw new Error(
      'slice assembly requires a projection operation packet with source',
    )
  const source = input.packet.source as GameIrDomainSourceEnvelope
  const normalized = (() => {
    switch (input.operation.step) {
      case 'phase4/gameplay/projection':
        return normalizeGameplayProjectionOperationPacket(input.packet)
      case 'phase4/balance/projection':
        return normalizeBalanceProjectionOperationPacket(
          input.packet,
          gameplayAuthority(input.records),
        )
      case 'phase5/world-scene/projection':
        return normalizeWorldSceneProjectionOperationPacket(
          input.packet,
          phase4(input.records),
        )
      case 'phase5/presentation/projection': {
        const authority = worldAdmitted(input.records)
        return normalizePresentationProjectionOperationPacket(input.packet, {
          phase4Authority: authority.phase4Authority,
          worldScene: authority.worldScene,
        })
      }
      case 'phase6/resource-realization/projection':
        return normalizeResourceRealizationProjectionOperationPacket(
          input.packet,
          {
            phase5Authority: phase5Closed(input.records),
            resourceRealization: {
              source,
              mechanical: emptyMechanical(source),
            },
          },
        )
      case 'phase7/implementation-verification/projection':
        return normalizeImplementationVerificationProjectionOperationPacket(
          input.packet,
          phase6Closed(input.records),
        )
      default:
        throw new Error(
          `slice assembly does not accept ${input.operation.step}`,
        )
    }
  })()
  const expected = buildStagedOperationPacket({
    operation: input.operation,
    source: normalized.source,
    records: input.records,
  })
  if (digestGameIrValue(normalized) !== digestGameIrValue(expected))
    throw new Error(
      'slice assembly operation packet is not the exact canonical packet',
    )
  return normalized as GameIrProjectionOperationPacket
}

/** The sole staged projection assembly entry: operation authority is normalized before journal assembly. */
export function assembleStagedProjectionOperation(input: {
  operation: GameIrStagedOperation
  packet: unknown
  records: Records
  journal: GameIrProjectionSliceJournal
}): GameIrDomainSemanticResult {
  const packet = normalizeStagedProjectionPacket(input)
  const snapshot =
    input.journal instanceof GameIrProjectionSliceJournal
      ? input.journal.completedSnapshot
      : (() => {
          throw new Error(
            'slice assembly requires a verified projection slice journal',
          )
        })()
  if (
    snapshot.operationStep !== input.operation.step ||
    snapshot.operationPacketDigest !== packet.packetDigest
  )
    throw new Error(
      'slice assembly journal is detached from the exact operation packet',
    )
  const foundation = packet.source.compileRequest.foundation
  const journalIdentity = snapshot.identity
  if (
    journalIdentity.taskId !== packet.source.taskId ||
    journalIdentity.publicationId !==
      packet.source.compileRequest.publicationId ||
    journalIdentity.confirmedBriefDigest !== foundation.confirmedBriefDigest ||
    journalIdentity.foundationRevision !== foundation.foundationRevision ||
    journalIdentity.foundationReadyReceiptDigest !== foundation.receiptDigest
  )
    throw new Error(
      'slice assembly journal identity is detached from the operation packet',
    )
  const plan = deriveProjectionSlicePlan(packet.source.moduleId)
  if (
    digestGameIrValue(snapshot.slicePlan) !== digestGameIrValue(plan) ||
    snapshot.entries.length !== plan.slices.length
  )
    throw new Error(
      'slice assembly journal is incomplete or uses a stale slice plan',
    )
  const nodes = snapshot.entries
    .flatMap(entry => entry.semantic.nodes)
    .sort((left, right) => compareCodeUnits(left.id, right.id))
  const nodeIds = new Set<string>()
  for (const node of nodes) {
    if (nodeIds.has(node.id))
      throw new Error(`slice assembly has duplicate node ID ${node.id}`)
    nodeIds.add(node.id)
  }
  const evidenceGroups = snapshot.entries.flatMap(
    entry => entry.semantic.sourceEvidenceGroups,
  ) as readonly GameIrSourceEvidenceGroup[]
  const evidenceSubjects = new Set<string>()
  for (const group of evidenceGroups)
    for (const subject of group.subjects) {
      if (evidenceSubjects.has(subject))
        throw new Error(
          `slice assembly has duplicate evidence subject ${subject}`,
        )
      evidenceSubjects.add(subject)
    }
  const sourceClaims = deriveGameIrSemanticSourceClaims(
    {
      sectionIndex: packet.source.sectionIndex,
      sectionBytes: packet.source.sectionBytes,
    },
    nodes as readonly GameIrSemanticCandidateNode[],
    evidenceGroups,
    'invalid Game IR projection assembled source evidence',
  )
  const semantic = { outcome: 'PROJECTED' as const, nodes, sourceClaims }
  switch (input.operation.step) {
    case 'phase4/gameplay/projection': {
      const receipt = admitGameplaySemanticResult(
        packet.semanticPacket as GameIrDomainSemanticPacket,
        semantic,
      )
      if (receipt.outcome === 'PROJECTED')
        prepareGameplayModule({
          source: packet.source,
          mechanical: emptyMechanical(packet.source),
          semantic: receipt,
        })
      return receipt
    }
    case 'phase4/balance/projection':
      return admitBalanceSemanticResult(
        packet.semanticPacket as GameIrDomainSemanticPacket,
        semantic,
      )
    case 'phase5/world-scene/projection':
      return admitWorldSceneSemanticResult(
        packet.semanticPacket as GameIrDomainSemanticPacket,
        semantic,
      )
    case 'phase5/presentation/projection':
      return admitPresentationSemanticResult(
        packet.semanticPacket as GameIrDomainSemanticPacket,
        semantic,
      )
    case 'phase6/resource-realization/projection': {
      const authority = {
        phase5Authority: phase5Closed(input.records),
        resourceRealization: {
          source: packet.source,
          mechanical: emptyMechanical(packet.source),
        },
      }
      return admitResourceRealizationSemanticResult(
        authority,
        prepareResourceRealizationSemanticProjectionPacket(authority),
        semantic,
      )
    }
    case 'phase7/implementation-verification/projection': {
      const authority = {
        source: packet.source,
        mechanical: emptyMechanical(packet.source),
      }
      return admitImplementationVerificationSemanticResult(
        authority,
        buildImplementationVerificationSemanticPacket(authority),
        semantic,
      )
    }
    default:
      throw new Error(`slice assembly does not accept ${input.operation.step}`)
  }
}

/** Convert the already-admitted journal assembly receipt into canonical records. */
export function stagedProjectionJournalCompletion(input: {
  operation: GameIrStagedOperation
  packet: unknown
  records: Records
  journal: GameIrProjectionSliceJournal
}): readonly GameIrCheckpointRecord[] {
  if (input.operation.operation !== 'projection')
    throw new Error(
      'projection journal completion requires a projection operation',
    )
  const receipt = assembleStagedProjectionOperation(input)
  if (!isRecord(receipt) || receipt.outcome !== 'PROJECTED')
    throw new Error(
      'completed projection journal did not produce an admitted receipt',
    )
  if (!isRecord(input.packet) || !isRecord(input.packet.source))
    throw new Error(
      'projection journal completion requires a source-bound packet',
    )
  const source = input.packet.source as GameIrDomainSourceEnvelope
  const mechanical = emptyMechanical(source)
  const record = (
    kind: GameIrCheckpointRecord['kind'],
    value: unknown,
  ): GameIrCheckpointRecord => ({ kind, record: value })
  switch (input.operation.step) {
    case 'phase4/gameplay/projection':
      return [
        record('phase4/gameplay/source', source),
        record('phase4/gameplay/mechanical', mechanical),
        record('phase4/gameplay/semantic', receipt),
      ]
    case 'phase4/balance/projection': {
      const completion = [
        record('phase4/balance/source', source),
        record('phase4/balance/mechanical', mechanical),
        record('phase4/balance/semantic', receipt),
      ] as const
      const closedRecords = new Map(input.records)
      for (const item of completion)
        closedRecords.set(item.kind, item.record)
      assembleGameplayBalanceModules(phase4(closedRecords))
      return completion
    }
    case 'phase5/world-scene/projection':
      return [
        record('phase5/world-scene/source', source),
        record('phase5/world-scene/mechanical', mechanical),
        record('phase5/world-scene/semantic', receipt),
      ]
    case 'phase5/presentation/projection':
      return [
        record('phase5/presentation/source', source),
        record('phase5/presentation/mechanical', mechanical),
        record('phase5/presentation/semantic', receipt),
      ]
    case 'phase6/resource-realization/projection':
      return [
        record('phase6/resource-realization/source', source),
        record('phase6/resource-realization/mechanical', mechanical),
        record('phase6/resource-realization/semantic', receipt),
      ]
    case 'phase7/implementation-verification/projection':
      return [
        record('phase7/implementation-verification/source', source),
        record('phase7/implementation-verification/mechanical', mechanical),
        record('phase7/implementation-verification/semantic', receipt),
      ]
    default:
      throw new Error(
        `projection journal completion does not accept ${input.operation.step}`,
      )
  }
}

/** Validation remains the existing small StructuredOutput/checkpoint route. */
export function admitStagedValidationOperation(input: {
  operation: GameIrStagedOperation
  packet: unknown
  records: Records
  result: unknown
}): readonly GameIrCheckpointRecord[] {
  const result = input.result
  const packet = input.packet
  if (!isRecord(result) || result.status !== 'completed')
    throw new Error(
      isRecord(result) && typeof result.reason === 'string'
        ? result.reason
        : 'Game IR operation failed',
    )
  const record = (
    kind: GameIrCheckpointRecord['kind'],
    value: unknown,
  ): GameIrCheckpointRecord => ({ kind, record: value })
  const boundValidation = (): Record<string, unknown> => {
    if (
      !isRecord(packet) ||
      typeof packet.packetDigest !== 'string' ||
      !isRecord(result.validation)
    )
      throw new Error('Game IR validation packet is invalid')
    return { ...result.validation, packetDigest: packet.packetDigest }
  }
  switch (input.operation.step) {
    case 'phase5/world-scene/validation':
      return [
        record(
          'phase5/world-scene/validation',
          admitPhase5SemanticValidationResult(
            packet as Phase5SemanticValidationPacket,
            boundValidation(),
          ),
        ),
      ]
    case 'phase5/presentation/validation':
      return [
        record(
          'phase5/presentation/validation',
          admitPhase5SemanticValidationResult(
            packet as Phase5SemanticValidationPacket,
            boundValidation(),
          ),
        ),
      ]
    case 'phase6/resource-realization/validation':
      return [
        record(
          'phase6/resource-realization/validation',
          admitResourceRealizationSemanticValidationResult(
            phase6Candidate(input.records),
            packet as ResourceRealizationSemanticValidationPacket,
            boundValidation(),
          ),
        ),
      ]
    case 'phase7/implementation-verification/validation':
      return [
        record(
          'phase7/implementation-verification/validation',
          admitImplementationVerificationSemanticValidationResult(
            phase7Candidate(input.records),
            packet as ImplementationVerificationSemanticValidationPacket,
            boundValidation(),
          ),
        ),
      ]
    default:
      throw new Error(
        `validation admission does not accept ${input.operation.step}`,
      )
  }
}
