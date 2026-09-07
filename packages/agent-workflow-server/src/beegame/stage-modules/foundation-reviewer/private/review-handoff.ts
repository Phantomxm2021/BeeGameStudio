import { createHash } from 'node:crypto'
import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { createFoundationFactStore } from './domain/foundation-fact-store'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { prepareFoundationReview } from './prepare-review'
import { reviewerSubjectSchema } from './review-subject'
import { reviewerInputDigest, type ReviewerPublishedResult } from './review-publication'
import { reviewerDigest, reviewerPolicyDigest, reviewerCanonicalJson } from './review-summary'
import { reviewerRepairEvidenceKeys } from './repair-evidence'
import { reviewerRecheckEvidenceSchema, reviewerFullFormatPolicyDigest, validateReviewerTargetedEvidence } from './recheck-contract'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const line = z.number().int().positive()
const section = z.object({ documentPath: path, sectionId: id, heading: z.string(), startLine: line, endLine: line, digest }).strict()
const document = z.object({ scope: z.literal('document'), documentPath: path, digest }).strict()
const common = { id, severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']), expected: z.string().min(1), actual: z.string().min(1) }
const issue = z.union([
  z.object({ ...common, type: z.enum(['schema', 'rule', 'contract', 'semantic']), source: section, target: section.optional(),
    supportingSections: z.array(section).max(16).optional(),
    remediation: z.object({ kind: z.literal('patch'), scope: z.literal('section'), documentPath: path, sectionIds: z.array(id).min(1) }).strict(),
    reasonCode: z.string().min(1).optional() }).strict(),
  z.object({ ...common, type: z.enum(['schema', 'contract']), source: document, reasonCode: z.literal('DOCUMENT_FORMAT_INVALID'),
    remediation: z.object({ kind: z.literal('patch'), scope: z.literal('document'), documentPath: path }).strict() }).strict(),
])
const fact = z.object({ key: id, value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.array(z.number().finite())]),
  source: section, evidence: z.object({ documentPath: path, sectionId: id, startLine: line, endLine: line, digest }).strict() }).strict()
const resultSchema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('foundation-reviewer'), resultId: digest, inputDigest: digest,
  ownerId: id, projectId: id, requestId: id, subject: reviewerSubjectSchema, kind: z.enum(['passed', 'issues_found']),
  documentSetDigest: digest, policyDigest: digest, issueRegistryDigest: digest, evidenceDigest: digest,
  documents: z.array(z.object({ path, content: z.string(), digest, byteLength: z.number().int().nonnegative() }).strict()).length(8),
  issues: z.array(z.object({ issue, facts: z.array(fact), sections: z.array(z.object({ path, sectionId: id.optional(), content: z.string(), digest }).strict()) }).strict()),
  recheck: reviewerRecheckEvidenceSchema.optional(),
}).strict()
const bindingSchema = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type ReviewerSourceBinding = z.infer<typeof bindingSchema>
const rawDigest = (content: string) => createHash('sha256').update(content).digest('hex')
const same = (left: unknown, right: unknown) => reviewerCanonicalJson(left) === reviewerCanonicalJson(right)

/**
 * Verify copied public data against the caller's already accepted result binding.
 * Hashes bind bytes, not semantic truth or a producer signature. The accepted
 * binding must come from the orchestration handoff, never from the candidate.
 * No producer state or filesystem is consulted.
 */
export function parseReviewerSourceResult(value: unknown, expected: ReviewerSourceBinding): ReviewerPublishedResult {
  const binding = bindingSchema.parse(expected)
  const result = resultSchema.parse(value)
  const { resultId, ...body } = result
  if (result.ownerId !== binding.ownerId || result.projectId !== binding.projectId ||
    resultId !== binding.resultId || reviewerDigest(result) !== binding.resultDigest || reviewerDigest(body) !== resultId)
    throw new Error('review source result binding mismatch')
  if (result.policyDigest !== reviewerPolicyDigest()) throw new Error('review source policy is incompatible')
  const documents = result.documents.map(({ path, content }) => ({ path, content }))
  const prepared = prepareFoundationReview(documents)
  if (!same(result.documents, prepared.snapshot.documents.map(doc => ({ ...doc, byteLength: Buffer.byteLength(doc.content, 'utf8') }))) ||
    result.documentSetDigest !== prepared.snapshot.digest ||
    result.inputDigest !== reviewerInputDigest({ ownerId: result.ownerId, projectId: result.projectId, subject: result.subject, documents }))
    throw new Error('review source document binding mismatch')
  const issues = result.issues.map(entry => entry.issue)
  if (reviewerDigest(issues) !== result.issueRegistryDigest || (issues.length === 0) !== (result.kind === 'passed') ||
    new Set(issues.map(issue => issue.id)).size !== issues.length)
    throw new Error('review source issue registry is inconsistent')
  if (result.recheck && result.subject.kind !== 'candidate') throw new Error('targeted evidence requires a candidate subject')
  if (result.subject.kind === 'candidate' && !result.recheck) throw new Error('candidate review requires explicit recheck evidence')
  const targeted = result.recheck?.kind === 'targeted'
  if (result.recheck?.kind === 'full_format' && result.recheck.policyDigest !== reviewerFullFormatPolicyDigest())
    throw new Error('full format recheck policy is incompatible')
  // The recheck's candidateResultDigest is the full candidate digest, while
  // subject.candidateResultId is only that candidate's resultId. Their
  // relationship is verified by the retry consumer with the copied candidate.
  if (prepared.kind === 'format_issues' && !targeted) {
    if (!same([...prepared.formatIssues].sort((a, b) => a.id.localeCompare(b.id)), issues) || result.issues.some(entry => entry.facts.length))
      throw new Error('review source format authority is inconsistent')
  }
  // Some format defects have a proven section boundary even while a different
  // document has no usable index. Rebuild only those locally proven documents.
  const localizedPaths = new Set(issues.filter(item => 'sectionId' in item.source).map(item => item.source.documentPath))
  const index = targeted ? buildFoundationSectionIndex({ documents: new Map(documents.map(doc => [doc.path, doc.content])) }) : prepared.kind === 'facts_pending' ? prepared.sectionIndex :
    buildFoundationSectionIndex({ documents: new Map(documents.filter(doc => localizedPaths.has(doc.path)).map(doc => [doc.path, doc.content])) })
  if (result.recheck?.kind === 'targeted') validateReviewerTargetedEvidence(result.recheck, result.documents, result.issues, index)
  const allFacts = new Map<string, unknown>()
  const assertSection = (ref: z.infer<typeof section>) => {
    if (!same(index.find(item => item.documentPath === ref.documentPath && item.sectionId === ref.sectionId) ?? null, ref))
      throw new Error('review source section evidence mismatch')
  }
  for (const entry of result.issues) {
    if (entry.issue.type === 'semantic' && (!('supportingSections' in entry.issue) || !Array.isArray(entry.issue.supportingSections)))
      throw new Error('semantic review issue must carry explicit supporting section evidence')
    if ('supportingSections' in entry.issue && entry.issue.supportingSections) {
      const supportKeys = entry.issue.supportingSections.map(ref => `${ref.documentPath}#${ref.sectionId}`)
      const sourceKey = 'sectionId' in entry.issue.source ? `${entry.issue.source.documentPath}#${entry.issue.source.sectionId}` : undefined
      const targetKey = 'target' in entry.issue && entry.issue.target && 'sectionId' in entry.issue.target ? `${entry.issue.target.documentPath}#${entry.issue.target.sectionId}` : undefined
      if (new Set(supportKeys).size !== supportKeys.length || (sourceKey !== undefined && supportKeys.includes(sourceKey)) ||
        (targetKey !== undefined && supportKeys.includes(targetKey)))
        throw new Error('review source supporting section evidence is not additional and unique')
    }
    const refs = [entry.issue.source, ...('target' in entry.issue && entry.issue.target ? [entry.issue.target] : []), ...('supportingSections' in entry.issue && entry.issue.supportingSections ? entry.issue.supportingSections : [])]
    const slices = refs.map(ref => {
      const content = documents.find(doc => doc.path === ref.documentPath)!.content
      if ('sectionId' in ref) assertSection(ref)
      const text = 'sectionId' in ref ? content.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n') : content
      if (rawDigest(text) !== ref.digest) throw new Error('review source evidence digest mismatch')
      return { path: ref.documentPath, ...('sectionId' in ref ? { sectionId: ref.sectionId } : {}), content: text, digest: ref.digest }
    })
    if (!same(slices, entry.sections)) throw new Error('review source evidence slices mismatch')
    const repair = entry.issue.remediation
    if (repair.scope === 'section') {
      if (new Set(repair.sectionIds).size !== repair.sectionIds.length ||
        repair.sectionIds.some(id => !index.some(ref => ref.documentPath === repair.documentPath && ref.sectionId === id)))
        throw new Error('review source repair scope is invalid')
    } else if (prepared.kind !== 'format_issues' || targeted) throw new Error('review source document repair lacks format authority')
    const keys = new Set<string>(reviewerRepairEvidenceKeys(entry.issue))
    const facts = createFoundationFactStore(entry.facts)
    for (const fact of facts) {
      if (!keys.has(fact.key)) throw new Error('review source fact is outside repair evidence scope')
      assertSection(fact.source)
      const content = documents.find(doc => doc.path === fact.evidence.documentPath)!.content
      if (rawDigest(content.split('\n').slice(fact.evidence.startLine - 1, fact.evidence.endLine).join('\n')) !== fact.evidence.digest)
        throw new Error('review source fact evidence digest mismatch')
      if (allFacts.has(fact.key) && !same(allFacts.get(fact.key), fact)) throw new Error('review source fact slices disagree')
      allFacts.set(fact.key, fact)
    }
  }
  return structuredClone(result)
}
