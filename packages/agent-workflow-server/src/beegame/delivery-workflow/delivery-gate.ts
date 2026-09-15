import { computeResourceRevision, computeWorkspaceRevision } from './revision'
import { createRunStore } from './run-store'
import { isWorkflowEvidenceFile } from './evidence'
import { CANONICAL_ASSET_MANIFEST } from './types'

export type WorkflowDeliveryGate = {
  allowed: boolean
  issues: string[]
}

/**
 * The deployment gate reads only the authoritative delivery run. Native
 * evidence and chat notifications are inputs to the workflow, never a second
 * deployment state machine.
 */
export async function evaluateWorkflowDeliveryGate(input: {
  workspacePath: string
  ownerId: string
}): Promise<WorkflowDeliveryGate> {
  const run = await createRunStore(input.workspacePath, input.ownerId).load()
  if (!run)
    return { allowed: false, issues: ['Delivery workflow has not started.'] }
  if (run.status !== 'completed' || run.phase !== 'DELIVERY') {
    return {
      allowed: false,
      issues: [`Delivery workflow is ${run.status} in ${run.phase}.`],
    }
  }
  if (run.evidence.acceptance?.status !== 'passed') {
    return {
      allowed: false,
      issues: ['Current workflow has no passed acceptance evidence.'],
    }
  }
  if (run.evidence.resourcePreparation?.status !== 'passed') {
    return {
      allowed: false,
      issues: ['Current workflow has no passed resource-preparation evidence.'],
    }
  }
  if (run.evidence.gameContent?.status !== 'passed' || !run.gameContentReceipt) {
    return {
      allowed: false,
      issues: ['Current workflow has no accepted Scene/UI content package.'],
    }
  }
  if (
    run.evidence.resourcePreparation.path !== CANONICAL_ASSET_MANIFEST
  ) {
    return {
      allowed: false,
      issues: [
        'Current resource-delivery evidence does not reference the canonical Asset Manifest.',
      ],
    }
  }
  if (
    !run.evidence.acceptance?.path ||
    !isWorkflowEvidenceFile(input.workspacePath, run.evidence.acceptance.path)
  ) {
    return {
      allowed: false,
      issues: [
        'Current workflow acceptance evidence file is missing or outside the project workspace.',
      ],
    }
  }
  const currentRevision = await computeWorkspaceRevision(input.workspacePath)
  const currentResourceRevision = await computeResourceRevision(
    input.workspacePath,
    run.revision.document,
  )
  if (
    !run.revision.content ||
    run.evidence.gameContent.revision !== run.revision.content ||
    run.gameContentReceipt.contentRevision !== run.revision.content ||
    run.gameContentReceipt.assetManifestRevision !== currentResourceRevision
  ) {
    return {
      allowed: false,
      issues: ['Accepted Scene/UI content is not bound to the current IR and Asset Manifest revisions.'],
    }
  }
  if (
    !run.revision.resource ||
    run.evidence.resourcePreparation.revision !== currentResourceRevision ||
    run.revision.resource !== currentResourceRevision
  ) {
    return {
      allowed: false,
      issues: [
        'Resources or content changed after validation; run resource production again.',
      ],
    }
  }
  const acceptedRevision = run.evidence.acceptance.revision
  if (acceptedRevision !== currentRevision) {
    return {
      allowed: false,
      issues: ['Workspace changed after acceptance; run acceptance again.'],
    }
  }
  return { allowed: true, issues: [] }
}
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
