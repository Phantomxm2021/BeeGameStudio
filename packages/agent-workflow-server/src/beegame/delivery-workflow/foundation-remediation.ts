import { isDeepStrictEqual } from 'node:util'
import {
  foundationReviewAffectedPaths,
  type FoundationReview,
} from './foundation-review'
import type {
  DispatchRecord,
  FoundationDocumentPath,
  FoundationRemediationLane,
  FoundationRemediationLaneId,
  FoundationRemediationReceipt,
  FoundationRemediationState,
} from './types'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'

export const FOUNDATION_REMEDIATION_LANE_IDS = [
  'gdd',
  'level-scene-design',
  'balance-design',
  'technical-design',
  'art-direction',
  'ui-ux-spec',
  'audio-design',
  'asset-plan',
] as const

export const FOUNDATION_REMEDIATION_LANES = Object.freeze([
  Object.freeze({
    id: 'gdd' as const,
    ownedPaths: Object.freeze(['docs/GDD.md'] as const),
  }),
  Object.freeze({
    id: 'level-scene-design' as const,
    ownedPaths: Object.freeze(['docs/LEVEL_SCENE_DESIGN.md'] as const),
  }),
  Object.freeze({
    id: 'balance-design' as const,
    ownedPaths: Object.freeze(['docs/BALANCE_DESIGN.md'] as const),
  }),
  Object.freeze({
    id: 'technical-design' as const,
    ownedPaths: Object.freeze(['docs/TECHNICAL_DESIGN.md'] as const),
  }),
  Object.freeze({
    id: 'art-direction' as const,
    ownedPaths: Object.freeze(['docs/ART_DIRECTION.md'] as const),
  }),
  Object.freeze({
    id: 'ui-ux-spec' as const,
    ownedPaths: Object.freeze(['docs/UI_UX_SPEC.md'] as const),
  }),
  Object.freeze({
    id: 'audio-design' as const,
    ownedPaths: Object.freeze(['docs/AUDIO_DESIGN.md'] as const),
  }),
  Object.freeze({
    id: 'asset-plan' as const,
    ownedPaths: Object.freeze(['docs/ASSET_PLAN.md'] as const),
  }),
])

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
  if (!lane)
    throw new Error(`foundation remediation lane is missing: ${laneId}`)
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
  const remediation = dispatch.request?.contract.remediation
  const suppliedSourceDigest =
    remediation && typeof remediation === 'object' && !Array.isArray(remediation)
      ? (remediation as Record<string, unknown>).sourceDigest
      : undefined
  const sourceDigest =
    typeof suppliedSourceDigest === 'string'
      ? suppliedSourceDigest
      : lane.sourceDigest
  if (
    !sourceDigest ||
    !/^[a-f0-9]{64}$/u.test(sourceDigest) ||
    (lane.sourceDigest && lane.sourceDigest !== sourceDigest)
  )
    throw new Error('foundation remediation retry changed its source digest')
  return replaceLane(state, {
    ...lane,
    sourceDigest,
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
  if (!reason.trim())
    throw new Error('foundation remediation failure is required')
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
    receipt: FoundationRemediationReceipt
  },
): FoundationRemediationState {
  const lane = laneFor(state, input.laneId)
  const receipt = input.receipt
  if (lane.status === 'completed' && isDeepStrictEqual(lane.receipt, receipt))
    return state
  if (
    lane.status !== 'running' ||
    lane.dispatch?.dispatchId !== input.dispatchId
  )
    throw new Error('foundation remediation receipt has no running dispatch')
  if (receipt.reviewDigest !== state.reviewDigest)
    throw new Error('foundation remediation receipt review changed')
  if (receipt.sourceRevision !== state.sourceRevision)
    throw new Error('foundation remediation receipt revision changed')
  if (receipt.targetPath !== lane.affectedPaths[0])
    throw new Error('foundation remediation receipt target does not match lane')
  if (!lane.sourceDigest || receipt.sourceDigest !== lane.sourceDigest)
    throw new Error('foundation remediation receipt source digest changed')
  if (new Set(receipt.patchedUnitIds).size !== receipt.patchedUnitIds.length)
    throw new Error('foundation remediation receipt patch units are invalid')
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
