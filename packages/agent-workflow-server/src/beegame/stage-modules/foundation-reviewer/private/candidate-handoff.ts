import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { bindReviewDocuments } from './prepare-review'
import { reviewerCanonicalJson, reviewerDigest } from './review-summary'
import { parseReviewerSourceResult, type ReviewerSourceBinding } from './review-handoff'
import { verifyReviewerCandidateChanges } from './candidate-changes'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const ids = z.array(id).min(1)
const operation = z.union([
  z.object({ scope: z.literal('document'), kind: z.literal('REPLACE'), documentPath: path,
    issueIds: ids, beforeDigest: digest, afterDigest: digest }).strict(),
  ...(['INSERT', 'REPLACE', 'DELETE'] as const).map(kind => z.object({ scope: z.literal('section'), kind: z.literal(kind),
    documentPath: path, sectionId: id, issueIds: ids,
    ...(kind !== 'INSERT' ? { beforeDigest: digest } : {}), ...(kind !== 'DELETE' ? { afterDigest: digest } : {}) }).strict()),
])
const binding = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type ReviewerCandidateBinding = z.infer<typeof binding>
export const reviewerCandidateResultSchema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('foundation-revision'), kind: z.literal('candidate_ready'),
  resultId: digest, ownerId: id, projectId: id, requestId: id, candidateId: id, round: z.number().int().positive().safe(),
  baseDocumentSetDigest: digest, sourceReviewResultId: digest, sourceReviewResultDigest: digest,
  previous: z.object({ candidateId: id, candidateResultId: digest, candidateResultDigest: digest,
    recheckResultId: digest, recheckResultDigest: digest }).strict().optional(),
  documentSetDigest: digest,
  documents: z.array(z.object({ path, content: z.string(), digest, byteLength: z.number().int().nonnegative().safe() }).strict()).length(8),
  changes: z.array(operation).min(1),
  repairClaims: z.array(z.object({ issueId: id, status: z.literal('APPLIED') }).strict()).min(1),
  unresolvedIssues: z.array(z.object({ issueId: id, reason: z.string().min(1) }).strict()),
}).strict()
export type ReviewerCandidateResult = z.infer<typeof reviewerCandidateResultSchema>
const same = (a: unknown, b: unknown) => reviewerCanonicalJson(a) === reviewerCanonicalJson(b)

/** Byte/schema binding only. The caller's accepted binding is not candidate-supplied authority. */
export function parseReviewerCandidateResult(value: unknown, expected: ReviewerCandidateBinding): ReviewerCandidateResult {
  const accepted = binding.parse(expected)
  const candidate = reviewerCandidateResultSchema.parse(value)
  const { resultId, ...body } = candidate
  if (candidate.ownerId !== accepted.ownerId || candidate.projectId !== accepted.projectId || resultId !== accepted.resultId ||
    reviewerDigest(candidate) !== accepted.resultDigest || reviewerDigest(body) !== resultId)
    throw new Error('candidate result binding mismatch')
  const snapshot = bindReviewDocuments(candidate.documents.map(({ path, content }) => ({ path, content })))
  if (candidate.documentSetDigest !== snapshot.digest || !same(candidate.documents,
    snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content, 'utf8') }))))
    throw new Error('candidate document binding mismatch')
  const claimed = [...candidate.repairClaims.map(claim => claim.issueId), ...candidate.unresolvedIssues.map(issue => issue.issueId)]
  if (new Set(claimed).size !== claimed.length) throw new Error('candidate issue claims must be unique and disjoint')
  return candidate
}

type CandidateHandoff = {
  sourceResult: unknown; sourceBinding: ReviewerSourceBinding
  candidateResult: unknown; candidateBinding: ReviewerCandidateBinding
}
function captureCandidateAuthority(input: CandidateHandoff) {
  const source = parseReviewerSourceResult(input.sourceResult, input.sourceBinding)
  const candidate = parseReviewerCandidateResult(input.candidateResult, input.candidateBinding)
  if (source.kind !== 'issues_found' || candidate.ownerId !== source.ownerId || candidate.projectId !== source.projectId ||
    candidate.sourceReviewResultId !== source.resultId || candidate.sourceReviewResultDigest !== reviewerDigest(source) ||
    candidate.baseDocumentSetDigest !== source.documentSetDigest)
    throw new Error('candidate source authority mismatch')
  return { source, candidate }
}
function verifyCandidateAuthority({ source, candidate }: ReturnType<typeof captureCandidateAuthority>) {
  const admittedIds = new Set(source.issues.map(entry => entry.issue.id))
  const claimedIds = [...candidate.repairClaims.map(claim => claim.issueId), ...candidate.unresolvedIssues.map(issue => issue.issueId)]
  if (claimedIds.length !== admittedIds.size || claimedIds.some(id => !admittedIds.has(id)))
    throw new Error('candidate must account for the exact source issues')
  const repairedIds = new Set(candidate.repairClaims.map(claim => claim.issueId))
  const issues = source.issues.filter(entry => repairedIds.has(entry.issue.id)).map(entry => entry.issue)
  const baseDocuments = source.documents.map(({ path, content }) => ({ path, content }))
  const documents = candidate.documents.map(({ path, content }) => ({ path, content }))
  const operations = verifyReviewerCandidateChanges({ baseDocuments, candidateDocuments: documents, issues })
  // Compare complete operation data, not only a worker-provided digest or IDs.
  const sorted = (values: readonly unknown[]) => [...values].map(reviewerCanonicalJson).sort()
  if (!same(sorted(operations), sorted(candidate.changes))) throw new Error('candidate declared changes disagree with verified bytes')
  return { source, candidate, baseDocuments, documents, operations, issues,
    unresolvedIssues: source.issues.filter(entry => !repairedIds.has(entry.issue.id)).map(entry => entry.issue) }
}

/** First candidate of an initial or completed next round; never a same-round retry. */
export function prepareReviewerFirstCandidate(input: CandidateHandoff) {
  const captured = captureCandidateAuthority(input)
  const { source, candidate } = captured
  if (candidate.previous) throw new Error('retry candidate requires previous public recheck authority')
  const expectedRound = source.subject.kind === 'initial' || source.recheck?.kind === 'full_format' ? 1
    : source.recheck?.decision === 'round_complete' ? source.recheck.round + 1 : undefined
  if (expectedRound === undefined || candidate.round !== expectedRound)
    throw new Error('first candidate requires round one or the next completed public recheck round')
  return verifyCandidateAuthority(captured)
}

/** Current retry consumes copied public predecessor evidence, not frozen task IDs or private Reviewer state. */
export function prepareReviewerRetryCandidate(input: CandidateHandoff & {
  previousCandidateResult: unknown; previousCandidateBinding: ReviewerCandidateBinding
  previousRecheckResult: unknown; previousRecheckBinding: ReviewerSourceBinding
}) {
  const captured = captureCandidateAuthority(input)
  const { source, candidate } = captured
  const previous = parseReviewerCandidateResult(input.previousCandidateResult, input.previousCandidateBinding)
  const recheck = parseReviewerSourceResult(input.previousRecheckResult, input.previousRecheckBinding)
  const expectedPrevious = { candidateId: previous.candidateId, candidateResultId: previous.resultId,
    candidateResultDigest: reviewerDigest(previous), recheckResultId: recheck.resultId, recheckResultDigest: reviewerDigest(recheck) }
  if (!same(candidate.previous ?? null, expectedPrevious) || candidate.candidateId === previous.candidateId ||
    previous.ownerId !== source.ownerId || previous.projectId !== source.projectId || previous.sourceReviewResultId !== source.resultId ||
    previous.sourceReviewResultDigest !== reviewerDigest(source) || previous.baseDocumentSetDigest !== source.documentSetDigest ||
    candidate.round !== previous.round || recheck.ownerId !== source.ownerId || recheck.projectId !== source.projectId ||
    recheck.subject.kind !== 'candidate' || recheck.subject.candidateId !== previous.candidateId ||
    recheck.subject.candidateResultId !== previous.resultId || recheck.subject.baseDocumentSetDigest !== source.documentSetDigest ||
    recheck.subject.sourceReviewResultId !== source.resultId || recheck.subject.sourceReviewResultDigest !== reviewerDigest(source) ||
    recheck.recheck?.kind !== 'targeted' || recheck.recheck.decision !== 'retry_same_round' || recheck.recheck.round !== previous.round ||
    recheck.recheck.candidateResultDigest !== reviewerDigest(previous) || recheck.documentSetDigest !== previous.documentSetDigest ||
    !same(recheck.documents, previous.documents))
    throw new Error('retry candidate predecessor authority mismatch')
  verifyCandidateAuthority({ source, candidate: previous })
  const previousClaimed = previous.repairClaims.map(claim => claim.issueId).sort()
  if (!same(previousClaimed, recheck.recheck.issueVerdicts.map(item => item.issueId).sort()))
    throw new Error('retry candidate predecessor coverage mismatch')
  // Recheck verdicts are public summaries, so bind their issue ownership to
  // the complete accepted source registry. The recheck's own `issues` list
  // intentionally omits resolved PASS issues and cannot provide this authority.
  const sourceIssues = new Map(source.issues.map(entry => [entry.issue.id, entry.issue]))
  for (const verdict of recheck.recheck.issueVerdicts) {
    const issue = sourceIssues.get(verdict.issueId)
    if (!issue) throw new Error('retry candidate recheck issue authority mismatch')
    const expectedKind = issue.type === 'semantic' ? 'semantic' : 'deterministic'
    if (verdict.kind !== expectedKind) throw new Error('retry candidate recheck issue kind mismatch')
  }
  for (const document of recheck.recheck.documentVerdicts) {
    for (const issueId of document.issueIds) {
      const issue = sourceIssues.get(issueId)
      if (!issue || issue.remediation.documentPath !== document.documentPath)
        throw new Error('retry candidate recheck document authority mismatch')
    }
  }
  const allowedIds: string[] = []
  for (const document of recheck.recheck.documentVerdicts) {
    if (document.status === 'FAIL') allowedIds.push(...document.retryIssueIds)
    else {
      allowedIds.push(...document.issueIds)
      if (candidate.documents.find(doc => doc.path === document.documentPath)?.content !== previous.documents.find(doc => doc.path === document.documentPath)?.content)
        throw new Error('retry candidate changed retained document bytes')
    }
  }
  if (!same(candidate.repairClaims.map(claim => claim.issueId).sort(), allowedIds.sort()))
    throw new Error('retry candidate must retain prior documents and repair only failed issue scopes')
  return verifyCandidateAuthority(captured)
}
