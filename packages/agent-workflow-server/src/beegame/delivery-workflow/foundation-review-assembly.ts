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

function assertSelectionPartition(
  selection: FoundationReviewSelection,
  candidatesByReference: ReadonlyMap<string, FoundationReviewCandidate>,
): void {
  const accounted = [
    ...selection.keep,
    ...selection.duplicate.map(item => item.source),
    ...selection.reject,
  ]
  for (const reference of [
    ...accounted,
    ...selection.duplicate.map(item => item.target),
  ])
    if (!candidatesByReference.has(reference))
      throw new Error('foundation review selection reference is not available')
  if (
    accounted.length !== candidatesByReference.size ||
    new Set(accounted).size !== accounted.length
  )
    throw new Error(
      'foundation review selection must account for every lane candidate exactly once',
    )
  for (const reference of candidatesByReference.keys())
    if (!accounted.includes(reference))
      throw new Error(
        'foundation review selection must account for every lane candidate exactly once',
      )
  for (const { source, target } of selection.duplicate) {
    if (source === target)
      throw new Error('foundation review duplicate cannot target itself')
    if (!selection.keep.includes(target))
      throw new Error('foundation review duplicate target is not retained')
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
  assertSelectionPartition(input.selection, candidatesByReference)

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
