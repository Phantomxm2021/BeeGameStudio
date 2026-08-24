import type { AuditIssue, AuditSeverity } from './foundation-issue-registry'

import type { FoundationRevisionRound } from './types'

export type FoundationRevisionRoundPolicySnapshot = {
  /** Issues have already been admitted by the committed Issue Registry. */
  issues: readonly AuditIssue[]
  issueRegistryDigest: string
  documentRevision: string
}

export type FoundationRevisionRoundPolicyInput =
  | {
      phase: 'plan'
      round: FoundationRevisionRound
      issues: readonly AuditIssue[]
    }
  | {
      phase: 'evaluate'
      round: FoundationRevisionRound
      before: FoundationRevisionRoundPolicySnapshot
      after: FoundationRevisionRoundPolicySnapshot
    }

export type FoundationRevisionRoundPolicyResult =
  | {
      status: 'repair'
      round: FoundationRevisionRound
      repairIssueIds: string[]
      knownIssueIds: string[]
    }
  | {
      status: 'proceed'
      repairIssueIds: []
      knownIssueIds: string[]
    }
  | {
      status: 'continue'
      nextRound: 2 | 3
      repairIssueIds: string[]
      knownIssueIds: string[]
    }
  | {
      status: 'needs_action'
      repairIssueIds: []
      knownIssueIds: string[]
      reason: 'no_progress' | 'round_limit'
    }

const SEVERITIES: readonly AuditSeverity[] = [
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
]

/**
 * Applies the sole authority-document round/stop policy. `plan` selects the
 * issues for an initial/next round; `evaluate` decides what follows a round's
 * targeted recheck. Both paths consume only Issue Registry admissions.
 */
export function evaluateFoundationRevisionRoundPolicy(
  input: FoundationRevisionRoundPolicyInput,
): FoundationRevisionRoundPolicyResult {
  if (!input || typeof input !== 'object')
    throw new Error('foundation revision round policy input is invalid')
  assertRound(input.round)

  if (input.phase === 'plan') {
    const issues = assertIssueList(input.issues, 'plan')
    const repairIssueIds = repairIdsForRound(input.round, issues)
    const knownIssueIds = sortIds(
      issues
        .filter(
          issue =>
            (issue.severity === 'MEDIUM' || issue.severity === 'LOW') &&
            !repairIssueIds.includes(issue.id),
        )
        .map(issue => issue.id),
    )
    if (repairIssueIds.length === 0) {
      const hasBlockerOrHigh = issues.some(
        issue => issue.severity === 'BLOCKER' || issue.severity === 'HIGH',
      )
      if (hasBlockerOrHigh)
        return {
          status: 'needs_action',
          repairIssueIds: [],
          knownIssueIds,
          reason: 'round_limit',
        }
      return { status: 'proceed', repairIssueIds: [], knownIssueIds }
    }
    return {
      status: 'repair',
      round: input.round,
      repairIssueIds,
      knownIssueIds,
    }
  }

  if (input.phase !== 'evaluate')
    throw new Error('foundation revision round policy phase is invalid')

  const before = assertSnapshot(input.before, 'before')
  const after = assertSnapshot(input.after, 'after')
  const beforeIds = sortedIssueIds(before.issues)
  const afterIds = sortedIssueIds(after.issues)
  const unchangedAuthority =
    sameIds(beforeIds, afterIds) &&
    before.issueRegistryDigest === after.issueRegistryDigest &&
    before.documentRevision === after.documentRevision

  if (unchangedAuthority && !sameIssueIdentities(before.issues, after.issues))
    throw new Error(
      'foundation revision round issue identity changed under an unchanged authoritative digest',
    )

  const unresolved = after.issues
  const blockerOrHigh = unresolved.filter(
    issue => issue.severity === 'BLOCKER' || issue.severity === 'HIGH',
  )
  const knownIssueIds = sortIds(
    unresolved
      .filter(issue => issue.severity === 'MEDIUM' || issue.severity === 'LOW')
      .map(issue => issue.id),
  )

  if (blockerOrHigh.length === 0)
    return { status: 'proceed', repairIssueIds: [], knownIssueIds }

  if (unchangedAuthority)
    return {
      status: 'needs_action',
      repairIssueIds: [],
      knownIssueIds,
      reason: 'no_progress',
    }

  if (input.round === 1)
    return {
      status: 'continue',
      nextRound: 2,
      repairIssueIds: repairIdsForRound(2, unresolved),
      knownIssueIds,
    }

  if (input.round === 2) {
    const nextRepairIssueIds = repairIdsForRound(3, unresolved)
    if (nextRepairIssueIds.length > 0)
      return {
        status: 'continue',
        nextRound: 3,
        repairIssueIds: nextRepairIssueIds,
        knownIssueIds,
      }
  }

  return {
    status: 'needs_action',
    repairIssueIds: [],
    knownIssueIds,
    reason: 'round_limit',
  }
}

function assertRound(value: unknown): asserts value is FoundationRevisionRound {
  if (value !== 1 && value !== 2 && value !== 3)
    throw new Error('foundation revision round must be 1, 2, or 3')
}

function assertSnapshot(
  value: FoundationRevisionRoundPolicySnapshot | undefined,
  label: string,
): FoundationRevisionRoundPolicySnapshot {
  if (!value || typeof value !== 'object')
    throw new Error(`foundation revision ${label} snapshot is invalid`)
  assertIssueList(value.issues, label)
  if (
    typeof value.issueRegistryDigest !== 'string' ||
    value.issueRegistryDigest.length === 0
  )
    throw new Error(
      `foundation revision ${label} issue registry digest is invalid`,
    )
  if (
    typeof value.documentRevision !== 'string' ||
    value.documentRevision.length === 0
  )
    throw new Error(`foundation revision ${label} document revision is invalid`)
  return value
}

function assertIssueList(value: unknown, label: string): readonly AuditIssue[] {
  if (!Array.isArray(value))
    throw new Error(`foundation revision ${label} issues must be an array`)
  const ids = new Set<string>()
  for (const issue of value) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue))
      throw new Error(
        `foundation revision ${label} AuditIssue identity is invalid`,
      )
    if (
      typeof issue.id !== 'string' ||
      issue.id.length === 0 ||
      !isSeverity(issue.severity)
    )
      throw new Error(
        `foundation revision ${label} AuditIssue identity is invalid: ${String(issue.id)}`,
      )
    if (ids.has(issue.id))
      throw new Error(
        `duplicate issue ID in foundation revision ${label}: ${issue.id}`,
      )
    ids.add(issue.id)
  }
  return value
}

function isSeverity(value: unknown): value is AuditSeverity {
  return (
    typeof value === 'string' && SEVERITIES.includes(value as AuditSeverity)
  )
}

function issueIdentity(issue: AuditIssue): string {
  return stableJson(issue)
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(',')}}`
  }
  return JSON.stringify(value) ?? 'null'
}

function sameIssueIdentities(
  before: readonly AuditIssue[],
  after: readonly AuditIssue[],
): boolean {
  const beforeById = new Map(
    before.map(issue => [issue.id, issueIdentity(issue)]),
  )
  const afterById = new Map(
    after.map(issue => [issue.id, issueIdentity(issue)]),
  )
  if (!sameIds([...beforeById.keys()], [...afterById.keys()])) return false
  return [...beforeById.keys()].every(
    id => beforeById.get(id) === afterById.get(id),
  )
}

function repairIdsForRound(
  round: FoundationRevisionRound,
  issues: readonly AuditIssue[],
): string[] {
  const allowed =
    round === 1
      ? new Set<AuditSeverity>(['BLOCKER', 'HIGH', 'MEDIUM'])
      : round === 2
        ? new Set<AuditSeverity>(['BLOCKER', 'HIGH'])
        : new Set<AuditSeverity>(['BLOCKER'])
  return sortIds(
    issues.filter(issue => allowed.has(issue.severity)).map(issue => issue.id),
  )
}

function sortedIssueIds(issues: readonly AuditIssue[]): string[] {
  return sortIds(issues.map(issue => issue.id))
}

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort((left, right) =>
    left < right ? -1 : left > right ? 1 : 0,
  )
}

function sameIds(left: readonly string[], right: readonly string[]): boolean {
  const a = sortIds(left)
  const b = sortIds(right)
  return a.length === b.length && a.every((id, index) => id === b[index])
}
