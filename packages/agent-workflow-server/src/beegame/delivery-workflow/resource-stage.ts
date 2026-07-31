import { auditAssetContract } from '../asset-contract-audit'
import {
  effectiveAssetFormats,
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from '../asset-contracts'
import { existsSync, readFileSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
  type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import { computeResourceRevision } from './revision'
import { isWorkflowEvidenceFile } from './evidence'
import { WORKFLOW_EVIDENCE_DIRECTORY } from './types'
import { transitionDeliveryRun } from './transition'
import type {
  DeliveryRun,
  ResourceEvidenceSnapshot,
  WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }

type ResourceAudit = ResourceDeliveryReadiness

function runtimeAssetRoot(workspacePath: string): string | undefined {
  const manifestPath = assetManifestPath(workspacePath)
  if (!existsSync(manifestPath)) return undefined
  try {
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      return undefined
    const projectTarget = (manifest as Record<string, unknown>).project_target
    if (
      !projectTarget ||
      typeof projectTarget !== 'object' ||
      Array.isArray(projectTarget)
    )
      return undefined
    const value = (projectTarget as Record<string, unknown>).runtime_asset_root
    return typeof value === 'string' && value.trim() ? value.trim() : undefined
  } catch {
    return undefined
  }
}

function assetManifestPath(workspacePath: string): string {
  return join(resolve(workspacePath), 'assets', 'asset-manifest.json')
}

function assetManifestExists(workspacePath: string): boolean {
  return existsSync(assetManifestPath(workspacePath))
}

function hasInlineImportReceipts(workspacePath: string): boolean {
  if (!assetManifestExists(workspacePath)) return false
  try {
    const manifest = JSON.parse(
      readFileSync(assetManifestPath(workspacePath), 'utf8'),
    ) as unknown
    if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest))
      return false
    const imports = (manifest as Record<string, unknown>).imports
    if (!Array.isArray(imports)) return false
    return imports.some(value => {
      if (!value || typeof value !== 'object' || Array.isArray(value))
        return false
      const resourceImport = value as Record<string, unknown>
      return (
        resourceImport.content_profile !== undefined ||
        resourceImport.technical_facts !== undefined ||
        resourceImport.local_file_hashes !== undefined ||
        resourceImport.dependencies !== undefined
      )
    })
  } catch {
    return false
  }
}

async function hasCanonicalAssetManifest(
  workspacePath: string,
): Promise<boolean> {
  if (!assetManifestExists(workspacePath)) return false
  try {
    await readBeeGameAssetManifest(workspacePath)
    return true
  } catch {
    return false
  }
}

export function resourcePreparationAllowedPaths(
  workspacePath: string,
): string[] {
  return [
    'assets/asset-manifest.json',
    ...(runtimeAssetRoot(workspacePath)
      ? [`${runtimeAssetRoot(workspacePath)!.replace(/\/+$/, '')}/`]
      : []),
  ]
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    !normalized.startsWith('/') &&
    !normalized.split('/').includes('..') &&
    allowedPaths.some(allowed => {
      const scope = allowed.replaceAll('\\', '/').replace(/\/+$/, '')
      return normalized === scope || normalized.startsWith(`${scope}/`)
    })
  )
}

async function repairDeterministicPreparationState(input: {
  workspacePath: string
  confirmedPolicy?: ReturnType<typeof confirmedResourceLibraryUsage>
}): Promise<void> {
  // `readBeeGameAssetManifest` intentionally exposes a non-persistable draft
  // when the file is absent. A fresh resource attempt owns manifest creation;
  // deterministic repair applies only to an existing canonical contract.
  if (!assetManifestExists(input.workspacePath)) return
  const compactInlineReceipts = hasInlineImportReceipts(input.workspacePath)
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  let changed = false
  if (
    input.confirmedPolicy &&
    manifest.project_target?.resource_library_usage !== input.confirmedPolicy
  ) {
    manifest.project_target = {
      ...(manifest.project_target ?? {}),
      resource_library_usage: input.confirmedPolicy,
    }
    changed = true
  }
  const currentImportIds = new Set(
    (manifest.imports ?? []).map(resourceImport => resourceImport.id),
  )
  const coveredCompositionIds = materializedCompositionIds(
    input.workspacePath,
    manifest,
  )
  manifest.requirements = manifest.requirements.map(requirement => {
    const bindings = requirement.satisfied_by
    const importIds = (bindings?.import_ids ?? []).filter(importId =>
      currentImportIds.has(importId),
    )
    const compositionIds = (bindings?.composition_ids ?? []).filter(
      compositionId => coveredCompositionIds.has(compositionId),
    )
    const projectReferences = (bindings?.project_references ?? []).filter(
      reference => projectReferenceExists(input.workspacePath, reference),
    )
    if (
      importIds.length !== (bindings?.import_ids?.length ?? 0) ||
      compositionIds.length !== (bindings?.composition_ids?.length ?? 0) ||
      projectReferences.length !== (bindings?.project_references?.length ?? 0)
    )
      changed = true
    const repairedBindings = bindings
      ? {
          ...(importIds.length ? { import_ids: importIds } : {}),
          ...(compositionIds.length ? { composition_ids: compositionIds } : {}),
          ...(projectReferences.length
            ? { project_references: projectReferences }
            : {}),
        }
      : undefined
    const hasBinding = Boolean(
      repairedBindings?.import_ids?.length ||
        repairedBindings?.composition_ids?.length ||
        repairedBindings?.project_references?.length,
    )
    const normalizedRequirement =
      repairedBindings && hasBinding
        ? { ...requirement, satisfied_by: repairedBindings }
        : (() => {
            const { satisfied_by: _satisfiedBy, ...withoutBindings } =
              requirement
            return withoutBindings
          })()
    if (normalizedRequirement.status !== 'satisfied' || hasBinding)
      return normalizedRequirement
    changed = true
    return { ...normalizedRequirement, status: 'planned' as const }
  })
  manifest.imports = (manifest.imports ?? []).map(resourceImport => {
    const hasEvidence = Boolean(
      resourceImport.usage_evidence?.references?.length ||
        resourceImport.usage_evidence?.runtime_event_ids?.length,
    )
    if (resourceImport.status !== 'referenced' || hasEvidence)
      return resourceImport
    changed = true
    const { usage_evidence: _usageEvidence, ...available } = resourceImport
    return { ...available, status: 'available' as const }
  })
  manifest.compositions = (manifest.compositions ?? []).map(composition => {
    const hasRecipe = Boolean(composition.recipe?.path)
    const hasEvidence = Boolean(
      composition.integration_evidence?.references?.length ||
        composition.integration_evidence?.runtime_event_ids?.length,
    )
    if (composition.status === 'planned' && hasRecipe) {
      changed = true
      const {
        recipe: _recipe,
        integration_evidence: _evidence,
        ...planned
      } = composition
      return planned
    }
    if (
      (composition.status !== 'assembled' &&
        composition.status !== 'integrated') ||
      (hasRecipe && (composition.status !== 'integrated' || hasEvidence))
    )
      return composition
    changed = true
    const {
      integration_evidence: _integrationEvidence,
      recipe: _recipe,
      ...planned
    } = composition
    return { ...planned, status: 'planned' as const }
  })
  if (changed || compactInlineReceipts)
    await writeBeeGameAssetManifest(input.workspacePath, manifest)
}

function projectReferenceExists(
  workspacePath: string,
  reference: string,
): boolean {
  if (!reference.trim() || reference !== reference.trim()) return false
  const root = resolve(workspacePath)
  const target = resolve(root, reference)
  return target.startsWith(`${root}${sep}`) && existsSync(target)
}

function materializedCompositionIds(
  workspacePath: string,
  manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
): Set<string> {
  const importIds = new Set((manifest.imports ?? []).map(item => item.id))
  return new Set(
    (manifest.compositions ?? [])
      .filter(
        composition =>
          composition.members.some(
            member => member.import_id && importIds.has(member.import_id),
          ) ||
          Boolean(
            composition.recipe?.path &&
              projectReferenceExists(workspacePath, composition.recipe.path),
          ),
      )
      .map(composition => composition.id),
  )
}

function requirementHasCurrentCoverage(
  workspacePath: string,
  requirement: Awaited<
    ReturnType<typeof readBeeGameAssetManifest>
  >['requirements'][number],
  importIds: Set<string>,
  coveredCompositionIds: Set<string>,
): boolean {
  const bindings = requirement.satisfied_by
  return Boolean(
    bindings?.import_ids?.some(id => importIds.has(id)) ||
      bindings?.composition_ids?.some(id => coveredCompositionIds.has(id)) ||
      bindings?.project_references?.some(reference =>
        projectReferenceExists(workspacePath, reference),
      ),
  )
}

async function removeIncompatibleImports(input: {
  workspacePath: string
  importIds: string[]
}): Promise<string[]> {
  if (!input.importIds.length) return []
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const removed = new Set(input.importIds)
  manifest.imports = (manifest.imports ?? []).filter(
    resourceImport => !removed.has(resourceImport.id),
  )
  manifest.requirements = manifest.requirements.map(requirement => {
    const bindings = requirement.satisfied_by
    if (!bindings) return requirement
    const importIds = (bindings.import_ids ?? []).filter(id => !removed.has(id))
    const repaired = {
      ...(importIds.length ? { import_ids: importIds } : {}),
      ...(bindings.composition_ids?.length
        ? { composition_ids: bindings.composition_ids }
        : {}),
      ...(bindings.project_references?.length
        ? { project_references: bindings.project_references }
        : {}),
    }
    const hasBinding = Object.keys(repaired).length > 0
    return {
      ...requirement,
      ...(hasBinding
        ? { satisfied_by: repaired }
        : { satisfied_by: undefined }),
      ...(requirement.status === 'satisfied' && !hasBinding
        ? { status: 'planned' as const }
        : {}),
    }
  })
  manifest.compositions = (manifest.compositions ?? []).map(composition => {
    const members = composition.members.filter(
      member => !member.import_id || !removed.has(member.import_id),
    )
    if (members.length === composition.members.length) return composition
    const {
      recipe: _recipe,
      integration_evidence: _integrationEvidence,
      ...planned
    } = composition
    return { ...planned, members, status: 'planned' as const }
  })
  await writeBeeGameAssetManifest(input.workspacePath, manifest)
  return unresolvedResourceRequirementIds(input.workspacePath, manifest)
}

function unresolvedResourceRequirementIds(
  workspacePath: string,
  manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
): string[] {
  const importIds = new Set((manifest.imports ?? []).map(item => item.id))
  const coveredCompositionIds = materializedCompositionIds(
    workspacePath,
    manifest,
  )
  return manifest.requirements.flatMap(requirement => {
    if (requirement.required === false || !requirement.resource_requirement)
      return []
    const covered = requirementHasCurrentCoverage(
      workspacePath,
      requirement,
      importIds,
      coveredCompositionIds,
    )
    return covered ? [] : [requirement.id]
  })
}

function unresolvedRequiredSourceDecisionIds(
  workspacePath: string,
  manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
): string[] {
  const importIds = new Set((manifest.imports ?? []).map(item => item.id))
  const coveredCompositionIds = materializedCompositionIds(
    workspacePath,
    manifest,
  )
  return manifest.requirements.flatMap(requirement => {
    if (
      requirement.required === false ||
      requirement.resource_requirement ||
      requirement.source_decision ||
      requirementHasCurrentCoverage(
        workspacePath,
        requirement,
        importIds,
        coveredCompositionIds,
      )
    )
      return []
    return [requirement.id]
  })
}

export type CurrentResourceReviewState = {
  requirementIds: Set<string>
  unresolvedRequirementIds: Set<string>
  importIds: Set<string>
  requirementImportIds: Map<string, Set<string>>
}

export async function readCurrentResourceReviewState(
  workspacePath: string,
): Promise<CurrentResourceReviewState> {
  const manifest = await readBeeGameAssetManifest(workspacePath)
  return {
    requirementIds: new Set(
      manifest.requirements.map(requirement => requirement.id),
    ),
    unresolvedRequirementIds: new Set([
      ...unresolvedResourceRequirementIds(workspacePath, manifest),
      ...unresolvedRequiredSourceDecisionIds(workspacePath, manifest),
    ]),
    importIds: new Set((manifest.imports ?? []).map(resource => resource.id)),
    requirementImportIds: new Map(
      manifest.requirements.map(requirement => [
        requirement.id,
        new Set(requirement.satisfied_by?.import_ids ?? []),
      ]),
    ),
  }
}

function buildResourceSelectionPlan(
  manifest: Awaited<ReturnType<typeof readBeeGameAssetManifest>>,
  selectionRequirementIds: string[],
) {
  const selectionIds = new Set(selectionRequirementIds)
  const currentImportIds = new Set(
    (manifest.imports ?? []).map(item => item.id),
  )
  type ResourceSelectionGroup = {
    responsibilities: Array<{
      requirementId: string
      purpose: string
      remainingImportBudget: number
    }>
    acceptedFormats: string[]
    resourceRequirement: Record<string, unknown>
    noMatch: string | undefined
  }
  const groups = new Map<string, ResourceSelectionGroup>()
  for (const requirement of manifest.requirements) {
    const resourceRequirement = requirement.resource_requirement
    if (!selectionIds.has(requirement.id) || !resourceRequirement) continue
    const boundImportCount =
      requirement.satisfied_by?.import_ids?.filter(id =>
        currentImportIds.has(id),
      ).length ?? 0
    const acceptedFormats = effectiveAssetFormats(
      requirement,
      manifest.project_target,
    )
    const {
      purpose: _resourcePurpose,
      import_budget: _importBudget,
      ...sharedRequirement
    } = resourceRequirement
    const normalizedRequirement = {
      ...sharedRequirement,
      accepted_formats: acceptedFormats,
    }
    const key = JSON.stringify({
      acceptedFormats,
      resourceRequirement: normalizedRequirement,
      noMatch: resourceRequirement.no_match,
    })
    const group: ResourceSelectionGroup = groups.get(key) ?? {
      responsibilities: [],
      acceptedFormats,
      resourceRequirement: normalizedRequirement,
      noMatch: resourceRequirement.no_match,
    }
    group.responsibilities.push({
      requirementId: requirement.id,
      purpose:
        requirement.purpose ?? resourceRequirement.purpose ?? requirement.id,
      remainingImportBudget: Math.max(
        0,
        (resourceRequirement.import_budget ?? 0) - boundImportCount,
      ),
    })
    groups.set(key, group)
  }
  return [...groups.values()]
    .map(group => ({
      ...group,
      responsibilities: [...group.responsibilities].sort((left, right) =>
        left.requirementId.localeCompare(right.requirementId),
      ),
    }))
    .sort((left, right) =>
      left.responsibilities[0]!.requirementId.localeCompare(
        right.responsibilities[0]!.requirementId,
      ),
    )
    .slice(0, 1)
}

export async function startResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error(
      `resource preparation requires RESOURCE_PREPARATION, got ${input.run.phase}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return Promise.resolve(input.run.activeDispatch)
  const confirmedPolicy = confirmedResourceLibraryUsage(
    input.run.confirmedBriefContext,
  )
  const hasCanonicalManifest = await hasCanonicalAssetManifest(
    input.workspacePath,
  )
  const resourceRemediation = input.run.resourceRemediation
  let existingContract = auditAssetContract(input.workspacePath)
  if (
    hasCanonicalManifest &&
    (resourceRemediation || (existingContract.imports?.length ?? 0) > 0)
  ) {
    await repairDeterministicPreparationState({
      workspacePath: input.workspacePath,
      ...(confirmedPolicy ? { confirmedPolicy } : {}),
    })
    existingContract = auditAssetContract(input.workspacePath)
  }
  const pendingSelectionIdsBeforeRemediation = hasCanonicalManifest
    ? unresolvedResourceRequirementIds(
        input.workspacePath,
        await readBeeGameAssetManifest(input.workspacePath),
      )
    : []
  const existingImportIds = new Set(
    (existingContract.imports ?? []).map(resourceImport => resourceImport.id),
  )
  const requestedReselectImportIds =
    resourceRemediation?.mode === 'reselection'
      ? [...new Set(resourceRemediation.reselectImportIds ?? [])]
      : []
  const unknownReselectImportIds = requestedReselectImportIds.filter(
    importId => !existingImportIds.has(importId),
  )
  const matchedRequestedReselectImportIds = requestedReselectImportIds.filter(
    importId => existingImportIds.has(importId),
  )
  const activeResourceRemediation =
    resourceRemediation?.mode === 'reselection' &&
    matchedRequestedReselectImportIds.length === 0 &&
    pendingSelectionIdsBeforeRemediation.length > 0
      ? undefined
      : resourceRemediation
  const targetIncompatibleImportIds = (existingContract.imports ?? [])
    .filter(resourceImport => resourceImport.targetFormatSupported === false)
    .map(resourceImport => resourceImport.id)
  const incompatibleImportIds = [
    ...new Set([
      ...matchedRequestedReselectImportIds,
      ...targetIncompatibleImportIds,
    ]),
  ]
  const selectionRequirementIds = incompatibleImportIds.length
    ? await removeIncompatibleImports({
        workspacePath: input.workspacePath,
        importIds: incompatibleImportIds,
      })
    : hasCanonicalManifest
      ? unresolvedResourceRequirementIds(
          input.workspacePath,
          await readBeeGameAssetManifest(input.workspacePath),
        )
      : []
  if (incompatibleImportIds.length)
    existingContract = auditAssetContract(input.workspacePath)
  const currentInventoryPolicyIssues = hasCanonicalManifest
    ? await auditResourceInventoryPolicy(input.workspacePath)
    : []
  const needsDeterministicRepair =
    hasCanonicalManifest &&
    incompatibleImportIds.length === 0 &&
    (activeResourceRemediation !== undefined ||
      ((existingContract.imports?.length ?? 0) > 0 &&
        (!existingContract.valid ||
          currentInventoryPolicyIssues.length > 0 ||
          pendingSelectionIdsBeforeRemediation.length === 0)))
  const repairContext = incompatibleImportIds.length
    ? {
        sourceRevision: input.run.revision.document,
        attempt: activeResourceRemediation?.attempt ?? 1,
        issues: [
          ...new Set([
            ...(activeResourceRemediation?.issues ?? []),
            ...(targetIncompatibleImportIds.length
              ? [
                  'Existing canonical imports are incompatible with the current project target and require bounded reselection.',
                ]
              : []),
            ...(activeResourceRemediation && unknownReselectImportIds.length
              ? [
                  `Reviewer-requested reselection import IDs are not present in the current manifest: ${unknownReselectImportIds.join(', ')}.`,
                ]
              : []),
          ]),
        ],
        mode: 'reselection' as const,
        preserveImportIds: [],
        preserveCompositionIds: [],
        reselectImportIds: incompatibleImportIds,
      }
    : needsDeterministicRepair
      ? {
          sourceRevision: input.run.revision.document,
          attempt: activeResourceRemediation?.attempt ?? 1,
          issues: [
            ...new Set([
              ...(activeResourceRemediation?.issues ?? []),
              ...currentInventoryPolicyIssues,
              ...(!existingContract.valid ? existingContract.issues : []),
              ...(activeResourceRemediation === undefined &&
              currentInventoryPolicyIssues.length === 0 &&
              existingContract.valid
                ? [
                    'A canonical resource inventory already exists; resume it without selecting or downloading replacement resources.',
                  ]
                : []),
            ]),
          ],
          mode: 'repair' as const,
          preserveImportIds: [],
          preserveCompositionIds: [],
        }
      : undefined
  const reselectImportIds = new Set(
    repairContext?.mode === 'reselection'
      ? (repairContext.reselectImportIds ?? [])
      : [],
  )
  const remediation =
    repairContext && hasCanonicalManifest
      ? {
          ...repairContext,
          preserveImportIds: (existingContract.imports ?? [])
            .map(item => item.id)
            .filter(importId => !reselectImportIds.has(importId)),
          preserveCompositionIds: existingContract.compositions.map(
            item => item.id,
          ),
        }
      : undefined
  const selectionPlan = hasCanonicalManifest
    ? buildResourceSelectionPlan(
        await readBeeGameAssetManifest(input.workspacePath),
        selectionRequirementIds,
      )
    : []
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'resource-preparer',
    phase: 'RESOURCE_PREPARATION',
    revision: input.run.revision.document,
    allowedPaths: resourcePreparationAllowedPaths(input.workspacePath),
    contract: {
      documentRevision: input.run.revision.document,
      resourceLibraryUsage: confirmedPolicy,
      assetPlan: 'docs/ASSET_PLAN.md',
      dynamicRuntimeAssetRoot:
        runtimeAssetRoot(input.workspacePath) ??
        'Declare project_target.runtime_asset_root in the manifest before importing; that exact workspace-relative directory is in resource scope.',
      resourceAttemptMode:
        remediation?.mode === 'reselection'
          ? 'reselection'
          : selectionPlan.length
            ? 'selection'
            : remediation
              ? 'repair'
              : 'fresh',
      ...(hasCanonicalManifest ? { selectionPlan } : {}),
      ...(remediation ? { remediation } : {}),
    },
  })
}

export async function completeResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'resource-preparer' }>
  audit: ResourceAudit
  resourceEvidence?: ResourceEvidenceSnapshot
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error('resource preparation is not the active phase')
  const confirmedPolicy = confirmedResourceLibraryUsage(
    input.run.confirmedBriefContext,
  )
  await repairDeterministicPreparationState({
    workspacePath: input.workspacePath,
    ...(confirmedPolicy ? { confirmedPolicy } : {}),
  })
  const resourceRevision = await computeResourceRevision(
    input.workspacePath,
    input.run.revision.document,
  )
  const currentAudit = auditResourcesForPreparation({
    workspacePath: input.workspacePath,
    confirmedBriefContext: input.run.confirmedBriefContext,
    ...(input.resourceEvidence
      ? { resourceEvidence: input.resourceEvidence }
      : {}),
  })
  const allowedPaths = resourcePreparationAllowedPaths(input.workspacePath)
  const outOfScope = input.terminal.writtenPaths.filter(
    path =>
      path !== input.terminal.evidencePath && !pathAllowed(path, allowedPaths),
  )
  const contract = auditAssetContract(input.workspacePath)
  const currentManifest = await readBeeGameAssetManifest(input.workspacePath)
  const unresolvedSelectionIds = unresolvedResourceRequirementIds(
    input.workspacePath,
    currentManifest,
  )
  // Fresh preparation has exactly one responsibility: establish the valid
  // canonical manifest. Selection starts in a new dispatch so the service can
  // derive and provide the authoritative grouped selectionPlan from that
  // manifest instead of asking one model turn to plan and search at once.
  if (
    input.terminal.attemptMode === 'fresh' &&
    input.terminal.status === 'completed' &&
    contract.present &&
    contract.valid &&
    unresolvedSelectionIds.length > 0 &&
    outOfScope.length === 0 &&
    isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  ) {
    const planned = {
      ...input.run,
      phase: 'RESOURCE_PREPARATION' as const,
      status: 'running' as const,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceRemediation: undefined,
    }
    return input.resourceEvidence
      ? { ...planned, resourceEvidence: input.resourceEvidence }
      : planned
  }
  const unavailableRequiredIds = currentManifest.requirements
    .filter(
      requirement =>
        requirement.required !== false &&
        requirement.source_decision?.type === 'unavailable',
    )
    .map(requirement => requirement.id)
  const reselectImportIds = (contract.imports ?? [])
    .filter(resourceImport => resourceImport.targetFormatSupported === false)
    .map(resourceImport => resourceImport.id)
  const inventoryPolicyIssues = await auditResourceInventoryPolicy(
    input.workspacePath,
  )
  const policy =
    currentAudit.confirmedPolicy ??
    currentAudit.manifestPolicy ??
    confirmedPolicy
  const issues = [
    ...currentAudit.issues,
    ...inventoryPolicyIssues,
    ...(outOfScope.length
      ? [
          `resource preparer wrote outside resource scope: ${outOfScope.join(', ')}`,
        ]
      : []),
    ...(!isWorkflowEvidenceFile(
      input.workspacePath,
      input.terminal.evidencePath,
    )
      ? [
          'resource preparation evidence is outside the workflow evidence directory.',
        ]
      : []),
    ...(input.terminal.status === 'completed' &&
    (policy === 'preferred' || policy === 'required') &&
    currentAudit.importCount > 0 &&
    input.resourceEvidence?.state !== 'current'
      ? ['Resource Library import has no current native provenance.']
      : []),
    ...(input.terminal.status === 'completed' &&
    (policy === 'preferred' || policy === 'required') &&
    currentAudit.failedActions.length
      ? [
          `unresolved Resource Library actions: ${currentAudit.failedActions.join(', ')}`,
        ]
      : []),
    ...(input.terminal.status === 'completed' && !contract.present
      ? ['resource preparation must create assets/asset-manifest.json.']
      : []),
    ...(input.terminal.status === 'completed' && unresolvedSelectionIds.length
      ? [
          `resource selection has unresolved file-backed requirements: ${unresolvedSelectionIds.join(', ')}. Import compatible candidates or record the approved no-match outcome.`,
        ]
      : []),
    ...(input.terminal.status === 'completed' && unavailableRequiredIds.length
      ? [
          `required library resources are unavailable: ${unavailableRequiredIds.join(', ')}.`,
        ]
      : []),
    ...(input.terminal.status === 'completed' &&
    !sameIds(
      input.terminal.importIds,
      (contract.imports ?? []).map(item => item.id),
    )
      ? ['resource preparer import IDs do not match the asset manifest.']
      : []),
    ...(input.terminal.status === 'completed' &&
    !sameIds(
      input.terminal.compositionIds,
      contract.compositions.map(item => item.id),
    )
      ? ['resource preparer composition IDs do not match the asset manifest.']
      : []),
    ...(input.terminal.status !== 'completed'
      ? [`resource preparation ${input.terminal.status}`]
      : []),
  ]
  const evidenceStatus = issues.length ? 'failed' : 'passed'
  const evidence = {
    path: input.terminal.evidencePath,
    kind: 'resource_preparation' as const,
    revision: resourceRevision,
    status: evidenceStatus as 'failed' | 'passed',
    observedAt: new Date().toISOString(),
  }
  const transitioned = issues.length
    ? transitionDeliveryRun(
        { ...input.run, activeDispatch: undefined },
        {
          type: 'resource_preparation_needs_action',
          reason: issues.join('; '),
          evidence,
        },
      )
    : transitionDeliveryRun(
        { ...input.run, activeDispatch: undefined },
        { type: 'resource_preparation_ready', resourceRevision, evidence },
      )
  const next = issues.length
    ? {
        ...transitioned,
        resourceRemediation: {
          sourceRevision: resourceRevision,
          attempt: input.run.resourceRemediation?.attempt ?? 1,
          issues: [issues.join('; ')],
          mode: reselectImportIds.length
            ? ('reselection' as const)
            : ('repair' as const),
          preserveImportIds: (contract.imports ?? [])
            .map(resourceImport => resourceImport.id)
            .filter(importId => !reselectImportIds.includes(importId)),
          preserveCompositionIds: contract.compositions.map(
            composition => composition.id,
          ),
          ...(reselectImportIds.length ? { reselectImportIds } : {}),
        },
      }
    : transitioned
  return input.resourceEvidence
    ? { ...next, resourceEvidence: input.resourceEvidence }
    : next
}

export async function reconcileCurrentResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  resourceEvidence?: ResourceEvidenceSnapshot
}): Promise<DeliveryRun | undefined> {
  if (
    input.run.phase !== 'RESOURCE_PREPARATION' ||
    input.run.activeDispatch?.status === 'running' ||
    !(await hasCanonicalAssetManifest(input.workspacePath))
  )
    return undefined
  const confirmedPolicy = confirmedResourceLibraryUsage(
    input.run.confirmedBriefContext,
  )
  await repairDeterministicPreparationState({
    workspacePath: input.workspacePath,
    ...(confirmedPolicy ? { confirmedPolicy } : {}),
  })
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const contract = auditAssetContract(input.workspacePath)
  const readiness = auditResourcesForPreparation({
    workspacePath: input.workspacePath,
    confirmedBriefContext: input.run.confirmedBriefContext,
    ...(input.resourceEvidence
      ? { resourceEvidence: input.resourceEvidence }
      : {}),
  })
  const inventoryPolicyIssues = await auditResourceInventoryPolicy(
    input.workspacePath,
  )
  const unresolvedSelectionIds = unresolvedResourceRequirementIds(
    input.workspacePath,
    manifest,
  )
  const unresolvedSourceDecisionIds = unresolvedRequiredSourceDecisionIds(
    input.workspacePath,
    manifest,
  )
  const incompatibleImportIds = (contract.imports ?? [])
    .filter(resourceImport => resourceImport.targetFormatSupported === false)
    .map(resourceImport => resourceImport.id)
  const unavailableRequiredIds = manifest.requirements
    .filter(
      requirement =>
        requirement.required !== false &&
        requirement.source_decision?.type === 'unavailable',
    )
    .map(requirement => requirement.id)
  const policy =
    readiness.confirmedPolicy ?? readiness.manifestPolicy ?? confirmedPolicy
  const issues = [
    ...readiness.issues,
    ...inventoryPolicyIssues,
    ...(!contract.present || !contract.valid ? contract.issues : []),
    ...(unresolvedSelectionIds.length
      ? [
          `resource selection has unresolved file-backed requirements: ${unresolvedSelectionIds.join(', ')}`,
        ]
      : []),
    ...(unresolvedSourceDecisionIds.length
      ? [
          `required non-library responsibilities have no exact durable source decision: ${unresolvedSourceDecisionIds.join(', ')}`,
        ]
      : []),
    ...(incompatibleImportIds.length
      ? [
          `current imports are incompatible with the project target: ${incompatibleImportIds.join(', ')}`,
        ]
      : []),
    ...(unavailableRequiredIds.length
      ? [
          `required library resources are unavailable: ${unavailableRequiredIds.join(', ')}`,
        ]
      : []),
    ...((policy === 'preferred' || policy === 'required') &&
    readiness.failedActions.length
      ? [
          `unresolved Resource Library actions: ${readiness.failedActions.join(', ')}`,
        ]
      : []),
  ]
  if (issues.length) return undefined
  const resourceRevision = await computeResourceRevision(
    input.workspacePath,
    input.run.revision.document,
  )
  const evidencePath = `${WORKFLOW_EVIDENCE_DIRECTORY}resource-preparation-reconciled-${input.run.runId.slice(0, 8)}.json`
  await mkdir(join(input.workspacePath, WORKFLOW_EVIDENCE_DIRECTORY), {
    recursive: true,
  })
  await writeFile(
    join(input.workspacePath, evidencePath),
    `${JSON.stringify(
      {
        runId: input.run.runId,
        revision: resourceRevision,
        status: 'passed',
        reason:
          'Current canonical resource state already satisfies deterministic preparation gates; stale remediation was not dispatched.',
        requirementCount: manifest.requirements.length,
        importCount: readiness.importCount,
        compositionCount: contract.compositions.length,
        observedAt: new Date().toISOString(),
      },
      null,
      2,
    )}\n`,
  )
  const evidence = {
    path: evidencePath,
    kind: 'resource_preparation' as const,
    revision: resourceRevision,
    status: 'passed' as const,
    observedAt: new Date().toISOString(),
  }
  const next = transitionDeliveryRun(
    { ...input.run, activeDispatch: undefined },
    { type: 'resource_preparation_ready', resourceRevision, evidence },
  )
  return input.resourceEvidence
    ? { ...next, resourceEvidence: input.resourceEvidence }
    : next
}

export async function auditResourceInventoryPolicy(
  workspacePath: string,
): Promise<string[]> {
  if (!assetManifestExists(workspacePath)) return []
  let manifest
  try {
    manifest = await readBeeGameAssetManifest(workspacePath)
  } catch {
    return []
  }
  const imports = manifest.imports ?? []
  const declaredBudget = manifest.requirements.reduce(
    (total, requirement) =>
      total + (requirement.resource_requirement?.import_budget ?? 0),
    0,
  )
  const requirementBoundCompositionIds = new Set(
    manifest.requirements.flatMap(
      requirement => requirement.satisfied_by?.composition_ids ?? [],
    ),
  )
  const boundImportIds = new Set([
    ...manifest.requirements.flatMap(
      requirement => requirement.satisfied_by?.import_ids ?? [],
    ),
    ...(manifest.compositions ?? [])
      .filter(composition => requirementBoundCompositionIds.has(composition.id))
      .flatMap(composition =>
        composition.members.flatMap(member =>
          member.import_id ? [member.import_id] : [],
        ),
      ),
  ])
  const unboundImportIds = imports
    .map(resourceImport => resourceImport.id)
    .filter(importId => !boundImportIds.has(importId))
  const prematureRecipeIds = (manifest.compositions ?? [])
    .filter(
      composition =>
        composition.status === 'planned' && Boolean(composition.recipe?.path),
    )
    .map(composition => composition.id)
  const currentImportIds = new Set(imports.map(item => item.id))
  const coveredCompositionIds = materializedCompositionIds(
    workspacePath,
    manifest,
  )
  const unfundedRequirementIds = manifest.requirements
    .filter(requirement => {
      if (requirement.required === false || !requirement.resource_requirement)
        return false
      const hasCurrentBinding = requirementHasCurrentCoverage(
        workspacePath,
        requirement,
        currentImportIds,
        coveredCompositionIds,
      )
      return (
        !hasCurrentBinding &&
        (requirement.resource_requirement.import_budget ?? 0) <= 0
      )
    })
    .map(requirement => requirement.id)
  const undecidedRequiredIds = unresolvedRequiredSourceDecisionIds(
    workspacePath,
    manifest,
  )
  return [
    ...(imports.length > 0 && declaredBudget <= 0
      ? [
          'Resource inventory has no explicit requirement.resource_requirement.import_budget.',
        ]
      : []),
    ...(declaredBudget > 0 && imports.length > declaredBudget
      ? [
          `Resource inventory exceeds its declared budget: ${imports.length} imports > ${declaredBudget}.`,
        ]
      : []),
    ...(unboundImportIds.length
      ? [
          `Resource imports are not bound to any current requirement or composition: ${unboundImportIds.join(', ')}.`,
        ]
      : []),
    ...(prematureRecipeIds.length
      ? [
          `Planned resource compositions must not claim target-native recipe paths before implementation: ${prematureRecipeIds.join(', ')}.`,
        ]
      : []),
    ...(unfundedRequirementIds.length
      ? [
          `File-backed resource requirements have no import budget or current binding: ${unfundedRequirementIds.join(', ')}. Omit resource_requirement only after recording one exact final source decision, or declare an approved positive budget.`,
        ]
      : []),
    ...(undecidedRequiredIds.length
      ? [
          `Required non-library responsibilities have no exact durable source decision or current binding: ${undecidedRequiredIds.join(', ')}. Record one canonical source_decision for each responsibility before resource preparation can pass.`,
        ]
      : []),
  ]
}

function sameIds(left: string[], right: string[]): boolean {
  const sortedLeft = [...left].sort()
  const sortedRight = [...right].sort()
  return (
    left.length === right.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  )
}

export function auditResourcesForPreparation(input: {
  workspacePath: string
  confirmedBriefContext?: string
  resourceEvidence?: Parameters<
    typeof auditResourceDeliveryReadiness
  >[0]['resourceEvidence']
}): ResourceAudit {
  return auditResourceDeliveryReadiness({
    workspacePath: input.workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(input.confirmedBriefContext),
    ...(input.resourceEvidence
      ? { resourceEvidence: input.resourceEvidence }
      : {}),
  })
}
