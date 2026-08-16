import { isDeepStrictEqual } from 'node:util'
import {
  foundationReviewAffectedPaths,
  type FoundationReview,
} from './foundation-review'
import { FOUNDATION_DOCUMENT_LANES } from './foundation-document-lanes'
import type {
  DispatchRecord,
  FoundationDocumentPath,
  FoundationRemediationLane,
  FoundationRemediationLaneId,
  FoundationRemediationReceipt,
  FoundationRemediationState,
} from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

export const FOUNDATION_REMEDIATION_LANES = FOUNDATION_DOCUMENT_LANES

export function createFoundationRemediationState(input: {
  reviewPath: string
  reviewDigest: string
  review: FoundationReview
}): FoundationRemediationState {
  if (!input.reviewPath.trim())
    throw new Error('foundation remediation review path is required')
  if (!/^[a-f0-9]{64}$/u.test(input.reviewDigest))
    throw new Error('foundation remediation review digest is invalid')
  if (input.review.verdict !== 'NEEDS_REVISION')
    throw new Error('foundation remediation requires a revision verdict')
  return createFoundationRemediationStateFromAuthority({
    reviewPath: input.reviewPath,
    reviewDigest: input.reviewDigest,
    sourceRevision: input.review.revision,
    affectedPaths: foundationReviewAffectedPaths(input.review),
  })
}

export function createFoundationRemediationStateFromAuthority(input: {
  reviewPath: string
  reviewDigest: string
  sourceRevision: string
  affectedPaths: readonly string[]
}): FoundationRemediationState {
  if (!input.reviewPath.trim())
    throw new Error('foundation remediation review path is required')
  if (!/^[a-f0-9]{64}$/u.test(input.reviewDigest))
    throw new Error('foundation remediation review digest is invalid')
  if (!/^[a-f0-9]{64}$/u.test(input.sourceRevision))
    throw new Error('foundation remediation source revision is invalid')
  const canonicalAffectedPaths = CANONICAL_FOUNDATION_DOCUMENTS.filter(path =>
    input.affectedPaths.includes(path),
  )
  if (
    canonicalAffectedPaths.length !== input.affectedPaths.length ||
    input.affectedPaths.some(
      (path, index) => path !== canonicalAffectedPaths[index],
    )
  )
    throw new Error(
      'foundation remediation affected paths must be canonical and unique',
    )
  if (!canonicalAffectedPaths.length)
    throw new Error('foundation remediation has no accepted conflict paths')
  const affected = new Set(canonicalAffectedPaths)
  const lanes: FoundationRemediationLane[] = FOUNDATION_REMEDIATION_LANES.map(
    definition => {
      const affectedPaths = definition.ownedPaths.filter(path =>
        affected.has(path),
      )
      return {
        id: definition.id,
        ownedPaths: [...definition.ownedPaths],
        affectedPaths,
        status: affectedPaths.length ? 'pending' : 'not_required',
      }
    },
  )
  return {
    reviewPath: input.reviewPath,
    reviewDigest: input.reviewDigest,
    sourceRevision: input.sourceRevision,
    lanes,
  }
}

export function pendingFoundationRemediationLanes(
  state: FoundationRemediationState,
): FoundationRemediationLane[] {
  return state.lanes.filter(lane => lane.status === 'pending')
}

function laneFor(
  state: FoundationRemediationState,
  laneId: FoundationRemediationLaneId,
): FoundationRemediationLane {
  const lane = state.lanes.find(candidate => candidate.id === laneId)
  if (!lane) throw new Error(`foundation remediation lane is missing: ${laneId}`)
  return lane
}

function replaceLane(
  state: FoundationRemediationState,
  replacement: FoundationRemediationLane,
): FoundationRemediationState {
  return {
    ...state,
    lanes: state.lanes.map(lane =>
      lane.id === replacement.id ? replacement : lane,
    ),
  }
}

export function recordFoundationRemediationDispatch(
  state: FoundationRemediationState,
  laneId: FoundationRemediationLaneId,
  dispatch: DispatchRecord,
): FoundationRemediationState {
  const lane = laneFor(state, laneId)
  if (
    lane.status === 'running' &&
    lane.dispatch?.dispatchId === dispatch.dispatchId
  )
    return state
  if (lane.status !== 'pending')
    throw new Error(`foundation remediation lane is not pending: ${laneId}`)
  if (dispatch.taskId !== `foundation-remediation:${laneId}`)
    throw new Error('foundation remediation dispatch task does not match lane')
  return replaceLane(state, {
    ...lane,
    status: 'running',
    dispatch,
    failureReason: undefined,
  })
}

export function recordFoundationRemediationFailure(
  state: FoundationRemediationState,
  laneId: FoundationRemediationLaneId,
  reason: string,
): FoundationRemediationState {
  const lane = laneFor(state, laneId)
  if (!reason.trim()) throw new Error('foundation remediation failure is required')
  if (lane.status !== 'running')
    throw new Error(`foundation remediation lane is not running: ${laneId}`)
  return replaceLane(state, {
    ...lane,
    status: 'failed',
    dispatch: lane.dispatch
      ? { ...lane.dispatch, status: 'failed', failureReason: reason }
      : undefined,
    failureReason: reason,
  })
}

export function retryFoundationRemediationFailures(
  state: FoundationRemediationState,
): FoundationRemediationState {
  return {
    ...state,
    lanes: state.lanes.map(lane =>
      lane.status === 'failed'
        ? {
            ...lane,
            status: 'pending' as const,
            dispatch: undefined,
            failureReason: undefined,
          }
        : lane,
    ),
  }
}

export function commitFoundationRemediationReceipt(
  state: FoundationRemediationState,
  input: {
    laneId: FoundationRemediationLaneId
    dispatchId: string
    writtenPaths: readonly string[]
    beforeDigests: Record<string, string>
    afterDigests: Record<string, string>
    committedAt: string
  },
): FoundationRemediationState {
  const lane = laneFor(state, input.laneId)
  const receipt: FoundationRemediationReceipt = {
    reviewDigest: state.reviewDigest,
    sourceRevision: state.sourceRevision,
    ownedPaths: [...lane.ownedPaths],
    beforeDigests: { ...input.beforeDigests },
    afterDigests: { ...input.afterDigests },
    committedAt: input.committedAt,
  }
  if (lane.status === 'completed' && isDeepStrictEqual(lane.receipt, receipt))
    return state
  if (
    lane.status !== 'running' ||
    lane.dispatch?.dispatchId !== input.dispatchId
  )
    throw new Error('foundation remediation receipt has no running dispatch')
  if (!isDeepStrictEqual(input.writtenPaths, lane.affectedPaths))
    throw new Error('mutation paths do not match the lane assignment')
  const ownedKeys = [...lane.ownedPaths].sort()
  for (const digests of [input.beforeDigests, input.afterDigests]) {
    if (
      !isDeepStrictEqual(Object.keys(digests).sort(), ownedKeys) ||
      Object.values(digests).some(value => !/^[a-f0-9]{64}$/u.test(value))
    )
      throw new Error('foundation remediation receipt digests are incomplete')
  }
  return replaceLane(state, {
    ...lane,
    status: 'completed',
    dispatch: { ...lane.dispatch, status: 'completed' },
    receipt,
    failureReason: undefined,
  })
}

export function foundationRemediationReadyForVerification(
  state: FoundationRemediationState,
): boolean {
  return state.lanes.every(lane =>
    lane.status === 'not_required' ? true : lane.status === 'completed',
  )
}
