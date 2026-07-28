import { existsSync } from 'node:fs'
import { isAbsolute } from 'node:path'
import { join } from 'node:path'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import { isWorkflowEvidenceFile } from './evidence'
import { transitionDeliveryRun } from './transition'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  WORKFLOW_EVIDENCE_DIRECTORY,
} from './types'
import type {
  DeliveryRun,
  EvidenceRef,
  WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type ReadinessAudit = (
  workspacePath: string,
  options?: { includeChecklist?: boolean },
) => {
  valid: boolean
  issues: string[]
}

async function defaultAudit(
  workspacePath: string,
  options?: { includeChecklist?: boolean },
): Promise<ReturnType<ReadinessAudit>> {
  const { auditDocumentReadiness } = await import('../document-readiness-audit')
  return auditDocumentReadiness(workspacePath)
}

async function defaultChecklistIds(workspacePath: string): Promise<string[]> {
  if (
    !existsSync(
      join(workspacePath, 'docs', 'acceptance', 'gameplay-checklist.md'),
    )
  )
    return []
  const { readAcceptanceChecklistIds } = await import(
    '../document-readiness-audit'
  )
  return readAcceptanceChecklistIds(workspacePath)
}

type Dispatcher = {
  dispatch(request: WorkerDispatchRequest): Promise<unknown>
}

export async function startDocumentStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'DOCUMENT_DRAFTING')
    throw new Error(
      `document stage requires DOCUMENT_DRAFTING, got ${input.run.phase}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_DRAFTING',
    revision: input.run.revision.document,
    allowedPaths: ['docs/'],
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      documentSet: 'foundation',
    },
  })
}

export async function startChecklistDraftStage(input: {
  run: DeliveryRun
  workspacePath: string
  dispatcher: Dispatcher
}): Promise<unknown> {
  if (input.run.phase !== 'DOCUMENT_REVIEW')
    throw new Error(
      `checklist stage requires DOCUMENT_REVIEW, got ${input.run.phase}`,
    )
  if (input.run.documentStep !== 'CHECKLIST_DRAFTING')
    throw new Error(
      `checklist stage requires CHECKLIST_DRAFTING, got ${input.run.documentStep ?? 'unset'}`,
    )
  if (input.run.activeDispatch?.status === 'running')
    return input.run.activeDispatch
  return input.dispatcher.dispatch({
    runId: input.run.runId,
    ownerId: input.run.ownerId,
    projectId: input.run.projectId,
    workspacePath: input.workspacePath,
    workerType: 'document-author',
    phase: 'DOCUMENT_REVIEW',
    revision: input.run.revision.document,
    allowedPaths: ['docs/acceptance/'],
    contract: {
      confirmedBriefDigest: input.run.confirmedBriefDigest,
      documentSet: 'checklist',
      approvedDocumentRevision: input.run.revision.document,
    },
  })
}

export async function completeDocumentDraft(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-author' }>
  audit?: ReadinessAudit
  documentSet?: 'foundation' | 'checklist'
}): Promise<DeliveryRun> {
  const documentSet = input.documentSet ?? 'foundation'
  if (
    input.run.phase !== 'DOCUMENT_DRAFTING' &&
    !(documentSet === 'checklist' && input.run.phase === 'DOCUMENT_REVIEW')
  )
    throw new Error('document draft is not the active phase')
  if (
    documentSet === 'checklist' &&
    input.run.documentStep !== 'CHECKLIST_DRAFTING'
  )
    throw new Error('checklist draft requires an approved foundation review')
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
      })
  const allowedPaths =
    documentSet === 'checklist'
      ? new Set(['docs/acceptance/gameplay-checklist.md'])
      : new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)
  const outOfScope = input.terminal.writtenPaths.filter(path => {
    const normalized = path.split('\\').join('/')
    return (
      isAbsolute(path) ||
      normalized.split('/').includes('..') ||
      !allowedPaths.has(normalized)
    )
  })
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.run.confirmedBriefDigest,
  )
  const workspaceRevision = await computeWorkspaceRevision(input.workspacePath)
  const updated: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    activeDispatch: undefined,
    blockedReason:
      readiness.valid && outOfScope.length === 0
        ? undefined
        : [
            ...readiness.issues,
            ...(outOfScope.length > 0
              ? [
                  `document author wrote outside the document scope: ${outOfScope.join(', ')}`,
                ]
              : []),
          ].join('; '),
    updatedAt: new Date().toISOString(),
  }
  if (!readiness.valid || outOfScope.length > 0) return updated
  return {
    ...updated,
    phase: 'DOCUMENT_REVIEW',
    documentStep:
      documentSet === 'checklist' ? 'CHECKLIST_REVIEW' : 'FOUNDATION_REVIEW',
  }
}

export async function reconcileDocumentReview(input: {
  run: DeliveryRun
  workspacePath: string
  terminal: Extract<WorkerTerminalResult, { workerType: 'document-reviewer' }>
  audit?: ReadinessAudit
  currentDocumentRevision?: string
  scope?: 'foundation' | 'complete'
}): Promise<DeliveryRun> {
  if (input.run.phase !== 'DOCUMENT_REVIEW')
    throw new Error('document review is not the active phase')
  const scope = input.scope ?? 'complete'
  if (
    scope === 'foundation' &&
    input.run.documentStep !== 'FOUNDATION_REVIEW'
  )
    throw new Error('foundation review requires the foundation review step')
  const readiness = input.audit
    ? input.audit(input.workspacePath, { includeChecklist: scope === 'complete' })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: scope === 'complete',
      })
  if (!readiness.valid)
    throw new Error(
      `document review cannot be reconciled: ${readiness.issues.join('; ')}`,
    )
  if (!isWorkflowEvidenceFile(input.workspacePath, input.terminal.evidencePath))
    throw new Error(
      'document review evidence file is missing or outside the project workspace',
    )
  if (
    input.currentDocumentRevision &&
    input.terminal.revision !== input.currentDocumentRevision
  )
    throw new Error(
      'document review evidence does not match the current documents',
    )
  const expectedChecklistIds =
    scope === 'complete' ? await defaultChecklistIds(input.workspacePath) : []
  const expectedPaths = new Set<string>(
    scope === 'complete'
      ? CANONICAL_PROJECT_DOCUMENTS
      : CANONICAL_FOUNDATION_DOCUMENTS,
  )
  if (
    input.terminal.reviewedDocumentPaths.length !== expectedPaths.size ||
    new Set(input.terminal.reviewedDocumentPaths).size !== expectedPaths.size ||
    input.terminal.reviewedDocumentPaths.some(path => !expectedPaths.has(path))
  ) {
    throw new Error('document review does not cover the required document set')
  }
  if (
    expectedChecklistIds.length !== input.terminal.checklistIds.length ||
    expectedChecklistIds.some(id => !input.terminal.checklistIds.includes(id))
  )
    throw new Error('document review does not cover the current checklist')
  const status =
    input.terminal.verdict === 'READY'
      ? 'ready'
      : input.terminal.verdict === 'NEEDS_REVISION'
        ? 'failed'
        : 'blocked'
  const evidence: EvidenceRef = {
    path: input.terminal.evidencePath,
    kind: 'document_review',
    revision: input.run.revision.document,
    status,
    observedAt: new Date().toISOString(),
  }
  if (scope === 'foundation' && input.terminal.verdict === 'READY') {
    return {
      ...input.run,
      status: 'running',
      documentStep: 'CHECKLIST_DRAFTING',
      blockedReason: undefined,
      activeDispatch: undefined,
      updatedAt: new Date().toISOString(),
    }
  }
  const reconciled = transitionDeliveryRun(
    input.run,
    input.terminal.verdict === 'READY'
      ? { type: 'document_review_ready', evidence }
      : input.terminal.verdict === 'NEEDS_REVISION'
        ? { type: 'document_review_needs_revision', evidence }
        : { type: 'document_review_blocked', evidence },
  )
  return reconciled
}
