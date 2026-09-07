import type { prepareReviewerFirstCandidate } from './candidate-handoff'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { analyzeFoundationImpact } from './domain/foundation-impact-analysis'
import { createFoundationFactStore } from './domain/foundation-fact-store'
import { rebuildFoundationImpactedFacts, validateFoundationPatch, buildFoundationSemanticRecheckPacket } from './domain/foundation-patch-validation'
import { runProductionDeterministicFoundationImpactAudit } from './domain/foundation-audit-production-manifest'
import type { AuditIssue } from './domain/foundation-issue-registry'
import type { FoundationFactReceipt } from './domain/foundation-fact-extraction'
import { reviewerDigest } from './review-summary'
import { reviewerInputDigest } from './review-publication'
import type { ReviewerSubject } from './review-subject'

export type ReviewerPreparedCandidate = ReturnType<typeof prepareReviewerFirstCandidate>

export function reviewerCandidateSubject(input: ReviewerPreparedCandidate): ReviewerSubject {
  return { kind: 'candidate', candidateId: input.candidate.candidateId, candidateResultId: input.candidate.resultId,
    sourceReviewResultId: input.source.resultId, sourceReviewResultDigest: reviewerDigest(input.source),
    baseDocumentSetDigest: input.source.documentSetDigest,
    ...(input.candidate.previous ? { previousCandidateId: input.candidate.previous.candidateId } : {}) }
}

/** Fact scope comes from verified operations, never Revision's repair claims. */
export function prepareReviewerTargetedAudit(value: ReviewerPreparedCandidate) {
  const input = structuredClone(value)
  if (input.operations.some(operation => operation.scope !== 'section'))
    throw new Error('targeted review requires section-only operations')
  // The frozen format entry has no derived fact/index authority for localized
  // format repairs. Keep that unsupported route fail-closed until separately
  // authorized; a catalog-only pass must not masquerade as a format recheck.
  if (input.source.issues.some(entry => entry.issue.reasonCode === 'DOCUMENT_FORMAT_INVALID'))
    throw new Error('localized format repair lacks supported targeted review authority')
  const documents = new Map(input.documents.map(doc => [doc.path, doc.content]))
  const sectionIndex = buildFoundationSectionIndex({ documents })
  const issue = (original: ReviewerPreparedCandidate['issues'][number]): AuditIssue => {
    if (!('sectionId' in original.source) || original.remediation.scope !== 'section')
      throw new Error('targeted review requires section issue authority')
    const admitted = original as AuditIssue
    const source = sectionIndex.find(ref => ref.documentPath === admitted.source.documentPath && ref.sectionId === admitted.source.sectionId)
    const target = admitted.target && sectionIndex.find(ref => ref.documentPath === admitted.target!.documentPath && ref.sectionId === admitted.target!.sectionId)
    const supportingSections = admitted.supportingSections?.map(ref => sectionIndex.find(item => item.documentPath === ref.documentPath && item.sectionId === ref.sectionId))
    if (!source || (admitted.target && !target) || (supportingSections && supportingSections.some(ref => !ref))) throw new Error('targeted review issue section is missing')
    return { ...admitted, source, ...(target ? { target } : {}), ...(supportingSections ? { supportingSections: supportingSections as NonNullable<AuditIssue['supportingSections']> } : {}) }
  }
  const issues = input.issues.map(issue)
  // Public slices can overlap. Identical copies are deduplicated; disagreement
  // has already been rejected by the source-result parser.
  const facts = createFoundationFactStore([...new Map(input.source.issues.flatMap(entry => entry.facts).map(fact => [fact.key, fact])).values()])
  const impact = analyzeFoundationImpact(input.operations)
  const subject = reviewerCandidateSubject(input)
  const inputDigest = reviewerInputDigest({ ownerId: input.source.ownerId, projectId: input.source.projectId, subject, documents: input.documents })
  const rebuildInput = { committedFactStore: facts, documents, sectionIndex, impact, revision: input.source.documentSetDigest }
  const planned = rebuildFoundationImpactedFacts({ ...rebuildInput, phase: 'plan' })
  return { input, subject, inputDigest, documents, sectionIndex, issues, impact, rebuildInput, planned }
}

/** Mechanical admission and deterministic validation; semantic PASS still requires its own strong-worker result. */
export function validateReviewerTargetedFacts(input: ReviewerPreparedCandidate, results: readonly FoundationFactReceipt[]) {
  const prepared = prepareReviewerTargetedAudit(input)
  const rebuilt = rebuildFoundationImpactedFacts({ ...prepared.rebuildInput, phase: 'admit', results: structuredClone(results) })
  const documentPaths = [...new Set(prepared.input.operations.map(operation => operation.documentPath))]
  const documentValidations = documentPaths.map(documentPath => {
    const operations = prepared.input.operations.filter(operation => operation.documentPath === documentPath)
    const issues = prepared.issues.filter(issue => issue.remediation.documentPath === documentPath)
    const base = prepared.input.source.documents.find(doc => doc.path === documentPath)!
    const candidate = prepared.input.candidate.documents.find(doc => doc.path === documentPath)!
    const checked = validateFoundationPatch({ validatorTaskId: `reviewer.validator.${reviewerDigest(documentPath).slice(0, 24)}`,
      round: prepared.input.candidate.round, documentPath, baseDocumentDigest: base.digest, postPatchDocumentDigest: candidate.digest,
      patchOperations: operations, impact: analyzeFoundationImpact(operations), admittedIssues: issues,
      sectionIndex: prepared.sectionIndex, factStore: rebuilt.factStore })
    return { documentPath, checked }
  })
  const semanticIds = new Set(documentValidations.flatMap(item => item.checked.semanticRecheckIssueIds))
  const semantic = prepared.issues.filter(issue => semanticIds.has(issue.id)).map(issue => {
    const operation = prepared.input.operations.find(operation => operation.issueIds.includes(issue.id))!
    return { issue, packet: buildFoundationSemanticRecheckPacket({ issue, patchOperation: operation,
      sectionIndex: prepared.sectionIndex, documents: prepared.documents, impact: analyzeFoundationImpact([operation]), factStore: rebuilt.factStore }) }
  })
  // Preserve the frozen targeted production policy. This does not silently run
  // the initial-review project rules or the full semantic checklist.
  const newImpactedIssues = runProductionDeterministicFoundationImpactAudit({ sectionIndex: prepared.sectionIndex, factStore: rebuilt.factStore, impact: prepared.impact })
  return { prepared, rebuilt, documentValidations, semantic, newImpactedIssues }
}
