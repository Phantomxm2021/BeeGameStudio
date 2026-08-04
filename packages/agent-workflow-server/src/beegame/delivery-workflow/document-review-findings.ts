import type { DocumentReviewCycle, DocumentReviewFinding } from './types'

export function openDocumentReviewFindingIds(
  cycle: DocumentReviewCycle,
): Set<string> {
  return new Set(cycle.checks.flatMap(check => check.findingIds))
}

export function openDocumentReviewFindings(
  value: unknown,
): DocumentReviewFinding[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return []
  const cycle = value as Record<string, unknown>
  if (!Array.isArray(cycle.checks) || !Array.isArray(cycle.findings)) return []
  const openIds = new Set(
    cycle.checks.flatMap(check => {
      if (!check || typeof check !== 'object' || Array.isArray(check)) return []
      const findingIds = (check as Record<string, unknown>).findingIds
      return Array.isArray(findingIds)
        ? findingIds.filter(
            (findingId): findingId is string => typeof findingId === 'string',
          )
        : []
    }),
  )
  return cycle.findings.filter((finding): finding is DocumentReviewFinding =>
    Boolean(
      finding &&
        typeof finding === 'object' &&
        !Array.isArray(finding) &&
        typeof (finding as Record<string, unknown>).findingId === 'string' &&
        openIds.has((finding as Record<string, unknown>).findingId as string),
    ),
  )
}

export function mergeDocumentReviewFindingLedger(
  existing: DocumentReviewFinding[],
  submitted: DocumentReviewFinding[],
): DocumentReviewFinding[] {
  const replacements = new Map(
    submitted.map(finding => [finding.findingId, finding]),
  )
  const merged = existing.map(
    finding => replacements.get(finding.findingId) ?? finding,
  )
  const existingIds = new Set(existing.map(finding => finding.findingId))
  return [
    ...merged,
    ...submitted.filter(finding => !existingIds.has(finding.findingId)),
  ]
}
