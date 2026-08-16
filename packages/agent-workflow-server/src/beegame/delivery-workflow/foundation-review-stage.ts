import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import {
  FOUNDATION_DOCUMENT_LANES,
  foundationDocumentLaneById,
  type FoundationDocumentLaneId,
} from './foundation-document-lanes'
import {
  acceptFoundationReviewLanePacket,
  foundationReviewLanePacketPath,
  foundationReviewLanePacketStagingPath,
} from './foundation-review-lane-packet'
import { writeFoundationReviewProjection } from './foundation-review-projection'
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
import { foundationRemediationReadyForVerification } from './foundation-remediation'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationRemediationState,
} from './types'
import { foundationReviewWorkerTerminalSchema } from './worker-contracts'

const digestPattern = /^[a-f0-9]{64}$/u
const laneIds = new Set<FoundationReviewRole>(
  FOUNDATION_DOCUMENT_LANES.map(lane => lane.id),
)

function isLaneRole(role: FoundationReviewRole): role is FoundationDocumentLaneId {
  return laneIds.has(role)
}

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
    packetDigests: Partial<Record<FoundationDocumentLaneId, string>>
    projection?: { path: string; digest: string; byteLength: number }
    priorReview?: { path: string; digest: string }
    remediationReceipts?: Array<{
      laneId: string
      receipt: NonNullable<FoundationRemediationState['lanes'][number]['receipt']>
    }>
  }
}

function reportIsDispatchable(
  state: FoundationReviewState,
  role: FoundationReviewRole,
): boolean {
  const report = state.reports.find(candidate => candidate.role === role)
  return report?.status === 'pending' && !report.dispatch
}

function pendingRoles(state: FoundationReviewState): FoundationReviewRole[] {
  if (state.mode === 'verification')
    return reportIsDispatchable(state, 'verification') ? ['verification'] : []
  const lanes = state.reports.slice(0, 3)
  if (
    lanes.every(report => report.status === 'completed' && report.digest) &&
    reportIsDispatchable(state, 'synthesis')
  )
    return ['synthesis']
  return lanes
    .filter(report => reportIsDispatchable(state, report.role))
    .map(report => report.role)
}

function completedPacketDigests(
  state: FoundationReviewState,
): Partial<Record<FoundationDocumentLaneId, string>> {
  return Object.fromEntries(
    state.reports.flatMap(report =>
      isLaneRole(report.role) && typeof report.digest === 'string'
        ? [[report.role, report.digest]]
        : [],
    ),
  ) as Partial<Record<FoundationDocumentLaneId, string>>
}

function verificationReceipts(input: {
  state: FoundationReviewState
  remediationState?: FoundationRemediationState
}): FoundationReviewDispatch['contract']['remediationReceipts'] {
  if (input.state.mode !== 'verification') return undefined
  const remediation = input.remediationState
  if (
    !remediation ||
    remediation.reviewDigest !== input.state.priorReviewDigest ||
    remediation.resultingRevision !== input.state.revision ||
    !foundationRemediationReadyForVerification(remediation)
  )
    throw new Error(
      'foundation verification requires the completed remediation receipt barrier',
    )
  return remediation.lanes.flatMap(lane =>
    lane.status === 'not_required'
      ? []
      : lane.receipt
        ? [{ laneId: lane.id, receipt: lane.receipt }]
        : (() => {
            throw new Error(`foundation verification receipt is missing: ${lane.id}`)
          })(),
  )
}

export async function buildFoundationReviewDispatches(input: {
  state: FoundationReviewState
  workspacePath: string
  confirmedBriefDigest: string
  remediationState?: FoundationRemediationState
}): Promise<FoundationReviewDispatch[]> {
  const state = assertFoundationReviewState(input.state)
  if (!digestPattern.test(input.confirmedBriefDigest))
    throw new Error('foundation review confirmed brief digest is invalid')
  const roles = pendingRoles(state)
  const packetDigests = completedPacketDigests(state)
  const remediationReceipts = verificationReceipts({
    state,
    remediationState: input.remediationState,
  })

  return Promise.all(
    roles.map(async role => {
      const taskId = `review:foundation:${role}:${state.attempt}`
      let projection: FoundationReviewDispatch['contract']['projection']
      let sourcePaths: string[]
      let verificationSourcePaths: string[]
      let stagingPath: string
      let committedPath: string
      if (isLaneRole(role)) {
        const lane = foundationDocumentLaneById(role)
        projection = await writeFoundationReviewProjection({
          workspacePath: input.workspacePath,
          revision: state.revision,
          laneId: role,
        })
        sourcePaths = lane.ownedPaths.map(path => resolve(input.workspacePath, path))
        verificationSourcePaths = [resolve(input.workspacePath, projection.path)]
        stagingPath = foundationReviewLanePacketStagingPath(
          input.workspacePath,
          state.revision,
          role,
        )
        committedPath = foundationReviewLanePacketPath(
          input.workspacePath,
          state.revision,
          role,
        )
      } else {
        sourcePaths =
          role === 'synthesis'
            ? FOUNDATION_DOCUMENT_LANES.map(lane =>
                foundationReviewLanePacketPath(
                  input.workspacePath,
                  state.revision,
                  lane.id,
                ),
              )
            : [resolve(input.workspacePath, state.priorReviewPath!)]
        verificationSourcePaths =
          role === 'verification'
            ? CANONICAL_FOUNDATION_DOCUMENTS.map(path =>
                resolve(input.workspacePath, path),
              )
            : []
        stagingPath = foundationReviewStagingPath(
          input.workspacePath,
          state.revision,
          `foundation-${state.mode}-${state.attempt}-${role}`,
        )
        committedPath = foundationReviewPath(input.workspacePath, state.revision)
      }
      const assignment: FoundationReviewAssignment = {
        scope: 'foundation',
        role,
        sourcePaths,
        verificationSourcePaths,
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
          ...(projection ? { projection } : {}),
          ...(state.mode === 'verification'
            ? {
                priorReview: {
                  path: state.priorReviewPath!,
                  digest: state.priorReviewDigest!,
                },
                remediationReceipts,
              }
            : {}),
        },
      }
    }),
  )
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

  if (isLaneRole(terminal.role)) {
    const projection = await writeFoundationReviewProjection({
      workspacePath: input.workspacePath,
      revision: state.revision,
      laneId: terminal.role,
    })
    const accepted = await acceptFoundationReviewLanePacket({
      workspacePath: input.workspacePath,
      revision: state.revision,
      currentRevision: input.currentRevision,
      laneId: terminal.role,
      projectionDigest: projection.digest,
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

  if (terminal.role === 'synthesis') {
    for (const lane of state.reports.slice(0, 3)) {
      if (lane.status !== 'completed' || !lane.digest)
        throw new Error('foundation synthesis requires completed lane packets')
      const bytes = await readFile(resolve(input.workspacePath, lane.path))
      if (createHash('sha256').update(bytes).digest('hex') !== lane.digest)
        throw new Error('foundation review lane packet digest changed')
    }
  }
  const priorReview =
    terminal.role === 'verification'
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
    dispatchId: `foundation-${state.mode}-${state.attempt}-${terminal.role}`,
    ...(priorReview
      ? { priorReview: { review: priorReview.review, digest: priorReview.digest } }
      : {}),
  })
  return assertFoundationReviewState({
    ...state,
    status: 'completed',
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
    finalReportPath: accepted.path,
    finalReportDigest: accepted.digest,
    verdict: accepted.review.verdict,
    failureReason: undefined,
  })
}
