import { auditAssetContract } from '../asset-contract-audit'
import {
  auditResourceDeliveryReadiness,
  confirmedResourceLibraryUsage,
} from '../resource-delivery-readiness'
import {
  computeResourceRevision,
} from './revision'
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
      manifestPath: 'assets/asset-manifest.json',
      validationCommand: {
        executable: process.execPath,
        args: [new URL('../resource-validation-cli.ts', import.meta.url).pathname],
      },
      currentResourceIssues: [
        ...currentResourceContractIssues(input.workspacePath),
      ],
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
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'RESOURCE_PREPARATION')
    throw new Error('resource production is not the active phase')
  if (input.terminal?.workerType === 'resource-planner') {
    if (input.run.resourceProductionState.currentTask === 'RESOURCE_DELIVERED')
      throw new Error('resource preparation is already complete')
    const audit = auditAssetContract(input.workspacePath)
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
      missingRequirementIds.length > 0 ||
      !readiness.ready
    ) {
      const issues = [...new Set([
        ...audit.issues,
        ...(audit.requirements.length === 0 ? ['Resource delivery requires at least one canonical requirement.'] : []),
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
        resourceProductionState: input.run.resourceProductionState,
      }
    }
    const accepted: DeliveryRun = {
      ...input.run,
      activeDispatch: undefined,
      blockedReason: undefined,
      resourceProductionState: {
        currentTask: 'RESOURCE_DELIVERED',
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
