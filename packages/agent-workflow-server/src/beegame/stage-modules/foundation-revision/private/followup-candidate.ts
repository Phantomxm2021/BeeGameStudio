import { z } from 'zod/v4'
import { revisionCanonicalJson } from './json-digest'
import { bindRevisionDocuments, type RevisionDocumentInput } from './document-snapshot'
import { constructRevisionCandidate } from './candidate-construction'
import { parseRevisionRepairSource, revisionRepairRound, verifyRevisionCandidateAuthority, prepareRevisionRetryAuthority } from './candidate-authority'
import type { RevisionSourceBinding } from './initial-source'
import type { RevisionCandidateBinding } from './candidate-result'

const id = z.string().min(1).max(200)
const followupSchema = z.object({ sourceResult: z.unknown(), sourceBinding: z.unknown(), requestId: id,
  candidateDocuments: z.unknown(), unresolvedIssues: z.unknown() }).strict()
const retrySchema = z.object({ sourceResult: z.unknown(), sourceBinding: z.unknown(), requestId: id,
  candidateDocuments: z.unknown(), previousCandidateResult: z.unknown(), previousCandidateBinding: z.unknown(),
  previousRecheckResult: z.unknown(), previousRecheckBinding: z.unknown() }).strict()

/** The new review's public issues become the next repair authority, not an old issue registry. */
export function buildRevisionNextRoundCandidate(input: {
  sourceResult: unknown
  sourceBinding: RevisionSourceBinding
  requestId: string
  candidateDocuments: readonly RevisionDocumentInput[]
  unresolvedIssues: readonly { issueId: string; reason: string }[]
}) {
  const captured = followupSchema.parse(JSON.parse(revisionCanonicalJson(input))) as typeof input
  const source = parseRevisionRepairSource(captured.sourceResult, captured.sourceBinding)
  if (source.subject.kind !== 'candidate') throw new Error('Revision next round requires a candidate recheck source')
  const candidate = constructRevisionCandidate({ source, requestId: captured.requestId,
    candidateDocuments: captured.candidateDocuments, unresolvedIssues: captured.unresolvedIssues, round: revisionRepairRound(source) })
  verifyRevisionCandidateAuthority(source, candidate)
  return candidate
}

/** Retry planning consumes only accepted copied predecessor results, never frozen task IDs. */
export function buildRevisionRetryCandidate(input: {
  sourceResult: unknown
  sourceBinding: RevisionSourceBinding
  previousCandidateResult: unknown
  previousCandidateBinding: RevisionCandidateBinding
  previousRecheckResult: unknown
  previousRecheckBinding: RevisionSourceBinding
  requestId: string
  candidateDocuments: readonly RevisionDocumentInput[]
}) {
  const captured = retrySchema.parse(JSON.parse(revisionCanonicalJson(input))) as typeof input
  const authority = prepareRevisionRetryAuthority({ sourceResult: captured.sourceResult, sourceBinding: captured.sourceBinding,
    previousCandidateResult: captured.previousCandidateResult, previousCandidateBinding: captured.previousCandidateBinding,
    previousRecheckResult: captured.previousRecheckResult, previousRecheckBinding: captured.previousRecheckBinding })
  const documents = bindRevisionDocuments(captured.candidateDocuments)
  for (const path of authority.retainedDocumentPaths) {
    if (documents.documents.find(doc => doc.path === path)?.content !== authority.previousCandidate.documents.find(doc => doc.path === path)?.content)
      throw new Error('Revision retry changed retained document bytes')
  }
  const repaired = new Set(authority.repairIssueIds)
  const unresolvedIssues = authority.source.issues.filter(entry => !repaired.has(entry.issue.id)).map(entry => ({
    issueId: entry.issue.id,
    reason: authority.previousCandidate.unresolvedIssues.find(issue => issue.issueId === entry.issue.id)?.reason
      ?? 'Not included in the failed-issue scope of the accepted same-round recheck.',
  }))
  const candidate = constructRevisionCandidate({ source: authority.source, requestId: captured.requestId,
    candidateDocuments: captured.candidateDocuments, unresolvedIssues, round: authority.round, previous: authority.previous,
    previousCandidateDocuments: authority.previousCandidate.documents.map(({ path, content }) => ({ path, content })) })
  if (candidate.candidateId === authority.previousCandidate.candidateId) throw new Error('Revision retry candidate identity was reused')
  verifyRevisionCandidateAuthority(authority.source, candidate)
  return candidate
}
