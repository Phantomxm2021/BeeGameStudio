import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { reviewerDigest, reviewerCanonicalJson } from './review-summary'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const ref = z.object({ documentPath: path, sectionId: id, heading: z.string(), startLine: z.number().int().positive(),
  endLine: z.number().int().positive(), digest }).strict()
const diagnostic = z.object({ unmetExpected: z.string().min(1), observedActual: z.string().min(1), evidence: z.array(ref).min(1),
  dependencySections: z.array(ref).min(1), failureReasonCode: z.enum(['expected_not_met', 'actual_persists', 'contradictory_evidence', 'evidence_insufficient']),
  scopeAssessment: z.literal('repairable_in_scope') }).strict()
export const reviewerTargetedEvidenceSchema = z.object({ kind: z.literal('targeted'), round: z.number().int().positive().safe(),
  candidateResultDigest: digest, policyDigest: digest, decision: z.enum(['retry_same_round', 'round_complete']),
  issueVerdicts: z.array(z.union([
    z.object({ issueId: id, kind: z.literal('deterministic'), status: z.enum(['PASS', 'FAIL']) }).strict(),
    z.object({ issueId: id, kind: z.literal('semantic'), status: z.enum(['PASS', 'NOT_CHECKED']) }).strict(),
    z.object({ issueId: id, kind: z.literal('semantic'), status: z.literal('FAIL'), diagnostic }).strict(),
  ])).min(1),
  documentVerdicts: z.array(z.object({ documentPath: path, documentDigest: digest, issueIds: z.array(id).min(1),
    retryIssueIds: z.array(id), status: z.enum(['PASS', 'FAIL', 'DEFERRED']) }).strict()).min(1),
}).strict()
export type ReviewerTargetedPublicEvidence = z.infer<typeof reviewerTargetedEvidenceSchema>
export const reviewerFullFormatEvidenceSchema = z.object({ kind: z.literal('full_format'), round: z.number().int().positive().safe(),
  candidateResultDigest: digest, policyDigest: digest, nextRound: z.literal(1) }).strict()
export type ReviewerFullFormatPublicEvidence = z.infer<typeof reviewerFullFormatEvidenceSchema>
export const reviewerRecheckEvidenceSchema = z.union([reviewerTargetedEvidenceSchema, reviewerFullFormatEvidenceSchema])
export type ReviewerRecheckPublicEvidence = z.infer<typeof reviewerRecheckEvidenceSchema>
export const reviewerFullFormatPolicyDigest = () => reviewerDigest({ version: 'full-format-review.v1',
  route: 'whole-document-format-only', audit: 'fresh-full-initial-review', newIssuesRound: 1 })
export const reviewerTargetedPolicyDigest = () => reviewerDigest({ version: 'targeted-review.v1',
  audit: 'frozen-production-impact-only', semantic: 'strong-expected-actual-PASS-FAIL',
  prompt: 'assigned-section-digests.v1', deterministicFailure: 'defer-semantic-same-round',
  retry: 'failed-documents-only-retain-other-bytes', publication: 'new-issues-after-all-active-pass' })

/** Structural consistency of copied public outcomes, not a substitute for an accepted result binding. */
export function validateReviewerTargetedEvidence(value: ReviewerTargetedPublicEvidence, documents: readonly { path: string; digest: string }[],
  issues: readonly { issue: { id: string } }[], sectionIndex: readonly z.infer<typeof ref>[]) {
  const result = reviewerTargetedEvidenceSchema.parse(value)
  if (result.policyDigest !== reviewerTargetedPolicyDigest()) throw new Error('targeted review policy is incompatible')
  const byId = new Map(result.issueVerdicts.map(item => [item.issueId, item]))
  const documentIds = result.documentVerdicts.flatMap(item => item.issueIds)
  if (byId.size !== result.issueVerdicts.length || new Set(documentIds).size !== documentIds.length ||
    documentIds.length !== byId.size || documentIds.some(id => !byId.has(id)) ||
    new Set(result.documentVerdicts.map(item => item.documentPath)).size !== result.documentVerdicts.length)
    throw new Error('targeted public verdict coverage is inconsistent')
  for (const document of result.documentVerdicts) {
    if (documents.find(item => item.path === document.documentPath)?.digest !== document.documentDigest)
      throw new Error('targeted public document verdict binding mismatch')
    const verdicts = document.issueIds.map(id => byId.get(id)!)
    const failed = verdicts.filter(item => item.status === 'FAIL').map(item => item.issueId).sort()
    const status = failed.length ? 'FAIL' : verdicts.some(item => item.status === 'NOT_CHECKED') ? 'DEFERRED' : 'PASS'
    if (document.status !== status || reviewerCanonicalJson([...document.retryIssueIds].sort()) !== reviewerCanonicalJson(failed))
      throw new Error('targeted public retention verdict is inconsistent')
  }
  const hasFailure = result.issueVerdicts.some(item => item.status === 'FAIL')
  const deterministicFailure = result.issueVerdicts.some(item => item.kind === 'deterministic' && item.status === 'FAIL')
  if ((result.decision === 'retry_same_round') !== hasFailure || result.issueVerdicts.some(item =>
    item.kind === 'semantic' && (item.status === 'NOT_CHECKED') !== deterministicFailure))
    throw new Error('targeted public decision is inconsistent')
  const remainingIds = new Set(issues.map(item => item.issue.id))
  for (const verdict of result.issueVerdicts) {
    if ((verdict.status !== 'PASS') !== remainingIds.has(verdict.issueId))
      throw new Error('targeted remaining issue authority is inconsistent')
    if ('diagnostic' in verdict) for (const section of [...verdict.diagnostic.evidence, ...verdict.diagnostic.dependencySections]) {
      const current = sectionIndex.find(ref => ref.documentPath === section.documentPath && ref.sectionId === section.sectionId)
      if (!current || reviewerCanonicalJson(current) !== reviewerCanonicalJson(section)) throw new Error('targeted diagnostic section is stale')
    }
  }
}
