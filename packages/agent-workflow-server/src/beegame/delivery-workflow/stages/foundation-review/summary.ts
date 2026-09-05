import {
  loadCommittedFoundationDerivedArtifacts,
  loadDeterministicFoundationReview,
  publishFoundationSemanticReview,
  type FoundationFinalReview,
} from '../../foundation-audit-artifacts'
import { summarizeFoundationIssues, type FoundationIssueSummary, type FoundationRevisionAuthority } from '../../foundation-audit-state'
import { compileFoundationIssueRegistry } from '../../foundation-audit-check-definitions'
import { FOUNDATION_SEMANTIC_AUDIT_MANIFEST, digestFoundationSemanticResult, semanticResultToFoundationIssueDrafts, type FoundationSemanticResult } from '../../foundation-semantic-audit'
import { buildSemanticPacketFor, requireSectionAuditIssues } from './packets'
import { mergeExactFoundationReviewIssues } from '../../foundation-final-issue-merge'
import { evaluateFoundationRevisionRoundPolicy } from '../../foundation-revision-round-policy'
import type { FoundationDerivedAuthorityBinding, FoundationDeterministicReviewBinding } from './deterministic'
import type { FoundationDocumentPath } from '../../types'

/**
 * The semantic task evidence needed to close a Reviewer wave.  Dispatch,
 * usage, and terminal transport details remain global/runtime concerns and
 * are intentionally not accepted by this operation.
 */
export type FoundationReviewSummaryTask = Readonly<{
  taskId: string
  kind: 'semantic' | 'confirmation'
  revision: string
  checkId: string
  packetDigest: string
  status: string
  sourceTaskId?: string
  admittedResult?: FoundationSemanticResult
}>

export type FoundationReviewSummarySnapshot = Readonly<{
  revision: string
  derived?: FoundationDerivedAuthorityBinding
  deterministic?: FoundationDeterministicReviewBinding
  tasks: readonly FoundationReviewSummaryTask[]
}>

export type FoundationReviewSummaryInput = Readonly<{
  workspacePath: string
  snapshot: FoundationReviewSummarySnapshot
}>

export type FoundationReviewSummaryBinding = Readonly<{
  reviewDigest: string
  issueRegistryPath: string
  issueRegistryDigest: string
  manifestPath: string
  manifestDigest: string
  markerPath: string
  markerDigest: string
  sectionIndexDigest: string
  factStoreDigest: string
  semanticManifestDigest: string
  issueSummary: FoundationIssueSummary
}>

export type FoundationReviewSummaryResult =
  | Readonly<{
      kind: 'proceed'
      review: FoundationReviewSummaryBinding
    }>
  | Readonly<{
      kind: 'revision-required'
      review: FoundationReviewSummaryBinding
      authority: FoundationRevisionAuthority
      roundBefore: {
        documentRevision: string
        issueRegistryDigest: string
        issueAuthority: FoundationRevisionAuthority['issueAuthority']
      }
      round: 1
      phaseStartedAt: string
    }>

function copy<T>(value: T): T {
  return structuredClone(value)
}

/**
 * Snapshot the complete public protocol before the first artifact read.
 * Every nested mutable value used after an await is copied explicitly; in
 * particular, semantic issue drafts are never retained from caller-owned
 * task objects.
 */
function copyInput(input: FoundationReviewSummaryInput): FoundationReviewSummaryInput {
  return {
    workspacePath: input.workspacePath,
    snapshot: {
      revision: input.snapshot.revision,
      ...(input.snapshot.derived ? { derived: {
        manifestPath: input.snapshot.derived.manifestPath,
        manifestDigest: input.snapshot.derived.manifestDigest,
        markerPath: input.snapshot.derived.markerPath,
        markerDigest: input.snapshot.derived.markerDigest,
        factStorePath: input.snapshot.derived.factStorePath,
        factStoreDigest: input.snapshot.derived.factStoreDigest,
        sectionIndexPath: input.snapshot.derived.sectionIndexPath,
        sectionIndexDigest: input.snapshot.derived.sectionIndexDigest,
      } } : {}),
      ...(input.snapshot.deterministic ? { deterministic: {
        reviewDigest: input.snapshot.deterministic.reviewDigest,
        issueRegistryPath: input.snapshot.deterministic.issueRegistryPath,
        issueRegistryDigest: input.snapshot.deterministic.issueRegistryDigest,
        manifestPath: input.snapshot.deterministic.manifestPath,
        manifestDigest: input.snapshot.deterministic.manifestDigest,
        markerPath: input.snapshot.deterministic.markerPath,
        markerDigest: input.snapshot.deterministic.markerDigest,
        catalogVersion: input.snapshot.deterministic.catalogVersion,
        contractGraphDigest: input.snapshot.deterministic.contractGraphDigest,
        sectionIndexDigest: input.snapshot.deterministic.sectionIndexDigest,
        factStoreDigest: input.snapshot.deterministic.factStoreDigest,
      } } : {}),
      tasks: input.snapshot.tasks.map(task => ({
        taskId: task.taskId,
        kind: task.kind,
        revision: task.revision,
        checkId: task.checkId,
        packetDigest: task.packetDigest,
        status: task.status,
        ...(task.sourceTaskId !== undefined ? { sourceTaskId: task.sourceTaskId } : {}),
        ...(task.admittedResult !== undefined ? { admittedResult: copy(task.admittedResult) } : {}),
      })),
    },
  }
}

function reviewBinding(
  review: FoundationFinalReview,
  issueSummary: FoundationIssueSummary,
): FoundationReviewSummaryBinding {
  const reviewRoot = `.beegame/audit/foundation/${review.revision}/review/${review.reviewDigest}`
  return {
    reviewDigest: review.reviewDigest,
    issueRegistryPath: `${reviewRoot}/issue-registry.json`,
    issueRegistryDigest: review.digests.issueRegistry,
    manifestPath: `${reviewRoot}/manifest.json`,
    manifestDigest: review.digests.manifest,
    markerPath: `${reviewRoot}/COMMITTED.json`,
    markerDigest: review.digests.marker,
    sectionIndexDigest: review.sectionIndexDigest,
    factStoreDigest: review.factStoreDigest,
    semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
    issueSummary: copy(issueSummary),
  }
}

/**
 * Close the semantic Reviewer wave and publish its final issue registry.
 * This is pure stage business plus the existing artifact publication
 * protocol; it does not acquire locks, mutate a run, or resume dispatch.
 */
export async function prepareFoundationReviewSummary(
  input: FoundationReviewSummaryInput,
): Promise<FoundationReviewSummaryResult> {
  const captured = copyInput(input)
  const { workspacePath, snapshot } = captured
  if (!snapshot.derived || !snapshot.deterministic)
    throw new Error('semantic finalization requires deterministic and derived bindings')

  const committed = await loadCommittedFoundationDerivedArtifacts({ workspacePath, revision: snapshot.revision })
  const prefix = await loadDeterministicFoundationReview({
    workspacePath,
    revision: snapshot.revision,
    reviewDigest: snapshot.deterministic.reviewDigest,
  })
  if (!committed || !prefix) throw new Error('semantic finalization immutable inputs are unavailable')

  const runtimeTasks = snapshot.tasks
  const sourceTasks = runtimeTasks.filter(task => task.kind === 'semantic')
  if (sourceTasks.length !== 10 || sourceTasks.some(task => !task.admittedResult || task.status !== 'completed'))
    throw new Error('semantic finalization requires every source result')

  const deterministicIssues = requireSectionAuditIssues(prefix.issues)
  const resultLedger: { checkId: string; packetIdentity: string; admittedResultDigest: string; confirmationDigest?: string }[] = []
  const semanticDrafts = []
  for (const task of sourceTasks) {
    const packet = await buildSemanticPacketFor({
      workspacePath,
      revision: snapshot.revision,
      checkId: task.checkId,
      sectionIndex: committed.sectionIndex,
      factStore: committed.factStore,
      deterministicReviewDigest: prefix.reviewDigest,
      deterministicIssuePrefix: deterministicIssues,
      documentDigests: committed.documentDigests,
    })
    const confirmation = runtimeTasks.find(candidate => candidate.kind === 'confirmation' && candidate.sourceTaskId === task.taskId)
    const admitted = (confirmation?.admittedResult ?? task.admittedResult) as FoundationSemanticResult
    if (admitted.outcome === 'UNDECIDABLE') throw new Error('semantic confirmation remained undecidable')
    semanticDrafts.push(...semanticResultToFoundationIssueDrafts(packet, admitted))
    resultLedger.push({
      checkId: task.checkId,
      packetIdentity: packet.identity,
      admittedResultDigest: digestFoundationSemanticResult(task.admittedResult!),
      ...(confirmation?.admittedResult ? { confirmationDigest: digestFoundationSemanticResult(confirmation.admittedResult) } : {}),
    })
  }

  const semanticIssues = compileFoundationIssueRegistry({
    sectionIndex: committed.sectionIndex,
    factStore: committed.factStore,
    drafts: semanticDrafts,
  })
  const issues = mergeExactFoundationReviewIssues([...deterministicIssues, ...semanticIssues])
  const review = await publishFoundationSemanticReview({
    workspacePath,
    revision: snapshot.revision,
    documentDigests: committed.documentDigests,
    sectionIndexDigest: committed.digests.sectionIndex,
    factStoreDigest: committed.digests.factStore,
    deterministicReviewDigest: prefix.reviewDigest,
    semanticManifest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
    semanticResultDigests: resultLedger,
    issues,
  })
  const issueSummary = summarizeFoundationIssues(review.issues)
  const binding = reviewBinding(review, issueSummary)
  const policy = evaluateFoundationRevisionRoundPolicy({ phase: 'plan', round: 1, issues: review.issues })
  if (policy.status === 'proceed') return { kind: 'proceed', review: binding }

  const authority: FoundationRevisionAuthority = {
    issueAuthority: {
      kind: 'review',
      reviewDigest: review.reviewDigest,
      issueRegistryDigest: review.digests.issueRegistry,
    },
    derivedDigests: {
      sectionIndex: committed.digests.sectionIndex,
      factStore: committed.digests.factStore,
      manifest: committed.digests.manifest,
    },
    documentDigests: copy(committed.documentDigests) as Array<{ path: FoundationDocumentPath; digest: string }>,
  }
  const phaseStartedAt = new Date().toISOString()
  return {
    kind: 'revision-required',
    review: binding,
    authority,
    roundBefore: {
      documentRevision: snapshot.revision,
      issueRegistryDigest: review.digests.issueRegistry,
      issueAuthority: copy(authority.issueAuthority),
    },
    round: 1,
    phaseStartedAt,
  }
}
