import { getGameDocumentContract } from './game-document-contracts'
import type {
  AuditIssue,
  IssueRegistryContext,
} from './foundation-issue-registry'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from './types'

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

    const documentPath = issue.fixDocument
    const sectionId = issue.fixSectionId
    if (!isCanonicalDocument(documentPath) || typeof sectionId !== 'string')
      throw new Error(`revision issue fix target is outside canonical authority: ${issue.id}`)

    const authority = input.registry.section(documentPath, sectionId)
    if (!authority)
      throw new Error(`revision issue fix section is unknown to the validated registry: ${documentPath}#${sectionId}`)
    if (
      authority.documentPath !== documentPath ||
      authority.sectionId !== sectionId
    )
      throw new Error(`revision issue fix section disagrees with registry authority: ${issue.id}`)

    const contract = getGameDocumentContract(documentPath)
    if (!contract.sections.some(section => section.sectionId === sectionId))
      throw new Error(`revision issue fix section is not canonical: ${documentPath}#${sectionId}`)

    const current = grouped.get(documentPath)
    if (current) {
      current.sectionIds.add(sectionId)
      current.issueIds.push(issue.id)
    } else {
      grouped.set(documentPath, {
        sectionIds: new Set([sectionId]),
        issueIds: [issue.id],
      })
    }
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => documentRank(left) - documentRank(right))
    .map(([documentPath, value]) => {
      const contract = getGameDocumentContract(documentPath)
      const sectionRank = new Map(
        contract.sections.map((section, index) => [section.sectionId, index]),
      )
      return {
        documentPath,
        sectionIds: [...value.sectionIds].sort(
          (left, right) =>
            (sectionRank.get(left) ?? Number.MAX_SAFE_INTEGER) -
              (sectionRank.get(right) ?? Number.MAX_SAFE_INTEGER),
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
