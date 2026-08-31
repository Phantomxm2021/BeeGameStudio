import type { ResourceAcquisitionProfile } from '@bee-game-studio/beegame-resource-core'
import {
  compareCodeUnits,
  digestGameIrValue,
  type GameIrModuleCandidate,
  type GameIrNode,
} from './model'
import {
  assembleWorldPresentationClosure,
  type WorldPresentationAssemblyAuthority,
  type WorldPresentationClosure,
} from './world-presentation-assembler'
import {
  admitResourceRealizationSemanticValidationResult,
  prepareResourceRealizationSemanticValidationPacket,
  type ResourceRealizationSemanticValidationResult,
  type ResourceRealizationValidationPreparationAuthority,
} from './phase6-admission'
import { parseResourceRealizationModule } from './resource-realization-schema'
import type { GameIrDomainSourceEnvelope } from './domain-source'
import type { GameIrMechanicalProjectionReceipt } from './domain-projection'
import type { ResourceRealizationSemanticReceipt } from './resource-realization-producer'

type ResourceSourcingPolicy = Readonly<{
  allowedSourceKinds: readonly string[]
  licenseConstraints: readonly string[]
  responsibleParty: string
  handoffCriteria: readonly string[]
}>

export type ResourceRealizationModuleProjection = Readonly<{
  schemaVersion: 'game-ir-resource-realization-module.v1'
  taskId: string
  foundationRevision: string
  module: GameIrModuleCandidate & Readonly<{ moduleId: 'resource-realization' }>
  sourceDigest: string
  mechanicalReceiptDigest: string
  semanticReceiptDigest: string
  semanticValidationResultDigest: string
  projectionDigest: string
}>

export type ResourcePlanRequirement = Readonly<{
  id: string
  name?: string
  purpose?: string
  required: boolean
  acquisitionProfile: ResourceAcquisitionProfile
  sourcingPolicy: ResourceSourcingPolicy
}>

export type ResourcePlanProjection = Readonly<{
  projectTarget: Readonly<{
    platform?: string
    runtime?: string
    assetFormatCapabilities: readonly string[]
  }>
  requirements: readonly ResourcePlanRequirement[]
}>

export type ResourceRealizationAssemblyAuthority = Readonly<{
  phase5Authority: WorldPresentationAssemblyAuthority
  resourceRealization: Readonly<{
    source: GameIrDomainSourceEnvelope
    mechanical: GameIrMechanicalProjectionReceipt
    semantic: ResourceRealizationSemanticReceipt
    validation: ResourceRealizationSemanticValidationResult
  }>
}>

export type ResourceRealizationClosure = Readonly<{
  schemaVersion: 'game-ir-resource-realization-closure.v1'
  taskId: string
  foundationRevision: string
  foundationReceiptDigest: string
  compileRequestDigest: string
  authoritySectionIndexDigest: string
  phase5: WorldPresentationClosure
  resourceRealization: ResourceRealizationModuleProjection
  resourcePlan: ResourcePlanProjection
  resourcePlanDigest: string
  closureDigest: string
}>

function fail(message: string): never {
  throw new Error(`invalid Game IR Resource Realization assembly: ${message}`)
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
  if (keys.some(key => typeof key !== 'string'))
    fail(`${label} has a symbol property`)
  for (const key of keys) {
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
): asserts value is ResourceRealizationAssemblyAuthority {
  if (!isRecord(value)) fail('authority must be a plain object')
  exactKeys(value, ['phase5Authority', 'resourceRealization'], 'authority')
  if (!isRecord(value.resourceRealization))
    fail('resourceRealization must be a plain object')
  exactKeys(
    value.resourceRealization,
    ['source', 'mechanical', 'semantic', 'validation'],
    'resourceRealization',
  )
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Reflect.ownKeys(value as object)) {
      const descriptor = Object.getOwnPropertyDescriptor(value as object, child)
      if (descriptor && 'value' in descriptor) deepFreeze(descriptor.value)
    }
    Object.freeze(value)
  }
  return value
}

function profileFor(
  logical: GameIrNode,
  nodes: readonly GameIrNode[],
): GameIrNode {
  const matches = nodes.filter(
    node =>
      node.kind === 'resource-realization.acquisition-profile' &&
      node.edges.some(
        edge => edge.type === 'describes' && edge.targetId === logical.id,
      ),
  )
  if (matches.length !== 1)
    fail(`logical resource ${logical.id} must have one profile`)
  return matches[0]!
}

function deriveResourcePlan(
  module: GameIrModuleCandidate,
): ResourcePlanProjection {
  const nodes = module.nodes
  const target = nodes.find(
    node => node.kind === 'resource-realization.delivery-target',
  )
  if (!target) fail('resource module has no delivery target')
  const targetValue = target.value
  const projectTarget: Record<string, unknown> = {}
  if (Object.hasOwn(targetValue, 'platform'))
    projectTarget.platform = targetValue.platform
  if (Object.hasOwn(targetValue, 'runtime'))
    projectTarget.runtime = targetValue.runtime
  projectTarget.assetFormatCapabilities = [
    ...(targetValue.assetFormatCapabilities as readonly string[]),
  ]

  const requirements = nodes
    .filter(node => node.kind === 'resource-realization.logical-resource')
    .map(logical => {
      const value = logical.value
      const profile = profileFor(logical, nodes).value
      const acquisitionProfile: ResourceAcquisitionProfile = {
        dimensions: [
          ...(profile.dimensions as ResourceAcquisitionProfile['dimensions']),
        ],
        assetKinds: [
          ...(profile.assetKinds as ResourceAcquisitionProfile['assetKinds']),
        ],
        usageTags: [
          ...(profile.usageTags as ResourceAcquisitionProfile['usageTags']),
        ],
        capabilities: [
          ...(profile.capabilities as ResourceAcquisitionProfile['capabilities']),
        ],
        styles: [...(profile.styles as readonly string[])],
        ...(Object.hasOwn(profile, 'coverage')
          ? {
              coverage: structuredClone(
                profile.coverage,
              ) as ResourceAcquisitionProfile['coverage'],
            }
          : {}),
      }
      const requirement: Record<string, unknown> = {
        id: value.requirementId,
        required: profile.required,
        acquisitionProfile,
        sourcingPolicy: structuredClone(
          profile.sourcingPolicy,
        ) as ResourceSourcingPolicy,
      }
      if (Object.hasOwn(profile, 'name')) requirement.name = profile.name
      if (Object.hasOwn(profile, 'purpose'))
        requirement.purpose = profile.purpose
      return requirement as ResourcePlanRequirement
    })
    .sort((left, right) => compareCodeUnits(left.id, right.id))

  return {
    projectTarget: projectTarget as ResourcePlanProjection['projectTarget'],
    requirements,
  }
}

function phase5ValidationAuthority(
  authority: ResourceRealizationAssemblyAuthority,
): ResourceRealizationValidationPreparationAuthority {
  return {
    phase5Authority: authority.phase5Authority,
    resourceRealization: {
      source: authority.resourceRealization.source,
      mechanical: authority.resourceRealization.mechanical,
      semantic: authority.resourceRealization.semantic,
    },
  }
}

export function assembleResourceRealizationClosure(
  authority: ResourceRealizationAssemblyAuthority,
): ResourceRealizationClosure {
  validateAuthorityShape(authority)
  const phase5 = assembleWorldPresentationClosure(authority.phase5Authority)
  const validationAuthority = phase5ValidationAuthority(authority)
  const packet =
    prepareResourceRealizationSemanticValidationPacket(validationAuthority)
  const validation = admitResourceRealizationSemanticValidationResult(
    validationAuthority,
    packet,
    authority.resourceRealization.validation,
  )
  if (validation.outcome !== 'PASS')
    fail(`semantic fidelity must be PASS, received ${validation.outcome}`)

  let moduleValue: unknown
  try {
    moduleValue = JSON.parse(packet.moduleBytes)
  } catch {
    fail('validation packet module bytes are not canonical JSON')
  }
  const module = parseResourceRealizationModule(moduleValue, {
    request: packet.compileRequest,
    sections: packet.authoritySectionIndex,
    externalModules: packet.priorModules,
  }) as ResourceRealizationModuleProjection['module']
  const resourceRealizationBody = {
    schemaVersion: 'game-ir-resource-realization-module.v1' as const,
    taskId: packet.taskId,
    foundationRevision: packet.foundationRevision,
    module,
    sourceDigest: packet.sourceDigest,
    mechanicalReceiptDigest: packet.mechanicalReceiptDigest,
    semanticReceiptDigest: packet.semanticReceiptDigest,
    semanticValidationResultDigest: digestGameIrValue(validation),
  }
  const resourceRealization = {
    ...resourceRealizationBody,
    projectionDigest: digestGameIrValue(resourceRealizationBody),
  }
  const resourcePlan = deriveResourcePlan(module)
  const body = {
    schemaVersion: 'game-ir-resource-realization-closure.v1' as const,
    taskId: phase5.taskId,
    foundationRevision: phase5.foundationRevision,
    foundationReceiptDigest: phase5.foundationReceiptDigest,
    compileRequestDigest: phase5.compileRequestDigest,
    authoritySectionIndexDigest: phase5.authoritySectionIndexDigest,
    phase5,
    resourceRealization,
    resourcePlan,
    resourcePlanDigest: digestGameIrValue(resourcePlan),
  }
  return deepFreeze({ ...body, closureDigest: digestGameIrValue(body) })
}
