import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { buildFoundationSectionIndex } from './domain/foundation-section-index'
import { bindRevisionDocuments } from './document-snapshot'
import { revisionBytesDigest, revisionCanonicalJson, revisionDigest } from './json-digest'
import { assertRevisionFactConstraint, revisionRepairEvidenceKeys } from './fact-evidence'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const line = z.number().int().positive().safe()
const section = z.object({ documentPath: path, sectionId: id, heading: z.string(), startLine: line, endLine: line, digest }).strict()
const supportingSections = z.array(section).max(16)
const common = { id, severity: z.enum(['BLOCKER', 'HIGH', 'MEDIUM', 'LOW']), expected: z.string().min(1), actual: z.string().min(1) }
const issue = z.union([
  z.object({ ...common, type: z.enum(['schema', 'rule', 'contract']), source: section, target: section.optional(), supportingSections: supportingSections.optional(),
    remediation: z.object({ kind: z.literal('patch'), scope: z.literal('section'), documentPath: path, sectionIds: z.array(id).min(1) }).strict(),
    reasonCode: z.string().min(1).optional() }).strict(),
  z.object({ ...common, type: z.literal('semantic'), source: section, target: section.optional(), supportingSections,
    remediation: z.object({ kind: z.literal('patch'), scope: z.literal('section'), documentPath: path, sectionIds: z.array(id).min(1) }).strict(),
    reasonCode: z.string().min(1).optional() }).strict(),
  z.object({ ...common, type: z.enum(['schema', 'contract']), reasonCode: z.literal('DOCUMENT_FORMAT_INVALID'),
    source: z.object({ scope: z.literal('document'), documentPath: path, digest }).strict(),
    remediation: z.object({ kind: z.literal('patch'), scope: z.literal('document'), documentPath: path }).strict() }).strict(),
])
const fact = z.object({ key: id, value: z.union([z.string(), z.number().finite(), z.boolean(), z.array(z.string()), z.array(z.number().finite())]),
  source: section, evidence: z.object({ documentPath: path, sectionId: id, startLine: line, endLine: line, digest }).strict() }).strict()
export const revisionInitialSourceSchema = z.object({
  protocolVersion: z.literal(1), producer: z.literal('foundation-reviewer'), kind: z.literal('issues_found'),
  resultId: digest, inputDigest: digest, ownerId: id, projectId: id, requestId: id,
  subject: z.object({ kind: z.literal('initial'), sourceResultId: id, sourceDocumentRevision: digest, confirmedBriefDigest: digest }).strict(),
  documentSetDigest: digest, policyDigest: digest, issueRegistryDigest: digest, evidenceDigest: digest,
  documents: z.array(z.object({ path, content: z.string(), digest, byteLength: z.number().int().nonnegative().safe() }).strict()).length(8),
  issues: z.array(z.object({ issue, facts: z.array(fact),
    sections: z.array(z.object({ path, sectionId: id.optional(), content: z.string(), digest }).strict()) }).strict()).min(1),
}).strict()
const bindingSchema = z.object({ ownerId: id, projectId: id, resultId: digest, resultDigest: digest }).strict()
export type RevisionSourceBinding = z.infer<typeof bindingSchema>
export type RevisionInitialSource = z.infer<typeof revisionInitialSourceSchema>
export type RevisionSectionRef = z.infer<typeof section>
export type RevisionIssue = z.infer<typeof issue>
const same = (left: unknown, right: unknown) => revisionCanonicalJson(left) === revisionCanonicalJson(right)

function sectionIdentity(ref: RevisionSectionRef): string {
  return `${ref.documentPath}\u0000${ref.sectionId}`
}

function compareSectionRefs(left: RevisionSectionRef, right: RevisionSectionRef): number {
  // The wire contract is ordered by stable identity, not line positions. A
  // document edit may move a section while preserving its canonical identity.
  return left.documentPath.localeCompare(right.documentPath) || left.sectionId.localeCompare(right.sectionId)
}

/**
 * First initial-review handoff only. The accepted binding is supplied separately
 * by orchestration; a rehashed payload is not its own authority. This validates
 * copied bytes/scopes, never runs content audits or issues a Reviewer verdict.
 * Candidate rechecks require a separate predecessor-aware admission path.
 */
export function parseRevisionInitialSource(value: unknown, expected: RevisionSourceBinding): RevisionInitialSource {
  const result = revisionInitialSourceSchema.parse(JSON.parse(revisionCanonicalJson(value)))
  assertRevisionSourceBinding(result, expected)
  validateRevisionSourceEvidence(result)
  return result
}

/** Shared only inside Revision, after the phase-specific source schema has parsed. */
export function assertRevisionSourceBinding(result: { ownerId: string; projectId: string; resultId: string }, expected: RevisionSourceBinding): void {
  const binding = bindingSchema.parse(JSON.parse(revisionCanonicalJson(expected)))
  const { resultId, ...body } = result
  if (result.ownerId !== binding.ownerId || result.projectId !== binding.projectId || resultId !== binding.resultId ||
    revisionDigest(result) !== binding.resultDigest || revisionDigest(body) !== resultId)
    throw new Error('Revision source binding mismatch')
}

/** Common byte/scope constraints; phase-specific recheck evidence is validated separately. */
export function validateRevisionSourceEvidence(result: Pick<RevisionInitialSource,
  'ownerId' | 'projectId' | 'inputDigest' | 'documents' | 'documentSetDigest' | 'issues' | 'issueRegistryDigest'> & { subject: unknown }): void {
  const snapshot = bindRevisionDocuments(result.documents.map(({ path, content }) => ({ path, content })))
  if (!same(snapshot.documents, result.documents) || snapshot.documentSetDigest !== result.documentSetDigest ||
    revisionDigest({ ownerId: result.ownerId, projectId: result.projectId, subject: result.subject,
      documentSetDigest: result.documentSetDigest }) !== result.inputDigest)
    throw new Error('Revision source document binding mismatch')
  const issues = result.issues.map(entry => entry.issue)
  if (new Set(issues.map(item => item.id)).size !== issues.length || revisionDigest(issues) !== result.issueRegistryDigest)
    throw new Error('Revision source issue binding mismatch')
  const indexedPaths = new Set<string>()
  for (const entry of result.issues) {
    if ('sectionId' in entry.issue.source) indexedPaths.add(entry.issue.source.documentPath)
    if ('target' in entry.issue && entry.issue.target) indexedPaths.add(entry.issue.target.documentPath)
    if ('supportingSections' in entry.issue)
      for (const supporting of entry.issue.supportingSections ?? []) indexedPaths.add(supporting.documentPath)
    if (entry.issue.remediation.scope === 'section') indexedPaths.add(entry.issue.remediation.documentPath)
    for (const fact of entry.facts) indexedPaths.add(fact.source.documentPath)
  }
  // A malformed document with document-scoped repair need not have an index.
  const index = buildFoundationSectionIndex({ documents: new Map(result.documents.filter(doc => indexedPaths.has(doc.path)).map(doc => [doc.path, doc.content])) })
  const assertSection = (ref: z.infer<typeof section>) => {
    if (!same(index.find(item => item.documentPath === ref.documentPath && item.sectionId === ref.sectionId) ?? null, ref))
      throw new Error('Revision source section evidence mismatch')
  }
  const allFacts = new Map<string, unknown>()
  for (const entry of result.issues) {
    const support = 'supportingSections' in entry.issue ? (entry.issue.supportingSections ?? []) : []
    if (entry.issue.type === 'semantic' && !('supportingSections' in entry.issue))
      throw new Error('Revision semantic issue supporting section evidence is required')
    const known = 'sectionId' in entry.issue.source
      ? [entry.issue.source, ...('target' in entry.issue && entry.issue.target ? [entry.issue.target] : [])]
      : []
    const knownIdentities = new Set(known.map(sectionIdentity))
    const supportIdentities = support.map(sectionIdentity)
    if (new Set(supportIdentities).size !== supportIdentities.length || supportIdentities.some(identity => knownIdentities.has(identity)) ||
      support.some((ref, index) => index > 0 && compareSectionRefs(support[index - 1]!, ref) >= 0))
      throw new Error('Revision supporting section evidence is duplicate, overlaps repair refs, or not canonically ordered')
    const refs = 'sectionId' in entry.issue.source ? [...known, ...support] : [entry.issue.source]
    const slices = refs.map(ref => {
      const content = result.documents.find(doc => doc.path === ref.documentPath)!.content
      if ('sectionId' in ref) assertSection(ref)
      const text = 'sectionId' in ref ? content.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n') : content
      if (revisionBytesDigest(text) !== ref.digest) throw new Error('Revision source evidence digest mismatch')
      return { path: ref.documentPath, ...('sectionId' in ref ? { sectionId: ref.sectionId } : {}), content: text, digest: ref.digest }
    })
    if (!same(slices, entry.sections)) throw new Error('Revision source evidence slices mismatch')
    const repair = entry.issue.remediation
    if (repair.scope === 'section') {
      if (new Set(repair.sectionIds).size !== repair.sectionIds.length || repair.sectionIds.some(id =>
        !index.some(ref => ref.documentPath === repair.documentPath && ref.sectionId === id)))
        throw new Error('Revision source repair scope mismatch')
    } else if (entry.issue.source.documentPath !== repair.documentPath || entry.facts.length)
      throw new Error('Revision document repair authority mismatch')
    const factKeys = new Set<string>()
    const allowedFactKeys = new Set(revisionRepairEvidenceKeys(entry.issue))
    for (const fact of entry.facts) {
      if (!allowedFactKeys.has(fact.key)) throw new Error('Revision fact is outside repair evidence scope')
      assertRevisionFactConstraint(fact)
      assertSection(fact.source)
      if (factKeys.has(fact.key) || fact.evidence.documentPath !== fact.source.documentPath || fact.evidence.sectionId !== fact.source.sectionId ||
        fact.evidence.startLine < fact.source.startLine || fact.evidence.endLine < fact.evidence.startLine || fact.evidence.endLine > fact.source.endLine)
        throw new Error('Revision fact evidence scope mismatch')
      factKeys.add(fact.key)
      const content = result.documents.find(doc => doc.path === fact.evidence.documentPath)!.content
      if (revisionBytesDigest(content.split('\n').slice(fact.evidence.startLine - 1, fact.evidence.endLine).join('\n')) !== fact.evidence.digest)
        throw new Error('Revision fact evidence digest mismatch')
      if (allFacts.has(fact.key) && !same(allFacts.get(fact.key), fact)) throw new Error('Revision fact slices disagree')
      allFacts.set(fact.key, fact)
    }
  }
}
