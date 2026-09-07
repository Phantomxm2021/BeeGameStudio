import { completedReviewFixture } from './review-fixture'
import { buildReviewerPublishedResult } from '../review-publication'
import { prepareReviewerFirstCandidate } from '../candidate-handoff'
import { verifyReviewerCandidateChanges } from '../candidate-changes'
import { bindReviewDocuments } from '../prepare-review'
import { reviewerDigest } from '../review-summary'

export function firstCandidateFixture(normalizedFacts = true) {
  const review = completedReviewFixture({ normalizedFacts: true, output: taskId => taskId === 'semantic-4'
    ? { status: 'completed', outcome: 'ISSUES', issues: [{ problem: 'feedback', expected: 'readable feedback', actual: 'missing',
      sourceSectionKey: 'GDD#player_actions', remediation: { kind: 'patch', sectionKeys: ['GDD#player_actions'] } }] }
    : { status: 'completed', outcome: 'PASS' } })
  const documents = review.documents.map(doc => ({ ...doc, content: doc.path === 'docs/GDD.md'
    ? normalizedFacts ? doc.content.replace('game.mechanics: ["move","attack","dash"]', 'game.mechanics: ["move","attack","dash","parry"]')
      : doc.content.replace('game.mechanics: ["move","attack","dash"]', 'The player can move, attack, dash and parry with readable feedback.') : doc.content }))
  return candidateFixtureFromReview(review, documents)
}

export function candidateFixtureFromReview(review: ReturnType<typeof completedReviewFixture>, documents: ReturnType<typeof completedReviewFixture>['documents']) {
  const sourceResult = buildReviewerPublishedResult({ identity: { ownerId: 'owner', projectId: 'project', requestId: 'review' },
    subject: { kind: 'initial', sourceResultId: 'author', sourceDocumentRevision: 'a'.repeat(64), confirmedBriefDigest: 'b'.repeat(64) }, ...review })
  const snapshot = bindReviewDocuments(documents)
  const body = { protocolVersion: 1 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
    ownerId: 'owner', projectId: 'project', requestId: 'repair', candidateId: 'candidate-one', round: 1,
    baseDocumentSetDigest: sourceResult.documentSetDigest, sourceReviewResultId: sourceResult.resultId, sourceReviewResultDigest: reviewerDigest(sourceResult),
    documentSetDigest: snapshot.digest, documents: snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content) })),
    changes: verifyReviewerCandidateChanges({ baseDocuments: review.documents, candidateDocuments: documents, issues: sourceResult.issues.map(entry => entry.issue) }),
    repairClaims: sourceResult.issues.map(entry => ({ issueId: entry.issue.id, status: 'APPLIED' as const })), unresolvedIssues: [] }
  const candidateResult = { ...body, resultId: reviewerDigest(body) }
  const binding = (value: { ownerId: string; projectId: string; resultId: string }) => ({
    ownerId: value.ownerId, projectId: value.projectId, resultId: value.resultId, resultDigest: reviewerDigest(value) })
  const input = { sourceResult, sourceBinding: binding(sourceResult), candidateResult, candidateBinding: binding(candidateResult) }
  return { input, prepared: prepareReviewerFirstCandidate(input), review }
}
