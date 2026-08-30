import {
  activeFoundationRevisionBundle,
  parseFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { relativeFoundationAuditArtifactPaths } from '../foundation-audit-artifacts'
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type FoundationDocumentPath,
} from '../types'
import {
  parseFoundationReadyReceipt,
  receiptDigest,
  type FoundationReadyReceipt,
} from './contracts'

export type ProjectFoundationReadyReceiptInput = Readonly<{
  state: FoundationAuditState
  projectId: string
  confirmedBriefDigest: string
}>

const INPUT_KEYS = ['confirmedBriefDigest', 'projectId', 'state'] as const

function assertInput(
  value: unknown,
): asserts value is ProjectFoundationReadyReceiptInput {
  if (!value || typeof value !== 'object')
    throw new Error('Foundation READY adapter input is required')
  const keys = Object.keys(value).sort()
  if (
    keys.length !== INPUT_KEYS.length ||
    INPUT_KEYS.some((key, index) => keys[index] !== key)
  )
    throw new Error(
      'Foundation READY adapter accepts only state, projectId, and confirmedBriefDigest',
    )
  const input = value as Record<string, unknown>
  if (
    typeof input.projectId !== 'string' ||
    input.projectId.trim().length === 0
  )
    throw new Error('Foundation READY adapter projectId is required')
  if (
    typeof input.confirmedBriefDigest !== 'string' ||
    !/^[a-f0-9]{64}$/.test(input.confirmedBriefDigest)
  )
    throw new Error(
      'Foundation READY adapter confirmedBriefDigest must be a SHA-256 digest',
    )
}

function assertZeroIssues(state: FoundationAuditState): void {
  if (!state.issueSummary || state.issueSummary.total !== 0)
    throw new Error('Foundation READY requires an empty issue Registry')
  if (
    state.issueSummary.blocker !== 0 ||
    state.issueSummary.high !== 0 ||
    state.issueSummary.medium !== 0 ||
    state.issueSummary.low !== 0
  )
    throw new Error(
      'Foundation READY issue summary is inconsistent with an empty issue Registry',
    )
}

function assertDocumentBindings(
  state: FoundationAuditState,
): Record<FoundationDocumentPath, string> {
  const entries = Object.entries(state.documentDigests)
  if (
    entries.length !== CANONICAL_FOUNDATION_DOCUMENTS.length ||
    CANONICAL_FOUNDATION_DOCUMENTS.some(
      path =>
        !entries.some(
          ([candidate, digest]) =>
            candidate === path && /^[a-f0-9]{64}$/.test(digest),
        ),
    )
  )
    throw new Error(
      'Foundation READY requires all eight canonical document digests',
    )
  return Object.fromEntries(
    CANONICAL_FOUNDATION_DOCUMENTS.map(path => [
      path,
      state.documentDigests[path],
    ]),
  ) as Record<FoundationDocumentPath, string>
}

function assertCurrentSectionIndex(state: FoundationAuditState): void {
  const derived = state.derived
  const canonicalDerivedSectionIndexPath = relativeFoundationAuditArtifactPaths(
    state.revision,
  ).sectionIndex.replace('/staging/', '/derived/')
  if (
    !derived ||
    derived.sectionIndexPath !== canonicalDerivedSectionIndexPath ||
    derived.sectionIndexDigest !== state.sectionIndexDigest ||
    !/^[a-f0-9]{64}$/.test(state.sectionIndexDigest)
  )
    throw new Error('Foundation READY Section Index binding is inconsistent')
}

function projectAuthority(
  state: FoundationAuditState,
): FoundationReadyReceipt['authority'] {
  if (state.status === 'audit_ready') {
    const review = state.review
    if (!review) throw new Error('Foundation READY review authority is missing')
    assertZeroIssues({ ...state, issueSummary: review.issueSummary })
    if (
      review.sectionIndexDigest !== state.sectionIndexDigest ||
      review.factStoreDigest !== state.derived?.factStoreDigest
    )
      throw new Error(
        'Foundation READY review authority is not bound to current derived artifacts',
      )
    return {
      kind: 'review',
      reviewDigest: review.reviewDigest,
      issueRegistryDigest: review.issueRegistryDigest,
    }
  }

  const authority = state.authority
  const publication = state.publication
  if (
    !authority ||
    authority.issueAuthority.kind !== 'publication' ||
    !publication
  )
    throw new Error(
      'Foundation READY committed revision publication authority is missing',
    )
  const issueAuthority = authority.issueAuthority
  const activeBundle = activeFoundationRevisionBundle(state)
  if (
    issueAuthority.baseRevision !== state.roundBefore?.documentRevision ||
    issueAuthority.baseRevision !== activeBundle.baseDocumentRevision
  )
    throw new Error(
      'Foundation READY revision publication base revision lineage is inconsistent',
    )
  if (
    publication.resultingRevision !== state.revision ||
    publication.authorityDigest !== issueAuthority.authorityDigest ||
    publication.resultingIssueRegistryDigest !==
      issueAuthority.issueRegistryDigest ||
    authority.derivedDigests.sectionIndex !== state.sectionIndexDigest ||
    authority.derivedDigests.factStore !== state.derived?.factStoreDigest ||
    authority.derivedDigests.manifest !== state.derived?.manifestDigest ||
    authority.documentDigests.length !==
      CANONICAL_FOUNDATION_DOCUMENTS.length ||
    CANONICAL_FOUNDATION_DOCUMENTS.some(path => {
      const matching = authority.documentDigests.filter(
        entry => entry.path === path,
      )
      return (
        matching.length !== 1 ||
        matching[0]!.digest !== state.documentDigests[path]
      )
    })
  )
    throw new Error(
      'Foundation READY revision publication authority is inconsistent',
    )
  return {
    kind: 'revision_publication',
    baseRevision: issueAuthority.baseRevision,
    authorityDigest: issueAuthority.authorityDigest,
    issueRegistryDigest: issueAuthority.issueRegistryDigest,
  }
}

export function projectFoundationReadyReceipt(
  input: ProjectFoundationReadyReceiptInput,
): FoundationReadyReceipt {
  assertInput(input)
  const state = parseFoundationAuditState(input.state)
  if (state.status !== 'audit_ready' && state.status !== 'revision_ready')
    throw new Error(
      'Foundation READY requires audit_ready or revision_ready status',
    )
  const documentDigests = assertDocumentBindings(state)
  assertCurrentSectionIndex(state)
  if (state.status === 'audit_ready') {
    if (!state.review)
      throw new Error('Foundation READY review authority is missing')
    assertZeroIssues({ ...state, issueSummary: state.review.issueSummary })
  } else {
    assertZeroIssues(state)
  }
  const withoutReceiptDigest: Omit<FoundationReadyReceipt, 'receiptDigest'> = {
    schemaVersion: 'foundation-ready-receipt.v1',
    projectId: input.projectId,
    foundationRevision: state.revision,
    confirmedBriefDigest: input.confirmedBriefDigest,
    documentDigests,
    sectionIndexPath: state.derived!.sectionIndexPath,
    sectionIndexDigest: state.sectionIndexDigest,
    authority: projectAuthority(state),
  }
  return parseFoundationReadyReceipt({
    ...withoutReceiptDigest,
    receiptDigest: receiptDigest(withoutReceiptDigest),
  })
}
