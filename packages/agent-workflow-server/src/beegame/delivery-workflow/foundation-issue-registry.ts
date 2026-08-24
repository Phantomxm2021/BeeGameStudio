import { createHash } from 'node:crypto'
import type { FoundationDocumentPath } from './types'
import type { SectionRef } from './foundation-section-index'

export type AuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AuditIssueType = 'schema' | 'rule' | 'contract' | 'semantic'

/** The only issue shape admitted to the foundation audit pipeline. */
export type AuditIssue = {
  id: string
  severity: AuditSeverity
  type: AuditIssueType
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  fixDocument: FoundationDocumentPath
  fixSectionId: string
}

export type AuditFactConflict = Readonly<Record<string, unknown>>

export type AuditIssueDraft = Omit<AuditIssue, 'id'> & {
  checkId: string
  /** Keys and values are included in the deterministic issue identity. */
  conflictingFacts?: AuditFactConflict
  conflictingFactKeys?: readonly string[]
  conflictingFactValues?: readonly unknown[]
}

const ISSUE_KEYS = [
  'actual',
  'expected',
  'fixDocument',
  'fixSectionId',
  'id',
  'severity',
  'source',
  'target',
  'type',
] as const

function normalizeString(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

function normalizeValue(value: unknown): unknown {
  if (typeof value === 'string') return normalizeString(value)
  if (Array.isArray(value)) return value.map(normalizeValue)
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, normalizeValue(item)]),
    )
  }
  return value
}

function sectionIdentity(section: SectionRef | undefined): unknown {
  if (!section) return null
  return {
    documentPath: section.documentPath,
    sectionId: section.sectionId,
  }
}

function canonicalJson(value: unknown): string {
  return JSON.stringify(normalizeValue(value))
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function conflictPayload(input: {
  conflictingFacts?: AuditFactConflict
  conflictingFactKeys?: readonly string[]
  conflictingFactValues?: readonly unknown[]
}): unknown {
  if (input.conflictingFacts)
    return Object.fromEntries(
      Object.entries(input.conflictingFacts)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, value]) => [key, normalizeValue(value)]),
    )
  return {
    keys: [...(input.conflictingFactKeys ?? [])].sort(),
    values: (input.conflictingFactValues ?? []).map(normalizeValue),
  }
}

function issueIdentityPayload(
  issue: Omit<AuditIssue, 'id'> & { checkId?: string },
): Record<string, unknown> {
  return {
    checkId: issue.checkId ?? `${issue.type}.${issue.severity}`,
    source: sectionIdentity(issue.source),
    target: sectionIdentity(issue.target),
    severity: issue.severity,
    type: issue.type,
    expected: normalizeString(issue.expected),
    actual: normalizeString(issue.actual),
    fixDocument: issue.fixDocument,
    fixSectionId: issue.fixSectionId,
  }
}

/** Returns a stable identity that intentionally excludes the display ID. */
export function issueIdentity(issue: AuditIssue): string {
  return canonicalJson(issueIdentityPayload(issue))
}

/** Creates an issue ID from check identity, section identity and fact conflicts. */
export function makeAuditIssue(input: AuditIssueDraft): AuditIssue {
  if (!input.checkId.trim())
    throw new Error('audit issue check identity is required')
  const identity = {
    ...issueIdentityPayload(input),
    conflicts: conflictPayload(input),
  }
  const id = `AUD-${digest(canonicalJson(identity)).slice(0, 24).toUpperCase()}`
  return {
    id,
    severity: input.severity,
    type: input.type,
    source: { ...input.source },
    ...(input.target ? { target: { ...input.target } } : {}),
    expected: input.expected,
    actual: input.actual,
    fixDocument: input.fixDocument,
    fixSectionId: input.fixSectionId,
  }
}

function sameSection(left: SectionRef, right: SectionRef): boolean {
  return (
    left.documentPath === right.documentPath &&
    left.sectionId === right.sectionId &&
    left.heading === right.heading &&
    left.startLine === right.startLine &&
    left.endLine === right.endLine &&
    left.digest === right.digest
  )
}

function validateIssueShape(issue: AuditIssue): void {
  const actualKeys = Object.keys(issue).sort()
  const expectedKeys = [...ISSUE_KEYS]
    .filter(key => key !== 'target' || issue.target !== undefined)
    .sort()
  if (JSON.stringify(actualKeys) !== JSON.stringify(expectedKeys))
    throw new Error(`audit issue has an invalid schema: ${issue.id}`)
  if (
    typeof issue.id !== 'string' ||
    typeof issue.expected !== 'string' ||
    typeof issue.actual !== 'string'
  )
    throw new Error(`audit issue has missing required fields: ${issue.id}`)
  if (!['BLOCKER', 'HIGH', 'MEDIUM', 'LOW'].includes(issue.severity))
    throw new Error(`audit issue severity is invalid: ${issue.id}`)
  if (!['schema', 'rule', 'contract', 'semantic'].includes(issue.type))
    throw new Error(`audit issue type is invalid: ${issue.id}`)
  if (!issue.fixDocument || !issue.fixSectionId)
    throw new Error(`audit issue fix location is required: ${issue.id}`)
}

export type FoundationIssueRegistryInput = {
  issues: readonly AuditIssue[]
  sectionIndex?: readonly SectionRef[]
}

function registryInput(
  input: readonly AuditIssue[] | FoundationIssueRegistryInput,
): FoundationIssueRegistryInput {
  if (Array.isArray(input)) return { issues: input }
  return input as FoundationIssueRegistryInput
}

/** Compiles the sole deterministic issue registry and rejects collisions. */
export function createFoundationIssueRegistry(
  input: readonly AuditIssue[] | FoundationIssueRegistryInput,
): AuditIssue[] {
  const { issues, sectionIndex } = registryInput(input)
  const ids = new Set<string>()
  const identities = new Set<string>()
  for (const issue of issues) {
    validateIssueShape(issue)
    if (ids.has(issue.id))
      throw new Error(`duplicate audit issue id: ${issue.id}`)
    ids.add(issue.id)
    const identity = issueIdentity(issue)
    if (identities.has(identity))
      throw new Error('conflicting duplicate audit issue identity')
    identities.add(identity)
    if (sectionIndex) {
      const source = sectionIndex.find(candidate =>
        sameSection(candidate, issue.source),
      )
      if (!source)
        throw new Error(
          `audit issue source is not a validated SectionRef: ${issue.id}`,
        )
      const target = issue.target
        ? sectionIndex.find(candidate => sameSection(candidate, issue.target!))
        : undefined
      if (issue.target && !target)
        throw new Error(
          `audit issue target is not a validated SectionRef: ${issue.id}`,
        )
      const fix = sectionIndex.find(
        candidate =>
          candidate.documentPath === issue.fixDocument &&
          candidate.sectionId === issue.fixSectionId,
      )
      if (!fix)
        throw new Error(
          `audit issue fix is not a validated SectionRef: ${issue.id}`,
        )
    }
  }
  const severityRank: Record<AuditSeverity, number> = {
    BLOCKER: 0,
    HIGH: 1,
    MEDIUM: 2,
    LOW: 3,
  }
  return [...issues]
    .map(issue => ({
      ...issue,
      source: { ...issue.source },
      ...(issue.target ? { target: { ...issue.target } } : {}),
    }))
    .sort((left, right) => {
      const rank = severityRank[left.severity] - severityRank[right.severity]
      if (rank) return rank
      const leftKey = `${left.type}\0${left.source.documentPath}\0${left.source.sectionId}\0${left.target?.documentPath ?? ''}\0${left.target?.sectionId ?? ''}\0${left.id}`
      const rightKey = `${right.type}\0${right.source.documentPath}\0${right.source.sectionId}\0${right.target?.documentPath ?? ''}\0${right.target?.sectionId ?? ''}\0${right.id}`
      return leftKey.localeCompare(rightKey)
    })
}

export const compileFoundationIssueRegistry = createFoundationIssueRegistry
export const createIssueRegistry = createFoundationIssueRegistry
export const compileIssueRegistry = createFoundationIssueRegistry

export function appendFoundationIssues(
  registry: readonly AuditIssue[],
  issues: readonly AuditIssue[],
  sectionIndex?: readonly SectionRef[],
): AuditIssue[] {
  return createFoundationIssueRegistry({
    issues: [...registry, ...issues],
    sectionIndex,
  })
}
