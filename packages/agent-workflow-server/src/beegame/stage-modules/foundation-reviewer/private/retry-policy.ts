/** Production Reviewer dispatch failure policy; no cross-stage runtime imports. */
export function foundationReviewFailureNeedsAction(input: {
  kind: 'document-facts' | 'semantic' | 'confirmation'
  attempt: number
  reason: string
}): boolean {
  return /(?:fast model|model config|attempt cap|not configured)/i.test(input.reason) ||
    input.attempt >= (input.kind === 'confirmation' ? 1 : 2)
}
