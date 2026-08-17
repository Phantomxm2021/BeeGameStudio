import {
  foundationReviewSchema,
  type FoundationReview,
} from './foundation-review'
import type {
  FoundationReviewCandidate,
  FoundationReviewLaneReceipt,
  FoundationReviewSelection,
} from './foundation-review-markdown'

function bytewiseCompare(left: string, right: string): number {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'))
}

function cloneCandidate(candidate: FoundationReviewCandidate, id: string) {
  return {
    id,
    title: candidate.title,
    problem: candidate.problem,
    evidence: candidate.evidence.map(evidence => ({ ...evidence })),
    requiredOutcome: candidate.requiredOutcome,
    changes: candidate.changes.map(change => ({ ...change })),
    acceptance: [...candidate.acceptance],
  }
}

export function assembleFoundationReview(input: {
  revision: string
  laneReceipts: FoundationReviewLaneReceipt[]
  selection: FoundationReviewSelection
}): FoundationReview {
  if (input.selection.revision !== input.revision)
    throw new Error('foundation review selection revision does not match')

  const candidatesByReference = new Map<string, FoundationReviewCandidate>()
  for (const receipt of input.laneReceipts) {
    if (receipt.revision !== input.revision)
      throw new Error('foundation review lane receipt revision does not match')
    for (const candidate of receipt.candidates) {
      if (candidatesByReference.has(candidate.reference))
        throw new Error('foundation review candidate references must be unique')
      candidatesByReference.set(candidate.reference, candidate)
    }
  }

  const conflicts = [...input.selection.keep]
    .sort(bytewiseCompare)
    .map((reference, index) => {
      const candidate = candidatesByReference.get(reference)
      if (!candidate)
        throw new Error('foundation review selection reference is not available')
      return cloneCandidate(candidate, `B${index + 1}`)
    })
  return foundationReviewSchema.parse({
    version: 3,
    scope: 'foundation',
    revision: input.revision,
    verdict: conflicts.length ? 'NEEDS_REVISION' : 'READY',
    conflicts,
  })
}
