import { z } from 'zod/v4'
import { validateReviewerTargetedFacts, type ReviewerPreparedCandidate } from './targeted-preparation'
import { admitFoundationSemanticRecheckWorkerResult, type FoundationSemanticFailureDiagnostic } from './domain/foundation-patch-validation'
import type { FoundationFactReceipt } from './domain/foundation-fact-extraction'
import type { AuditIssue } from './domain/foundation-issue-registry'
import type { FoundationDocumentPath } from './domain/types'
import { buildReviewerIssueEvidence, reviewerDigest } from './review-summary'

export type ReviewerTargetedIssueVerdict = { issueId: string; status: 'PASS' | 'FAIL' | 'NOT_CHECKED';
  kind: 'deterministic' | 'semantic'; diagnostic?: FoundationSemanticFailureDiagnostic }
export type ReviewerTargetedDocumentVerdict = { documentPath: FoundationDocumentPath; documentDigest: string;
  issueIds: string[]; retryIssueIds: string[]; status: 'PASS' | 'FAIL' | 'DEFERRED' }
const replies = z.array(z.object({ issueId: z.string().min(1).max(200), output: z.unknown().refine(value => value !== undefined) }).strict())

/**
 * Recompute business outcomes from admitted receipts, not Revision claims.
 * Deterministic failure defers semantic execution; retained bytes are not
 * described as PASS when their semantic checks have not run yet.
 */
export function summarizeReviewerTargeted(input: ReviewerPreparedCandidate, factReceipts: readonly FoundationFactReceipt[], semanticReplies: z.infer<typeof replies>) {
  const responses = replies.parse(semanticReplies)
  if (new Set(responses.map(response => response.issueId)).size !== responses.length) throw new Error('duplicate targeted semantic reply')
  const validation = validateReviewerTargetedFacts(input, factReceipts)
  const patch = validation.documentValidations.flatMap(item => item.checked.patchValidations)
  const deterministicFailed = patch.some(item => item.status === 'FAIL')
  if (deterministicFailed && responses.length) throw new Error('semantic execution must be deferred after deterministic failure')
  if (!deterministicFailed && (responses.length !== validation.semantic.length ||
    responses.some(response => !validation.semantic.some(item => item.issue.id === response.issueId))))
    throw new Error('targeted semantic reply coverage is incomplete or extra')
  const verdicts: ReviewerTargetedIssueVerdict[] = patch.map(item => ({ issueId: item.issueId, kind: 'deterministic', status: item.status }))
  const semanticEvidence = []
  for (const [index, { issue, packet }] of validation.semantic.entries()) {
    if (deterministicFailed) { verdicts.push({ issueId: issue.id, kind: 'semantic', status: 'NOT_CHECKED' }); continue }
    const response = responses.find(item => item.issueId === issue.id)!
    const admitted = admitFoundationSemanticRecheckWorkerResult(packet, response.output, { taskId: `targeted-semantic-${index}`, issue })
    verdicts.push({ issueId: issue.id, kind: 'semantic', status: admitted.status,
      ...(admitted.status === 'FAIL' ? { diagnostic: admitted.diagnostic } : {}) })
    semanticEvidence.push(admitted)
  }
  verdicts.sort((a, b) => a.issueId.localeCompare(b.issueId))
  const failed = new Set(verdicts.filter(item => item.status === 'FAIL').map(item => item.issueId))
  const decision = failed.size ? 'retry_same_round' as const : 'round_complete' as const
  const documents: ReviewerTargetedDocumentVerdict[] = validation.documentValidations.map(({ documentPath }) => {
    const issueIds = validation.prepared.issues.filter(issue => issue.remediation.documentPath === documentPath).map(issue => issue.id).sort()
    const retryIssueIds = issueIds.filter(id => failed.has(id))
    return { documentPath, documentDigest: validation.prepared.input.candidate.documents.find(doc => doc.path === documentPath)!.digest,
      issueIds, retryIssueIds, status: retryIssueIds.length ? 'FAIL' : verdicts.some(item => issueIds.includes(item.issueId) && item.status === 'NOT_CHECKED') ? 'DEFERRED' : 'PASS' }
  })
  const rebind = (issue: ReviewerPreparedCandidate['issues'][number]): AuditIssue => {
    if (!('sectionId' in issue.source) || issue.remediation.scope !== 'section') throw new Error('targeted remaining issue is not section scoped')
    const original = issue as AuditIssue
    const source = validation.prepared.sectionIndex.find(ref => ref.documentPath === original.source.documentPath && ref.sectionId === original.source.sectionId)
    const target = original.target && validation.prepared.sectionIndex.find(ref => ref.documentPath === original.target!.documentPath && ref.sectionId === original.target!.sectionId)
    const supportingSections = original.supportingSections?.map(ref => validation.prepared.sectionIndex.find(item => item.documentPath === ref.documentPath && item.sectionId === ref.sectionId))
    if (!source || (original.target && !target) || (supportingSections && supportingSections.some(ref => !ref))) throw new Error('targeted remaining issue evidence is missing')
    return { ...original, source, ...(target ? { target } : {}), ...(supportingSections ? { supportingSections: supportingSections as NonNullable<AuditIssue['supportingSections']> } : {}) }
  }
  const resolvedIds = new Set(verdicts.filter(item => item.status === 'PASS').map(item => item.issueId))
  const remaining = new Map<string, AuditIssue>()
  for (const { issue } of validation.prepared.input.source.issues)
    if (!resolvedIds.has(issue.id)) remaining.set(issue.id, rebind(issue))
  // Original publication admits newly discovered deterministic issues only at
  // a completely validated round boundary, never as Revision-created authority.
  if (decision === 'round_complete') for (const issue of validation.newImpactedIssues)
    if (!resolvedIds.has(issue.id)) remaining.set(issue.id, issue)
  const issues = [...remaining.values()].sort((a, b) => a.id.localeCompare(b.id))
  return structuredClone({ kind: issues.length ? 'issues_found' as const : 'passed' as const, decision,
    candidateId: validation.prepared.input.candidate.candidateId, candidateResultId: validation.prepared.input.candidate.resultId,
    candidateResultDigest: reviewerDigest(validation.prepared.input.candidate), round: validation.prepared.input.candidate.round,
    issueVerdicts: verdicts, documentVerdicts: documents,
    issues: buildReviewerIssueEvidence(validation.prepared.input.documents, issues, validation.rebuilt.factStore),
    issueRegistryDigest: reviewerDigest(issues),
    evidenceDigest: reviewerDigest({ candidate: reviewerDigest(validation.prepared.input.candidate), patch, semanticEvidence, decision }) })
}
