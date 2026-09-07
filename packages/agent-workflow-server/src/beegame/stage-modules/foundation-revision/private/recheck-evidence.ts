import { z } from 'zod/v4'
import { CANONICAL_FOUNDATION_DOCUMENTS } from './domain/types'
import { revisionCanonicalJson, revisionDigest } from './json-digest'

const id = z.string().min(1).max(200)
const digest = z.string().regex(/^[a-f0-9]{64}$/)
const path = z.enum(CANONICAL_FOUNDATION_DOCUMENTS)
const ref = z.object({ documentPath: path, sectionId: id, heading: z.string(), startLine: z.number().int().positive(), endLine: z.number().int().positive(), digest }).strict()
const diagnostic = z.object({ unmetExpected: z.string().min(1), observedActual: z.string().min(1), evidence: z.array(ref).min(1), dependencySections: z.array(ref).min(1), failureReasonCode: z.enum(['expected_not_met', 'actual_persists', 'contradictory_evidence', 'evidence_insufficient']), scopeAssessment: z.literal('repairable_in_scope') }).strict()
const targetedSchema = z.object({ kind: z.literal('targeted'), round: z.number().int().positive().safe(), candidateResultDigest: digest, policyDigest: digest, decision: z.enum(['retry_same_round', 'round_complete']), issueVerdicts: z.array(z.union([
  z.object({ issueId: id, kind: z.literal('deterministic'), status: z.enum(['PASS', 'FAIL']) }).strict(),
  z.object({ issueId: id, kind: z.literal('semantic'), status: z.enum(['PASS', 'NOT_CHECKED']) }).strict(),
  z.object({ issueId: id, kind: z.literal('semantic'), status: z.literal('FAIL'), diagnostic }).strict(),
])).min(1), documentVerdicts: z.array(z.object({ documentPath: path, documentDigest: digest, issueIds: z.array(id).min(1), retryIssueIds: z.array(id), status: z.enum(['PASS', 'FAIL', 'DEFERRED']) }).strict()).min(1) }).strict()
const fullFormatSchema = z.object({ kind: z.literal('full_format'), round: z.number().int().positive().safe(), candidateResultDigest: digest, policyDigest: digest, nextRound: z.literal(1) }).strict()
const schema = z.union([targetedSchema, fullFormatSchema])

const fullFormatPolicyDescription = { version: 'full-format-review.v1', route: 'whole-document-format-only', audit: 'fresh-full-initial-review', newIssuesRound: 1 } as const
const targetedPolicyDescription = { version: 'targeted-review.v1', audit: 'frozen-production-impact-only', semantic: 'strong-expected-actual-PASS-FAIL', prompt: 'assigned-section-digests.v1', deterministicFailure: 'defer-semantic-same-round', retry: 'failed-documents-only-retain-other-bytes', publication: 'new-issues-after-all-active-pass' } as const

/** Compatibility policy digests; these identify the public evidence version, not an audit. */
export const revisionFullFormatPolicyDigest = () => revisionDigest(fullFormatPolicyDescription)
export const revisionTargetedPolicyDigest = () => revisionDigest(targetedPolicyDescription)

export type RevisionRecheckEvidence = z.infer<typeof schema>
export type RevisionTargetedRecheckEvidence = z.infer<typeof targetedSchema>
export type RevisionFullFormatRecheckEvidence = z.infer<typeof fullFormatSchema>
export type RevisionRecheckSectionRef = z.infer<typeof ref>

function same(left: unknown, right: unknown): boolean {
  return revisionCanonicalJson(left) === revisionCanonicalJson(right)
}

function assertTargeted(value: RevisionTargetedRecheckEvidence, documents: readonly { path: string; digest: string }[], issues: readonly { issue: { id: string } }[], sectionIndex: readonly RevisionRecheckSectionRef[]): void {
  if (value.policyDigest !== revisionTargetedPolicyDigest()) throw new Error('Revision targeted review policy is incompatible')
  const byId = new Map(value.issueVerdicts.map(item => [item.issueId, item]))
  const documentIds = value.documentVerdicts.flatMap(item => item.issueIds)
  if (byId.size !== value.issueVerdicts.length || new Set(documentIds).size !== documentIds.length || documentIds.length !== byId.size || documentIds.some(issueId => !byId.has(issueId)) || new Set(value.documentVerdicts.map(item => item.documentPath)).size !== value.documentVerdicts.length)
    throw new Error('Revision targeted public verdict coverage is inconsistent')
  for (const document of value.documentVerdicts) {
    if (documents.find(item => item.path === document.documentPath)?.digest !== document.documentDigest)
      throw new Error('Revision targeted public document verdict binding mismatch')
    const verdicts = document.issueIds.map(issueId => byId.get(issueId)!)
    const failed = verdicts.filter(item => item.status === 'FAIL').map(item => item.issueId).sort()
    const status = failed.length ? 'FAIL' : verdicts.some(item => item.status === 'NOT_CHECKED') ? 'DEFERRED' : 'PASS'
    if (document.status !== status || !same([...document.retryIssueIds].sort(), failed))
      throw new Error('Revision targeted public retention verdict is inconsistent')
  }
  const hasFailure = value.issueVerdicts.some(item => item.status === 'FAIL')
  const deterministicFailure = value.issueVerdicts.some(item => item.kind === 'deterministic' && item.status === 'FAIL')
  if ((value.decision === 'retry_same_round') !== hasFailure || value.issueVerdicts.some(item => item.kind === 'semantic' && (item.status === 'NOT_CHECKED') !== deterministicFailure))
    throw new Error('Revision targeted public decision is inconsistent')
  const remainingIds = new Set(issues.map(item => item.issue.id))
  // After active issues pass, Reviewer may publish NEW issues for the next
  // round. Those are deliberately not members of the preceding verdict set.
  for (const verdict of value.issueVerdicts) {
    if ((verdict.status !== 'PASS') !== remainingIds.has(verdict.issueId))
      throw new Error('Revision targeted remaining issue authority is inconsistent')
    if ('diagnostic' in verdict) for (const section of [...verdict.diagnostic.evidence, ...verdict.diagnostic.dependencySections]) {
      const current = sectionIndex.find(ref => ref.documentPath === section.documentPath && ref.sectionId === section.sectionId)
      if (!current || !same(current, section)) throw new Error('Revision targeted diagnostic section is stale')
    }
  }
}

/**
 * Parses and checks copied public recheck evidence. This validates only the
 * evidence contract and current byte/reference bindings; it does not run an
 * audit, inspect Reviewer state, or infer a verdict.
 */
export function validateRevisionRecheckEvidence(value: unknown, documents: readonly { path: string; digest: string }[], issues: readonly { issue: { id: string } }[], sectionIndex: readonly RevisionRecheckSectionRef[]): RevisionRecheckEvidence {
  const parsed = schema.parse(JSON.parse(revisionCanonicalJson(value)))
  if (parsed.kind === 'full_format') {
    if (parsed.policyDigest !== revisionFullFormatPolicyDigest()) throw new Error('Revision full format review policy is incompatible')
  } else {
    assertTargeted(parsed, documents, issues, sectionIndex)
  }
  return structuredClone(parsed)
}

export const revisionRecheckEvidenceSchema = schema
export const revisionTargetedEvidenceSchema = targetedSchema
export const revisionFullFormatEvidenceSchema = fullFormatSchema
