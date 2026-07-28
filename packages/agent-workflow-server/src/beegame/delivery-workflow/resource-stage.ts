import { auditAssetContract } from '../asset-contract-audit'
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

function pathAllowed(path: string): boolean {
  const normalized = path.replaceAll('\\', '/')
  return (
    !normalized.startsWith('/') &&
    !normalized.split('/').includes('..') &&
    (normalized.startsWith('assets/') ||
      normalized.startsWith(WORKFLOW_EVIDENCE_DIRECTORY))
  )
}

export function startResourcePreparation(input: {
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
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'resource-preparer',
    phase: 'RESOURCE_PREPARATION',
    revision: input.run.revision.document,
    allowedPaths: ['assets/', WORKFLOW_EVIDENCE_DIRECTORY],
    contract: {
      documentRevision: input.run.revision.document,
      resourceLibraryUsage: confirmedResourceLibraryUsage(
        input.run.confirmedBriefContext,
      ),
      assetPlan: 'docs/ASSET_PLAN.md',
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
  const outOfScope = input.terminal.writtenPaths.filter(
    path => !pathAllowed(path),
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
