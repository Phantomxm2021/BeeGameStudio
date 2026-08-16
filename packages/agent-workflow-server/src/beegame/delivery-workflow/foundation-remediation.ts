import { foundationReviewAffectedPaths, type FoundationReview } from './foundation-review'
import type {
  FoundationDocumentPath,
  FoundationRemediationLane,
  FoundationRemediationLaneId,
  FoundationRemediationState,
} from './types'

type FoundationRemediationLaneDefinition = {
  id: FoundationRemediationLaneId
  ownedPaths: readonly FoundationDocumentPath[]
}

export const FOUNDATION_REMEDIATION_LANES = Object.freeze(
  [
    {
      id: 'core-design',
      ownedPaths: [
        'docs/GDD.md',
        'docs/LEVEL_SCENE_DESIGN.md',
        'docs/BALANCE_DESIGN.md',
      ],
    },
    {
      id: 'technical-assets',
      ownedPaths: ['docs/TECHNICAL_DESIGN.md', 'docs/ASSET_PLAN.md'],
    },
    {
      id: 'presentation',
      ownedPaths: [
        'docs/ART_DIRECTION.md',
        'docs/UI_UX_SPEC.md',
        'docs/AUDIO_DESIGN.md',
      ],
    },
  ].map(lane =>
    Object.freeze({
      id: lane.id,
      ownedPaths: Object.freeze([...lane.ownedPaths]),
    }),
  ),
) as readonly FoundationRemediationLaneDefinition[]

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
  const affected = new Set(foundationReviewAffectedPaths(input.review))
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
    sourceRevision: input.review.revision,
    lanes,
  }
}
