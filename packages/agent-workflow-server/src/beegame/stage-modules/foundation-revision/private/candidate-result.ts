import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { bindRevisionDocuments } from './document-snapshot'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const issueIds = z.array(id).min(1)
const operation = z.union([
  z.object({ scope: z.literal('document'), kind: z.literal('REPLACE'), documentPath: path,
    issueIds, beforeDigest: digest, afterDigest: digest }).strict(),
  z.object({ scope: z.literal('section'), kind: z.literal('INSERT'), documentPath: path,
    sectionId: id, issueIds, afterDigest: digest }).strict(),
  z.object({ scope: z.literal('section'), kind: z.literal('REPLACE'), documentPath: path,
    sectionId: id, issueIds, beforeDigest: digest, afterDigest: digest }).strict(),
  z.object({ scope: z.literal('section'), kind: z.literal('DELETE'), documentPath: path,
    sectionId: id, issueIds, beforeDigest: digest }).strict(),
])
const schema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('foundation-revision'), kind: z.literal('candidate_ready'),
  resultId: digest, ownerId: id, projectId: id, requestId: id, candidateId: id,
  round: z.number().int().positive().safe(),
  baseDocumentSetDigest: digest, sourceReviewResultId: digest, sourceReviewResultDigest: digest,
  previous: z.object({ candidateId: id, candidateResultId: digest, candidateResultDigest: digest,
    recheckResultId: digest, recheckResultDigest: digest }).strict().optional(),
  documentSetDigest: digest,
  documents: z.array(z.object({ path, content: z.string(), digest,
    byteLength: z.number().int().nonnegative().safe() }).strict()).length(8),
  changes: z.array(operation).min(1),
  repairClaims: z.array(z.object({ issueId: id, status: z.literal('APPLIED') }).strict()).min(1),
  unresolvedIssues: z.array(z.object({ issueId: id, reason: z.string().min(1) }).strict()),
}).strict()
const bindingSchema = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type RevisionCandidateResult = z.infer<typeof schema>
export type RevisionCandidateBinding = z.infer<typeof bindingSchema>

/**
 * Re-captures an immutable public result at a storage/consumption boundary.
 * This is schema and byte binding only: original issue authority, operations,
 * and predecessor retention must also be derived by the candidate owner.
 */
export function parseRevisionCandidateResult(value: unknown, expected: RevisionCandidateBinding): RevisionCandidateResult {
  const accepted = bindingSchema.parse(JSON.parse(revisionCanonicalJson(expected)))
  const result = schema.parse(JSON.parse(revisionCanonicalJson(value)))
  const { resultId, ...body } = result
  if (result.ownerId !== accepted.ownerId || result.projectId !== accepted.projectId || resultId !== accepted.resultId ||
    revisionDigest(result) !== accepted.resultDigest || revisionDigest(body) !== resultId)
    throw new Error('Revision candidate result binding mismatch')
  const snapshot = bindRevisionDocuments(result.documents.map(({ path, content }) => ({ path, content })))
  if (snapshot.documentSetDigest !== result.documentSetDigest ||
    revisionCanonicalJson(snapshot.documents) !== revisionCanonicalJson(result.documents))
    throw new Error('Revision candidate document binding mismatch')
  const claimed = result.repairClaims.map(claim => claim.issueId)
  const allIds = [...claimed, ...result.unresolvedIssues.map(issue => issue.issueId)]
  if (new Set(allIds).size !== allIds.length)
    throw new Error('Revision candidate issue claims must be unique and disjoint')
  const repaired = new Set(claimed)
  const covered = new Set<string>()
  const changedScopes = new Map<string, Set<string>>()
  for (const change of result.changes) {
    const scopes = changedScopes.get(change.documentPath) ?? new Set<string>()
    const scope = change.scope === 'document' ? '' : change.sectionId
    if (scopes.has(scope) || (scope === '' && scopes.size > 0) || scopes.has(''))
      throw new Error('Revision candidate changes must have unique unmixed scopes')
    scopes.add(scope)
    changedScopes.set(change.documentPath, scopes)
    if (new Set(change.issueIds).size !== change.issueIds.length || change.issueIds.some(id => !repaired.has(id)))
      throw new Error('Revision candidate operation claims mismatch')
    for (const id of change.issueIds) covered.add(id)
  }
  if (covered.size !== repaired.size || claimed.some(id => !covered.has(id)))
    throw new Error('Revision candidate repair claims lack operation coverage')
  return result
}
