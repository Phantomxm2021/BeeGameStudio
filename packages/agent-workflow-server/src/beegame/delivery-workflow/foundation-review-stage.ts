import { createHash } from 'node:crypto'
import { readFile, rm } from 'node:fs/promises'
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
} from './foundation-review'
import {
  assertFoundationReviewState,
  type FoundationReviewRole,
  type FoundationReviewState,
} from './foundation-review-state'
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
    reviewMode: 'initial'
    reviewRole: FoundationReviewRole
    assignment: FoundationReviewAssignment
    confirmedBriefDigest: string
    packetDigests: Partial<Record<FoundationDocumentLaneId, string>>
    projection?: { path: string; digest: string; byteLength: number }
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

export async function buildFoundationReviewDispatches(input: {
  state: FoundationReviewState
  workspacePath: string
  confirmedBriefDigest: string
}): Promise<FoundationReviewDispatch[]> {
  const state = assertFoundationReviewState(input.state)
  if (!digestPattern.test(input.confirmedBriefDigest))
    throw new Error('foundation review confirmed brief digest is invalid')
  const roles = pendingRoles(state)
  const packetDigests = completedPacketDigests(state)

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
        sourcePaths = FOUNDATION_DOCUMENT_LANES.map(lane =>
          foundationReviewLanePacketPath(
            input.workspacePath,
            state.revision,
            lane.id,
          ),
        )
        verificationSourcePaths = []
        stagingPath = foundationReviewStagingPath(
          input.workspacePath,
          state.revision,
          `foundation-initial-${state.attempt}-${role}`,
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
      await rm(stagingPath, { force: true })
      return {
        idempotencyKey: taskId,
        taskId,
        role,
        assignment,
        contract: {
          reviewScope: 'foundation',
          reviewMode: 'initial',
          reviewRole: role,
          assignment,
          confirmedBriefDigest: input.confirmedBriefDigest,
          packetDigests,
          ...(projection ? { projection } : {}),
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
    terminal.mode !== 'initial' ||
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
      mode: 'initial',
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
  const accepted = await acceptFoundationReview({
    workspacePath: input.workspacePath,
    revision: state.revision,
    currentRevision: input.currentRevision,
    dispatchId: `foundation-initial-${state.attempt}-${terminal.role}`,
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
