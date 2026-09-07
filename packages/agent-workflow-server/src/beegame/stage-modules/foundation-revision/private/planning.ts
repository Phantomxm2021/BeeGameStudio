import { canonicalFoundationBlockIds } from './domain/foundation-section-index'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath } from './domain/types'

const DIGEST = /^[a-f0-9]{64}$/
const CANONICAL = new Set<string>(CANONICAL_FOUNDATION_DOCUMENTS)

export type RevisionPlanningSectionRef = {
  documentPath: FoundationDocumentPath
  sectionId: string
}

export type RevisionPlanningDocumentRef = {
  scope: 'document'
  documentPath: FoundationDocumentPath
  digest: string
}

type RevisionPlanningRemediation =
  | { kind: 'patch'; scope: 'section'; documentPath: FoundationDocumentPath; sectionIds: string[] }
  | { kind: 'patch'; scope: 'document'; documentPath: FoundationDocumentPath }

export type RevisionPlanningIssue = {
  id: string
  type: 'schema' | 'rule' | 'contract' | 'semantic'
  expected?: string
  actual?: string
  reasonCode?: string
  source?: RevisionPlanningSectionRef | RevisionPlanningDocumentRef
  target?: RevisionPlanningSectionRef
  /** Read-only evidence; never widens the remediation batch. */
  supportingSections?: RevisionPlanningSectionRef[]
  remediation: RevisionPlanningRemediation
}

export type RevisionSectionAuthority = {
  documentPath: FoundationDocumentPath
  sectionId: string
}

export type RevisionBatch =
  | { scope: 'section'; documentPath: FoundationDocumentPath; sectionIds: string[]; issueIds: string[] }
  | { scope: 'document'; documentPath: FoundationDocumentPath; sectionIds: []; issueIds: string[] }

function isCanonicalDocument(value: unknown): value is FoundationDocumentPath {
  return typeof value === 'string' && CANONICAL.has(value)
}

function documentRank(path: FoundationDocumentPath): number {
  return CANONICAL_FOUNDATION_DOCUMENTS.indexOf(path)
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}

function authorityKey(documentPath: string, sectionId: string): string {
  return `${documentPath}\u0000${sectionId}`
}

function sectionAuthorityMap(authorities: readonly RevisionSectionAuthority[]): Map<string, RevisionSectionAuthority> {
  if (!Array.isArray(authorities)) throw new Error('foundation revision planning requires section authority data')
  const map = new Map<string, RevisionSectionAuthority>()
  for (const authority of authorities) {
    if (!authority || typeof authority !== 'object' || Object.keys(authority).sort().join(',') !== 'documentPath,sectionId' || !isCanonicalDocument(authority.documentPath) ||
      typeof authority.sectionId !== 'string' || authority.sectionId.length === 0)
      throw new Error('foundation revision section authority is invalid')
    const key = authorityKey(authority.documentPath, authority.sectionId)
    if (map.has(key)) throw new Error(`duplicate foundation revision section authority: ${authority.documentPath}#${authority.sectionId}`)
    map.set(key, { documentPath: authority.documentPath, sectionId: authority.sectionId })
  }
  return map
}

function isDocumentSource(value: unknown): value is RevisionPlanningDocumentRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  return source.scope === 'document' && isCanonicalDocument(source.documentPath) && typeof source.digest === 'string' && DIGEST.test(source.digest)
}

/**
 * Groups admitted revision issues by their canonical remediation authority.
 * This is a private planning boundary: it does not claim that the caller's
 * issue source is a complete public review or that a revision is executable.
 */
export function buildFoundationRevisionBatches(input: {
  issues: readonly RevisionPlanningIssue[]
  sectionAuthorities: readonly RevisionSectionAuthority[]
}): RevisionBatch[] {
  if (!input || !Array.isArray(input.issues)) throw new Error('foundation revision batches require an issue array')
  const authorities = sectionAuthorityMap(input.sectionAuthorities)
  const seenIssueIds = new Set<string>()
  const grouped = new Map<FoundationDocumentPath, { scope: 'section' | 'document'; sectionIds: Set<string>; issueIds: string[] }>()

  for (const issue of input.issues) {
    if (!issue || typeof issue.id !== 'string' || issue.id.length === 0) throw new Error('foundation revision issue ID is invalid')
    if (seenIssueIds.has(issue.id)) throw new Error(`duplicate issue ID in revision input: ${issue.id}`)
    seenIssueIds.add(issue.id)
    const remediation = issue.remediation
    if (!remediation || typeof remediation !== 'object' || remediation.kind !== 'patch' || !isCanonicalDocument(remediation.documentPath))
      throw new Error(`revision issue patch target is outside canonical authority: ${issue.id}`)

    if (remediation.scope === 'document') {
      if (issue.type !== 'schema' && issue.type !== 'contract') throw new Error(`revision document scope is reserved for format issues: ${issue.id}`)
      if (issue.reasonCode !== 'DOCUMENT_FORMAT_INVALID' || !isDocumentSource(issue.source) || issue.source.documentPath !== remediation.documentPath ||
        ('target' in issue)) throw new Error(`revision document scope issue authority is invalid: ${issue.id}`)
      const current = grouped.get(remediation.documentPath)
      if (current && current.scope !== 'document') throw new Error(`revision document and section scopes cannot be mixed: ${remediation.documentPath}`)
      if (current) current.issueIds.push(issue.id)
      else grouped.set(remediation.documentPath, { scope: 'document', sectionIds: new Set(), issueIds: [issue.id] })
      continue
    }

    if (remediation.scope !== 'section' || !Array.isArray(remediation.sectionIds) || !remediation.sectionIds.length ||
      new Set(remediation.sectionIds).size !== remediation.sectionIds.length)
      throw new Error(`revision issue patch target is outside canonical authority: ${issue.id}`)
    const knownBlockIds = new Set(canonicalFoundationBlockIds(remediation.documentPath))
    for (const sectionId of remediation.sectionIds) {
      const authority = authorities.get(authorityKey(remediation.documentPath, sectionId))
      if (!authority) throw new Error(`revision issue patch section is unknown to the validated registry: ${remediation.documentPath}#${sectionId}`)
      if (authority.documentPath !== remediation.documentPath || authority.sectionId !== sectionId || !knownBlockIds.has(sectionId))
        throw new Error(`revision issue patch section is not canonical: ${remediation.documentPath}#${sectionId}`)
    }
    const current = grouped.get(remediation.documentPath)
    if (current) {
      if (current.scope !== 'section') throw new Error(`revision document and section scopes cannot be mixed: ${remediation.documentPath}`)
      for (const sectionId of remediation.sectionIds) current.sectionIds.add(sectionId)
      current.issueIds.push(issue.id)
    } else grouped.set(remediation.documentPath, { scope: 'section', sectionIds: new Set(remediation.sectionIds), issueIds: [issue.id] })
  }

  return [...grouped.entries()].sort(([left], [right]) => documentRank(left) - documentRank(right)).map(([documentPath, value]) => {
    const blockOrder = new Map(canonicalFoundationBlockIds(documentPath).map((blockId, index) => [blockId, index]))
    return value.scope === 'document'
      ? { scope: 'document' as const, documentPath, sectionIds: [] as [], issueIds: [...value.issueIds].sort(compareStable) }
      : { scope: 'section' as const, documentPath, sectionIds: [...value.sectionIds].sort((left, right) =>
        (blockOrder.get(left) ?? Number.MAX_SAFE_INTEGER) - (blockOrder.get(right) ?? Number.MAX_SAFE_INTEGER)), issueIds: [...value.issueIds].sort(compareStable) }
  })
}
