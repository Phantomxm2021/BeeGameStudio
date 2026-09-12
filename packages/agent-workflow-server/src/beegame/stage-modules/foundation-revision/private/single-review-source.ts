import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { bindRevisionDocuments } from './document-snapshot'
import { revisionBytesDigest, revisionDigest, revisionCanonicalJson } from './json-digest'

// Copied public protocol owned by the consumer. No Reviewer private imports.
const id = z.string().min(1).max(200), digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS), text = z.string().min(1).max(8000)
const inputPolicy = 'native-file-audit.v1'
const auditPolicy = z.literal('native-file-audit.v1')
const requirements = z.discriminatedUnion('status', [
  z.object({ status: z.literal('available'), content: z.string().min(1), digest }).strict(),
  z.object({ status: z.literal('unavailable'), reason: z.string().min(1).max(2000) }).strict(),
])
const subject = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('initial'), sourceResultId: id, sourceDocumentRevision: digest, confirmedBriefDigest: digest }).strict(),
  z.object({ kind: z.literal('candidate'), candidateId: id, candidateResultId: digest, sourceReviewResultId: digest,
    sourceReviewResultDigest: digest, baseDocumentSetDigest: digest, round: z.number().int().positive().safe() }).strict(),
])
const issue = z.object({ id: digest, type: z.literal('semantic'), reasonCode: z.literal('SINGLE_AGENT_FINDING'),
  severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']), title: z.string().min(1).max(300),
  actual: text, expected: text,
  source: z.object({ scope: z.literal('document'), documentPath: path, digest }).strict(),
}).strict()
export const singleRevisionSourceSchema = z.object({ protocolVersion: z.literal(3), producer: z.literal('foundation-reviewer'),
  resultId: digest, ownerId: id, projectId: id, requestId: id, inputDigest: digest, subject, requirements,
  inputContext: z.object({ comparison: z.json().optional(), tokenBudget: z.number().int().positive().safe().nullable().optional() }).strict().optional(),
  kind: z.literal('issues_found'), documents: z.array(z.object({ path, content: z.string(), digest, byteLength: z.number().int().nonnegative().safe() }).strict()).length(8),
  documentSetDigest: digest, policyDigest: digest, issueRegistryDigest: digest, evidenceDigest: digest,
  issues: z.array(z.object({ issue }).strict()).min(1).max(200),
  audit: z.object({ policy: auditPolicy, summary: text }).strict(),
}).strict()
export type SingleRevisionSource = z.infer<typeof singleRevisionSourceSchema>
export type SingleRevisionIssue = SingleRevisionSource['issues'][number]['issue']
const bindingSchema = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type SingleRevisionSourceBinding = z.infer<typeof bindingSchema>

export function parseSingleRevisionSource(value: unknown, expected: SingleRevisionSourceBinding): SingleRevisionSource {
  const result = singleRevisionSourceSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  const binding = bindingSchema.parse(expected)
  const { resultId, ...body } = result
  if (result.ownerId !== binding.ownerId || result.projectId !== binding.projectId || resultId !== binding.resultId ||
    revisionDigest(body) !== resultId || revisionDigest(result) !== binding.resultDigest)
    throw new Error('Revision source does not match accepted public binding')
  const snapshot = bindRevisionDocuments(result.documents.map(({ path, content }) => ({ path, content })))
  if (snapshot.documentSetDigest !== result.documentSetDigest || revisionCanonicalJson(snapshot.documents) !== revisionCanonicalJson(result.documents))
    throw new Error('Revision source document bytes changed')
  if (result.requirements.status === 'available' && (revisionBytesDigest(result.requirements.content) !== result.requirements.digest ||
    (result.subject.kind === 'initial' && result.subject.confirmedBriefDigest !== result.requirements.digest)))
    throw new Error('Revision requirements bytes changed')
  const input = { subject: result.subject, requirements: result.requirements, documents: result.documents.map(({ path, content }) => ({ path, content })),
    ...(result.inputContext?.comparison !== undefined ? { comparison: result.inputContext.comparison } : {}) }
  if (revisionDigest({ ownerId: result.ownerId, projectId: result.projectId, input, policy: inputPolicy,
      ...(result.inputContext?.tokenBudget !== undefined ? { tokenBudget: result.inputContext.tokenBudget } : {}) }) !== result.inputDigest ||
    revisionDigest(result.audit.policy) !== result.policyDigest)
    throw new Error('Revision source audit binding changed')
  if (new Set(result.issues.map(entry => entry.issue.id)).size !== result.issues.length ||
    revisionDigest(result.issues.map(entry => entry.issue)) !== result.issueRegistryDigest ||
    revisionDigest({ audit: result.audit, issues: result.issues }) !== result.evidenceDigest)
    throw new Error('Revision issue registry changed')
  for (const { issue } of result.issues) {
    const { id, ...body } = issue
    const document = result.documents.find(document => document.path === issue.source.documentPath)
    if (revisionDigest(body) !== id || !document || issue.source.digest !== document.digest)
      throw new Error('Revision issue source binding changed')
  }
  return result
}
