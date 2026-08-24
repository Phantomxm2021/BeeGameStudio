import type { AuditIssue, AuditSeverity } from './foundation-issue-registry'
import type { SectionRef } from './foundation-section-index'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

export type FoundationRevisionRound = 1 | 2 | 3

export type FoundationRevisionRoundPolicySnapshot = {
  issues: readonly AuditIssue[]
  issueRegistryDigest: string
  documentRevision: string
}

export type FoundationRevisionRoundPolicyInput = {
  round: FoundationRevisionRound
  before: FoundationRevisionRoundPolicySnapshot
  after: FoundationRevisionRoundPolicySnapshot
}

export type FoundationRevisionRoundPolicyResult =
  | {
      status: 'proceed'
      repairIssueIds: string[]
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
      repairIssueIds: string[]
      knownIssueIds: string[]
      reason: 'no_progress' | 'round_limit'
    }

const SEVERITIES: readonly AuditSeverity[] = [
  'BLOCKER',
  'HIGH',
  'MEDIUM',
  'LOW',
]

const ISSUE_KEYS = [
  'actual',
  'expected',
  'fixDocument',
  'fixSectionId',
  'id',
  'reasonCode',
  'severity',
  'source',
  'target',
  'type',
] as const

const SECTION_KEYS = [
  'digest',
  'documentPath',
  'endLine',
  'heading',
  'sectionId',
  'startLine',
] as const

const DIGEST = /^[a-f0-9]{64}$/

/**
 * Applies the sole authority-document round/stop policy after a revision
 * recheck. `repairIssueIds` names only issues that the next permitted round
 * may receive; MEDIUM/LOW findings are returned as Known Issues.
 */
export function evaluateFoundationRevisionRoundPolicy(
  input: FoundationRevisionRoundPolicyInput,
): FoundationRevisionRoundPolicyResult {
  assertRound(input?.round)
  assertSnapshot(input?.before, 'before')
  assertSnapshot(input?.after, 'after')

  const beforeIds = sortedIssueIds(input.before.issues)
  const afterIds = sortedIssueIds(input.after.issues)
  const unchangedAuthority =
    sameIds(beforeIds, afterIds) &&
    input.before.issueRegistryDigest === input.after.issueRegistryDigest &&
    input.before.documentRevision === input.after.documentRevision

  if (
    unchangedAuthority &&
    !sameIssueIdentities(input.before.issues, input.after.issues)
  )
    throw new Error(
      'foundation revision round issue identity changed under an unchanged authoritative digest',
    )

  const unresolved = input.after.issues
  const blockerOrHigh = unresolved.filter(
    issue => issue.severity === 'BLOCKER' || issue.severity === 'HIGH',
  )
  const knownIssueIds = sortIds(
    unresolved
      .filter(issue => issue.severity === 'MEDIUM' || issue.severity === 'LOW')
      .map(issue => issue.id),
  )

  if (blockerOrHigh.length === 0)
    return {
      status: 'proceed',
      repairIssueIds: [],
      knownIssueIds,
    }

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
): asserts value is FoundationRevisionRoundPolicySnapshot {
  if (!value || typeof value !== 'object')
    throw new Error(`foundation revision ${label} snapshot is invalid`)
  if (!Array.isArray(value.issues))
    throw new Error(`foundation revision ${label} issues must be an array`)
  if (
    typeof value.issueRegistryDigest !== 'string' ||
    !DIGEST.test(value.issueRegistryDigest)
  )
    throw new Error(
      `foundation revision ${label} issue registry digest is invalid`,
    )
  if (
    typeof value.documentRevision !== 'string' ||
    value.documentRevision.length === 0
  )
    throw new Error(`foundation revision ${label} document revision is invalid`)

  const ids = new Set<string>()
  for (const issue of value.issues) {
    assertAuditIssue(issue)
    if (ids.has(issue.id))
      throw new Error(
        `duplicate issue ID in foundation revision ${label}: ${issue.id}`,
      )
    ids.add(issue.id)
  }
}

function assertAuditIssue(value: unknown): asserts value is AuditIssue {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('foundation revision AuditIssue identity is invalid')
  const issue = value as Record<string, unknown>
  const actualKeys = Object.keys(issue).sort()
  const expectedKeys = ISSUE_KEYS.filter(key => issue[key] !== undefined).sort()
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  )
    throw new Error('foundation revision AuditIssue identity shape is invalid')
  if (
    typeof issue.id !== 'string' ||
    issue.id.length === 0 ||
    typeof issue.expected !== 'string' ||
    typeof issue.actual !== 'string' ||
    typeof issue.fixSectionId !== 'string' ||
    issue.fixSectionId.length === 0 ||
    !isSeverity(issue.severity) ||
    !isIssueType(issue.type) ||
    !isFoundationDocument(issue.fixDocument)
  )
    throw new Error(
      `foundation revision AuditIssue identity is invalid: ${String(issue.id)}`,
    )
  if (issue.reasonCode !== undefined && typeof issue.reasonCode !== 'string')
    throw new Error(
      `foundation revision AuditIssue reasonCode is invalid: ${issue.id}`,
    )
  assertSectionRef(issue.source, 'source', issue.id)
  if (issue.target !== undefined)
    assertSectionRef(issue.target, 'target', issue.id)
}

function assertSectionRef(
  value: unknown,
  label: string,
  issueId: string,
): asserts value is SectionRef {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error(
      `foundation revision ${label} identity is invalid: ${issueId}`,
    )
  const section = value as Record<string, unknown>
  const actualKeys = Object.keys(section).sort()
  if (
    actualKeys.length !== SECTION_KEYS.length ||
    actualKeys.some((key, index) => key !== [...SECTION_KEYS].sort()[index])
  )
    throw new Error(
      `foundation revision ${label} identity shape is invalid: ${issueId}`,
    )
  if (
    !isFoundationDocument(section.documentPath) ||
    typeof section.sectionId !== 'string' ||
    section.sectionId.length === 0 ||
    typeof section.heading !== 'string' ||
    !Number.isInteger(section.startLine) ||
    !Number.isInteger(section.endLine) ||
    (section.startLine as number) < 1 ||
    (section.endLine as number) < (section.startLine as number) ||
    typeof section.digest !== 'string' ||
    !DIGEST.test(section.digest)
  )
    throw new Error(
      `foundation revision ${label} identity is invalid: ${issueId}`,
    )
}

function isSeverity(value: unknown): value is AuditSeverity {
  return (
    typeof value === 'string' && SEVERITIES.includes(value as AuditSeverity)
  )
}

function isIssueType(value: unknown): value is AuditIssue['type'] {
  return (
    value === 'schema' ||
    value === 'rule' ||
    value === 'contract' ||
    value === 'semantic'
  )
}

function isFoundationDocument(value: unknown): value is FoundationDocumentPath {
  return (
    typeof value === 'string' &&
    (CANONICAL_FOUNDATION_DOCUMENTS as readonly string[]).includes(value)
  )
}

function issueIdentity(issue: AuditIssue): string {
  return stableJson({
    id: issue.id,
    severity: issue.severity,
    type: issue.type,
    source: issue.source,
    ...(issue.target ? { target: issue.target } : {}),
    expected: issue.expected,
    actual: issue.actual,
    fixDocument: issue.fixDocument,
    fixSectionId: issue.fixSectionId,
    ...(issue.reasonCode ? { reasonCode: issue.reasonCode } : {}),
  })
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
