import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  acceptFoundationReviewEvidence,
  foundationReviewEvidencePath,
  foundationReviewEvidenceStagingPath,
  type FoundationReviewSpecialistRole,
} from './foundation-review-evidence'
import {
  acceptFoundationReview,
  foundationReviewPath,
  foundationReviewStagingPath,
  readFoundationReviewArtifact,
} from './foundation-review'
import {
  assertFoundationReviewState,
  type FoundationReviewRole,
  type FoundationReviewState,
} from './foundation-review-state'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import {
  foundationReviewWorkerTerminalSchema,
} from './worker-contracts'

const digestPattern = /^[a-f0-9]{64}$/u

export type FoundationReviewAssignment = {
  scope: 'foundation'
  role: FoundationReviewRole
  sourcePaths: string[]
  verificationSourcePaths: string[]
  stagingOutputPaths: [string]
  committedOutputPaths: [string]
}

export type FoundationReviewDispatch = {
  idempotencyKey: string
  taskId: string
  role: FoundationReviewRole
  assignment: FoundationReviewAssignment
  contract: {
    reviewScope: 'foundation'
    reviewMode: FoundationReviewState['mode']
    reviewRole: FoundationReviewRole
    assignment: FoundationReviewAssignment
    confirmedBriefDigest: string
    packetDigests: Partial<Record<FoundationReviewSpecialistRole, string>>
    priorReview?: { path: string; digest: string }
  }
}

function reportIsDispatchable(
  state: FoundationReviewState,
  role: FoundationReviewRole,
): boolean {
  const report = state.reports.find(candidate => candidate.role === role)
  return report?.status === 'pending' && !report.dispatch
}

export function buildFoundationReviewDispatches(input: {
  state: FoundationReviewState
  workspacePath: string
  confirmedBriefDigest: string
}): FoundationReviewDispatch[] {
  const state = assertFoundationReviewState(input.state)
  if (!digestPattern.test(input.confirmedBriefDigest))
    throw new Error('foundation review confirmed brief digest is invalid')
  const canonicalPaths = CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
    resolve(input.workspacePath, path),
  )
  let roles: FoundationReviewRole[]
  if (state.mode === 'verification') {
    roles = reportIsDispatchable(state, 'final') ? ['final'] : []
  } else {
    const specialists = state.reports.slice(0, 2)
    if (specialists.every(report => report.status === 'pending' && !report.dispatch))
      roles = specialists.map(report => report.role)
    else if (
      specialists.every(report => report.status === 'completed' && report.digest) &&
      reportIsDispatchable(state, 'final')
    )
      roles = ['final']
    else roles = []
  }

  const packetDigests = Object.fromEntries(
    state.reports
      .filter(
        (report): report is typeof report & {
          role: FoundationReviewSpecialistRole
          digest: string
        } => report.role !== 'final' && typeof report.digest === 'string',
      )
      .map(report => [report.role, report.digest]),
  ) as Partial<Record<FoundationReviewSpecialistRole, string>>

  return roles.map(role => {
    const taskId = `review:foundation:${role}:${state.attempt}`
    const specialist = role !== 'final'
    const stagingPath = specialist
      ? foundationReviewEvidenceStagingPath(
          input.workspacePath,
          state.revision,
          role,
        )
      : foundationReviewStagingPath(
          input.workspacePath,
          state.revision,
          `foundation-${state.mode}-${state.attempt}-final`,
        )
    const committedPath = specialist
      ? foundationReviewEvidencePath(input.workspacePath, state.revision, role)
      : foundationReviewPath(input.workspacePath, state.revision)
    const packetPaths = state.reports
      .filter(report => report.role !== 'final')
      .map(report => resolve(input.workspacePath, report.path))
    const assignment: FoundationReviewAssignment = {
      scope: 'foundation',
      role,
      sourcePaths: specialist
        ? canonicalPaths
        : state.mode === 'initial'
          ? packetPaths
          : [resolve(input.workspacePath, state.priorReviewPath!)],
      verificationSourcePaths: specialist ? [] : canonicalPaths,
      stagingOutputPaths: [stagingPath],
      committedOutputPaths: [committedPath],
    }
    return {
      idempotencyKey: taskId,
      taskId,
      role,
      assignment,
      contract: {
        reviewScope: 'foundation',
        reviewMode: state.mode,
        reviewRole: role,
        assignment,
        confirmedBriefDigest: input.confirmedBriefDigest,
        packetDigests,
        ...(state.mode === 'verification'
          ? {
              priorReview: {
                path: state.priorReviewPath!,
                digest: state.priorReviewDigest!,
              },
            }
          : {}),
      },
    }
  })
}

export async function acceptFoundationReviewWorkerTerminal(input: {
  state: FoundationReviewState
  workspacePath: string
  currentRevision: string
  terminal: unknown
}): Promise<FoundationReviewState> {
  const state = assertFoundationReviewState(input.state)
  const terminal = foundationReviewWorkerTerminalSchema.parse(input.terminal)
  if (
    terminal.revision !== state.revision ||
    terminal.mode !== state.mode ||
    terminal.revision !== input.currentRevision
  )
    throw new Error('canonical artifacts changed during foundation review')
  const report = state.reports.find(candidate => candidate.role === terminal.role)
  if (!report || terminal.reportPath !== report.path)
    throw new Error('foundation review terminal does not match its assigned role')
  if (report.status === 'completed')
    throw new Error('foundation review report is already completed')

  if (terminal.role !== 'final') {
    const accepted = await acceptFoundationReviewEvidence({
      workspacePath: input.workspacePath,
      revision: state.revision,
      currentRevision: input.currentRevision,
      role: terminal.role,
    })
    return assertFoundationReviewState({
      ...state,
      status: 'running',
      reports: state.reports.map(candidate =>
        candidate.role === terminal.role
          ? {
              ...candidate,
              path: accepted.path,
              digest: accepted.digest,
              status: 'completed' as const,
              failureReason: undefined,
            }
          : candidate,
      ),
      failureReason: undefined,
    })
  }

  if (state.mode === 'initial') {
    for (const specialist of state.reports.slice(0, 2)) {
      if (specialist.status !== 'completed' || !specialist.digest)
        throw new Error('foundation final review requires completed specialist packets')
      const bytes = await readFile(resolve(input.workspacePath, specialist.path))
      const digest = createHash('sha256').update(bytes).digest('hex')
      if (digest !== specialist.digest)
        throw new Error('foundation review specialist packet digest changed')
    }
  }
  const priorReview =
    state.mode === 'verification'
      ? await readFoundationReviewArtifact({
          workspacePath: input.workspacePath,
          path: state.priorReviewPath!,
          expectedDigest: state.priorReviewDigest!,
        })
      : undefined
  const accepted = await acceptFoundationReview({
    workspacePath: input.workspacePath,
    revision: state.revision,
    currentRevision: input.currentRevision,
    dispatchId: `foundation-${state.mode}-${state.attempt}-final`,
    ...(priorReview
      ? { priorReview: { review: priorReview.review, digest: priorReview.digest } }
      : {}),
  })
  return assertFoundationReviewState({
    ...state,
    status: 'completed',
    reports: state.reports.map(candidate =>
      candidate.role === 'final'
        ? {
            ...candidate,
            path: accepted.path,
            digest: accepted.digest,
            status: 'completed' as const,
            failureReason: undefined,
          }
        : candidate,
    ),
    finalReportPath: accepted.path,
    finalReportDigest: accepted.digest,
    verdict: accepted.review.verdict,
    failureReason: undefined,
  })
}
