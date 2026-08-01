import { mkdir, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { auditAssetContract } from '../asset-contract-audit'
import {
  BEEGAME_RESOURCE_ROOTS,
  readBeeGameAssetManifest,
} from '../asset-contracts'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
  type ResourceDeliveryReadiness,
} from '../resource-delivery-readiness'
import { isWorkflowEvidenceFile } from './evidence'
import { computeResourceRevision } from './revision'
import { transitionDeliveryRun } from './transition'
import {
  WORKFLOW_EVIDENCE_DIRECTORY,
  type DeliveryRun,
  type ResourceEvidenceSnapshot,
  type WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type Dispatcher = { dispatch(request: WorkerDispatchRequest): Promise<unknown> }
type ResourceAudit = ResourceDeliveryReadiness
const MAX_AUTOMATIC_RESOURCE_REMEDIATION_ATTEMPTS = 3

export function resourcePreparationAllowedPaths(_workspacePath: string): string[] {
  return [
    'assets/asset-manifest.json',
    ...Object.values(BEEGAME_RESOURCE_ROOTS).map(directoryScope),
  ]
}

function directoryScope(path: string): string {
  let normalized = path.replaceAll('\\', '/')
  while (normalized.endsWith('/')) normalized = normalized.slice(0, -1)
  return `${normalized}/`
}

function pathAllowed(path: string, allowedPaths: string[]): boolean {
  const normalized = path.replaceAll('\\', '/')
  if (normalized.startsWith('/') || normalized.split('/').some(part => part === '..')) return false
  return allowedPaths.some(allowed => {
    let scope = allowed.replaceAll('\\', '/')
    while (scope.endsWith('/')) scope = scope.slice(0, -1)
    return normalized === scope || normalized.startsWith(`${scope}/`)
  })
}

export type CurrentResourceReviewState = {
  requirementIds: Set<string>
  uncoveredRequirementIds: Set<string>
  resourceIds: Set<string>
  contentIds: Set<string>
}

export async function readCurrentResourceReviewState(workspacePath: string): Promise<CurrentResourceReviewState> {
  const manifest = await readBeeGameAssetManifest(workspacePath)
  const contract = auditAssetContract(workspacePath)
  const covered = new Set(contract.content.coveredRequirementIds)
  return {
    requirementIds: new Set(manifest.requirements.map(item => item.id)),
    uncoveredRequirementIds: new Set(
      manifest.requirements.filter(item => item.required !== false && !covered.has(item.id)).map(item => item.id),
    ),
    resourceIds: new Set(manifest.resources.map(item => item.id)),
    contentIds: new Set(contract.content.files.map(item => item.id)),
  }
}

export async function startResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error(`resource production requires RESOURCE_PREPARATION, got ${input.run.phase}`)
  if (input.run.activeDispatch?.status === 'running') return input.run.activeDispatch
  const reviewCycle = input.run.documentReviewState.activeCycle
  const reviewFindings = reviewCycle?.acceptedSemanticResult && reviewCycle.activeTarget === 'resource'
    ? reviewCycle.findings.filter(finding => finding.owner === 'resource')
    : []
  const resourceBaselineRevision = await computeResourceRevision(input.workspacePath, input.run.revision.document)
  const audit = input.run.resourceRemediation
    ? auditResourcesForPreparation({
        workspacePath: input.workspacePath,
        confirmedBriefContext: input.run.confirmedBriefContext,
        ...(input.run.resourceEvidence?.state === 'current' ? { resourceEvidence: input.run.resourceEvidence } : {}),
      })
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
      resourceBaselineRevision,
      resourceLibraryUsage: confirmedResourceLibraryUsage(input.run.confirmedBriefContext),
      assetPlan: 'docs/ASSET_PLAN.md',
      artDirection: 'docs/ART_DIRECTION.md',
      contentContract: {
        manifest: 'assets/asset-manifest.json',
        jsonOwnership: 'resource mappings, entities, UI, audio, events, waves and numeric configuration',
        yamlOwnership: 'world, scene, hierarchy and instance placement only',
      },
      ...(input.run.resourceRemediation ? { remediation: { kind: 'resource_contract', ...input.run.resourceRemediation, issues: [...(audit?.issues ?? []), ...(audit?.readinessIssues ?? [])] } } : {}),
      ...(reviewFindings.length ? { reviewRemediation: { cycleId: reviewCycle!.cycleId, findings: reviewFindings } } : {}),
    },
  })
}

export async function completeResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'resource-preparer' }>
  audit: ResourceAudit
  resourceEvidence?: ResourceEvidenceSnapshot
  baselineResourceRevision?: string
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'RESOURCE_PREPARATION') throw new Error('resource production is not the active phase')
  const contract = auditAssetContract(input.workspacePath)
  const outOfScope = input.terminal.writtenPaths.filter(path =>
    path !== input.terminal.evidencePath && !pathAllowed(path, resourcePreparationAllowedPaths(input.workspacePath)),
  )
  const evidenceValid = isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath)
  const idsMatch = sameIds(input.terminal.resourceIds, contract.resources.map(item => item.id)) &&
    sameIds(input.terminal.contentIds, contract.content.files.map(item => item.id))
  const issues = [
    ...input.audit.issues,
    ...input.audit.readinessIssues,
    ...(outOfScope.length ? [`resource production wrote outside scope: ${outOfScope.join(', ')}`] : []),
    ...(!evidenceValid ? ['resource production evidence is outside the workflow evidence directory.'] : []),
    ...(input.terminal.status !== 'completed' ? [`resource production ${input.terminal.status}`] : []),
    ...(input.terminal.status === 'completed' && !idsMatch ? ['resource worker IDs do not match the resource-content contract.'] : []),
  ]
  const resourceRevision = await computeResourceRevision(input.workspacePath, input.run.revision.document)
  const madeProgress = input.terminal.status === 'completed' && contract.present && !outOfScope.length && evidenceValid && idsMatch && Boolean(input.baselineResourceRevision) && input.baselineResourceRevision !== resourceRevision
  if (madeProgress && !input.audit.ready && (input.run.resourceRemediation?.attempt ?? 0) < MAX_AUTOMATIC_RESOURCE_REMEDIATION_ATTEMPTS) {
    const next: DeliveryRun = {
      ...input.run,
      status: 'running',
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceRemediation: {
        sourceRevision: resourceRevision,
        attempt: (input.run.resourceRemediation?.attempt ?? 0) + 1,
        issues: [...input.audit.issues, ...input.audit.readinessIssues],
      },
    }
    return input.resourceEvidence ? { ...next, resourceEvidence: input.resourceEvidence } : next
  }
  const evidence = {
    path: input.terminal.evidencePath,
    kind: 'resource_preparation' as const,
    revision: resourceRevision,
    status: issues.length ? 'failed' as const : 'passed' as const,
    observedAt: new Date().toISOString(),
  }
  const transitioned = issues.length
    ? transitionDeliveryRun({ ...input.run, activeDispatch: undefined }, { type: 'resource_preparation_needs_action', reason: issues.join('; '), evidence })
    : transitionDeliveryRun({ ...input.run, activeDispatch: undefined }, { type: 'resource_preparation_ready', resourceRevision, evidence })
  const next = issues.length ? {
    ...transitioned,
    resourceRemediation: {
      sourceRevision: resourceRevision,
      attempt: (input.run.resourceRemediation?.attempt ?? 0) + 1,
      issues,
    },
  } : transitioned
  return input.resourceEvidence ? { ...next, resourceEvidence: input.resourceEvidence } : next
}

export async function reconcileCurrentResourcePreparation(input: {
  run: DeliveryRun
  workspacePath: string
  resourceEvidence?: ResourceEvidenceSnapshot
}): Promise<DeliveryRun | undefined> {
  if (input.run.phase !== 'RESOURCE_PREPARATION' || input.run.activeDispatch?.status === 'running') return undefined
  const readiness = auditResourcesForPreparation({
    workspacePath: input.workspacePath,
    confirmedBriefContext: input.run.confirmedBriefContext,
    ...(input.resourceEvidence ? { resourceEvidence: input.resourceEvidence } : {}),
  })
  if (!readiness.ready) return undefined
  const manifest = await readBeeGameAssetManifest(input.workspacePath)
  const contract = auditAssetContract(input.workspacePath)
  const resourceRevision = await computeResourceRevision(input.workspacePath, input.run.revision.document)
  const evidencePath = `${WORKFLOW_EVIDENCE_DIRECTORY}resource-production-reconciled-${input.run.runId.slice(0, 8)}.json`
  await mkdir(join(input.workspacePath, WORKFLOW_EVIDENCE_DIRECTORY), { recursive: true })
  await writeFile(join(input.workspacePath, evidencePath), `${JSON.stringify({
    runId: input.run.runId,
    revision: resourceRevision,
    status: 'passed',
    requirementCount: manifest.requirements.length,
    resourceCount: manifest.resources.length,
    contentFileCount: contract.content.files.length,
    observedAt: new Date().toISOString(),
  }, null, 2)}\n`)
  const evidence = { path: evidencePath, kind: 'resource_preparation' as const, revision: resourceRevision, status: 'passed' as const, observedAt: new Date().toISOString() }
  const next = transitionDeliveryRun({ ...input.run, activeDispatch: undefined }, { type: 'resource_preparation_ready', resourceRevision, evidence })
  return input.resourceEvidence ? { ...next, resourceEvidence: input.resourceEvidence } : next
}

export async function auditResourceInventoryPolicy(workspacePath: string): Promise<string[]> {
  const audit = auditResourceDeliveryReadiness({ workspacePath })
  return [...audit.issues, ...audit.readinessIssues]
}

export function auditResourcesForPreparation(input: {
  workspacePath: string
  confirmedBriefContext?: string
  resourceEvidence?: Parameters<typeof auditResourceDeliveryReadiness>[0]['resourceEvidence']
}): ResourceAudit {
  return auditResourceDeliveryReadiness({
    workspacePath: input.workspacePath,
    confirmedPolicy: confirmedResourceLibraryUsage(input.confirmedBriefContext),
    ...(input.resourceEvidence ? { resourceEvidence: input.resourceEvidence } : {}),
  })
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && new Set(left).size === left.length && left.every(id => right.includes(id))
}
