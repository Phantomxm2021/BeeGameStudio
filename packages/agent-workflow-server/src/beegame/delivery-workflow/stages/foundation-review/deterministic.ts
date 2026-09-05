import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../../types'
import {
  loadCommittedFoundationDerivedArtifacts,
  loadDeterministicFoundationReview,
  publishDeterministicFoundationReview,
  type FoundationDeterministicReview,
} from '../../foundation-audit-artifacts'
import {
  FOUNDATION_AUDIT_PRODUCTION_MANIFEST,
  runProductionDeterministicFoundationAudit,
} from '../../foundation-audit-production-manifest'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  type FoundationSemanticPacket,
} from '../../foundation-semantic-audit'
import {
  createFoundationSemanticTaskCollection,
  type FoundationSemanticTaskCollection,
} from '../../foundation-semantic-runtime'
import { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'

/**
 * The durable state binding needed by the global adapter. This is deliberately
 * structural and narrow: it is not the persisted review state envelope.
 */
export type FoundationDeterministicReviewBinding = Readonly<{
  reviewDigest: string
  issueRegistryPath: string
  issueRegistryDigest: string
  manifestPath: string
  manifestDigest: string
  markerPath: string
  markerDigest: string
  catalogVersion: string
  contractGraphDigest: string
  sectionIndexDigest: string
  factStoreDigest: string
}>

export type FoundationDerivedAuthorityBinding = Readonly<{
  manifestPath: string
  manifestDigest: string
  markerPath: string
  markerDigest: string
  factStorePath: string
  factStoreDigest: string
  sectionIndexPath: string
  sectionIndexDigest: string
}>

export type FoundationDeterministicReviewInput = Readonly<{
  workspacePath: string
  revision: string
  status: 'derived_committed' | 'deterministic_ready'
  derived?: FoundationDerivedAuthorityBinding
  deterministic?: FoundationDeterministicReviewBinding
}>

type CommittedDerivedEvidence = NonNullable<
  Awaited<ReturnType<typeof loadCommittedFoundationDerivedArtifacts>>
>

/**
 * All authority read before the durable deterministic-ready transition. The
 * nested values are independent snapshots so callers cannot mutate a loaded
 * artifact through this result or accidentally share it with another stage.
 */
export type FoundationDeterministicReviewEvidence = Readonly<{
  committed: CommittedDerivedEvidence
  review: FoundationDeterministicReview
}>

export type FoundationDeterministicReviewPreparation = Readonly<{
  workspacePath: string
  revision: string
  binding: FoundationDeterministicReviewBinding
  evidence: FoundationDeterministicReviewEvidence
}>

function sameDocumentDigests(
  left: readonly { path: string; digest: string }[],
  right: readonly { path: string; digest: string }[],
): boolean {
  return JSON.stringify([...left].sort((a, b) => a.path.localeCompare(b.path))) ===
    JSON.stringify([...right].sort((a, b) => a.path.localeCompare(b.path)))
}

function copy<T>(value: T): T {
  return structuredClone(value)
}

function snapshotDerivedBinding(
  binding: FoundationDerivedAuthorityBinding | undefined,
): FoundationDerivedAuthorityBinding | undefined {
  if (!binding) return undefined
  return {
    manifestPath: binding.manifestPath,
    manifestDigest: binding.manifestDigest,
    markerPath: binding.markerPath,
    markerDigest: binding.markerDigest,
    factStorePath: binding.factStorePath,
    factStoreDigest: binding.factStoreDigest,
    sectionIndexPath: binding.sectionIndexPath,
    sectionIndexDigest: binding.sectionIndexDigest,
  }
}

function snapshotReviewBinding(
  binding: FoundationDeterministicReviewBinding | undefined,
): FoundationDeterministicReviewBinding | undefined {
  if (!binding) return undefined
  return {
    reviewDigest: binding.reviewDigest,
    issueRegistryPath: binding.issueRegistryPath,
    issueRegistryDigest: binding.issueRegistryDigest,
    manifestPath: binding.manifestPath,
    manifestDigest: binding.manifestDigest,
    markerPath: binding.markerPath,
    markerDigest: binding.markerDigest,
    catalogVersion: binding.catalogVersion,
    contractGraphDigest: binding.contractGraphDigest,
    sectionIndexDigest: binding.sectionIndexDigest,
    factStoreDigest: binding.factStoreDigest,
  }
}

function bindingFor(
  revision: string,
  review: FoundationDeterministicReview,
): FoundationDeterministicReviewBinding {
  const reviewRoot = `.beegame/audit/foundation/${revision}/staging/review/${review.reviewDigest}`
  return {
    reviewDigest: review.reviewDigest,
    issueRegistryPath: `${reviewRoot}/issue-registry.json`,
    issueRegistryDigest: review.digests.issueRegistry,
    manifestPath: `${reviewRoot}/manifest.json`,
    manifestDigest: review.digests.manifest,
    markerPath: `${reviewRoot}/COMMITTED.json`,
    markerDigest: review.digests.marker,
    catalogVersion: review.catalogVersion,
    contractGraphDigest: review.contractGraphDigest,
    sectionIndexDigest: review.sectionIndexDigest,
    factStoreDigest: review.factStoreDigest,
  }
}

/**
 * Load the committed derived authority and either validate its existing
 * deterministic prefix or publish that prefix. No run/state mutation is
 * performed here; the caller owns the durable deterministic-ready commit.
 */
export async function prepareFoundationDeterministicReview(
  input: FoundationDeterministicReviewInput,
): Promise<FoundationDeterministicReviewPreparation> {
  // Read the narrow protocol synchronously. In particular, do not retain a
  // caller-owned binding object across the first artifact read.
  const reviewInput: FoundationDeterministicReviewInput = {
    workspacePath: input.workspacePath,
    revision: input.revision,
    status: input.status,
    derived: snapshotDerivedBinding(input.derived),
    deterministic: snapshotReviewBinding(input.deterministic),
  }
  if (!reviewInput.derived) throw new Error('committed deterministic audit inputs are unavailable')

  const committed = await loadCommittedFoundationDerivedArtifacts({
    workspacePath: reviewInput.workspacePath,
    revision: reviewInput.revision,
  })
  if (!committed) throw new Error('committed derived authority is unavailable')

  let review: FoundationDeterministicReview | undefined
  let binding: FoundationDeterministicReviewBinding
  if (reviewInput.status === 'deterministic_ready') {
    if (!reviewInput.deterministic) throw new Error('deterministic-ready state is missing immutable review binding')
    review = await loadDeterministicFoundationReview({
      workspacePath: reviewInput.workspacePath,
      revision: reviewInput.revision,
      reviewDigest: reviewInput.deterministic.reviewDigest,
    })
    if (
      !review ||
      review.revision !== reviewInput.revision ||
      review.reviewDigest !== reviewInput.deterministic.reviewDigest ||
      review.digests.issueRegistry !== reviewInput.deterministic.issueRegistryDigest ||
      review.digests.manifest !== reviewInput.deterministic.manifestDigest ||
      review.digests.marker !== reviewInput.deterministic.markerDigest ||
      review.sectionIndexDigest !== reviewInput.deterministic.sectionIndexDigest ||
      review.factStoreDigest !== reviewInput.deterministic.factStoreDigest ||
      review.sectionIndexDigest !== committed.digests.sectionIndex ||
      review.factStoreDigest !== committed.digests.factStore ||
      review.manifestDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest ||
      review.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
      review.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest ||
      reviewInput.deterministic.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
      reviewInput.deterministic.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest ||
      !sameDocumentDigests(review.documentDigests, committed.documentDigests)
    )
      throw new Error('deterministic-ready review binding is stale')
    binding = copy(reviewInput.deterministic)
  } else {
    const documents = new Map<FoundationDocumentPath, string>(
      await Promise.all(
        CANONICAL_FOUNDATION_DOCUMENTS.map(async path =>
          [path, await readFile(join(reviewInput.workspacePath, path), 'utf8')] as const,
        ),
      ),
    )
    const issues = runProductionDeterministicFoundationAudit({
      sectionIndex: committed.sectionIndex,
      factStore: committed.factStore,
      documents,
    })
    review = await publishDeterministicFoundationReview({
      workspacePath: reviewInput.workspacePath,
      revision: reviewInput.revision,
      documentDigests: committed.documentDigests,
      sectionIndex: committed.sectionIndex,
      factStore: committed.factStore,
      issues,
    })
    if (
      review.manifestDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.digest ||
      review.catalogVersion !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion ||
      review.contractGraphDigest !== FOUNDATION_AUDIT_PRODUCTION_MANIFEST.contractGraphDigest
    )
      throw new Error('deterministic review is not bound to the controller production manifest')
    binding = bindingFor(reviewInput.revision, review)
    review = await loadDeterministicFoundationReview({
      workspacePath: reviewInput.workspacePath,
      revision: reviewInput.revision,
      reviewDigest: review.reviewDigest,
    })
    if (!review) throw new Error('deterministic review prefix failed closed')
  }

  return {
    workspacePath: reviewInput.workspacePath,
    revision: reviewInput.revision,
    binding,
    evidence: {
      committed: copy(committed),
      review: copy(review),
    },
  }
}

export type FoundationSemanticWave = Readonly<{
  phaseStartedAt: string
  packets: readonly FoundationSemanticPacket[]
  collection: FoundationSemanticTaskCollection
}>

/**
 * Build the semantic packet wave and its exact ten-task seed from the same
 * immutable evidence returned by prepareFoundationDeterministicReview.
 * `phaseStartedAt` intentionally occurs after packet construction, matching
 * the former controller ordering.
 */
export async function prepareFoundationSemanticWave(
  input: FoundationDeterministicReviewPreparation,
): Promise<FoundationSemanticWave> {
  // Snapshot all nested evidence once before packet construction begins. The
  // semantic wave is bound to this preparation and cannot accept an alternate
  // workspace or revision alongside it.
  const preparation = {
    workspacePath: input.workspacePath,
    revision: input.revision,
    binding: snapshotReviewBinding(input.binding)!,
    evidence: {
      committed: copy(input.evidence.committed),
      review: copy(input.evidence.review),
    },
  }
  const { workspacePath, revision } = preparation
  const committed = preparation.evidence.committed
  const review = preparation.evidence.review
  const deterministicIssues = requireSectionAuditIssues(review.issues)
  const semanticPackets = await Promise.all(
    FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks.map(check =>
      buildSemanticPacketFor({
        workspacePath,
        revision,
        checkId: check.checkId,
        sectionIndex: committed.sectionIndex,
        factStore: committed.factStore,
        deterministicReviewDigest: review.reviewDigest,
        deterministicIssuePrefix: deterministicIssues,
        documentDigests: committed.documentDigests,
      }),
    ),
  )
  if (semanticPackets.length !== 10) throw new Error('semantic authority did not return exactly ten checks')

  const phaseStartedAt = new Date().toISOString()
  const collection = createFoundationSemanticTaskCollection({
    revision,
    phaseStartedAt,
    tasks: semanticPackets.map((packet, index) => ({
      taskId: `${revision}:semantic:${index}:${packet.identity.slice(0, 12)}`,
      kind: 'semantic' as const,
      revision,
      checkId: packet.checkId,
      packetDigest: packet.identity,
      modelTier: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.checks[index]!.modelTier,
      status: 'pending' as const,
      attempt: 0,
    })),
  })
  return {
    phaseStartedAt,
    packets: copy(semanticPackets),
    collection: copy(collection),
  }
}
