import { auditAssetContract } from '../asset-contract-audit'
import {
  readBeeGameAssetManifestSync,
  type BeeGameAssetRequirement,
  type BeeGameProjectResource,
} from '../asset-contracts'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
} from '../resource-delivery-readiness'
import {
  computeResourceRevision,
} from './revision'
import type { DownstreamIr } from './downstream-ir'
import { buildSystemDeliveryContract } from './system-delivery-contract'
import { transitionDeliveryRun } from './transition'
import { type DeliveryRun, type WorkerDispatchRequest } from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

export function resourcePreparationAllowedPaths(
): string[] {
  // Resource preparation is one native CLI turn.  The host still validates
  // the manifest, inventory and content separately, but the worker must be
  // able to create the complete asset contract without crossing phase/task
  // boundaries that would force it into a planner/curator/author protocol.
  return [directoryScope('assets')]
}

export function currentResourceContractIssues(workspacePath: string): string[] {
  const audit = auditAssetContract(workspacePath)
  return [...new Set(audit.issues)]
}

function directoryScope(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return `${normalized}/`
}

function currentResourceIrResultId(run: DeliveryRun): string | undefined {
  if (run.resourceProductionState.irResultId) {
    return run.resourceProductionState.irResultId
  }
  const value = run.activeDispatch?.request?.contract.gameIr
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const resultId = (value as Record<string, unknown>).resultId
  return typeof resultId === 'string' && resultId.trim() ? resultId : undefined
}

function object(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every(item => typeof item === 'string')
    ? value
    : undefined
}

function sameStrings(left: readonly string[], right: readonly string[]): boolean {
  const a = [...new Set(left)].sort()
  const b = [...new Set(right)].sort()
  return a.length === b.length && a.every((value, index) => value === b[index])
}

const COVERAGE_FIELDS = [
  ['assetKinds', 'asset_kinds'],
  ['usageTags', 'usage_tags'],
  ['capabilities', 'capabilities'],
  ['relationKinds', 'relation_kinds'],
  ['embeddedKinds', 'embedded_kinds'],
] as const

function normalizedCoverage(
  value: unknown,
  source: 'ir' | 'manifest',
): string | undefined {
  if (value === undefined) return JSON.stringify([])
  if (!Array.isArray(value)) return undefined
  const items: string[] = []
  for (const entry of value) {
    const item = object(entry)
    if (!item) return undefined
    const normalized: Record<string, string[]> = {}
    for (const [irField, manifestField] of COVERAGE_FIELDS) {
      const field = source === 'ir' ? irField : manifestField
      if (item[field] === undefined) continue
      const values = stringArray(item[field])
      if (!values) return undefined
      normalized[manifestField] = [...new Set(values)].sort()
    }
    items.push(JSON.stringify(normalized))
  }
  return JSON.stringify(items.sort())
}

function sourcingPolicyMatches(
  irValue: unknown,
  manifestValue: unknown,
): boolean {
  const ir = object(irValue)
  const manifest = object(manifestValue)
  if (!ir || !manifest) return false
  const irAllowed = stringArray(ir.allowedSourceKinds)
  const irLicenses = stringArray(ir.licenseConstraints)
  const irHandoff = stringArray(ir.handoffCriteria)
  const manifestAllowed = stringArray(manifest.allowed_source_kinds)
  const manifestLicenses = stringArray(manifest.license_constraints)
  const manifestHandoff = stringArray(manifest.handoff_criteria)
  return Boolean(
    irAllowed && irLicenses && irHandoff &&
    manifestAllowed && manifestLicenses && manifestHandoff &&
    sameStrings(irAllowed, manifestAllowed) &&
    sameStrings(irLicenses, manifestLicenses) &&
    sameStrings(irHandoff, manifestHandoff) &&
    ir.responsibleParty === manifest.responsible_party,
  )
}

function intersectsNormalized(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const values = new Set(right.map(value => value.trim().toLowerCase()))
  return left.some(value => values.has(value.trim().toLowerCase()))
}

function resourceCovers(
  resource: BeeGameProjectResource,
  obligation: {
    asset_kinds?: readonly string[]
    usage_tags?: readonly string[]
    capabilities?: readonly string[]
    relation_kinds?: readonly string[]
    embedded_kinds?: readonly string[]
  },
): boolean {
  if (
    obligation.asset_kinds?.length &&
    (!resource.asset_kind || !obligation.asset_kinds.some(value => value === resource.asset_kind))
  )
    return false
  if (
    obligation.usage_tags?.length &&
    !intersectsNormalized(obligation.usage_tags, resource.usage_tags ?? [])
  )
    return false
  for (const [required, actual] of [
    [obligation.capabilities, resource.capabilities],
    [obligation.relation_kinds, resource.relation_kinds],
    [obligation.embedded_kinds, resource.embedded_kinds],
  ] as const)
    if (required?.length && !required.every(value => actual?.includes(value)))
      return false
  return true
}

function boundResourcesFulfill(
  requirement: BeeGameAssetRequirement,
  resources: readonly BeeGameProjectResource[],
): boolean {
  const profile = requirement.acquisition_profile
  const eligible = resources.filter(resource =>
    Boolean(
      resource.dimension && profile.dimensions.some(value => value === resource.dimension) &&
      (!profile.styles.length || intersectsNormalized(profile.styles, resource.styles ?? [])),
    ),
  )
  const obligations = profile.coverage?.length
    ? profile.coverage
    : [{
        asset_kinds: profile.asset_kinds,
        usage_tags: profile.usage_tags,
        capabilities: profile.capabilities,
      }]
  return obligations.every(obligation =>
    eligible.some(resource => resourceCovers(resource, obligation)),
  )
}

/** Verify the durable resource contract still represents the injected IR. */
export function resourceIrManifestIssues(
  run: DeliveryRun,
  workspacePath: string,
  gameIrOverride?: DownstreamIr,
): string[] {
  const gameIr = object(gameIrOverride ?? run.activeDispatch?.request?.contract.gameIr)
  const assets = Array.isArray(gameIr?.assets)
    ? gameIr.assets.map(object).filter(Boolean) as Record<string, unknown>[]
    : undefined
  if (!gameIr || !assets)
    return ['The resource dispatch has no valid Game IR asset requirements.']

  let manifest
  try {
    manifest = readBeeGameAssetManifestSync(workspacePath)
  } catch {
    return []
  }
  const manifestById = new Map(
    manifest.requirements.map(requirement => [requirement.id, requirement]),
  )
  const resourcesById = new Map(
    manifest.resources.map(resource => [resource.id, resource]),
  )
  const bindingsByRequirement = new Map(
    auditAssetContract(workspacePath).bindings.map(binding => [
      binding.requirementId,
      binding.resourceIds,
    ]),
  )
  const expectedIds = new Set<string>()
  const issues: string[] = []
  for (const asset of assets) {
    const requirementId = typeof asset.id === 'string' ? asset.id : undefined
    if (!requirementId) {
      issues.push('Game IR contains an asset requirement without an ID.')
      continue
    }
    expectedIds.add(requirementId)
    const requirement = manifestById.get(requirementId)
    if (!requirement) {
      issues.push(`Manifest requirement is missing for IR requirement: ${requirementId}.`)
      continue
    }
    const profile = requirement.acquisition_profile
    const comparisons: Array<[string, readonly string[] | undefined, readonly string[]]> = [
      ['dimensions', stringArray(asset.dimensions), profile.dimensions],
      ['kinds', stringArray(asset.kinds), profile.asset_kinds],
      ['usageTags', stringArray(asset.usageTags), profile.usage_tags],
      ['capabilities', stringArray(asset.capabilities), profile.capabilities],
      ['styles', stringArray(asset.styles), profile.styles],
      ['acceptanceCriteria', stringArray(asset.acceptanceCriteria) ?? [], profile.acceptance_criteria ?? []],
    ]
    for (const [field, expected, actual] of comparisons)
      if (!expected || !sameStrings(expected, actual))
        issues.push(`Manifest requirement ${requirementId} does not preserve IR ${field}.`)
    if (asset.required !== requirement.required)
      issues.push(`Manifest requirement ${requirementId} does not preserve IR required.`)
    if (asset.name !== requirement.name)
      issues.push(`Manifest requirement ${requirementId} does not preserve IR name.`)
    if (asset.purpose !== requirement.purpose)
      issues.push(`Manifest requirement ${requirementId} does not preserve IR purpose.`)
    if (
      normalizedCoverage(asset.coverage, 'ir') !==
      normalizedCoverage(profile.coverage, 'manifest')
    )
      issues.push(`Manifest requirement ${requirementId} does not preserve IR coverage.`)
    if (!sourcingPolicyMatches(asset.sourcing, profile.sourcing_policy))
      issues.push(`Manifest requirement ${requirementId} does not preserve IR sourcing.`)
    const boundResources = (bindingsByRequirement.get(requirementId) ?? [])
      .map(resourceId => resourcesById.get(resourceId))
      .filter(Boolean) as BeeGameProjectResource[]
    if (boundResources.length && !boundResourcesFulfill(requirement, boundResources))
      issues.push(
        `Bound resources do not satisfy IR acquisition profile for ${requirementId}.`,
      )
  }
  for (const requirement of manifest.requirements)
    if (!expectedIds.has(requirement.id))
      issues.push(`Manifest requirement is not defined by the injected IR: ${requirement.id}.`)

  return issues
}

export async function startResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error(
      `resource production requires RESOURCE_PREPARATION, got ${input.run.phase}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch

  const common = {
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    phase: 'RESOURCE_PREPARATION' as const,
    taskId: 'RESOURCE_PREPARATION',
    revision: input.run.revision.document,
    allowedPaths: resourcePreparationAllowedPaths(),
  }
  return input.dispatcher.dispatch({
    ...common,
    workerType: 'resource-planner',
    contract: {
      task: 'RESOURCE_PREPARATION',
      resourceLibraryUsage: confirmedResourceLibraryUsage(
        input.run.confirmedBriefContext,
      ),
      currentResourceIssues: [
        ...currentResourceContractIssues(input.workspacePath),
      ],
      systemDeliveryContract: buildSystemDeliveryContract(),
    },
  })
}

export async function completeResourceTask(input: {
  run: DeliveryRun
  workspacePath: string
  terminal?: Extract<
    WorkerTerminalResult,
    { workerType: 'resource-planner' }
  >
  /**
   * A public, already-read IR lets the host accept an existing delivery
   * without launching a no-op resource worker. The terminal path keeps using
   * the exact dispatch payload that produced the artifacts.
   */
  gameIr?: DownstreamIr
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error('resource production is not the active phase')
  if (input.terminal?.workerType === 'resource-planner' || input.gameIr) {
    if (input.run.resourceProductionState.currentTask === 'RESOURCE_DELIVERED')
      throw new Error('resource preparation is already complete')
    const audit = auditAssetContract(input.workspacePath)
    const irManifestIssues = resourceIrManifestIssues(
      input.run,
      input.workspacePath,
      input.gameIr,
    )
    const requiredIds = audit.requirements
      .filter(requirement => requirement.required)
      .map(requirement => requirement.id)
    const bindingsByRequirement = new Map(
      audit.bindings.map(binding => [
        binding.requirementId,
        binding.resourceIds,
      ]),
    )
    const missingRequirementIds = requiredIds.filter(
      requirementId => !bindingsByRequirement.has(requirementId),
    )
    const deliveryReceipt =
      audit.present && !missingRequirementIds.length
        ? {
            bindings: requiredIds.map(requirementId => ({
              requirementId,
              resourceIds: [...bindingsByRequirement.get(requirementId)!],
            })),
            catalogObserved: audit.resources.some(
              resource => resource.sourceType === 'resource-library',
            ),
            resourceDigest: await computeResourceRevision(
              input.workspacePath,
              input.run.revision.document,
            ),
            acceptedAt: new Date().toISOString(),
          }
        : undefined
    const boundIrResultId = input.gameIr?.resultId ?? currentResourceIrResultId(input.run)
    const readiness = auditResourceDeliveryReadiness({
      workspacePath: input.workspacePath,
      confirmedPolicy: confirmedResourceLibraryUsage(
        input.run.confirmedBriefContext,
      ),
      catalogObserved: deliveryReceipt?.catalogObserved ?? false,
    })
    if (
      !audit.present ||
      !audit.valid ||
      audit.requirements.length === 0 ||
      irManifestIssues.length > 0 ||
      missingRequirementIds.length > 0 ||
      !readiness.ready
    ) {
      const issues = [...new Set([
        ...audit.issues,
        ...(audit.requirements.length === 0 ? ['Resource delivery requires at least one canonical requirement.'] : []),
        ...irManifestIssues,
        ...(missingRequirementIds.length
          ? [`Missing verified resource bindings: ${missingRequirementIds.join(', ')}`]
          : []),
        ...readiness.readinessIssues,
      ])]
      return {
        ...input.run,
        activeDispatch: undefined,
        status: 'needs_action',
        blockedReason: issues.join('; ') || 'resource preparation is incomplete',
        resourceProductionState: {
          ...input.run.resourceProductionState,
          ...(boundIrResultId ? { irResultId: boundIrResultId } : {}),
        },
      }
    }
    const accepted: DeliveryRun = {
      ...input.run,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceProductionState: {
        currentTask: 'RESOURCE_DELIVERED',
        ...(boundIrResultId ? { irResultId: boundIrResultId } : {}),
        deliveryReceipt,
      },
    }
    const resourceRevision = await computeResourceRevision(
      input.workspacePath,
      input.run.revision.document,
    )
    const evidence = {
      path: 'assets/asset-manifest.json',
      kind: 'resource_preparation' as const,
      revision: resourceRevision,
      status: 'passed' as const,
      observedAt: new Date().toISOString(),
    }
    return transitionDeliveryRun(
      accepted,
      { type: 'resource_preparation_ready', resourceRevision, evidence },
    )
  }
  throw new Error('retired resource worker terminal')
}
