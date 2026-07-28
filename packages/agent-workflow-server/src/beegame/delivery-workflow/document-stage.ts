import { existsSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { isAbsolute } from 'node:path'
import { join } from 'node:path'
import { computeDocumentRevision, computeWorkspaceRevision } from './revision'
import { isWorkflowEvidenceFile } from './evidence'
import { transitionDeliveryRun } from './transition'
import {
  CANONICAL_ASSET_MANIFEST,
  CANONICAL_FOUNDATION_DOCUMENTS,
  CANONICAL_PROJECT_DOCUMENTS,
  WORKFLOW_EVIDENCE_DIRECTORY,
} from './types'
import type {
  DeliveryRun,
  DocumentReviewFinding,
  EvidenceRef,
  WorkerDispatchRequest,
} from './types'
import type { WorkerTerminalResult } from './worker-contracts'

type ReadinessAudit = (
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
  },
) => {
  valid: boolean
  issues: string[]
}

async function defaultAudit(
  workspacePath: string,
  options?: {
    includeChecklist?: boolean
    includeAssetManifest?: boolean
  },
): Promise<ReturnType<ReadinessAudit>> {
  const { auditDocumentReadiness } = await import('../document-readiness-audit')
  return auditDocumentReadiness(workspacePath, options)
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

const MAX_DOCUMENT_REMEDIATION_ATTEMPTS = 3
const MAX_CHECKLIST_REMEDIATION_ATTEMPTS = 3

function normalizedReviewFindings(
  findings: Extract<
    WorkerTerminalResult,
    { workerType: 'document-reviewer' }
  >['findings'],
): DocumentReviewFinding[] {
  return findings.map((finding, index) => {
    const severity =
      finding.category === 'cross_document_conflict' ||
      finding.category === 'missing_spec'
        ? 'blocking'
        : finding.severity
    const identity = JSON.stringify({
      category: finding.category,
      documents: [...finding.documents].sort(),
      description: finding.description,
      requiredAction: finding.requiredAction,
      index,
    })
    return {
      ...finding,
      severity,
      id: `review-${createHash('sha256').update(identity).digest('hex').slice(0, 16)}`,
    }
  })
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
      ...(input.run.documentRemediation
        ? {
            remediation: {
              sourceRevision: input.run.documentRemediation.sourceRevision,
              evidencePath: input.run.documentRemediation.evidencePath,
              attempt: input.run.documentRemediation.attempt,
              findings: input.run.documentRemediation.findings,
            },
          }
        : {}),
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
      approvedDocumentRevision:
        input.run.evidence.documentReview?.revision ??
        input.run.revision.document,
      ...(input.run.checklistRemediation
        ? { checklistRemediation: input.run.checklistRemediation }
        : {}),
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
        includeAssetManifest: false,
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: documentSet === 'checklist',
        includeAssetManifest: false,
      })
  const foundationReadiness =
    documentSet === 'checklist'
      ? input.audit
        ? input.audit(input.workspacePath, {
            includeChecklist: false,
            includeAssetManifest: false,
          })
        : await defaultAudit(input.workspacePath, {
            includeChecklist: false,
            includeAssetManifest: false,
          })
      : undefined
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
  const expectedFindingIds =
    documentSet === 'foundation'
      ? (input.run.documentRemediation?.findings.map(finding => finding.id) ??
        [])
      : []
  const resolvedFindingIds = [
    ...new Set(input.terminal.resolvedFindingIds ?? []),
  ]
  const resolutionComplete =
    expectedFindingIds.length === 0 ||
    (resolvedFindingIds.length === expectedFindingIds.length &&
      expectedFindingIds.every(id => resolvedFindingIds.includes(id)))
  const checklistCanBeRemediated =
    documentSet === 'checklist' &&
    !readiness.valid &&
    foundationReadiness?.valid === true &&
    outOfScope.length === 0
  const checklistRemediationAttempt = checklistCanBeRemediated
    ? (input.run.checklistRemediation?.attempt ?? 0) + 1
    : undefined
  const checklistRemediation =
    checklistRemediationAttempt !== undefined
      ? {
          sourceRevision: documentRevision,
          attempt: checklistRemediationAttempt,
          issues: readiness.issues,
        }
      : undefined
  const checklistRetryAvailable =
    checklistRemediationAttempt !== undefined &&
    checklistRemediationAttempt <= MAX_CHECKLIST_REMEDIATION_ATTEMPTS
  const updated: DeliveryRun = {
    ...input.run,
    revision: {
      ...input.run.revision,
      document: documentRevision,
      workspace: workspaceRevision,
    },
    activeDispatch: undefined,
    status:
      checklistRemediationAttempt !== undefined && !checklistRetryAvailable
        ? 'needs_action'
        : input.run.status,
    blockedReason:
      readiness.valid && outOfScope.length === 0 && resolutionComplete
        ? undefined
        : [
            ...readiness.issues,
            ...(outOfScope.length > 0
              ? [
                  `document author wrote outside the document scope: ${outOfScope.join(', ')}`,
                ]
              : []),
            ...(!resolutionComplete
              ? [
                  'document author did not resolve every required review finding',
                ]
              : []),
          ].join('; '),
    ...(documentSet === 'checklist'
      ? { checklistRemediation }
      : {}),
    ...(input.run.documentRemediation
      ? {
          documentRemediation: {
            ...input.run.documentRemediation,
            resolvedFindingIds,
          },
        }
      : {}),
    updatedAt: new Date().toISOString(),
  }
  if (!readiness.valid || outOfScope.length > 0 || !resolutionComplete)
    return updated
  return {
    ...updated,
    phase:
      documentSet === 'checklist' ? 'RESOURCE_PREPARATION' : 'DOCUMENT_REVIEW',
    documentStep: documentSet === 'checklist' ? undefined : 'FOUNDATION_REVIEW',
    ...(documentSet === 'checklist'
      ? { checklistRemediation: undefined }
      : {}),
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
  if (scope === 'foundation' && input.run.documentStep !== 'FOUNDATION_REVIEW')
    throw new Error('foundation review requires the foundation review step')
  const readiness = input.audit
    ? input.audit(input.workspacePath, {
        includeChecklist: scope === 'complete',
        includeAssetManifest: scope === 'complete',
      })
    : await defaultAudit(input.workspacePath, {
        includeChecklist: scope === 'complete',
        includeAssetManifest: scope === 'complete',
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
      ? [...CANONICAL_PROJECT_DOCUMENTS, CANONICAL_ASSET_MANIFEST]
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
  const findings = normalizedReviewFindings(input.terminal.findings)
  // The workflow, not reviewer prose, owns the readiness gate. Normalize an
  // internally contradictory READY result so blocking findings can never
  // advance downstream work.
  const effectiveVerdict =
    input.terminal.verdict === 'READY' &&
    findings.some(finding => finding.severity === 'blocking')
      ? 'NEEDS_REVISION'
      : input.terminal.verdict
  const status =
    effectiveVerdict === 'READY'
      ? 'ready'
      : effectiveVerdict === 'NEEDS_REVISION'
        ? 'failed'
        : 'blocked'
  const reviewRevision =
    input.currentDocumentRevision ??
    (scope === 'complete'
      ? (input.run.revision.resource ?? input.run.revision.document)
      : input.run.revision.document)
  const evidence: EvidenceRef = {
    path: input.terminal.evidencePath,
    kind: 'document_review',
    revision: reviewRevision,
    status,
    observedAt: new Date().toISOString(),
  }
  if (scope === 'foundation' && effectiveVerdict === 'READY') {
    return {
      ...input.run,
      status: 'running',
      documentStep: 'CHECKLIST_DRAFTING',
      evidence: {
        ...input.run.evidence,
        documentReview: evidence,
      },
      blockedReason: undefined,
      activeDispatch: undefined,
      documentRemediation: undefined,
      checklistRemediation: undefined,
      updatedAt: new Date().toISOString(),
    }
  }
  const reconciled = transitionDeliveryRun(
    input.run,
    effectiveVerdict === 'READY'
      ? { type: 'document_review_ready', evidence }
      : effectiveVerdict === 'NEEDS_REVISION'
        ? { type: 'document_review_needs_revision', evidence }
        : { type: 'document_review_blocked', evidence },
  )
  if (effectiveVerdict === 'READY')
    return { ...reconciled, documentRemediation: undefined }
  if (findings.length === 0) {
    return {
      ...reconciled,
      status: 'needs_action',
      blockedReason: 'document review requires action but supplied no findings',
      activeDispatch: undefined,
      documentRemediation: undefined,
      updatedAt: new Date().toISOString(),
    }
  }
  const attempt = (input.run.documentRemediation?.attempt ?? 0) + 1
  const remediation = {
    sourceRevision: reviewRevision,
    evidencePath: input.terminal.evidencePath,
    attempt,
    findings,
  }
  if (
    effectiveVerdict === 'NEEDS_REVISION' &&
    attempt > MAX_DOCUMENT_REMEDIATION_ATTEMPTS
  ) {
    return {
      ...reconciled,
      status: 'needs_action',
      blockedReason: `document review still requires revision after ${MAX_DOCUMENT_REMEDIATION_ATTEMPTS} remediation attempts`,
      activeDispatch: undefined,
      documentRemediation: remediation,
      updatedAt: new Date().toISOString(),
    }
  }
  return { ...reconciled, documentRemediation: remediation }
}
