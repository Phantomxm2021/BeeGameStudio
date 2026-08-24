import type { AuditIssue } from './foundation-issue-registry'
import type { FoundationDocumentPath } from './types'

export const TECHNICAL_IMPOSSIBILITY_REASON_CODE =
  'technical-impossibility' as const

export type FoundationFixTarget = {
  documentPath: FoundationDocumentPath
  sectionId: string
}

export type FoundationFixResolutionInput = {
  source: FoundationFixTarget
  target?: FoundationFixTarget
  severity: AuditIssue['severity']
  reasonCode?: string
  /** Contract bindings encode the downstream document as source. */
  edgeDirection?: 'downstream-contract'
}

const authorityRank = (path: FoundationDocumentPath): number => {
  if (path === 'docs/GDD.md') return 0
  if (path === 'docs/TECHNICAL_DESIGN.md') return 1
  return 2
}

/**
 * The only production source-of-truth/fix policy. A downstream document is
 * corrected when it conflicts with its upstream authority. Technical design
 * may send an explicit impossibility blocker back to GDD; no other reverse
 * edge is accepted.
 */
export function resolveFoundationFixTarget(
  input: FoundationFixResolutionInput,
): FoundationFixTarget {
  if (!input.target) return input.source
  if (
    input.edgeDirection === 'downstream-contract' &&
    input.source.documentPath !== 'docs/GDD.md' &&
    input.target.documentPath === 'docs/GDD.md'
  )
    return input.source
  const sourceRank = authorityRank(input.source.documentPath)
  const targetRank = authorityRank(input.target.documentPath)
  if (sourceRank < targetRank) return input.target
  if (
    input.source.documentPath === 'docs/TECHNICAL_DESIGN.md' &&
    input.target.documentPath === 'docs/GDD.md'
  ) {
    if (
      input.severity === 'BLOCKER' &&
      input.reasonCode === TECHNICAL_IMPOSSIBILITY_REASON_CODE
    )
      return input.target
    throw new Error(
      'authority violation: Technical to GDD requires technical-impossibility BLOCKER',
    )
  }
  if (sourceRank > targetRank) return input.source
  return input.target
}

export function applyFoundationFixAuthority(
  issues: readonly AuditIssue[],
): AuditIssue[] {
  return issues.map(issue => {
    const target = resolveFoundationFixTarget({
      source: issue.source,
      target: issue.target,
      severity: issue.severity,
      reasonCode: issue.reasonCode,
      ...(issue.type === 'contract' ? { edgeDirection: 'downstream-contract' as const } : {}),
    })
    return {
      ...issue,
      fixDocument: target.documentPath,
      fixSectionId: target.sectionId,
    }
  })
}
