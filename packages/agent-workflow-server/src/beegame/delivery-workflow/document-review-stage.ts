import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve, sep } from 'node:path'
import type {
  DeliveryRun,
  DocumentReviewReportState,
  DocumentReviewRun,
} from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  documentReviewAssignments,
  finalReviewAssignment,
  type DocumentReviewAssignment,
  type DocumentReviewRole,
} from './document-review-topology'
import type {
  DocumentReviewScope,
  DocumentReviewVerdict,
} from './document-review-report'
import { computeDocumentRevision, computeResourceRevision } from './revision'

export type { DocumentReviewReportState, DocumentReviewRun } from './types'

export type DocumentReviewTerminal = {
  workerType: 'document-reviewer'
  status: 'completed'
  revision: string
  scope: DocumentReviewScope
  role: string
  reportPaths: string[]
  verdict?: DocumentReviewVerdict
  affectedPaths?: string[]
}

export type DocumentReviewDispatch = {
  idempotencyKey: string
  assignment: DocumentReviewAssignment
  contract: {
    reviewScope: DocumentReviewScope
    reviewRole: DocumentReviewRole
    assignment: DocumentReviewAssignment
    revisionVerification:
      | {
          kind: 'document'
          confirmedBriefDigest: string
          prerequisiteReports: Array<{ path: string; digest: string }>
        }
      | {
          kind: 'resource'
          confirmedBriefDigest: string
          prerequisiteReports: Array<{ path: string; digest: string }>
        }
    partDigests: Record<string, string>
  }
}

export async function computeCurrentDocumentReviewRevision(input: {
  workspacePath: string
  verification: DocumentReviewDispatch['contract']['revisionVerification']
}): Promise<string> {
  const workspaceRoot = resolve(input.workspacePath)
  for (const report of input.verification.prerequisiteReports) {
    const absolutePath = resolve(workspaceRoot, report.path)
    if (
      absolutePath !== workspaceRoot &&
      !absolutePath.startsWith(`${workspaceRoot}${sep}`)
    )
      throw new Error('document review prerequisite report escapes the project')
    const digest = createHash('sha256')
      .update(await readFile(absolutePath))
      .digest('hex')
    if (digest !== report.digest)
      throw new Error('document review prerequisite report changed')
  }
  const documentRevision = await computeDocumentRevision(
    input.workspacePath,
    input.verification.confirmedBriefDigest,
  )
  return input.verification.kind === 'document'
    ? documentRevision
    : computeResourceRevision(input.workspacePath, documentRevision)
}

function projectPath(workspacePath: string, path: string): string {
  return relative(resolve(workspacePath), resolve(path)).split('\\').join('/')
}

function assignmentsForRun(
  run: Pick<
    DocumentReviewRun,
    'scope' | 'revision' | 'approvedFoundationRevision'
  >,
  workspacePath: string,
): DocumentReviewAssignment[] {
  return documentReviewAssignments({
    scope: run.scope,
    workspacePath,
    revision: run.revision,
    ...(run.approvedFoundationRevision
      ? { approvedFoundationRevision: run.approvedFoundationRevision }
      : {}),
  })
}

export function hasCurrentDocumentReviewTopology(input: {
  run: Pick<
    DocumentReviewRun,
    'scope' | 'revision' | 'approvedFoundationRevision' | 'reports'
  >
  workspacePath: string
}): boolean {
  const expectedRoles = [
    ...assignmentsForRun(input.run, input.workspacePath).map(
      assignment => assignment.role,
    ),
    'final',
  ]
  return (
    input.run.reports.length === expectedRoles.length &&
    input.run.reports.every(
      (report, index) => report.role === expectedRoles[index],
    )
  )
}

export function createDocumentReviewRun(input: {
  scope: DocumentReviewScope
  revision: string
  attempt?: number
  approvedFoundationRevision?: string
}): DocumentReviewRun {
  const workspacePath = '/'
  const specialists = assignmentsForRun(input, workspacePath)
  const final = finalReviewAssignment({
    scope: input.scope,
    workspacePath,
    revision: input.revision,
    specialists,
  })
  return {
    scope: input.scope,
    revision: input.revision,
    status: 'pending',
    reports: [
      ...specialists.map(assignment => ({
        role: assignment.role,
        path: projectPath(workspacePath, assignment.committedOutputPaths[0]),
        status: 'pending' as const,
      })),
      {
        role: 'final',
        path: projectPath(workspacePath, final.committedOutputPaths[0]),
        status: 'pending' as const,
      },
    ],
    attempt: input.attempt ?? 1,
    ...(input.approvedFoundationRevision
      ? { approvedFoundationRevision: input.approvedFoundationRevision }
      : {}),
  }
}

export function buildDocumentReviewDispatches(input: {
  run: DocumentReviewRun
  workspacePath: string
  previousReport?: { path: string; digest: string }
  revisionVerification:
    | {
        kind: 'document'
        confirmedBriefDigest: string
        prerequisiteReports: Array<{ path: string; digest: string }>
      }
    | {
        kind: 'resource'
        confirmedBriefDigest: string
        prerequisiteReports: Array<{ path: string; digest: string }>
      }
}): DocumentReviewDispatch[] {
  if (input.run.status === 'completed' || input.run.status === 'failed')
    return []
  const specialists = assignmentsForRun(input.run, input.workspacePath)
  const stateByRole = new Map(
    input.run.reports.map(report => [report.role, report]),
  )
  const incompleteSpecialists = specialists.filter(
    assignment => stateByRole.get(assignment.role)?.status !== 'completed',
  )
  if (incompleteSpecialists.length) {
    const capacity = Math.max(
      0,
      3 -
        incompleteSpecialists.filter(
          assignment => stateByRole.get(assignment.role)?.status === 'running',
        ).length,
    )
    return incompleteSpecialists
      .filter(
        assignment => stateByRole.get(assignment.role)?.status === 'pending',
      )
      .slice(0, capacity)
      .map(assignment =>
        dispatchFor(
          input.run,
          assignment,
          {},
          input.revisionVerification,
        ),
      )
  }

  const finalState = stateByRole.get('final')
  if (finalState?.status !== 'pending') return []
  const final = finalReviewAssignment({
    scope: input.run.scope,
    workspacePath: input.workspacePath,
    revision: input.run.revision,
    specialists,
    previousReportPath: input.previousReport?.path,
  })
  const partDigests = Object.fromEntries(
    specialists.map(assignment => {
      const state = stateByRole.get(assignment.role)
      if (!state?.digest)
        throw new Error('completed document review report has no digest')
      return [state.path, state.digest]
    }),
  )
  return [
    dispatchFor(
      input.run,
      final,
      partDigests,
      input.revisionVerification,
    ),
  ]
}

function dispatchFor(
  run: DocumentReviewRun,
  assignment: DocumentReviewAssignment,
  partDigests: Record<string, string>,
  revisionVerification: DocumentReviewDispatch['contract']['revisionVerification'],
): DocumentReviewDispatch {
  return {
    idempotencyKey: `${run.scope}:${run.revision}:${assignment.role}:${run.attempt}`,
    assignment,
    contract: {
      reviewScope: run.scope,
      reviewRole: assignment.role,
      assignment,
      revisionVerification,
      partDigests,
    },
  }
}

export async function acceptDocumentReviewTerminal(input: {
  run: DocumentReviewRun
  workspacePath: string
  terminal: DocumentReviewTerminal
}): Promise<DocumentReviewRun> {
  const { run, terminal } = input
  if (
    terminal.workerType !== 'document-reviewer' ||
    terminal.status !== 'completed' ||
    terminal.scope !== run.scope ||
    terminal.revision !== run.revision
  )
    throw new Error('document review terminal identity does not match')
  const report = run.reports.find(value => value.role === terminal.role)
  if (!report) throw new Error('document review terminal role is not assigned')
  const expectedPaths =
    terminal.role === 'final'
      ? [report.path, report.path.replace(/review\.md$/u, 'decision.json')]
      : [report.path]
  if (
    terminal.reportPaths.length !== expectedPaths.length ||
    terminal.reportPaths.some((path, index) => path !== expectedPaths[index])
  )
    throw new Error(
      'document review terminal paths do not match the assignment',
    )

  const bytes = await readFile(resolve(input.workspacePath, report.path))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const reports = run.reports.map(value =>
    value.role === report.role
      ? {
          ...value,
          status: 'completed' as const,
          digest,
          failureReason: undefined,
        }
      : value,
  )
  if (terminal.role === 'final') {
    if (!terminal.verdict || !terminal.affectedPaths)
      throw new Error('final document review terminal has no decision')
    return {
      ...run,
      status: 'completed',
      reports,
      finalReportPath: report.path,
      finalReportDigest: digest,
      verdict: terminal.verdict,
      affectedPaths: [...terminal.affectedPaths],
      failureReason: undefined,
    }
  }
  return { ...run, status: 'running', reports, failureReason: undefined }
}

export async function recoverDocumentReviewRun(input: {
  run: DocumentReviewRun
  workspacePath: string
  currentRevision: string
}): Promise<DocumentReviewRun> {
  if (input.currentRevision !== input.run.revision)
    return createDocumentReviewRun({
      scope: input.run.scope,
      revision: input.currentRevision,
      attempt: input.run.attempt,
      ...(input.run.approvedFoundationRevision
        ? { approvedFoundationRevision: input.run.approvedFoundationRevision }
        : {}),
    })
  if (
    input.run.status !== 'completed' &&
    !hasCurrentDocumentReviewTopology({
      run: input.run,
      workspacePath: input.workspacePath,
    })
  )
    return createDocumentReviewRun({
      scope: input.run.scope,
      revision: input.run.revision,
      attempt: input.run.attempt,
      ...(input.run.approvedFoundationRevision
        ? { approvedFoundationRevision: input.run.approvedFoundationRevision }
        : {}),
    })

  let specialistInvalidated = false
  const reports: DocumentReviewReportState[] = []
  for (const report of input.run.reports) {
    if (report.status === 'running') {
      reports.push({ role: report.role, path: report.path, status: 'pending' })
      continue
    }
    const isAcceptedFinal =
      report.role === 'final' &&
      report.path === input.run.finalReportPath &&
      report.digest === input.run.finalReportDigest &&
      Boolean(input.run.verdict && input.run.affectedPaths)
    if (
      (report.status !== 'completed' && !isAcceptedFinal) ||
      !report.digest
    ) {
      reports.push({ ...report })
      continue
    }
    try {
      const bytes = await readFile(resolve(input.workspacePath, report.path))
      if (createHash('sha256').update(bytes).digest('hex') === report.digest) {
        reports.push({
          ...report,
          status: 'completed',
          failureReason: undefined,
        })
        continue
      }
    } catch {
      // Missing committed bytes invalidate only this report on the same revision.
    }
    if (report.role !== 'final') specialistInvalidated = true
    reports.push({ role: report.role, path: report.path, status: 'pending' })
  }
  const recovered = reports.map(report =>
    specialistInvalidated && report.role === 'final'
      ? { role: report.role, path: report.path, status: 'pending' as const }
      : report,
  )
  const final = recovered.find(report => report.role === 'final')
  return {
    ...input.run,
    status: final?.status === 'completed' ? 'completed' : 'running',
    reports: recovered,
    failureReason:
      final?.status === 'completed' ? undefined : input.run.failureReason,
    ...(final?.status === 'completed'
      ? {}
      : {
          finalReportPath: undefined,
          finalReportDigest: undefined,
          verdict: undefined,
          affectedPaths: undefined,
        }),
  }
}

export function routeCompletedDocumentReview(input: {
  run: DeliveryRun
  review: DocumentReviewRun
  now?: string
  allowRetryAfterLimit?: boolean
}): DeliveryRun {
  const { run, review } = input
  if (
    review.status !== 'completed' ||
    !review.verdict ||
    !review.finalReportPath ||
    !review.finalReportDigest
  )
    throw new Error('document review routing requires a completed final report')
  if (review.verdict === 'NEEDS_REVISION') {
    if (review.attempt >= 3 && !input.allowRetryAfterLimit)
      return {
        ...run,
        phase: 'DOCUMENT_REVIEW',
        documentStep:
          review.scope === 'foundation'
            ? 'FOUNDATION_REVIEW'
            : review.scope === 'checklist'
              ? 'CHECKLIST_REVIEW'
              : 'COMPREHENSIVE_REVIEW',
        status: 'needs_action',
        blockedReason: `document review stopped after three consecutive reviews requiring revision; see ${review.finalReportPath}`,
        documentReviewState: {
          ...run.documentReviewState,
          activeRun: review,
        },
      }
    const affected = new Set(review.affectedPaths ?? [])
    const ownsFoundationPath = CANONICAL_FOUNDATION_DOCUMENTS.some(path =>
      affected.has(path),
    )
    const ownsChecklistPath = affected.has(
      'docs/acceptance/gameplay-checklist.md',
    )
    const ownsResourcePath = [...affected].some(path =>
      path.startsWith('assets/'),
    )
    if (!ownsFoundationPath && !ownsChecklistPath && !ownsResourcePath)
      throw new Error('document review decision has no routable affected path')
    return {
      ...run,
      phase: ownsFoundationPath
        ? 'DOCUMENT_DRAFTING'
        : ownsChecklistPath
          ? 'DOCUMENT_REVIEW'
          : 'RESOURCE_PREPARATION',
      documentStep:
        ownsChecklistPath && !ownsFoundationPath
          ? 'CHECKLIST_DRAFTING'
          : undefined,
      status: 'running',
      blockedReason: undefined,
      documentReviewState: {
        ...run.documentReviewState,
        activeRun: { ...review, remediatedPaths: [] },
      },
    }
  }
  const approval = {
    scope: review.scope,
    revision: review.revision,
    reportPath: review.finalReportPath,
    reportDigest: review.finalReportDigest,
    approvedAt: input.now ?? new Date().toISOString(),
  }
  return {
    ...run,
    phase:
      review.scope === 'foundation'
        ? 'DOCUMENT_REVIEW'
        : review.scope === 'checklist'
          ? 'RESOURCE_PREPARATION'
          : 'ATOMIC_TASK_PLANNING',
    documentStep:
      review.scope === 'foundation' ? 'CHECKLIST_DRAFTING' : undefined,
    status: 'running',
    blockedReason: undefined,
    documentReviewState: {
      ...run.documentReviewState,
      // Keep the latest completed run as display authority. The controller
      // replaces it when the next scope/revision starts; it is never replayed.
      activeRun: review,
      approvals: {
        ...(run.documentReviewState.approvals ?? {}),
        [review.scope]: approval,
      },
    },
  }
}
