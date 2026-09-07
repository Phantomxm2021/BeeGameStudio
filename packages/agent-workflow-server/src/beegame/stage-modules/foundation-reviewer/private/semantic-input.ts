import { createHash } from 'node:crypto'
import { prepareFoundationReview, type ReviewDocumentInput } from './prepare-review'
import type { ReviewerFactState } from './fact-state'
import { mergeFoundationFactResults, validateFoundationFactResults } from './domain/foundation-fact-extraction'
import { runProductionDeterministicFoundationAudit } from './domain/foundation-audit-production-manifest'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, type FoundationSemanticPacketInput } from './domain/foundation-semantic-audit'
import { digestSectionIndex } from './domain/foundation-section-index'
import { digestFactStore } from './domain/foundation-fact-store'

/** Derived only from replayed, admitted fact terminals and the original bytes. */
export function prepareReviewerSemanticInput(documents: readonly ReviewDocumentInput[], facts: ReviewerFactState) {
  const prepared = prepareFoundationReview(documents)
  if (prepared.kind !== 'facts_pending' || facts.phase !== 'facts_staged' || facts.inputDigest !== prepared.snapshot.digest ||
    facts.collection.tasks.length !== prepared.factPackets.length)
    throw new Error('semantic review requires all bound fact receipts')
  const admitted = prepared.factPackets.map((packet, index) => {
    const task = facts.collection.tasks[index]!
    if (task.taskId !== `fact-${index}` || task.status !== 'completed' || task.packetDigest !== packet.packetDigest ||
      task.dispatch?.status !== 'completed' || !task.receiptPath || !task.receiptDigest || !task.terminalDigest)
      throw new Error('semantic review fact receipt is incomplete')
    const results = task.dispatch.terminalResult?.results
    if (!Array.isArray(results)) throw new Error('semantic review fact terminal has no results')
    return validateFoundationFactResults({ packet, expectedRevision: prepared.snapshot.digest,
      documents: new Map(documents.map(item => [item.path, item.content])), sectionIndex: prepared.sectionIndex, results })
  })
  const factStore = mergeFoundationFactResults({ mechanicalFacts: prepared.extraction.facts,
    workerFacts: admitted.flatMap(item => item.facts), workerReceipts: admitted.flatMap(item => item.receipts) })
  const issues = runProductionDeterministicFoundationAudit({ sectionIndex: prepared.sectionIndex, factStore })
  const sectionBytes = Object.fromEntries(prepared.sectionIndex.map(section => {
    const content = prepared.snapshot.documents.find(item => item.path === section.documentPath)!.content
    return [`${section.documentPath}#${section.sectionId}`, content.split('\n').slice(section.startLine - 1, section.endLine).join('\n')]
  }))
  const deterministicReviewDigest = createHash('sha256').update(JSON.stringify({
    version: 'reviewer-deterministic-prefix.v1', revision: prepared.snapshot.digest,
    sectionIndexDigest: digestSectionIndex(prepared.sectionIndex), factStoreDigest: digestFactStore(factStore),
    manifest: prepared.manifest, issues,
  })).digest('hex')
  const packets: FoundationSemanticPacketInput[] = FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check => ({
    revision: prepared.snapshot.digest, checkId: check.checkId, sectionIndex: prepared.sectionIndex,
    sectionBytes, factStore, deterministicIssuePrefix: issues, deterministicReviewDigest,
  }))
  return { packets, deterministicReviewDigest, issues, factStore }
}
