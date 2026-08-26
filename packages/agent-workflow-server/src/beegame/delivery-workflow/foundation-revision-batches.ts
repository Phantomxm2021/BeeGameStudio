import type {
  AuditIssue,
  IssueRegistryContext,
} from './foundation-issue-registry'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'
import { canonicalFoundationBlockIds } from './foundation-section-index'

export type RevisionBatch = {
  documentPath: FoundationDocumentPath
  sectionIds: string[]
  issueIds: string[]
}

/**
 * Groups the already-admitted Issue Registry into one revision scope per
 * canonical document. The registry is the authority for the fix section;
 * issue source/target sections never widen a revision batch.
 */
export function buildFoundationRevisionBatches(input: {
  issues: readonly AuditIssue[]
  registry: IssueRegistryContext
}): RevisionBatch[] {
  if (!input || !Array.isArray(input.issues))
    throw new Error('foundation revision batches require an issue array')
  if (!input.registry || input.registry.validated !== true)
    throw new Error('foundation revision batches require a validated issue registry')

  const seenIssueIds = new Set<string>()
  const grouped = new Map<FoundationDocumentPath, {
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
    const sectionIds = issue.remediation.sectionIds
    if (!isCanonicalDocument(documentPath) || !sectionIds.length || new Set(sectionIds).size !== sectionIds.length)
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
      for (const sectionId of sectionIds) current.sectionIds.add(sectionId)
      current.issueIds.push(issue.id)
    } else {
      grouped.set(documentPath, {
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
      return {
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
