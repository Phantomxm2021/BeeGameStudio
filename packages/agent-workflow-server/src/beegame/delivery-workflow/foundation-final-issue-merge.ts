import type { AuditIssue, AuditSeverity } from './foundation-issue-registry'

const severityRank: Record<AuditSeverity, number> = {
  BLOCKER: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
}

function normalizedConflictText(value: string): string {
  return value.trim().replace(/\s+/g, ' ').toLowerCase()
}

function canonicalConflictSubject(issue: AuditIssue): string {
  const normalized = `${normalizedConflictText(issue.expected)} ${normalizedConflictText(issue.actual)}`
  const fact = /\brequired fact ([a-z][a-z0-9._-]*)\b/.exec(normalized)?.[1]
  return fact
    ? `fact:${fact}`
    : `text:${normalizedConflictText(issue.expected)}\u0000${normalizedConflictText(issue.actual)}`
}

/**
 * Merge only mechanically identical business conflicts emitted by different
 * audit layers at the final-review boundary. Different expected/actual
 * conditions in the same section stay separate.
 */
export function mergeExactFoundationReviewIssues(
  issues: readonly AuditIssue[],
): AuditIssue[] {
  const byConflict = new Map<string, AuditIssue>()
  for (const issue of issues) {
    const identity = JSON.stringify({
      source: [issue.source.documentPath, issue.source.sectionId],
      target: issue.target
        ? [issue.target.documentPath, issue.target.sectionId]
        : null,
      subject: canonicalConflictSubject(issue),
      remediation: issue.remediation,
    })
    const existing = byConflict.get(identity)
    if (!existing || severityRank[issue.severity] > severityRank[existing.severity])
      byConflict.set(identity, issue)
  }
  return [...byConflict.values()].sort((left, right) => left.id.localeCompare(right.id))
}
