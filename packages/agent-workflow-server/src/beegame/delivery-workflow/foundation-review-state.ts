import { z } from 'zod'
import type { DispatchRecord, WorkflowUsage } from './types'

const digestSchema = z.string().regex(/^[a-f0-9]{64}$/u)

export type FoundationReviewRole =
  | 'contract-specialist'
  | 'integration-specialist'
  | 'final'

export type FoundationReviewMode = 'initial' | 'verification'

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
  mode: FoundationReviewMode
  attempt: number
  status: 'pending' | 'running' | 'completed' | 'failed'
  reports: FoundationReviewReportState[]
  priorReviewPath?: string
  priorReviewDigest?: string
  finalReportPath?: string
  finalReportDigest?: string
  verdict?: 'READY' | 'NEEDS_REVISION'
  failureReason?: string
}

function reportPath(revision: string, role: FoundationReviewRole): string {
  const root = `.beegame/reviews/foundation/${revision}`
  if (role === 'contract-specialist') return `${root}/parts/contract.json`
  if (role === 'integration-specialist') return `${root}/parts/integration.json`
  return `${root}/review.json`
}

export function assertFoundationReviewState(
  state: FoundationReviewState,
): FoundationReviewState {
  digestSchema.parse(state.revision)
  if (!Number.isSafeInteger(state.attempt) || state.attempt < 1)
    throw new Error('foundation review attempt must be a positive integer')
  const expectedRoles: FoundationReviewRole[] =
    state.mode === 'initial'
      ? ['contract-specialist', 'integration-specialist', 'final']
      : ['final']
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
  if (state.mode === 'verification') {
    if (!state.priorReviewPath || !state.priorReviewDigest)
      throw new Error('verification review requires prior review path and digest')
    digestSchema.parse(state.priorReviewDigest)
  } else if (state.priorReviewPath || state.priorReviewDigest) {
    throw new Error('initial review cannot contain prior review authority')
  }
  const final = state.reports[state.reports.length - 1]
  if (
    state.mode === 'initial' &&
    final.status !== 'pending' &&
    !state.reports
      .slice(0, 2)
      .every(report => report.status === 'completed' && report.digest)
  )
    throw new Error('foundation final review requires completed specialist packets')
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
  mode: FoundationReviewMode
  attempt?: number
  priorReviewPath?: string
  priorReviewDigest?: string
}): FoundationReviewState {
  digestSchema.parse(input.revision)
  const roles: FoundationReviewRole[] =
    input.mode === 'initial'
      ? ['contract-specialist', 'integration-specialist', 'final']
      : ['final']
  return assertFoundationReviewState({
    revision: input.revision,
    mode: input.mode,
    attempt: input.attempt ?? 1,
    status: 'pending',
    reports: roles.map(role => ({
      role,
      path: reportPath(input.revision, role),
      status: 'pending',
    })),
    ...(input.priorReviewPath ? { priorReviewPath: input.priorReviewPath } : {}),
    ...(input.priorReviewDigest
      ? { priorReviewDigest: input.priorReviewDigest }
      : {}),
  })
}
