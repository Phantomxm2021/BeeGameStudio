import type {
  FoundationReviewIssue,
  IssueRegistryContext,
} from './foundation-issue-registry'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import { canonicalFoundationBlockIds } from './foundation-section-index'

const DIGEST = /^[a-f0-9]{64}$/

export type RevisionBatch =
  | { scope: 'section'; documentPath: FoundationDocumentPath; sectionIds: string[]; issueIds: string[] }
  | { scope: 'document'; documentPath: FoundationDocumentPath; sectionIds: []; issueIds: string[] }

/**
 * Groups the already-admitted Issue Registry into one revision scope per
 * canonical document. The registry is the authority for the fix section;
 * issue source/target sections never widen a revision batch.
 */
export function buildFoundationRevisionBatches(input: {
  issues: readonly FoundationReviewIssue[]
  registry: IssueRegistryContext
}): RevisionBatch[] {
  if (!input || !Array.isArray(input.issues))
    throw new Error('foundation revision batches require an issue array')
  if (!input.registry || input.registry.validated !== true)
    throw new Error('foundation revision batches require a validated issue registry')

  const seenIssueIds = new Set<string>()
  const grouped = new Map<FoundationDocumentPath, {
    scope: 'section' | 'document'
    sectionIds: Set<string>
    issueIds: string[]
  }>()

  for (const issue of input.issues) {
    if (!issue || typeof issue.id !== 'string' || issue.id.length === 0)
      throw new Error('foundation revision issue ID is invalid')
    if (seenIssueIds.has(issue.id))
      throw new Error(`duplicate issue ID in revision input: ${issue.id}`)
    seenIssueIds.add(issue.id)

    const documentPath = issue.remediation.documentPath
    if (!isCanonicalDocument(documentPath))
      throw new Error(`revision issue patch target is outside canonical authority: ${issue.id}`)

    if (issue.remediation.scope === 'document') {
      // A document-scoped remediation is deliberately a narrow format-repair
      // contract.  It cannot be used to smuggle an ordinary section issue into
      // a whole-document rewrite, and its source must remain an exact digest
      // reference rather than an invented SectionRef.
      if (
        issue.type !== 'schema' &&
        issue.type !== 'contract'
      )
        throw new Error(`revision document scope is reserved for format issues: ${issue.id}`)
      if (
        issue.reasonCode !== 'DOCUMENT_FORMAT_INVALID' ||
        !issue.source ||
        typeof issue.source !== 'object' ||
        Array.isArray(issue.source) ||
        issue.source.scope !== 'document' ||
        issue.source.documentPath !== documentPath ||
        typeof issue.source.digest !== 'string' ||
        !DIGEST.test(issue.source.digest) ||
        'target' in issue
      )
        throw new Error(`revision document scope issue authority is invalid: ${issue.id}`)
      const current = grouped.get(documentPath)
      if (current && current.scope !== 'document')
        throw new Error(`revision document and section scopes cannot be mixed: ${documentPath}`)
      if (current) current.issueIds.push(issue.id)
      else grouped.set(documentPath, { scope: 'document', sectionIds: new Set(), issueIds: [issue.id] })
      continue
    }
    const sectionIds = issue.remediation.sectionIds
    if (!sectionIds.length || new Set(sectionIds).size !== sectionIds.length)
      throw new Error(`revision issue patch target is outside canonical authority: ${issue.id}`)

    const knownBlockIds = new Set(canonicalFoundationBlockIds(documentPath))
    for (const sectionId of sectionIds) {
      const authority = input.registry.section(documentPath, sectionId)
      if (!authority)
        throw new Error(`revision issue patch section is unknown to the validated registry: ${documentPath}#${sectionId}`)
      if (authority.documentPath !== documentPath || authority.sectionId !== sectionId)
        throw new Error(`revision issue patch section disagrees with registry authority: ${issue.id}`)
      if (!knownBlockIds.has(sectionId))
        throw new Error(`revision issue patch section is not canonical: ${documentPath}#${sectionId}`)
    }

    const current = grouped.get(documentPath)
    if (current) {
      if (current.scope !== 'section')
        throw new Error(`revision document and section scopes cannot be mixed: ${documentPath}`)
      for (const sectionId of sectionIds) current.sectionIds.add(sectionId)
      current.issueIds.push(issue.id)
    } else {
      grouped.set(documentPath, {
        scope: 'section',
        sectionIds: new Set(sectionIds),
        issueIds: [issue.id],
      })
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => documentRank(left) - documentRank(right))
    .map(([documentPath, value]) => {
      const blockOrder = new Map(
        canonicalFoundationBlockIds(documentPath).map((blockId, index) => [blockId, index]),
      )
      return value.scope === 'document' ? {
        scope: 'document' as const,
        documentPath,
        sectionIds: [],
        issueIds: [...value.issueIds].sort(compareStable),
      } : {
        scope: 'section' as const,
        documentPath,
        sectionIds: [...value.sectionIds].sort(
          (left, right) =>
            (blockOrder.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (blockOrder.get(right) ?? Number.MAX_SAFE_INTEGER),
        ),
        issueIds: [...value.issueIds].sort(compareStable),
      }
    })
}

function isCanonicalDocument(value: unknown): value is FoundationDocumentPath {
  return (
    typeof value === 'string' &&
    (CANONICAL_FOUNDATION_DOCUMENTS as readonly string[]).includes(value)
  )
}

function documentRank(path: FoundationDocumentPath): number {
  return CANONICAL_FOUNDATION_DOCUMENTS.indexOf(path)
}

function compareStable(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0
}
