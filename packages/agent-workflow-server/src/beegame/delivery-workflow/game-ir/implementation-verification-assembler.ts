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
  prepareImplementationVerificationModule,
  type ImplementationVerificationSemanticReceipt,
} from './implementation-verification-producer'
import {
  canonicalGameIrJson,
  digestGameIrValue,
  parseGameIrCandidate,
  type GameIrCandidate,
  type GameIrModuleCandidate,
} from './model'
import type { GameIrDomainSourceEnvelope } from './domain-source'
import type { GameIrMechanicalProjectionReceipt } from './domain-projection'
import type { SemanticValidationResult } from './semantic-fidelity'

const ERROR_PREFIX = 'invalid Game IR Implementation/Verification assembly'

export type ImplementationVerificationAssemblyAuthority = Readonly<{
  phase6Authority: ResourceRealizationAssemblyAuthority
  implementationVerification: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ImplementationVerificationSemanticReceipt
    validation: SemanticValidationResult
  }>
}>

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
  const actual = (keys as string[]).sort()
  const wanted = [...expected].sort()
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  )
    fail(`${label} has unknown or missing fields`)
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
