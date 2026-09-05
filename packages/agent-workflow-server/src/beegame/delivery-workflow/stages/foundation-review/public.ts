import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { CANONICAL_FOUNDATION_DOCUMENTS, type FoundationDocumentPath, type FoundationAuditState, type FoundationAuthoringStatus } from '../../types'
import { deriveFoundationAuditArtifacts, publishFoundationDerivedArtifacts, publishDeterministicFoundationReview, writeFoundationFactPacket } from '../../foundation-audit-artifacts'
import { createFoundationAuditState, summarizeFoundationIssues } from '../../foundation-audit-state'
import { auditFoundationDocumentFormats } from '../../foundation-document-format-review'
import { createFoundationFactStore, digestFactStore } from '../../foundation-fact-store'
import { extractNormalizedFoundationFacts, buildFoundationFactPackets } from '../../foundation-fact-extraction'

export interface FoundationReviewEntryInput {
  workspacePath: string
  revision: string
  checkpoints: readonly { path: FoundationDocumentPath; status: FoundationAuthoringStatus }[]
}

export type FoundationReviewEntryResult =
  | { kind: 'review-ready' | 'revision-required'; state: FoundationAuditState }
  | { kind: 'failed'; reason: string }

export async function enterFoundationReview(
  input: FoundationReviewEntryInput,
): Promise<FoundationReviewEntryResult> {
  const { workspacePath, revision } = input
  const checkpoints = input.checkpoints.map(({ path, status }) => ({ path, status }))
  try {
    const documents = new Map<FoundationDocumentPath, string>()
    for (const path of CANONICAL_FOUNDATION_DOCUMENTS) {
      try {
        documents.set(path, await readFile(join(workspacePath, path), 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT')
          throw new Error(`committed foundation document is missing: ${path}`)
        throw error
      }
    }
    const formatIssues = auditFoundationDocumentFormats({ documents })
    const artifacts = await deriveFoundationAuditArtifacts({
      workspacePath,
      revision,
      checkpoints,
      documents,
      ...(formatIssues.length ? { sectionIndex: [] } : {}),
    })
    if (formatIssues.length) {
      const factStore = createFoundationFactStore([])
      const derived = await publishFoundationDerivedArtifacts({
        workspacePath,
        revision: artifacts.revision,
        documentDigests: artifacts.documentDigests,
        sectionIndex: [],
        factStore,
        normalizedFactDigest: digestFactStore(factStore),
        manifest: artifacts.manifest as unknown as Record<string, unknown>,
      })
      const review = await publishDeterministicFoundationReview({
        workspacePath,
        revision: artifacts.revision,
        documentDigests: artifacts.documentDigests,
        sectionIndex: [],
        factStore,
        issues: formatIssues,
      })
      const baseState = createFoundationAuditState({ revision: artifacts.revision, documentDigests: artifacts.documentDigests, manifest: artifacts.manifest })
      const issueAuthority = { kind: 'format_review' as const, reviewDigest: review.reviewDigest, issueRegistryDigest: review.digests.issueRegistry }
      const authority = {
        issueAuthority,
        derivedDigests: { sectionIndex: derived.digests.sectionIndex, factStore: derived.digests.factStore, manifest: derived.digests.manifest },
        documentDigests: derived.documentDigests,
      }
      const derivedRoot = `.beegame/audit/foundation/${artifacts.revision}/derived`
      return {
        kind: 'revision-required',
        state: {
          ...baseState,
          status: 'planning',
          phaseStartedAt: new Date().toISOString(),
          derived: {
            manifestPath: `${derivedRoot}/manifest.json`,
            manifestDigest: derived.digests.manifest,
            markerPath: `${derivedRoot}/COMMITTED.json`,
            markerDigest: derived.digests.marker,
            factStorePath: `${derivedRoot}/fact-store.json`,
            factStoreDigest: derived.digests.factStore,
            sectionIndexPath: `${derivedRoot}/section-index.json`,
            sectionIndexDigest: derived.digests.sectionIndex,
          },
          authority,
          roundBefore: { documentRevision: artifacts.revision, issueRegistryDigest: review.digests.issueRegistry, issueAuthority },
          round: 1,
          issueSummary: summarizeFoundationIssues(formatIssues),
          tasks: [],
        },
      }
    }
    const extraction = extractNormalizedFoundationFacts({ documents, sectionIndex: artifacts.sectionIndex })
    const packets = buildFoundationFactPackets({ revision: artifacts.revision, documents, sectionIndex: artifacts.sectionIndex, unresolvedKeys: extraction.unresolvedKeys })
    const phaseStartedAt = new Date().toISOString()
    const baseState = createFoundationAuditState({ revision: artifacts.revision, documentDigests: artifacts.documentDigests, manifest: artifacts.manifest })
    const tasks = packets.map((packet, index) => ({ taskId: `${artifacts.revision}:fact:${index}:${packet.packetDigest.slice(0, 12)}`, kind: 'document-facts' as const, revision: artifacts.revision, packetDigest: packet.packetDigest, factKeyCount: packet.keys.length, modelTier: 'fast' as const, status: 'pending' as const, attempt: 0 }))
    for (const [index, packet] of packets.entries()) await writeFoundationFactPacket({ workspacePath, revision: artifacts.revision, taskId: tasks[index]!.taskId, packet })
    let nextState: FoundationAuditState = { ...baseState, status: packets.length ? ('extracting_facts' as const) : ('facts_staged' as const), tasks, phaseStartedAt }
    return {
      kind: 'review-ready',
      state: nextState,
    }
  } catch (error) {
    return {
      kind: 'failed',
      reason: `foundation audit derivation failed: ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}
export { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'
export { resumeFoundationReview, mayIgnoreDuplicateFoundationReviewDispatch, type FoundationReviewDuplicateDispatchContext, type FoundationReviewScheduleResult, type FoundationReviewSchedulingPorts } from './scheduler'
export { projectReviewSchedulingTask, projectReviewSchedulingUsage, type FoundationReviewSchedulingContext } from './context'
