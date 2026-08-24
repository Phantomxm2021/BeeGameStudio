import { createHash } from 'node:crypto'
import type { FoundationDocumentPath } from './types'
import type { SectionRef } from './foundation-section-index'

export type AuditSeverity = 'BLOCKER' | 'HIGH' | 'MEDIUM' | 'LOW'
export type AuditIssueType = 'schema' | 'rule' | 'contract' | 'semantic'

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

export type AuditIssueDraft = {
  checkId: string
  severity: AuditSeverity
  type: AuditIssueType
  source: SectionRef
  target?: SectionRef
  expected: string
  actual: string
  fixDocument: FoundationDocumentPath
  fixSectionId: string
  conflictIdentity: Readonly<Record<string, unknown>>
}

export type IssueRegistryContext = {
  validated: true
  section(documentPath: string, sectionId: string): SectionRef | undefined
}

const DRAFT_KEYS = [
  'actual',
  'checkId',
  'conflictIdentity',
  'expected',
  'fixDocument',
  'fixSectionId',
  'severity',
  'source',
  'target',
  'type',
]

function normalize(value: unknown): unknown {
  if (typeof value === 'string') return value.trim().replace(/\s+/g, ' ')
  if (Array.isArray(value)) return value.map(normalize)
  if (value && typeof value === 'object')
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([key, item]) => [key, normalize(item)]),
    )
  return value
}

function json(value: unknown): string {
  return JSON.stringify(normalize(value))
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function identitySection(section: SectionRef | undefined): unknown {
  return section
    ? { documentPath: section.documentPath, sectionId: section.sectionId }
    : null
}

function exactSection(
  context: IssueRegistryContext,
  section: SectionRef,
  label: string,
): SectionRef {
  const resolved = context.section(section.documentPath, section.sectionId)
  if (
    !resolved ||
    resolved.heading !== section.heading ||
    resolved.startLine !== section.startLine ||
    resolved.endLine !== section.endLine ||
    resolved.digest !== section.digest
  )
    throw new Error(`audit issue ${label} is not the validated SectionRef`)
  return resolved
}

function validateDraftShape(draft: AuditIssueDraft): void {
  const actual = Object.keys(draft).sort()
  const expected = [...DRAFT_KEYS]
    .filter(key => key !== 'target' || draft.target !== undefined)
    .sort()
  if (JSON.stringify(actual) !== JSON.stringify(expected))
    throw new Error(
      'audit issue draft must not contain caller id or unknown fields',
    )
  if (!draft.checkId.trim())
    throw new Error('audit issue check identity is required')
}

/** Sole compiler/admission point. Callers provide drafts, never IDs. */
export function compileIssueRegistry(
  context: IssueRegistryContext,
  drafts: readonly AuditIssueDraft[],
): AuditIssue[] {
  if (context.validated !== true)
    throw new Error('issue registry requires a validated audit context')
  const identities = new Set<string>()
  const issues: AuditIssue[] = []
  for (const draft of drafts) {
    validateDraftShape(draft)
    const source = exactSection(context, draft.source, 'source')
    const target = draft.target
      ? exactSection(context, draft.target, 'target')
      : undefined
    const fix = context.section(draft.fixDocument, draft.fixSectionId)
    if (!fix) throw new Error('audit issue fix is not the validated SectionRef')
    const identity = json({
      checkId: draft.checkId.trim(),
      source: identitySection(source),
      target: identitySection(target),
      conflict: draft.conflictIdentity,
    })
    if (identities.has(identity))
      throw new Error('duplicate audit issue identity')
    identities.add(identity)
    const id = `AUD-${digest(identity).slice(0, 24).toUpperCase()}`
    issues.push({
      id,
      severity: draft.severity,
      type: draft.type,
      source: { ...source },
      ...(target ? { target: { ...target } } : {}),
      expected: draft.expected,
      actual: draft.actual,
      fixDocument: fix.documentPath,
      fixSectionId: fix.sectionId,
    })
  }
  return issues.sort((left, right) => left.id.localeCompare(right.id))
}
