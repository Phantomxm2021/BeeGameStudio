import { z } from 'zod'
import type { DispatchRecord, WorkflowUsage } from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export type FoundationReviewRole =
  | 'core-design'
  | 'technical-assets'
  | 'presentation'
  | 'synthesis'

export type FoundationReviewReportState = {
  role: FoundationReviewRole
  path: string
  status: 'pending' | 'running' | 'completed' | 'failed'
  dispatch?: DispatchRecord
  digest?: string
  durationMs?: number
  usage?: WorkflowUsage
  failureReason?: string
}

export type FoundationReviewState = {
  revision: string
  attempt: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: FoundationReviewReportState[]
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: 'READY' | 'NEEDS_REVISION'
  failureReason?: string
}

export function foundationReviewHasAcceptedFinal(
  state: FoundationReviewState,
): boolean {
  return Boolean(
    state.verdict &&
      state.finalReportPath &&
      state.finalReportDigest &&
      state.reports.every(
        report => report.status === 'completed' && report.digest,
      ),
  )
}

function reportPath(revision: string, role: FoundationReviewRole): string {
  const root = `.beegame/reviews/foundation/${revision}`
  if (
    role === 'core-design' ||
    role === 'technical-assets' ||
    role === 'presentation'
  )
    return `${root}/parts/${role}.json`
  return `${root}/review.json`
}

export function assertFoundationReviewState(
  state: FoundationReviewState,
): FoundationReviewState {
  digestSchema.parse(state.revision)
  if (!Number.isSafeInteger(state.attempt) || state.attempt < 1)
    throw new Error('foundation review attempt must be a positive integer')
  const expectedRoles: FoundationReviewRole[] = [
    'core-design',
    'technical-assets',
    'presentation',
    'synthesis',
  ]
  if (
    state.reports.length !== expectedRoles.length ||
    state.reports.some((report, index) => report.role !== expectedRoles[index])
  )
    throw new Error('foundation review report topology does not match mode')
  if (state.reports.some(report => report.path !== reportPath(state.revision, report.role)))
    throw new Error('foundation review report path does not match role')
  for (const report of state.reports) {
    if (report.status === 'completed' && !report.digest)
      throw new Error('completed foundation review report requires a digest')
    if (report.digest) digestSchema.parse(report.digest)
  }
  const final = state.reports[state.reports.length - 1]
  if (
    final.status !== 'pending' &&
    !state.reports
      .slice(0, 3)
      .every(report => report.status === 'completed' && report.digest)
  )
    throw new Error('foundation synthesis requires completed lane packets')
  if (state.status === 'completed') {
    if (
      final.status !== 'completed' ||
      !state.finalReportPath ||
      !state.finalReportDigest ||
      !state.verdict
    )
      throw new Error('completed foundation review requires final authority')
    digestSchema.parse(state.finalReportDigest)
  }
  return state
}

export function createFoundationReviewState(input: {
  revision: string
  attempt?: number
}): FoundationReviewState {
  digestSchema.parse(input.revision)
  const roles: FoundationReviewRole[] = [
    'core-design',
    'technical-assets',
    'presentation',
    'synthesis',
  ]
  return assertFoundationReviewState({
    revision: input.revision,
    attempt: input.attempt ?? 1,
    status: 'pending',
    reports: roles.map(role => ({
      role,
      path: reportPath(input.revision, role),
      status: 'pending',
    })),
  })
}
