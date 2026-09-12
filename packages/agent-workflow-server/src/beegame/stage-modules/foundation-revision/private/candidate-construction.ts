import { bindRevisionDocuments } from './document-snapshot'
import { captureRevisionSnapshot } from './revision-snapshot'
import { parseRevisionCandidateResult } from './candidate-result'
import { revisionDigest } from './json-digest'
import type { prepareRevisionRequest } from './request-preparation'

/** Materialize exactly one candidate from the completed file snapshot. */
export function constructRevisionCandidate(prepared: ReturnType<typeof prepareRevisionRequest>,
  candidateId: string, value: unknown) {
  const snapshot = captureRevisionSnapshot(value)
  const bound = bindRevisionDocuments(snapshot.documents)
  const body = {
    protocolVersion: 2 as const, producer: 'foundation-revision' as const, kind: 'candidate_ready' as const,
    ownerId: prepared.source.ownerId, projectId: prepared.source.projectId, requestId: prepared.request.requestId,
    candidateId, round: prepared.round, revisionSummary: snapshot.summary,
    baseDocumentSetDigest: prepared.source.documentSetDigest, sourceReviewResultId: prepared.source.resultId,
    sourceReviewResultDigest: revisionDigest(prepared.source),
    documentSetDigest: bound.documentSetDigest, documents: bound.documents,
  }
  const result = { ...body, resultId: revisionDigest(body) }
  return parseRevisionCandidateResult(result, { ownerId: result.ownerId, projectId: result.projectId,
    resultId: result.resultId, resultDigest: revisionDigest(result) })
}
