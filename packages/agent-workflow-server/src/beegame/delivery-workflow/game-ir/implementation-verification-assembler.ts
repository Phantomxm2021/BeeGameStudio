import {
  assembleResourceRealizationClosure,
  type ResourceRealizationAssemblyAuthority,
  type ResourceRealizationClosure,
} from './resource-realization-assembler'
import { GAME_IR_CANONICAL_MODULE_IDS } from './contracts'
import {
  admitImplementationVerificationSemanticValidationResult,
  prepareImplementationVerificationSemanticValidationPacket,
  type ImplementationVerificationSemanticValidationPacket,
  type ImplementationVerificationValidationPreparationAuthority,
} from './phase7-admission'
import {
  buildImplementationVerificationSemanticPacket,
  prepareImplementationVerificationModule,
  type ImplementationVerificationSemanticReceipt,
} from './implementation-verification-producer'
import {
  canonicalGameIrJson,
  compareCodeUnits,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrModuleCandidate,
} from './model'
import {
  validateGameIrDomainSourceEnvelope,
  type GameIrDomainSourceEnvelope,
} from './domain-source'
import type {
  GameIrDomainSemanticPacket,
  GameIrMechanicalProjectionReceipt,
} from './domain-projection'
import type { SemanticValidationResult } from './semantic-fidelity'
import { createSemanticFidelityPrimitives } from './semantic-fidelity'
import {
  buildDomainProjectionEnvelope,
  normalizeDomainProjectionEnvelope,
  operationIsRecord,
  operationTargets,
  emptyOperationMechanicalReceipt,
  type DomainProjectionEnvelope,
  type OperationTarget,
} from './operation-packet-primitives'
import { IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST } from './implementation-verification-schema'

const ERROR_PREFIX = 'invalid Game IR Implementation/Verification assembly'
const { exactKeys } = createSemanticFidelityPrimitives(ERROR_PREFIX)

export type ImplementationVerificationAssemblyAuthority = Readonly<{
  phase6Authority: ResourceRealizationAssemblyAuthority
  implementationVerification: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ImplementationVerificationSemanticReceipt
    validation: SemanticValidationResult
  }>
}>

export type ImplementationVerificationProjectionOperationDependencies =
  Readonly<{
    phase6ClosureDigest: string
    priorTargets: readonly OperationTarget[]
  }>
export type ImplementationVerificationProjectionOperationPacket =
  DomainProjectionEnvelope<
    ImplementationVerificationProjectionOperationDependencies,
    GameIrDomainSemanticPacket,
    'game-ir-implementation-verification-projection-operation-packet.v1'
  >
export type ImplementationVerificationProjectionOperationInput = Readonly<{
  phase6Authority: ResourceRealizationAssemblyAuthority
  source: GameIrDomainSourceEnvelope
  mechanical: GameIrMechanicalProjectionReceipt
}>

function implementationPriorTargets(
  phase6: ResourceRealizationClosure,
): readonly OperationTarget[] {
  const local = new Set(
    Object.keys(IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST),
  )
  const allowed = new Set<string>()
  for (const descriptor of Object.values(
    IMPLEMENTATION_VERIFICATION_DOMAIN_MANIFEST,
  ))
    for (const relation of Object.values(descriptor.relationships))
      for (const kind of relation.targetKinds)
        if (!local.has(kind)) allowed.add(kind)
  return operationTargets(
    [
      ...phase6.phase5.phase4.gameplay.module.nodes,
      ...phase6.phase5.phase4.balance.module.nodes,
      ...phase6.phase5.worldScene.module.nodes,
      ...phase6.phase5.presentation.module.nodes,
      ...phase6.resourceRealization.module.nodes,
    ]
      .filter(node => allowed.has(node.kind))
      .map(node => ({ id: node.id, kind: node.kind }))
      .sort((left, right) =>
        compareCodeUnits(
          `${left.id}\0${left.kind}`,
          `${right.id}\0${right.kind}`,
        ),
      ),
    'Implementation/Verification operation priorTargets',
  )
}

function implementationOperationIdentity(
  source: GameIrDomainSourceEnvelope,
  phase6: ResourceRealizationClosure,
): void {
  if (
    source.taskId !== phase6.taskId ||
    source.compileRequest.foundation.foundationRevision !==
      phase6.foundationRevision ||
    source.compileRequest.foundation.receiptDigest !==
      phase6.foundationReceiptDigest ||
    digestGameIrValue(source.compileRequest) !== phase6.compileRequestDigest ||
    digestGameIrValue(source.authoritySectionIndex) !==
      phase6.authoritySectionIndexDigest
  )
    fail(
      'Implementation/Verification operation source is detached from Phase 6 closure',
    )
}

function implementationOperationDependencies(
  phase6Authority: ResourceRealizationAssemblyAuthority,
): Readonly<{
  phase6: ResourceRealizationClosure
  dependencies: ImplementationVerificationProjectionOperationDependencies
}> {
  const phase6 = assembleResourceRealizationClosure(phase6Authority)
  return {
    phase6,
    dependencies: {
      phase6ClosureDigest: phase6.closureDigest,
      priorTargets: implementationPriorTargets(phase6),
    },
  }
}

export function buildImplementationVerificationProjectionOperationPacket(
  input: ImplementationVerificationProjectionOperationInput,
): ImplementationVerificationProjectionOperationPacket {
  if (!isRecord(input))
    fail('Implementation/Verification operation input must be an object')
  exactKeys(
    input,
    ['phase6Authority', 'source', 'mechanical'],
    'Implementation/Verification operation input',
  )
  const source = validateGameIrDomainSourceEnvelope(input.source)
  if (source.moduleId !== 'implementation-verification')
    fail('Implementation/Verification operation source module is invalid')
  const { phase6, dependencies } = implementationOperationDependencies(
    input.phase6Authority,
  )
  implementationOperationIdentity(source, phase6)
  const semanticPacket = buildImplementationVerificationSemanticPacket({
    source,
    mechanical: input.mechanical,
  })
  return buildDomainProjectionEnvelope({
    schemaVersion:
      'game-ir-implementation-verification-projection-operation-packet.v1',
    moduleId: 'implementation-verification',
    source,
    semanticPacket,
    dependencies,
  })
}

export function normalizeImplementationVerificationProjectionOperationPacket(
  value: unknown,
  phase6Authority: ResourceRealizationAssemblyAuthority,
): ImplementationVerificationProjectionOperationPacket {
  const normalized = normalizeDomainProjectionEnvelope(value, {
    schemaVersion:
      'game-ir-implementation-verification-projection-operation-packet.v1',
    moduleId: 'implementation-verification',
    label: 'Implementation/Verification operation packet',
    parseDependencies: dependency => {
      if (!operationIsRecord(dependency))
        fail(
          'Implementation/Verification operation dependencies must be an object',
        )
      exactKeys(
        dependency,
        ['phase6ClosureDigest', 'priorTargets'],
        'Implementation/Verification operation dependencies',
      )
      if (
        typeof dependency.phase6ClosureDigest !== 'string' ||
        !/^[a-f0-9]{64}$/.test(dependency.phase6ClosureDigest)
      )
        fail('Implementation/Verification phase6 closure digest is invalid')
      return {
        phase6ClosureDigest: dependency.phase6ClosureDigest,
        priorTargets: operationTargets(
          dependency.priorTargets,
          'Implementation/Verification operation priorTargets',
        ),
      }
    },
  })
  const { phase6, dependencies } =
    implementationOperationDependencies(phase6Authority)
  implementationOperationIdentity(normalized.source, phase6)
  const expectedSemanticPacket = buildImplementationVerificationSemanticPacket({
    source: normalized.source,
    mechanical: emptyOperationMechanicalReceipt(normalized.source),
  })
  if (
    canonicalGameIrJson(normalized.semanticPacket) !==
    canonicalGameIrJson(expectedSemanticPacket)
  )
    fail(
      'Implementation/Verification operation semantic packet is stale or detached',
    )
  if (
    canonicalGameIrJson(normalized.dependencies) !==
    canonicalGameIrJson(dependencies)
  )
    fail(
      'Implementation/Verification operation dependencies are stale or detached',
    )
  return normalized
}

export type ImplementationVerificationModuleProjection = Readonly<{
  schemaVersion: 'game-ir-implementation-verification-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate &
    Readonly<{ moduleId: 'implementation-verification' }>
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest: string
  projectionDigest: string
}>

export type ImplementationVerificationClosure = Readonly<{
  schemaVersion: 'game-ir-implementation-verification-closure.v1'
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  phase6: ResourceRealizationClosure
  implementationVerification: ImplementationVerificationModuleProjection
  candidate: GameIrCandidate
  candidateDigest: string
  closureDigest: string
}>

export type GameIrPublishedModuleEvidence =
  | Readonly<{
      phase: 'phase4'
      moduleId: 'gameplay' | 'balance'
      sourceDigest: string
      mechanicalReceiptDigest: string
      semanticReceiptDigest: string
      projectionDigest: string
    }>
  | Readonly<{
      phase: 'phase5'
      moduleId: 'world-scene' | 'presentation'
      sourceDigest: string
      mechanicalReceiptDigest: string
      semanticReceiptDigest: string
      semanticValidationResultDigest: string
      projectionDigest: string
    }>
  | Readonly<{
      phase: 'phase6'
      moduleId: 'resource-realization'
      sourceDigest: string
      mechanicalReceiptDigest: string
      semanticReceiptDigest: string
      semanticValidationResultDigest: string
      projectionDigest: string
    }>
  | Readonly<{
      phase: 'phase7'
      moduleId: 'implementation-verification'
      sourceDigest: string
      mechanicalReceiptDigest: string
      semanticReceiptDigest: string
      semanticValidationResultDigest: string
      projectionDigest: string
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
): asserts value is ImplementationVerificationAssemblyAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(
    value,
    ['phase6Authority', 'implementationVerification'],
    'authority',
  )
  if (!isRecord(value.implementationVerification))
    fail('implementationVerification must be a plain object')
  exactKeys(
    value.implementationVerification,
    ['source', 'mechanical', 'semantic', 'validation'],
    'implementationVerification',
  )
}

function projection(
  source: GameIrDomainSourceEnvelope,
  mechanical: GameIrMechanicalProjectionReceipt,
  semantic: ImplementationVerificationSemanticReceipt,
  validation: SemanticValidationResult,
  module: GameIrModuleCandidate &
    Readonly<{ moduleId: 'implementation-verification' }>,
): ImplementationVerificationModuleProjection {
  if (validation.outcome !== 'PASS')
    fail(`semantic fidelity must be PASS, received ${validation.outcome}`)
  const body = {
    schemaVersion: 'game-ir-implementation-verification-module.v1' as const,
    taskId: source.taskId,
    foundationRevision: source.compileRequest.foundation.foundationRevision,
    module,
    sourceDigest: source.sourceDigest,
    mechanicalReceiptDigest: mechanical.receiptDigest,
    semanticReceiptDigest: semantic.receiptDigest,
    semanticValidationResultDigest: digestGameIrValue(validation),
  }
  return Object.freeze({ ...body, projectionDigest: digestGameIrValue(body) })
}

function completeCandidate(
  phase6: ResourceRealizationClosure,
  implementation: ImplementationVerificationModuleProjection,
  source: GameIrDomainSourceEnvelope,
): GameIrCandidate {
  const modules = [
    phase6.phase5.phase4.balance.module,
    phase6.phase5.phase4.gameplay.module,
    implementation.module,
    phase6.phase5.presentation.module,
    phase6.resourceRealization.module,
    phase6.phase5.worldScene.module,
  ]
  const actual = modules.map(module => module.moduleId)
  if (
    canonicalGameIrJson(actual) !==
    canonicalGameIrJson(GAME_IR_CANONICAL_MODULE_IDS)
  )
    fail('candidate modules are not in canonical code-unit order')
  return parseGameIrCandidate(
    {
      schemaVersion: 'game-ir.v1',
      taskId: source.taskId,
      foundationRevision: source.compileRequest.foundation.foundationRevision,
      modules,
    },
    {
      request: source.compileRequest,
      sections: source.authoritySectionIndex,
    },
  )
}

export function assembleImplementationVerificationClosure(
  authority: ImplementationVerificationAssemblyAuthority,
): ImplementationVerificationClosure {
  validateAuthority(authority)
  const phase6 = assembleResourceRealizationClosure(authority.phase6Authority)
  const prep: ImplementationVerificationValidationPreparationAuthority = {
    phase6Authority: authority.phase6Authority,
    implementationVerification: {
      source: authority.implementationVerification.source,
      mechanical: authority.implementationVerification.mechanical,
      semantic: authority.implementationVerification.semantic,
    },
  }
  const packet: ImplementationVerificationSemanticValidationPacket =
    prepareImplementationVerificationSemanticValidationPacket(prep)
  const validation = admitImplementationVerificationSemanticValidationResult(
    prep,
    packet,
    authority.implementationVerification.validation,
  )
  const prepared = prepareImplementationVerificationModule({
    source: prep.implementationVerification.source,
    mechanical: prep.implementationVerification.mechanical,
    semantic: prep.implementationVerification.semantic,
    priorModules: packet.priorModules,
  })
  const implementation = projection(
    prepared.source,
    prep.implementationVerification.mechanical,
    prep.implementationVerification.semantic,
    validation,
    prepared.module,
  )
  const candidate = completeCandidate(
    phase6,
    implementation,
    prep.implementationVerification.source,
  )
  const candidateDigest = digestGameIrValue(candidate)
  const body = {
    schemaVersion: 'game-ir-implementation-verification-closure.v1' as const,
    taskId: candidate.taskId,
    foundationRevision: candidate.foundationRevision,
    foundationReceiptDigest: phase6.foundationReceiptDigest,
    compileRequestDigest: phase6.compileRequestDigest,
    authoritySectionIndexDigest: phase6.authoritySectionIndexDigest,
    phase6,
    implementationVerification: implementation,
    candidate,
    candidateDigest,
  }
  return Object.freeze({ ...body, closureDigest: digestGameIrValue(body) })
}
