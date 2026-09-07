import { CANONICAL_FOUNDATION_DOCUMENTS } from './types'
import { stringArray, sameStrings } from './recovery-values'

// Validate existing document evidence for downstream recovery; never resume or commit Author work.
export function authorUnitPredecessors(unitId: string): string[] | undefined {
  const index = CANONICAL_FOUNDATION_DOCUMENTS.findIndex(
    path => 'document:' + path === unitId,
  )
  if (index < 0) return undefined
  return index === 0
    ? []
    : ['document:' + CANONICAL_FOUNDATION_DOCUMENTS[index - 1]!]
}

export function validateAuthorCompletedProofs(input: {
  completedPaths: unknown
  provenUnitIds: ReadonlySet<string>
  reject(
    code: 'recovery_checkpoint_missing' | 'recovery_checkpoint_conflict',
    message: string,
  ): never
}): void {
  const paths = stringArray(input.completedPaths)
  if (!paths) return
  if (
    !sameStrings(paths, CANONICAL_FOUNDATION_DOCUMENTS.slice(0, paths.length))
  )
    input.reject(
      'recovery_checkpoint_conflict',
      'snapshot completed documents are outside the current canonical prefix',
    )
  for (const path of paths)
    if (!input.provenUnitIds.has('document:' + path))
      input.reject(
        'recovery_checkpoint_missing',
        `snapshot-completed document ${path} has no dispatch-bound accepted journal event`,
      )
}
