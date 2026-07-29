import { auditAssetContract } from '../asset-contract-audit'
import {
  readBeeGameAssetManifest,
  writeBeeGameAssetManifest,
} from '../asset-contracts'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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

async function hasCanonicalAssetManifest(workspacePath: string): Promise<boolean> {
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
    WORKFLOW_EVIDENCE_DIRECTORY,
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
  manifest.requirements = manifest.requirements.map(requirement => {
    const bindings = requirement.satisfied_by
    const hasBinding = Boolean(
      bindings?.import_ids?.length ||
        bindings?.composition_ids?.length ||
        bindings?.project_references?.length,
    )
    if (requirement.status !== 'satisfied' || hasBinding) return requirement
    changed = true
    const { satisfied_by: _satisfiedBy, ...planned } = requirement
    return { ...planned, status: 'planned' as const }
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
  if (changed) await writeBeeGameAssetManifest(input.workspacePath, manifest)
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
  const manifestPresent = assetManifestExists(input.workspacePath)
  const hasCanonicalManifest = await hasCanonicalAssetManifest(
    input.workspacePath,
  )
  if (input.run.resourceRemediation && hasCanonicalManifest)
    await repairDeterministicPreparationState({
      workspacePath: input.workspacePath,
      ...(confirmedPolicy ? { confirmedPolicy } : {}),
    })
  const existingContract = auditAssetContract(input.workspacePath)
  const resourceRemediation = input.run.resourceRemediation
  const remediation = resourceRemediation && hasCanonicalManifest
    ? {
        ...resourceRemediation,
        preserveImportIds: (existingContract.imports ?? []).map(
          item => item.id,
        ),
        preserveCompositionIds: existingContract.compositions.map(
          item => item.id,
        ),
      }
    : undefined
  const freshRestart = resourceRemediation && !hasCanonicalManifest
    ? {
        attempt: resourceRemediation.attempt,
        manifestState: manifestPresent ? 'invalid' : 'missing',
        issues: [
          ...resourceRemediation.issues,
          ...existingContract.issues.filter(
            issue => !resourceRemediation.issues.includes(issue),
          ),
        ],
      }
    : undefined
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
      resourceAttemptMode: remediation ? 'repair' : 'fresh',
      ...(remediation ? { remediation } : {}),
      ...(freshRestart ? { freshRestart } : {}),
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
  const resourceRevision = await computeResourceRevision(
    input.workspacePath,
    input.run.revision.document,
  )
  const allowedPaths = resourcePreparationAllowedPaths(input.workspacePath)
  const outOfScope = input.terminal.writtenPaths.filter(
    path => !pathAllowed(path, allowedPaths),
  )
  const contract = auditAssetContract(input.workspacePath)
  const policy =
    input.audit.confirmedPolicy ??
    input.audit.manifestPolicy ??
    confirmedResourceLibraryUsage(input.run.confirmedBriefContext)
  const issues = [
    ...input.audit.issues,
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
    input.audit.importCount > 0 &&
    input.resourceEvidence?.state !== 'current'
      ? ['Resource Library import has no current native provenance.']
      : []),
    ...(input.terminal.status === 'completed' &&
    (policy === 'preferred' || policy === 'required') &&
    input.audit.failedActions.length
      ? [
          `unresolved Resource Library actions: ${input.audit.failedActions.join(', ')}`,
        ]
      : []),
    ...(input.terminal.status === 'completed' && !contract.present
      ? ['resource preparation must create assets/asset-manifest.json.']
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
  const next = issues.length
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
  return input.resourceEvidence
    ? { ...next, resourceEvidence: input.resourceEvidence }
    : next
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
