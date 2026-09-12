import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { bindRevisionDocuments } from './document-snapshot'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const schema = z.object({
  protocolVersion: z.literal(2), producer: z.literal('foundation-revision'), kind: z.literal('candidate_ready'),
  resultId: digest, ownerId: id, projectId: id, requestId: id, candidateId: z.uuid(),
  round: z.number().int().positive().safe(),
  baseDocumentSetDigest: digest, sourceReviewResultId: digest, sourceReviewResultDigest: digest,
  documentSetDigest: digest, revisionSummary: z.string().trim().min(1).max(8000),
  documents: z.array(z.object({ path: z.enum(CANONICAL_FOUNDATION_DOCUMENTS),
    content: z.string().refine(value => value.trim().length > 0 && Buffer.byteLength(value) <= 2 * 1024 * 1024),
    digest, byteLength: z.number().int().nonnegative().safe() }).strict()).length(8),
}).strict()
const bindingSchema = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type RevisionCandidateResult = z.infer<typeof schema>
export type RevisionCandidateBinding = z.infer<typeof bindingSchema>

/** Identity and byte integrity only. Reviewer decides whether the edits fix the issues. */
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
  return result
}
