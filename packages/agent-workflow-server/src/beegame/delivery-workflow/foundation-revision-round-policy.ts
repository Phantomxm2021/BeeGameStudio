import type { AuditIssue, AuditSeverity } from './foundation-issue-registry'
import type { FoundationRevisionRound } from './types'

export type FoundationRevisionRoundPolicySnapshot = {
  issues: readonly AuditIssue[]
  issueRegistryDigest: string
  documentRevision: string
}

export type FoundationRevisionRoundPolicyInput =
  | { phase: 'plan'; round: FoundationRevisionRound; issues: readonly AuditIssue[] }
  | { phase: 'evaluate'; round: FoundationRevisionRound; before: FoundationRevisionRoundPolicySnapshot; after: FoundationRevisionRoundPolicySnapshot }

export type FoundationRevisionRoundPolicyResult =
  | { status: 'repair'; round: FoundationRevisionRound; repairIssueIds: string[] }
  | { status: 'proceed'; repairIssueIds: [] }
  | { status: 'continue'; nextRound: FoundationRevisionRound; repairIssueIds: string[] }

const SEVERITIES: readonly AuditSeverity[] = ['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']

/** The issue registry is the sole completion authority; every issue is repaired. */
export function evaluateFoundationRevisionRoundPolicy(input: FoundationRevisionRoundPolicyInput): FoundationRevisionRoundPolicyResult {
  if (!input || typeof input !== 'object') throw new Error('foundation revision round policy input is invalid')
  assertRound(input.round)
  if (input.phase === 'plan') {
    const issues = assertIssueList(input.issues, 'plan')
    const repairIssueIds = sortIds(issues.map(issue => issue.id))
    return repairIssueIds.length === 0 ? { status: 'proceed', repairIssueIds: [] } : { status: 'repair', round: input.round, repairIssueIds }
  }
  if (input.phase !== 'evaluate') throw new Error('foundation revision round policy phase is invalid')
  const before = assertSnapshot(input.before, 'before')
  const after = assertSnapshot(input.after, 'after')
  const unchangedIssueAuthority = before.issueRegistryDigest === after.issueRegistryDigest
  if (unchangedIssueAuthority && !sameIssueIdentities(before.issues, after.issues)) throw new Error('foundation revision round issue identity changed under an unchanged authoritative digest')
  if (after.issues.length === 0) return { status: 'proceed', repairIssueIds: [] }
  if (input.round >= Number.MAX_SAFE_INTEGER) throw new Error('foundation revision round cannot advance beyond the safe integer range')
  return { status: 'continue', nextRound: input.round + 1, repairIssueIds: sortIds(after.issues.map(issue => issue.id)) }
}

function assertRound(value: unknown): asserts value is FoundationRevisionRound {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1) throw new Error('foundation revision round must be a positive integer')
}
function assertSnapshot(value: FoundationRevisionRoundPolicySnapshot | undefined, label: string): FoundationRevisionRoundPolicySnapshot {
  if (!value || typeof value !== 'object') throw new Error(`foundation revision ${label} snapshot is invalid`)
  assertIssueList(value.issues, label)
  if (typeof value.issueRegistryDigest !== 'string' || value.issueRegistryDigest.length === 0) throw new Error(`foundation revision ${label} issue registry digest is invalid`)
  if (typeof value.documentRevision !== 'string' || value.documentRevision.length === 0) throw new Error(`foundation revision ${label} document revision is invalid`)
  return value
}
function assertIssueList(value: unknown, label: string): readonly AuditIssue[] {
  if (!Array.isArray(value)) throw new Error(`foundation revision ${label} issues must be an array`)
  const ids = new Set<string>()
  for (const issue of value) {
    if (!issue || typeof issue !== 'object' || Array.isArray(issue) || typeof issue.id !== 'string' || issue.id.length === 0 || !isSeverity(issue.severity)) throw new Error(`foundation revision ${label} AuditIssue identity is invalid`)
    if (ids.has(issue.id)) throw new Error(`duplicate issue ID in foundation revision ${label}: ${issue.id}`)
    ids.add(issue.id)
  }
  return value
}
function isSeverity(value: unknown): value is AuditSeverity { return typeof value === 'string' && SEVERITIES.includes(value as AuditSeverity) }
function issueIdentity(issue: AuditIssue): string { return stableJson(issue) }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value as Record<string, unknown>).filter(([, item]) => item !== undefined).sort(([left], [right]) => left.localeCompare(right)).map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(',')}}`
  return JSON.stringify(value) ?? 'null'
}
function sameIssueIdentities(before: readonly AuditIssue[], after: readonly AuditIssue[]): boolean {
  const beforeById = new Map(before.map(issue => [issue.id, issueIdentity(issue)]))
  const afterById = new Map(after.map(issue => [issue.id, issueIdentity(issue)]))
  if (!sameIds([...beforeById.keys()], [...afterById.keys()])) return false
  return [...beforeById.keys()].every(id => beforeById.get(id) === afterById.get(id))
}
function sortedIssueIds(issues: readonly AuditIssue[]): string[] { return sortIds(issues.map(issue => issue.id)) }
function sortIds(ids: readonly string[]): string[] { return [...ids].sort((left, right) => left.localeCompare(right)) }
function sameIds(left: readonly string[], right: readonly string[]): boolean { const a = sortIds(left); const b = sortIds(right); return a.length === b.length && a.every((id, index) => id === b[index]) }
