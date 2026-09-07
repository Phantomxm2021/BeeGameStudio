import { createHash } from 'node:crypto'
import { prepareFoundationReview, type ReviewDocumentInput } from './prepare-review'
import { prepareReviewerSemanticInput } from './semantic-input'
import type { ReviewerJournalState } from './review-state'
import { buildFoundationSemanticPacket, admitFoundationSemanticResult, digestFoundationSemanticResult,
  semanticResultToFoundationIssueDrafts, FOUNDATION_SEMANTIC_AUDIT_MANIFEST } from './domain/foundation-semantic-audit'
import { foundationSemanticTasksComplete } from './domain/foundation-semantic-runtime'
import { compileFoundationIssueRegistry } from './domain/foundation-audit-check-definitions'
import { mergeExactFoundationReviewIssues } from './domain/foundation-final-issue-merge'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './domain/foundation-audit-production-manifest'
import type { FoundationReviewIssue } from './domain/foundation-issue-registry'
import type { FoundationFact } from './domain/foundation-fact-store'
import { reviewerRepairEvidenceKeys } from './repair-evidence'

export function reviewerCanonicalJson(value: unknown): string {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value)
  if (Array.isArray(value)) return '[' + value.map(reviewerCanonicalJson).join(',') + ']'
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype)
    return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + reviewerCanonicalJson((value as Record<string, unknown>)[key])).join(',') + '}'
  throw new Error('review evidence must be finite JSON data')
}
export const reviewerDigest = (value: unknown) => createHash('sha256').update(reviewerCanonicalJson(value)).digest('hex')
export const reviewerPolicyDigest = () => reviewerDigest({ deterministic: FOUNDATION_AUDIT_PRODUCTION_MANIFEST, semantic: FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  finalization: 'all-issues-require-repair.v1', format: 'frozen-complete-foundation-markdown.v1', semanticEvidence: 'supporting-section-keys.v1' })

export type ReviewerIssueEvidence = { issue: FoundationReviewIssue; facts: FoundationFact[]; sections: { path: string; sectionId?: string; content: string; digest: string }[] }
export type ReviewerSummary = {
  version: 'foundation-review-summary.v1'
  inputDigest: string
  kind: 'passed' | 'issues_found'
  policyDigest: string
  issues: ReviewerIssueEvidence[]
  issueRegistryDigest: string
  evidenceDigest: string
}

/** Reusable only within Reviewer: exact current evidence for a public issue registry. */
export function buildReviewerIssueEvidence(documents: readonly ReviewDocumentInput[], issues: readonly FoundationReviewIssue[], facts: readonly FoundationFact[]): ReviewerIssueEvidence[] {
  return structuredClone(issues.map(issue => {
    const refs = [issue.source, ...('target' in issue && issue.target ? [issue.target] : []), ...('supportingSections' in issue && issue.supportingSections ? issue.supportingSections : [])]
    const sections = refs.map(ref => {
      const content = documents.find(item => item.path === ref.documentPath)?.content
      if (content === undefined) throw new Error('review issue document is missing')
      const text = 'sectionId' in ref ? content.split('\n').slice(ref.startLine - 1, ref.endLine).join('\n') : content
      const digest = createHash('sha256').update(text).digest('hex')
      if (digest !== ref.digest) throw new Error('review issue evidence no longer matches original bytes')
      return { path: ref.documentPath, ...('sectionId' in ref ? { sectionId: ref.sectionId } : {}), content: text, digest }
    })
    const repairKeys = new Set<string>(reviewerRepairEvidenceKeys(issue))
    return { issue, sections, facts: facts.filter(fact => repairKeys.has(fact.key)) }
  }))
}

/** Final business conclusion, derived only from replayed receipts and original input. */
export function summarizeReviewer(documents: readonly ReviewDocumentInput[], state: ReviewerJournalState): ReviewerSummary {
  const prepared = prepareFoundationReview(documents)
  if (prepared.snapshot.digest !== state.inputDigest) throw new Error('review summary input binding mismatch')
  let issues: FoundationReviewIssue[]
  let facts: readonly FoundationFact[] = []
  let ledger: unknown[] = []
  let deterministicDigest: string | null = null
  if (prepared.kind === 'format_issues') {
    if (state.phase !== 'format_issues' || state.semantic) throw new Error('format summary state is inconsistent')
    issues = [...prepared.formatIssues]
  } else {
    const semantic = state.semantic
    if (!semantic || semantic.phase !== 'semantic_staged' || !foundationSemanticTasksComplete(semantic.collection))
      throw new Error('review summary requires every semantic and confirmation receipt')
    const derived = prepareReviewerSemanticInput(documents, state)
    facts = derived.factStore
    deterministicDigest = derived.deterministicReviewDigest
    const sourceTasks = semantic.collection.tasks.filter(task => task.kind === 'semantic')
    const drafts = []
    for (const source of sourceTasks) {
      const packet = buildFoundationSemanticPacket(derived.packets.find(item => item.checkId === source.checkId)!)
      if (source.packetDigest !== packet.identity || !source.receiptPath || !source.receiptDigest) throw new Error('review source receipt binding is incomplete')
      const admitted = admitFoundationSemanticResult(packet, semantic.results[source.taskId])
      const confirmation = semantic.collection.tasks.find(task => task.kind === 'confirmation' && task.sourceTaskId === source.taskId)
      const needsConfirmation = admitted.outcome === 'UNDECIDABLE' || FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.find(check => check.checkId === source.checkId)!.severity === 'BLOCKER'
      if (needsConfirmation !== Boolean(confirmation)) throw new Error('review confirmation coverage differs from service policy')
      const final = confirmation ? admitFoundationSemanticResult(packet, semantic.results[confirmation.taskId]) : admitted
      if (confirmation && (confirmation.packetDigest !== packet.identity || !confirmation.receiptDigest || !confirmation.receiptPath)) throw new Error('review confirmation receipt binding is incomplete')
      if (final.outcome === 'UNDECIDABLE') throw new Error('review confirmation is still undecidable')
      drafts.push(...semanticResultToFoundationIssueDrafts(packet, final))
      ledger.push({ checkId: source.checkId, packetIdentity: packet.identity, sourceDigest: digestFoundationSemanticResult(admitted),
        ...(confirmation ? { confirmationDigest: digestFoundationSemanticResult(final) } : {}) })
    }
    const semanticIssues = compileFoundationIssueRegistry({ sectionIndex: derived.packets[0]!.sectionIndex, factStore: facts, drafts })
    issues = mergeExactFoundationReviewIssues([...derived.issues, ...semanticIssues])
  }
  issues.sort((left, right) => left.id.localeCompare(right.id))
  const evidence = buildReviewerIssueEvidence(documents, issues, facts)
  const policyDigest = reviewerPolicyDigest()
  const summary: ReviewerSummary = { version: 'foundation-review-summary.v1', inputDigest: state.inputDigest, kind: issues.length ? 'issues_found' : 'passed',
    policyDigest, issues: structuredClone(evidence), issueRegistryDigest: reviewerDigest(issues), evidenceDigest: reviewerDigest({ deterministicDigest, ledger }) }
  return structuredClone(summary)
}
