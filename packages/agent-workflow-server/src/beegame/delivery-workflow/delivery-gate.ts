import { computeResourceRevision, computeWorkspaceRevision } from './revision'
import { createRunStore } from './run-store'
import { isWorkflowEvidenceFile } from './evidence'

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
  if (
    !run.revision.resource ||
    run.documentReviewState.approvals.complete?.revision !==
      run.revision.resource
  ) {
    return {
      allowed: false,
      issues: [
        'Current workflow has no current comprehensive review approval.',
      ],
    }
  }
  if (run.evidence.resourcePreparation?.status !== 'passed') {
    return {
      allowed: false,
      issues: ['Current workflow has no passed resource-preparation evidence.'],
    }
  }
  if (run.evidence.implementationAudit?.status !== 'passed') {
    return {
      allowed: false,
      issues: ['Current workflow has no passed implementation-audit evidence.'],
    }
  }
  const completeApproval = run.documentReviewState.approvals.complete
  let reviewReportCurrent = false
  if (completeApproval) {
    try {
      const bytes = await readFile(
        resolve(input.workspacePath, completeApproval.reportPath),
      )
      reviewReportCurrent =
        createHash('sha256').update(bytes).digest('hex') ===
        completeApproval.reportDigest
    } catch {
      reviewReportCurrent = false
    }
  }
  if (
    !reviewReportCurrent ||
    !run.evidence.resourcePreparation.path ||
    !isWorkflowEvidenceFile(
      input.workspacePath,
      run.evidence.resourcePreparation.path,
    ) ||
    !run.evidence.implementationAudit.path ||
    !isWorkflowEvidenceFile(
      input.workspacePath,
      run.evidence.implementationAudit.path,
    )
  ) {
    return {
      allowed: false,
      issues: [
        'Current comprehensive-review, resource-production or implementation-audit evidence file is missing or outside the project workspace.',
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
  if (run.evidence.implementationAudit.revision !== currentRevision) {
    return {
      allowed: false,
      issues: [
        'Workspace changed after implementation audit; run the audit again.',
      ],
    }
  }
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
