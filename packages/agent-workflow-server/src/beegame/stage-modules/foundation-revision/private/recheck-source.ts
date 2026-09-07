import { z } from 'zod/v4'
import { revisionInitialSourceSchema, assertRevisionSourceBinding, validateRevisionSourceEvidence,
  type RevisionSourceBinding } from './initial-source'
import { revisionCanonicalJson } from './json-digest'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { revisionRecheckEvidenceSchema, validateRevisionRecheckEvidence } from './recheck-evidence'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const schema = revisionInitialSourceSchema.extend({
  kind: z.enum(['passed', 'issues_found']),
  subject: z.object({ kind: z.literal('candidate'), candidateId: id, candidateResultId: id,
    baseDocumentSetDigest: digest, sourceReviewResultId: digest, sourceReviewResultDigest: digest,
    previousCandidateId: id.optional() }).strict(),
  issues: z.array(revisionInitialSourceSchema.shape.issues.element),
  recheck: revisionRecheckEvidenceSchema,
}).strict()
export type RevisionRecheckSource = z.infer<typeof schema>

/**
 * Copies the accepted public recheck, validates its bytes and structural verdict
 * consistency, and never recomputes a content verdict. The consumer must also
 * bind this result to the exact previous candidate before planning a retry.
 */
export function parseRevisionRecheckSource(value: unknown, expected: RevisionSourceBinding): RevisionRecheckSource {
  const result = schema.parse(JSON.parse(revisionCanonicalJson(value)))
  assertRevisionSourceBinding(result, expected)
  validateRevisionSourceEvidence(result)
  if ((result.kind === 'passed') !== (result.issues.length === 0))
    throw new Error('Revision recheck kind and issue registry disagree')
  const index = result.recheck.kind === 'targeted'
    ? buildFoundationSectionIndex({ documents: new Map(result.documents.map(doc => [doc.path, doc.content])) }) : []
  validateRevisionRecheckEvidence(result.recheck, result.documents, result.issues, index)
  return result
}
