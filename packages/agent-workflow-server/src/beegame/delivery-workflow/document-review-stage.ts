import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import type { DispatchRecord } from './types'
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

export type DocumentReviewReportState = {
  role: DocumentReviewRole
  path: string
  digest?: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dispatch?: DispatchRecord
  failureReason?: string
}

export type DocumentReviewRun = {
  scope: DocumentReviewScope
  revision: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: DocumentReviewReportState[]
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: DocumentReviewVerdict
  affectedPaths?: string[]
  attempt: number
  approvedFoundationRevision?: string
  failureReason?: string
}

export type DocumentReviewTerminal = {
  workerType: 'document-reviewer'
  status: 'completed'
  revision: string
  scope: DocumentReviewScope
  role: DocumentReviewRole
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
    currentRevision: string
    partDigests: Record<string, string>
  }
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
}): DocumentReviewDispatch[] {
  if (input.run.status === 'completed' || input.run.status === 'failed') return []
  const specialists = assignmentsForRun(input.run, input.workspacePath)
  const stateByRole = new Map(input.run.reports.map(report => [report.role, report]))
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
      .filter(assignment => stateByRole.get(assignment.role)?.status === 'pending')
      .slice(0, capacity)
      .map(assignment => dispatchFor(input.run, assignment, {}))
  }

  const finalState = stateByRole.get('final')
  if (finalState?.status !== 'pending') return []
  const final = finalReviewAssignment({
    scope: input.run.scope,
    workspacePath: input.workspacePath,
    revision: input.run.revision,
    specialists,
  })
  const partDigests = Object.fromEntries(
    specialists.map(assignment => {
      const state = stateByRole.get(assignment.role)
      if (!state?.digest)
        throw new Error('completed document review report has no digest')
      return [state.path, state.digest]
    }),
  )
  return [dispatchFor(input.run, final, partDigests)]
}

function dispatchFor(
  run: DocumentReviewRun,
  assignment: DocumentReviewAssignment,
  partDigests: Record<string, string>,
): DocumentReviewDispatch {
  return {
    idempotencyKey: `${run.scope}:${run.revision}:${assignment.role}:${run.attempt}`,
    assignment,
    contract: {
      reviewScope: run.scope,
      reviewRole: assignment.role,
      assignment,
      currentRevision: run.revision,
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
    throw new Error('document review terminal paths do not match the assignment')

  const bytes = await readFile(resolve(input.workspacePath, report.path))
  const digest = createHash('sha256').update(bytes).digest('hex')
  const reports = run.reports.map(value =>
    value.role === report.role
      ? { ...value, status: 'completed' as const, digest, failureReason: undefined }
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

  let specialistInvalidated = false
  const reports: DocumentReviewReportState[] = []
  for (const report of input.run.reports) {
    if (report.status === 'running') {
      reports.push({ role: report.role, path: report.path, status: 'pending' })
      continue
    }
    if (report.status !== 'completed' || !report.digest) {
      reports.push({ ...report })
      continue
    }
    try {
      const bytes = await readFile(resolve(input.workspacePath, report.path))
      if (createHash('sha256').update(bytes).digest('hex') === report.digest) {
        reports.push({ ...report })
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
