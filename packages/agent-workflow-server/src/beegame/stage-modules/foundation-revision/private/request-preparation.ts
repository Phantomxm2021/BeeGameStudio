import { z } from 'zod/v4'
import { parseRevisionRepairSource, prepareRevisionRetryAuthority, revisionRepairRound } from './candidate-authority'
import { bindRevisionDocuments } from './document-snapshot'
import { revisionCanonicalJson, revisionDigest } from './json-digest'
import { buildFoundationRevisionBatches } from './planning'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const binding = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
const common = { ownerId: id, projectId: id, requestId: id, sourceResult: z.unknown(), sourceBinding: binding }
const requestSchema = z.discriminatedUnion('kind', [
  z.object({ ...common, kind: z.literal('initial') }).strict(),
  z.object({ ...common, kind: z.literal('next_round') }).strict(),
  z.object({ ...common, kind: z.literal('retry_same_round'), previousCandidateResult: z.unknown(),
    previousCandidateBinding: binding, previousRecheckResult: z.unknown(), previousRecheckBinding: binding }).strict(),
])

/** Pure private admission. Bindings must come from the accepting host; hashes are not authentication. */
export function prepareRevisionRequest(value: unknown) {
  const request = requestSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  // The phase parsers validate the independently supplied binding shapes.
  const retry = request.kind === 'retry_same_round' ? prepareRevisionRetryAuthority({
    sourceResult: request.sourceResult, sourceBinding: request.sourceBinding,
    previousCandidateResult: request.previousCandidateResult, previousCandidateBinding: request.previousCandidateBinding,
    previousRecheckResult: request.previousRecheckResult, previousRecheckBinding: request.previousRecheckBinding,
  }) : null
  const source = retry?.source ?? parseRevisionRepairSource(request.sourceResult, request.sourceBinding)
  if (source.ownerId !== request.ownerId || source.projectId !== request.projectId)
    throw new Error('Revision request owner/project mismatch')
  if ((request.kind === 'initial' && source.subject.kind !== 'initial') ||
    (request.kind === 'next_round' && source.subject.kind !== 'candidate'))
    throw new Error('Revision request phase mismatch')

  const retainedPaths = new Set(retry?.retainedDocumentPaths ?? [])
  const repairIds = new Set(retry?.repairIssueIds ?? source.issues.map(entry => entry.issue.id))
  const dispatchIssues = source.issues.filter(entry => repairIds.has(entry.issue.id) &&
    !retainedPaths.has(entry.issue.remediation.documentPath))
  // Public evidence slices describe source/target, not necessarily every
  // remediation section. Rebuild only the required writable document indices.
  const sectionPaths = new Set(dispatchIssues.filter(entry => entry.issue.remediation.scope === 'section')
    .map(entry => entry.issue.remediation.documentPath))
  const sectionAuthorities = buildFoundationSectionIndex({ documents: new Map(source.documents.filter(doc => sectionPaths.has(doc.path))
    .map(doc => [doc.path, doc.content])) }).map(({ documentPath, sectionId }) => ({ documentPath, sectionId }))
  const batches = buildFoundationRevisionBatches({ issues: dispatchIssues.map(entry => entry.issue), sectionAuthorities })
  if (!batches.length) throw new Error('Revision request has no dispatchable repair issues')
  // Failed documents restart from the original source; only accepted retained
  // documents carry predecessor bytes. Failed candidate edits are not a new base.
  const staging = bindRevisionDocuments(source.documents.map(doc => ({ path: doc.path,
    content: retainedPaths.has(doc.path) ? retry!.previousCandidate.documents.find(previous => previous.path === doc.path)!.content : doc.content })))
  const unresolvedIssues = source.issues.filter(entry => !repairIds.has(entry.issue.id)).map(entry => ({ issueId: entry.issue.id,
    reason: retry?.previousCandidate.unresolvedIssues.find(issue => issue.issueId === entry.issue.id)?.reason
      ?? 'Not included in the failed-issue scope of the accepted same-round recheck.',
  }))
  // Captured request + deterministic plan can be journaled before dispatch. This
  // function does not allocate candidate IDs, publish, execute or certify repairs.
  return { request, requestDigest: revisionDigest(request), source, round: retry?.round ?? revisionRepairRound(source),
    previous: retry?.previous ?? null, staging, batches,
    previousCandidateDocuments: retry?.previousCandidate.documents.map(({ path, content }) => ({ path, content })) ?? null,
    repairIssueIds: [...repairIds].sort(), dispatchIssueIds: dispatchIssues.map(entry => entry.issue.id).sort(),
    retainedDocumentPaths: [...retainedPaths], unresolvedIssues }
}
