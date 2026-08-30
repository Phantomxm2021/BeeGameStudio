import { describe, expect, test } from 'bun:test'
import {
  createFoundationAuditState,
  parseFoundationAuditState,
  type FoundationAuditState,
} from '../foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from '../foundation-audit-production-manifest'
import {
  foundationRevisionPacketPath,
  foundationRevisionSemanticResultPath,
} from '../foundation-revision-stage'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
} from '../foundation-semantic-audit'
import { CANONICAL_FOUNDATION_DOCUMENTS } from '../types'
import {
  projectFoundationReadyReceipt,
  type ProjectFoundationReadyReceiptInput,
} from './foundation-ready-adapter'

const DIGEST = 'a'.repeat(64)
const REVIEW_DIGEST = 'b'.repeat(64)
const REVISION = 'revision-1'
const OLD_PHASE = '2026-08-24T00:00:00.000Z'
const BRIEF_DIGEST = 'c'.repeat(64)
const USAGE = {
  input_tokens: 1,
  cache_read_tokens: 0,
  cache_creation_tokens: 0,
  completion_tokens: 1,
  total_tokens: 2,
}

function seedState(): FoundationAuditState {
  return createFoundationAuditState({
    revision: REVISION,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
      path,
      digest: DIGEST,
    })),
    manifest: {
      revision: REVISION,
      status: 'index_staged',
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      sectionIndexDigest: DIGEST,
    },
  })
}

function auditReadyState(): FoundationAuditState {
  const reviewRoot = `.beegame/audit/foundation/${REVISION}/review/${REVIEW_DIGEST}`
  const state = seedState()
  return parseFoundationAuditState({
    ...state,
    status: 'audit_ready',
    phaseStartedAt: OLD_PHASE,
    derived: {
      manifestPath: `.beegame/audit/foundation/${REVISION}/derived/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `.beegame/audit/foundation/${REVISION}/derived/COMMITTED.json`,
      markerDigest: DIGEST,
      factStorePath: `.beegame/audit/foundation/${REVISION}/derived/fact-store.json`,
      factStoreDigest: DIGEST,
      sectionIndexPath: `.beegame/audit/foundation/${REVISION}/staging/section-index.json`,
      sectionIndexDigest: DIGEST,
    },
    deterministic: {
      reviewDigest: DIGEST,
      issueRegistryPath: `.beegame/audit/foundation/${REVISION}/staging/review/issue-registry.json`,
      issueRegistryDigest: DIGEST,
      manifestPath: `.beegame/audit/foundation/${REVISION}/staging/review/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `.beegame/audit/foundation/${REVISION}/staging/review/COMMITTED.json`,
      markerDigest: DIGEST,
      catalogVersion: FOUNDATION_AUDIT_PRODUCTION_MANIFEST.catalogVersion,
      contractGraphDigest: DIGEST,
      sectionIndexDigest: DIGEST,
      factStoreDigest: DIGEST,
    },
    semantic: { aggregateUsage: USAGE },
    tasks: FOUNDATION_SEMANTIC_CHECKS.map((check, index) => ({
      taskId: `semantic-${index}`,
      kind: 'semantic' as const,
      revision: REVISION,
      checkId: check.checkId,
      packetDigest: DIGEST,
      modelTier: check.modelTier,
      status: 'completed' as const,
      attempt: 1,
      terminalDigest: DIGEST,
      usage: USAGE,
      durationMs: 1,
      dispatch: {
        dispatchId: `dispatch-semantic-${index}`,
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: `semantic-${index}`,
        revision: REVISION,
        status: 'completed' as const,
        startedAt: OLD_PHASE,
        finishedAt: OLD_PHASE,
        terminalResult: {},
      },
      admittedResult: {
        checkId: check.checkId,
        packetIdentity: DIGEST,
        outcome: 'PASS' as const,
      },
    })),
    review: {
      reviewDigest: REVIEW_DIGEST,
      issueRegistryPath: `${reviewRoot}/issue-registry.json`,
      issueRegistryDigest: REVIEW_DIGEST,
      manifestPath: `${reviewRoot}/manifest.json`,
      manifestDigest: REVIEW_DIGEST,
      markerPath: `${reviewRoot}/COMMITTED.json`,
      markerDigest: REVIEW_DIGEST,
      sectionIndexDigest: DIGEST,
      factStoreDigest: DIGEST,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  })
}

function revisionReadyState(): FoundationAuditState {
  const derivedRoot = `.beegame/audit/foundation/${REVISION}/derived`
  const taskId = 'revision-1.impacted-facts.1.0'
  const state = seedState()
  return parseFoundationAuditState({
    ...state,
    status: 'revision_ready',
    sectionIndexPath: `${derivedRoot}/section-index.json`,
    manifestPath: `${derivedRoot}/manifest.json`,
    phaseStartedAt: OLD_PHASE,
    derived: {
      manifestPath: `${derivedRoot}/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `${derivedRoot}/COMMITTED.json`,
      markerDigest: DIGEST,
      factStorePath: `${derivedRoot}/fact-store.json`,
      factStoreDigest: DIGEST,
      sectionIndexPath: `${derivedRoot}/section-index.json`,
      sectionIndexDigest: DIGEST,
    },
    authority: {
      issueAuthority: {
        kind: 'publication' as const,
        baseRevision: 'prior-review-revision',
        authorityDigest: 'd'.repeat(64),
        issueRegistryDigest: 'e'.repeat(64),
      },
      derivedDigests: {
        sectionIndex: DIGEST,
        factStore: DIGEST,
        manifest: DIGEST,
      },
      documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
        path,
        digest: DIGEST,
      })),
    },
    roundBefore: {
      documentRevision: 'prior-review-revision',
      issueRegistryDigest: REVIEW_DIGEST,
      issueAuthority: {
        kind: 'review' as const,
        reviewDigest: REVIEW_DIGEST,
        issueRegistryDigest: REVIEW_DIGEST,
      },
    },
    round: 1,
    issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    activeBundleId: 'bundle-1',
    revisionBundles: [
      {
        bundleId: 'bundle-1',
        status: 'active' as const,
        round: 1,
        baseDocumentRevision: 'prior-review-revision',
        baseDocumentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
          path,
          digest: DIGEST,
        })),
        remediationDigest: DIGEST,
        taskIds: [taskId],
        frozenTaskIds: [],
      },
    ],
    tasks: [
      {
        taskId,
        kind: 'impacted-facts' as const,
        revision: 'prior-review-revision',
        round: 1,
        packetPath: foundationRevisionPacketPath(
          'prior-review-revision',
          1,
          taskId,
        ),
        packetDigest: DIGEST,
        status: 'completed' as const,
        attempt: 1,
        terminalDigest: DIGEST,
        usage: USAGE,
        durationMs: 1,
        bundleId: 'bundle-1',
        modelTier: 'fast' as const,
        receiptPath: `${foundationRevisionPacketPath('prior-review-revision', 1, taskId).replace('/packet.json', '')}/receipt.json`,
        receiptDigest: DIGEST,
        dispatch: {
          dispatchId: `dispatch-${taskId}`,
          workerType: 'foundation-fact-extractor' as const,
          phase: 'DOCUMENT_REVIEW' as const,
          taskId,
          revision: 'prior-review-revision',
          status: 'completed' as const,
          startedAt: OLD_PHASE,
          finishedAt: OLD_PHASE,
          terminalResult: {},
        },
      },
    ],
    publication: {
      preparedPath: 'prepared',
      journalPath: 'journal',
      committedPath: 'committed',
      authorityDigest: 'd'.repeat(64),
      resultingRevision: REVISION,
      resultingIssueRegistryDigest: 'e'.repeat(64),
    },
  })
}

function input(
  state: FoundationAuditState,
): ProjectFoundationReadyReceiptInput {
  return { state, projectId: 'project-1', confirmedBriefDigest: BRIEF_DIGEST }
}

describe('Foundation READY outer adapter', () => {
  test('projects an audit-ready receipt from the current review authority', () => {
    const receipt = projectFoundationReadyReceipt(input(auditReadyState()))

    expect(receipt).toMatchObject({
      schemaVersion: 'foundation-ready-receipt.v1',
      projectId: 'project-1',
      foundationRevision: REVISION,
      confirmedBriefDigest: BRIEF_DIGEST,
      documentDigests: Object.fromEntries(
        CANONICAL_FOUNDATION_DOCUMENTS.map(path => [path, DIGEST]),
      ),
      sectionIndexPath: `.beegame/audit/foundation/${REVISION}/staging/section-index.json`,
      sectionIndexDigest: DIGEST,
      authority: {
        kind: 'review',
        reviewDigest: REVIEW_DIGEST,
        issueRegistryDigest: REVIEW_DIGEST,
      },
    })
    expect(receipt.receiptDigest).toMatch(/^[a-f0-9]{64}$/)
    expect(Object.isFrozen(receipt)).toBe(true)
    expect(Object.isFrozen(receipt.documentDigests)).toBe(true)
  })

  test('projects revision-ready authority from committed publication, not prior review', () => {
    const receipt = projectFoundationReadyReceipt(input(revisionReadyState()))

    expect(receipt.authority).toEqual({
      kind: 'revision_publication',
      baseRevision: 'prior-review-revision',
      authorityDigest: 'd'.repeat(64),
      issueRegistryDigest: 'e'.repeat(64),
    })
    expect(receipt.authority).not.toMatchObject({ reviewDigest: REVIEW_DIGEST })
  })

  test('rejects every state that is not complete, empty, and internally bound', () => {
    const audit = auditReadyState()
    expect(() =>
      projectFoundationReadyReceipt(
        input({ ...audit, status: 'index_staged' }),
      ),
    ).toThrow(/ready|status/i)
    expect(() =>
      projectFoundationReadyReceipt(
        input({ ...audit, status: 'semantic_review' }),
      ),
    ).toThrow(/ready|status/i)
    expect(() =>
      projectFoundationReadyReceipt(input({ ...audit, status: 'revising' })),
    ).toThrow()
    expect(() =>
      projectFoundationReadyReceipt(
        input({
          ...audit,
          review: {
            ...audit.review!,
            issueSummary: {
              total: 1,
              blocker: 1,
              high: 0,
              medium: 0,
              low: 0,
            },
          },
        }),
      ),
    ).toThrow(/issue|empty|zero/i)
    expect(() =>
      projectFoundationReadyReceipt(input({ ...audit, review: undefined })),
    ).toThrow(/review|authority/i)
    expect(() =>
      projectFoundationReadyReceipt(
        input({ ...audit, sectionIndexDigest: 'f'.repeat(64) }),
      ),
    ).toThrow(/section|binding/i)
    expect(() =>
      projectFoundationReadyReceipt(
        input({
          ...audit,
          documentDigests: {
            ...audit.documentDigests,
            'docs/GDD.md': undefined as unknown as string,
          },
        }),
      ),
    ).toThrow(/document|digest/i)
  })

  test('rejects caller-owned document or authority overrides', () => {
    expect(() =>
      projectFoundationReadyReceipt({
        ...input(auditReadyState()),
        documentDigests: {},
        authority: {
          kind: 'review',
          reviewDigest: DIGEST,
          issueRegistryDigest: DIGEST,
        },
      } as unknown as ProjectFoundationReadyReceiptInput),
    ).toThrow()
  })

  test('rejects an audit-ready state whose derived Section Index path is stale', () => {
    const state = auditReadyState()
    const derived = {
      ...state.derived!,
      sectionIndexPath: `.beegame/audit/foundation/${REVISION}/derived/other-index.json`,
    }
    const parserValid = parseFoundationAuditState({ ...state, derived })
    expect(parserValid.derived?.sectionIndexPath).toBe(derived.sectionIndexPath)
    expect(() => projectFoundationReadyReceipt(input(parserValid))).toThrow(
      /Section Index binding/i,
    )
  })

  test('rejects inconsistent revision publication bindings', () => {
    const state = revisionReadyState()
    expect(() =>
      projectFoundationReadyReceipt(
        input({
          ...state,
          publication: {
            ...state.publication!,
            resultingRevision: 'other-revision',
          },
        }),
      ),
    ).toThrow(/publication|revision|authority/i)
    expect(() =>
      projectFoundationReadyReceipt(
        input({
          ...state,
          authority: {
            ...state.authority!,
            documentDigests: state.authority!.documentDigests.map(
              (entry, index) =>
                index === 0 ? { ...entry, digest: 'f'.repeat(64) } : entry,
            ),
          },
        }),
      ),
    ).toThrow(/publication|authority|inconsistent/i)
    expect(() =>
      projectFoundationReadyReceipt(
        input({ ...state, publication: undefined }),
      ),
    ).toThrow(/publication|authority|metadata/i)
  })

  test('rejects a publication whose base revision diverges from round-before lineage', () => {
    const state = revisionReadyState()
    const parserValid = parseFoundationAuditState({
      ...state,
      roundBefore: {
        ...state.roundBefore!,
        documentRevision: 'different-lineage',
      },
    })
    expect(parserValid.roundBefore?.documentRevision).toBe('different-lineage')
    expect(() => projectFoundationReadyReceipt(input(parserValid))).toThrow(
      /lineage|base revision/i,
    )
  })

  test('rejects a publication whose active bundle base diverges from publication lineage', () => {
    const state = revisionReadyState()
    const bundle = state.revisionBundles![0]!
    const task = state.tasks[0]!
    if (task.kind !== 'impacted-facts')
      throw new Error('revision fixture task kind changed')
    const divergentRevision = 'different-bundle-lineage'
    const divergentTask = {
      ...task,
      revision: divergentRevision,
      packetPath: foundationRevisionPacketPath(
        divergentRevision,
        task.round,
        task.taskId,
      ),
      dispatch: task.dispatch
        ? { ...task.dispatch, revision: divergentRevision }
        : undefined,
    }
    const parserValid = parseFoundationAuditState({
      ...state,
      revisionBundles: [{ ...bundle, baseDocumentRevision: divergentRevision }],
      tasks: [divergentTask],
    })
    expect(parserValid.revisionBundles?.[0]?.baseDocumentRevision).toBe(
      divergentRevision,
    )
    expect(() => projectFoundationReadyReceipt(input(parserValid))).toThrow(
      /lineage|base revision/i,
    )
  })
})
