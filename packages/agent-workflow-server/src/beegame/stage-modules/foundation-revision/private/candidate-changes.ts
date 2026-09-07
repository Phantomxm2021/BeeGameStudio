import { bindRevisionDocuments, type RevisionDocumentInput } from './document-snapshot'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { buildFoundationRevisionBatches } from './planning'
import { deriveRevisionDocumentPatchOperation } from './complete-document'
import { deriveRevisionPatchOperations, type PatchOperation } from './markdown'
import type { RevisionInitialSource } from './initial-source'

/** Mechanical changes from admitted issue scope; no candidate/worker-supplied operations. */
export function deriveRevisionCandidateChanges(input: {
  baseDocuments: readonly RevisionDocumentInput[]
  candidateDocuments: readonly RevisionDocumentInput[]
  issues: readonly RevisionInitialSource['issues'][number]['issue'][]
}): PatchOperation[] {
  const base = bindRevisionDocuments(input.baseDocuments)
  const candidate = bindRevisionDocuments(input.candidateDocuments)
  const sectionPaths = new Set(input.issues.filter(issue => issue.remediation.scope === 'section').map(issue => issue.remediation.documentPath))
  const sectionAuthorities = buildFoundationSectionIndex({ documents: new Map(base.documents.filter(document => sectionPaths.has(document.path))
    .map(document => [document.path, document.content])) }).map(section => ({ documentPath: section.documentPath, sectionId: section.sectionId }))
  const batches = buildFoundationRevisionBatches({ issues: input.issues, sectionAuthorities })
  const issuesById = new Map(input.issues.map(issue => [issue.id, issue]))
  const changes: PatchOperation[] = []
  for (const batch of batches) {
    const before = base.documents.find(document => document.path === batch.documentPath)!
    const after = candidate.documents.find(document => document.path === batch.documentPath)!
    const issues = batch.issueIds.map(issueId => issuesById.get(issueId)!)
    if (batch.scope === 'document') {
      changes.push(deriveRevisionDocumentPatchOperation({ documentPath: batch.documentPath,
        baseMarkdown: before.content, stagedMarkdown: after.content, issues }))
      continue
    }
    const issueIdsBySection = new Map<string, string[]>()
    for (const issue of issues) {
      if (issue.remediation.scope !== 'section') throw new Error('Revision section repair authority mismatch')
      for (const sectionId of issue.remediation.sectionIds)
        issueIdsBySection.set(sectionId, [...(issueIdsBySection.get(sectionId) ?? []), issue.id])
    }
    changes.push(...deriveRevisionPatchOperations({ documentPath: batch.documentPath, baseMarkdown: before.content,
      stagedMarkdown: after.content, authorizedSectionIds: batch.sectionIds, issueIdsBySection }))
  }
  for (const before of base.documents) {
    if (batches.some(batch => batch.documentPath === before.path)) continue
    if (before.content !== candidate.documents.find(document => document.path === before.path)!.content)
      throw new Error('Revision changed an unauthorized document')
  }
  if (!changes.length) throw new Error('Revision candidate contains no repair progress')
  return changes
}
