import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../../types'
import {
  loadFoundationAuditArtifacts,
  loadFoundationFactReceipt,
  publishFoundationDerivedArtifacts,
} from '../../foundation-audit-artifacts'
import {
  extractNormalizedFoundationFacts,
  mergeFoundationFactResults,
  type FoundationFactReceipt,
} from '../../foundation-fact-extraction'
import {
  digestFactStore,
  type FoundationFact,
  type FoundationFactStore,
} from '../../foundation-fact-store'

/**
 * The smallest task projection needed to consume immutable fact receipts.
 * Runtime task status is deliberately not part of this operation: a task is
 * consumable only when all of its receipt bindings are present and valid.
 */
export type FoundationReviewFactsTaskSnapshot = {
  taskId: string
  kind: 'document-facts'
  revision: string
  packetDigest: string
  terminalDigest?: string
  receiptPath?: string
  receiptDigest?: string
}

/**
 * Read-only Reviewer state required by fact finalization. This is a protocol
 * projection, rather than the persisted audit state or a delivery run.
 */
export type FoundationReviewFactsSnapshot = {
  revision: string
  status: 'facts_staged'
  documentDigests: Readonly<Record<FoundationDocumentPath, string>>
  sectionIndexDigest: string
  sectionIndexPath: string
  manifestPath: string
  tasks: readonly FoundationReviewFactsTaskSnapshot[]
}

export type FoundationReviewFactsInput = {
  workspacePath: string
  snapshot: FoundationReviewFactsSnapshot
}

export type FoundationReviewFactsDerivedBinding = {
  manifestPath: string
  manifestDigest: string
  markerPath: string
  markerDigest: string
  factStorePath: string
  factStoreDigest: string
  sectionIndexPath: string
  sectionIndexDigest: string
}

export type FoundationReviewFactsResult = {
  revision: string
  normalizedFactDigest: string
  factStore: FoundationFactStore
  derived: FoundationReviewFactsDerivedBinding
  manifestDigest: string
}

function copySnapshot(snapshot: FoundationReviewFactsSnapshot): FoundationReviewFactsSnapshot {
  return {
    revision: snapshot.revision,
    status: snapshot.status,
    documentDigests: { ...snapshot.documentDigests },
    sectionIndexDigest: snapshot.sectionIndexDigest,
    sectionIndexPath: snapshot.sectionIndexPath,
    manifestPath: snapshot.manifestPath,
    tasks: snapshot.tasks.map(task => ({
      taskId: task.taskId,
      kind: task.kind,
      revision: task.revision,
      packetDigest: task.packetDigest,
      terminalDigest: task.terminalDigest,
      receiptPath: task.receiptPath,
      receiptDigest: task.receiptDigest,
    })),
  }
}

/**
 * Finalize the Reviewer fact stage.
 *
 * The artifact loader's current public type describes its expected-state
 * projection as the persisted audit state. The object passed below contains
 * only the fields the loader actually consumes; the assertion is confined to
 * this compatibility seam and does not expose or construct a full state.
 */
export async function prepareFoundationReviewFacts(
  input: FoundationReviewFactsInput,
): Promise<FoundationReviewFactsResult> {
  const workspacePath = input.workspacePath
  const snapshot = copySnapshot(input.snapshot)
  const expectedState = {
    revision: snapshot.revision,
    status: snapshot.status,
    documentDigests: snapshot.documentDigests,
    sectionIndexDigest: snapshot.sectionIndexDigest,
    sectionIndexPath: snapshot.sectionIndexPath,
    manifestPath: snapshot.manifestPath,
  } as Parameters<typeof loadFoundationAuditArtifacts>[0]['expectedState']

  const artifacts = await loadFoundationAuditArtifacts({
    workspacePath,
    revision: snapshot.revision,
    expectedState,
  })
  if (!artifacts) throw new Error('foundation fact section index is unavailable during finalization')

  const documents = new Map(
    await Promise.all(
      CANONICAL_FOUNDATION_DOCUMENTS.map(async path =>
        [path, await readFile(join(workspacePath, path), 'utf8')] as const,
      ),
    ),
  )
  const mechanical = extractNormalizedFoundationFacts({
    documents,
    sectionIndex: artifacts.sectionIndex,
  })
  const workerFacts: FoundationFact[] = []
  const workerReceipts: FoundationFactReceipt[] = []
  for (const task of snapshot.tasks.filter(task => task.kind === 'document-facts')) {
    if (!task.receiptPath || !task.receiptDigest || !task.terminalDigest)
      throw new Error('foundation fact task receipt binding is incomplete')
    const receipt = await loadFoundationFactReceipt({
      workspacePath,
      revision: snapshot.revision,
      taskId: task.taskId,
      expectedPacketDigest: task.packetDigest,
      expectedTerminalDigest: task.terminalDigest,
      expectedReceiptPath: task.receiptPath,
      expectedReceiptDigest: task.receiptDigest,
    })
    workerFacts.push(...receipt.facts)
    workerReceipts.push(...(receipt.receipts as FoundationFactReceipt[]))
  }
  const factStore = mergeFoundationFactResults({
    mechanicalFacts: mechanical.facts,
    workerFacts,
    workerReceipts,
  })
  const normalizedFactDigest = digestFactStore(factStore)
  const published = await publishFoundationDerivedArtifacts({
    workspacePath,
    revision: snapshot.revision,
    documentDigests: artifacts.documentDigests,
    sectionIndex: artifacts.sectionIndex,
    factStore,
    normalizedFactDigest,
    manifest: artifacts.manifest as unknown as Record<string, unknown>,
  })
  const derivedRoot = `.beegame/audit/foundation/${snapshot.revision}/derived`
  const derived: FoundationReviewFactsDerivedBinding = {
    manifestPath: `${derivedRoot}/manifest.json`,
    manifestDigest: published.digests.manifest,
    markerPath: `${derivedRoot}/COMMITTED.json`,
    markerDigest: published.digests.marker,
    factStorePath: `${derivedRoot}/fact-store.json`,
    factStoreDigest: published.digests.factStore,
    sectionIndexPath: `${derivedRoot}/section-index.json`,
    sectionIndexDigest: published.digests.sectionIndex,
  }
  return {
    revision: snapshot.revision,
    normalizedFactDigest,
    factStore: structuredClone(factStore),
    derived,
    manifestDigest: published.digests.manifest,
  }
}
