import { createHash } from 'node:crypto'
import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import {
  createFoundationAuditState,
  parseFoundationAuditState,
  type FoundationAuditState,
} from './foundation-audit-state'
import { FOUNDATION_AUDIT_PRODUCTION_MANIFEST } from './foundation-audit-production-manifest'
import {
  foundationRevisionPacketPath,
  foundationRevisionSemanticResultPath,
  foundationRevisionStagePath,
} from './foundation-revision-stage'
import {
  FOUNDATION_SEMANTIC_AUDIT_MANIFEST,
  FOUNDATION_SEMANTIC_CHECKS,
} from './foundation-semantic-audit'
import { transitionDeliveryRun } from './transition'
import { CANONICAL_FOUNDATION_DOCUMENTS, type DeliveryRun } from './types'
import { beginParallelFoundationAuthoring } from './foundation-authoring-batch'
import type { AuditIssue } from './foundation-issue-registry'

const DIGEST = 'a'.repeat(64)
const REVISION = 'rev-1'
const OLD_PHASE = '2026-08-24T00:00:00.000Z'
const MODEL_REASON = 'foundation fact fast model is not configured'
const USAGE = {
  input_tokens: 11,
  cache_read_tokens: 7,
  cache_creation_tokens: 3,
  completion_tokens: 19,
  total_tokens: 40,
}

function auditState(
  overrides: Partial<
    Extract<FoundationAuditState['tasks'][number], { kind: 'document-facts' }>
  > = {},
  includeSecondTask = true,
): FoundationAuditState {
  const seed = createFoundationAuditState({
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
  return parseFoundationAuditState({
    ...seed,
    status: 'extracting_facts',
    phaseStartedAt: OLD_PHASE,
    aggregateUsage: USAGE,
    tasks: [
      {
        taskId: 'facts-0',
        kind: 'document-facts',
        revision: REVISION,
        packetDigest: DIGEST,
        factKeyCount: 1,
        modelTier: 'fast',
        status: 'needs_action',
        attempt: 0,
        failureReason: MODEL_REASON,
        ...overrides,
      },
      ...(includeSecondTask
        ? [
            {
              taskId: 'facts-1',
              kind: 'document-facts',
              revision: REVISION,
              packetDigest: DIGEST,
              factKeyCount: 1,
              modelTier: 'fast',
              status: 'needs_action',
              attempt: 0,
              failureReason: MODEL_REASON,
            },
          ]
        : []),
    ],
  })
}

function auditRun(state: FoundationAuditState): DeliveryRun {
  return {
    ...createTestDeliveryRun({
      projectId: 'transition-retry',
      ownerId: 'transition-owner',
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    blockedReason: 'foundation worker needs attention',
    foundationAuditState: state,
  }
}

test('retry revives only the selected failed foundation document', () => {
  const failedPath = 'docs/ASSET_PLAN.md' as const
  const draftState = beginParallelFoundationAuthoring(['docs/GDD.md'])
  const run: DeliveryRun = {
    ...createTestDeliveryRun({
      projectId: 'draft-retry',
      ownerId: 'draft-owner',
    }),
    phase: 'DOCUMENT_DRAFTING',
    documentStep: 'FOUNDATION_DRAFTING',
    status: 'needs_action',
    blockedReason: 'document transport failed',
    foundationDraftState: {
      ...draftState,
      documents: draftState.documents!.map(document =>
        document.path === failedPath
          ? {
              ...document,
              status: 'needs_action' as const,
              failureReason: 'document transport failed',
            }
          : document,
      ),
    },
  }

  const retried = transitionDeliveryRun(run, {
    type: 'retry',
    taskId: failedPath,
  })

  expect(retried).toMatchObject({ status: 'running', blockedReason: undefined })
  expect(
    retried.foundationDraftState.documents?.find(
      document => document.path === failedPath,
    ),
  ).toMatchObject({
    status: 'pending',
    dispatch: undefined,
    failureReason: undefined,
  })
  expect(
    retried.foundationDraftState.documents?.find(
      document => document.path === 'docs/BALANCE_DESIGN.md',
    )?.status,
  ).toBe('pending')
})

function semanticAuditState(
  overrides: Partial<
    Extract<FoundationAuditState['tasks'][number], { kind: 'semantic' }>
  > = {},
): FoundationAuditState {
  const seed = createFoundationAuditState({
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
  return parseFoundationAuditState({
    ...seed,
    status: 'semantic_review',
    phaseStartedAt: OLD_PHASE,
    derived: {
      manifestPath: `.beegame/audit/foundation/${REVISION}/derived/manifest.json`,
      manifestDigest: DIGEST,
      markerPath: `.beegame/audit/foundation/${REVISION}/derived/COMMITTED.json`,
      markerDigest: DIGEST,
      factStorePath: `.beegame/audit/foundation/${REVISION}/derived/fact-store.json`,
      factStoreDigest: DIGEST,
      sectionIndexPath: `.beegame/audit/foundation/${REVISION}/derived/section-index.json`,
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
      status: index === 0 ? ('needs_action' as const) : ('pending' as const),
      attempt: 0,
      ...(index === 0 ? overrides : {}),
    })),
  })
}

function auditReadyState(): FoundationAuditState {
  const reviewDigest = 'b'.repeat(64)
  const reviewRoot = `.beegame/audit/foundation/${REVISION}/review/${reviewDigest}`
  const state = semanticAuditState()
  return parseFoundationAuditState({
    ...state,
    status: 'audit_ready',
    tasks: state.tasks.map(task => {
      if (task.kind !== 'semantic')
        throw new Error('audit-ready fixture requires semantic tasks')
      return {
        ...task,
        status: 'completed' as const,
        attempt: 1,
        terminalDigest: DIGEST,
        usage: USAGE,
        durationMs: 1,
        dispatch: {
          dispatchId: `dispatch-${task.taskId}`,
          workerType: 'foundation-semantic-reviewer' as const,
          phase: 'DOCUMENT_REVIEW' as const,
          taskId: task.taskId,
          revision: REVISION,
          status: 'completed' as const,
          startedAt: OLD_PHASE,
          finishedAt: OLD_PHASE,
          terminalResult: {},
        },
        admittedResult: {
          checkId: task.checkId,
          packetIdentity: DIGEST,
          outcome: 'PASS' as const,
        },
      }
    }),
    review: {
      reviewDigest,
      issueRegistryPath: `${reviewRoot}/issue-registry.json`,
      issueRegistryDigest: reviewDigest,
      manifestPath: `${reviewRoot}/manifest.json`,
      manifestDigest: reviewDigest,
      markerPath: `${reviewRoot}/COMMITTED.json`,
      markerDigest: reviewDigest,
      sectionIndexDigest: DIGEST,
      factStoreDigest: DIGEST,
      semanticManifestDigest: FOUNDATION_SEMANTIC_AUDIT_MANIFEST.digest,
      issueSummary: { total: 0, blocker: 0, high: 0, medium: 0, low: 0 },
    },
  })
}

function revisionState(): FoundationAuditState {
  const reason = 'foundation semantic balanced model is not configured'
  const semanticTask = {
    taskId: 'semantic-recheck-0',
    kind: 'semantic-recheck' as const,
    issueId: 'issue-0',
    revision: REVISION,
    round: 2 as const,
    packetPath: foundationRevisionPacketPath(REVISION, 2, 'semantic-recheck-0'),
    packetDigest: DIGEST,
    status: 'needs_action' as const,
    attempt: 0,
    failureReason: reason,
    modelTier: 'balanced' as const,
    bundleId: 'revision-bundle-2',
    issue: {
      id: 'issue-0',
      severity: 'HIGH' as const,
      type: 'semantic' as const,
      source: {
        documentPath: 'docs/GDD.md' as const,
        sectionId: 'vision',
        heading: 'Vision',
        startLine: 1,
        endLine: 1,
        digest: DIGEST,
      },
      expected: 'expected',
      actual: 'actual',
      remediation: {
        kind: 'patch' as const,
        documentPath: 'docs/GDD.md' as const,
        sectionIds: ['vision'],
      },
    } satisfies AuditIssue,
  }
  const documentTask = {
    taskId: 'document-revision-0',
    kind: 'document-revision' as const,
    revision: REVISION,
    round: 2 as const,
    packetPath: foundationRevisionPacketPath(
      REVISION,
      2,
      'document-revision-0',
    ),
    packetDigest: DIGEST,
    status: 'needs_action' as const,
    attempt: 0,
    failureReason: reason,
    documentPath: 'docs/GDD.md' as const,
    issueIds: ['issue-0'],
    sectionIds: ['vision'],
    stagedPath: foundationRevisionStagePath(REVISION, 'docs/GDD.md'),
    baseDocumentDigest: DIGEST,
    dependencyDigests: { 'docs/GDD.md#vision': DIGEST },
    frozen: false,
    bundleId: 'revision-bundle-2',
  }
  const seed = createFoundationAuditState({
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
  return parseFoundationAuditState({
    ...seed,
    authority: {
      issueAuthority: {
        kind: 'review',
        reviewDigest: DIGEST,
        issueRegistryDigest: DIGEST,
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
      documentRevision: 'document-rev',
      issueRegistryDigest: DIGEST,
      issueAuthority: {
        kind: 'review',
        reviewDigest: DIGEST,
        issueRegistryDigest: DIGEST,
      },
    },
    revision: REVISION,
    round: 2,
    status: 'semantic_recheck',
    phaseStartedAt: OLD_PHASE,
    issueSummary: { total: 1, blocker: 0, high: 1, medium: 0, low: 0 },
    activeBundleId: 'revision-bundle-2',
    revisionBundles: [
      {
        bundleId: 'revision-bundle-2',
        status: 'active' as const,
        round: 2,
        baseDocumentRevision: REVISION,
        baseDocumentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({
          path,
          digest: DIGEST,
        })),
        remediationDigest: DIGEST,
        taskIds: [semanticTask.taskId, documentTask.taskId],
        frozenTaskIds: [],
      },
    ],
    tasks: [semanticTask, documentTask],
  })
}

function validationBoundaryState(): FoundationAuditState {
  const state = completedRevisionState()
  return {
    ...state,
    status: 'validating',
  }
}

function revisionRun(state: FoundationAuditState): DeliveryRun {
  return {
    ...createTestDeliveryRun({
      projectId: 'transition-retry-revision',
      ownerId: 'transition-owner',
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    blockedReason: 'revision worker needs attention',
    foundationAuditState: state,
  }
}

function completedRevisionState(): FoundationAuditState {
  const state = revisionState()
  return {
    ...state,
    tasks: state.tasks.map(task => {
      const terminalEvidence = {
        usage: USAGE,
        durationMs: 1,
        dispatch: {
          dispatchId: `dispatch-${task.taskId}`,
          workerType:
            task.kind === 'document-revision'
              ? ('foundation-document-reviser' as const)
              : ('foundation-semantic-reviewer' as const),
          phase: 'DOCUMENT_REVIEW' as const,
          taskId: task.taskId,
          revision: task.revision,
          status: 'completed' as const,
          startedAt: OLD_PHASE,
          finishedAt: OLD_PHASE,
          terminalResult: {},
        },
      }
      if (task.kind === 'semantic-recheck') {
        return {
          ...task,
          ...terminalEvidence,
          status: 'completed' as const,
          attempt: 1,
          terminalDigest: DIGEST,
          resultPath: foundationRevisionSemanticResultPath(
            task.revision,
            task.round,
            task.taskId,
          ),
          resultDigest: DIGEST,
        }
      }
      if (task.kind !== 'document-revision')
        throw new Error('completed fixture requires document revisions')
      return {
        ...task,
        ...terminalEvidence,
        status: 'completed' as const,
        attempt: 1,
        terminalDigest: DIGEST,
        receipt: {
          taskId: task.taskId,
          round: task.round,
          documentPath: task.documentPath,
          issueIds: task.issueIds,
          baseDocumentDigest: task.baseDocumentDigest,
          stagedDocumentDigest: DIGEST,
          changedSectionIds: task.sectionIds,
          stagedPath: task.stagedPath,
          terminalDigest: DIGEST,
        },
      }
    }),
  }
}

describe('foundation retry transitions', () => {
  test('retries all eligible document-facts tasks and preserves aggregate usage', () => {
    const run = auditRun(auditState())
    const retried = transitionDeliveryRun(run, { type: 'retry' })
    const state = retried.foundationAuditState!

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(state.tasks.map(task => task.status)).toEqual(['pending', 'pending'])
    expect(state.tasks.every(task => task.failureReason === undefined)).toBe(
      true,
    )
    expect(state.phaseStartedAt).toBe(OLD_PHASE)
    expect(state.aggregateUsage).toEqual(USAGE)
  })

  test('retries only eligible semantic-recheck tasks and preserves revision timing', () => {
    const run = revisionRun(revisionState())
    const before = run.foundationAuditState!
    const retried = transitionDeliveryRun(run, { type: 'retry' })
    const state = retried.foundationAuditState!

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(state.tasks[0]).toMatchObject({
      kind: 'semantic-recheck',
      status: 'pending',
    })
    expect(state.tasks[0]?.failureReason).toBeUndefined()
    expect(state.tasks[1]).toEqual(before.tasks[1])
    expect(state.status).toBe(before.status)
    expect(state.round).toBe(before.round)
    expect(state.authority).toEqual(before.authority)
    expect(state.phaseStartedAt).toBe(OLD_PHASE)
  })

  test('revives a document revision at attempt 2 on ordinary retry', () => {
    const seed = revisionState()
    const documentTask = seed.tasks.find(
      task => task.kind === 'document-revision',
    )!
    const actionableTask = {
      ...documentTask,
      attempt: 2,
      failureReason: 'revision issue coverage is not exact',
      usage: USAGE,
      durationMs: 123,
      dispatch: {
        dispatchId: 'dispatch-document-revision-0',
        workerType: 'foundation-document-reviser' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: documentTask.taskId,
        revision: documentTask.revision,
        status: 'invalid' as const,
        failureReason: 'revision issue coverage is not exact',
        startedAt: OLD_PHASE,
        finishedAt: OLD_PHASE,
      },
    }
    const state: FoundationAuditState = {
      ...seed,
      status: 'revising',
      tasks: [actionableTask],
      revisionBundles: seed.revisionBundles?.map(bundle => ({
        ...bundle,
        taskIds: [documentTask.taskId],
      })),
    }
    const retried = transitionDeliveryRun(revisionRun(state), { type: 'retry' })

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(retried.foundationAuditState?.tasks).toEqual([
      expect.objectContaining({
        kind: 'document-revision',
        status: 'pending',
        attempt: 2,
        failureReason: undefined,
      }),
    ])
  })

  test('revives a failed semantic recheck on ordinary retry', () => {
    const seed = revisionState()
    const semanticTask = seed.tasks.find(task => task.kind === 'semantic-recheck')!
    const reason = 'durable semantic terminal is invalid'
    const failedTask = {
      ...semanticTask,
      attempt: 1,
      status: 'needs_action' as const,
      failureReason: reason,
      dispatch: {
        dispatchId: 'dispatch-semantic-recheck-0',
        workerType: 'foundation-semantic-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        taskId: semanticTask.taskId,
        revision: semanticTask.revision,
        status: 'failed' as const,
        failureReason: reason,
        startedAt: OLD_PHASE,
        finishedAt: OLD_PHASE,
      },
    }
    const state: FoundationAuditState = {
      ...seed,
      tasks: [failedTask],
      revisionBundles: seed.revisionBundles?.map(bundle => ({
        ...bundle,
        taskIds: [semanticTask.taskId],
      })),
    }
    const retried = transitionDeliveryRun(revisionRun(state), { type: 'retry' })

    expect(retried.status).toBe('running')
    expect(retried.foundationAuditState?.tasks).toEqual([
      expect.objectContaining({
        kind: 'semantic-recheck',
        status: 'pending',
        attempt: 1,
        failureReason: undefined,
      }),
    ])
  })

  test('re-enters a validating boundary without reviving completed workers', () => {
    const before = validationBoundaryState()
    const run = revisionRun(before)
    const retried = transitionDeliveryRun(run, { type: 'retry' })

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(retried.foundationAuditState).toEqual(before)

    const taskRetry = transitionDeliveryRun(run, {
      type: 'retry',
      taskId: before.tasks[0]!.taskId,
    })
    expect(taskRetry.status).toBe('needs_action')
    expect(taskRetry.foundationAuditState).toEqual(before)
  })

  test('replans a legacy validating boundary that never materialized impacted-fact tasks', () => {
    const before = validationBoundaryState()
    const documentOnly = {
      ...before,
      tasks: before.tasks.filter(task => task.kind === 'document-revision'),
      revisionBundles: before.revisionBundles?.map(bundle => ({
        ...bundle,
        taskIds: bundle.taskIds.filter(taskId =>
          before.tasks.some(
            task => task.taskId === taskId && task.kind === 'document-revision',
          ),
        ),
      })),
    }
    const retried = transitionDeliveryRun(revisionRun(documentOnly), {
      type: 'retry',
    })

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(retried.foundationAuditState?.status).toBe('rebuilding_facts')
    expect(retried.foundationAuditState?.tasks).toEqual(documentOnly.tasks)
  })

  test('re-enters a failed planning boundary', () => {
    const planning = {
      ...revisionState(),
      status: 'planning' as const,
      tasks: [],
      activeBundleId: undefined,
      revisionBundles: undefined,
    }
    const retried = transitionDeliveryRun(
      {
        ...revisionRun(planning),
        blockedReason:
          'foundation revision planning materialization failed: transient store error',
      },
      { type: 'retry' },
    )
    expect(retried.status).toBe('running')
    expect(retried.foundationAuditState?.status).toBe('planning')
  })

  test('does not retry ineligible foundation failures', () => {
    const cases = [
      { label: 'attempt 1', override: { attempt: 1 } },
      { label: 'usage', override: { usage: USAGE } },
      {
        label: 'integrity failure',
        override: {
          failureReason: 'foundation fact terminal identity mismatch',
        },
      },
      {
        label: 'dispatch',
        override: {
          dispatch: {
            dispatchId: 'dispatch-0',
            workerType: 'foundation-fact-extractor' as const,
            phase: 'DOCUMENT_REVIEW' as const,
            taskId: 'facts-0',
            revision: REVISION,
            status: 'failed' as const,
            startedAt: OLD_PHASE,
          },
        },
      },
    ] as const

    for (const { label, override } of cases) {
      const run = auditRun(auditState(override, false))
      const before = run.foundationAuditState!.tasks
      const retried = transitionDeliveryRun(run, { type: 'retry' })

      expect(retried.status, label).toBe('needs_action')
      expect(retried.blockedReason, label).toBe(run.blockedReason)
      expect(retried.foundationAuditState?.tasks, label).toEqual(before)
    }

    const admittedRun = auditRun(
      semanticAuditState({
        failureReason: 'foundation semantic balanced model is not configured',
        admittedResult: {
          checkId: FOUNDATION_SEMANTIC_CHECKS[0]!.checkId,
          packetIdentity: DIGEST,
          outcome: 'UNDECIDABLE',
          reason: 'requires a fresh semantic result',
        },
      }),
    )
    const admittedBefore = admittedRun.foundationAuditState!.tasks
    const admittedRetry = transitionDeliveryRun(admittedRun, { type: 'retry' })
    expect(admittedRetry.status).toBe('needs_action')
    expect(admittedRetry.blockedReason).toBe(admittedRun.blockedReason)
    expect(admittedRetry.foundationAuditState?.tasks).toEqual(admittedBefore)

    const resultPathState = revisionState()
    const resultPathTask = resultPathState.tasks.find(
      (
        task,
      ): task is Extract<
        FoundationAuditState['tasks'][number],
        { kind: 'semantic-recheck' }
      > => task.kind === 'semantic-recheck',
    )!
    resultPathState.tasks = resultPathState.tasks.map(task =>
      task.taskId === resultPathTask.taskId
        ? {
            ...resultPathTask,
            resultPath: foundationRevisionSemanticResultPath(
              resultPathTask.revision,
              resultPathTask.round,
              resultPathTask.taskId,
            ),
          }
        : task,
    )
    const resultPathRun = revisionRun(resultPathState)
    const resultPathBefore = resultPathRun.foundationAuditState!.tasks
    const resultPathRetry = transitionDeliveryRun(resultPathRun, {
      type: 'retry',
    })
    expect(resultPathRetry.status).toBe('needs_action')
    expect(resultPathRetry.blockedReason).toBe(resultPathRun.blockedReason)
    expect(resultPathRetry.foundationAuditState?.tasks).toEqual(
      resultPathBefore,
    )

    for (const [label, run] of [
      ['audit_ready', auditRun(auditReadyState())],
      [
        'round-closing revision',
        revisionRun({ ...completedRevisionState(), status: 'round_closing' }),
      ],
    ] as const) {
      const retried = transitionDeliveryRun(run, { type: 'retry' })
      expect(retried.status, label).toBe('running')
      expect(retried.blockedReason, label).toBeUndefined()
    }
  })
})

const GAME_IR_DIGEST = 'c'.repeat(64)
const GAME_IR_BRIEF = 'confirmed brief for v46 transition'
const GAME_IR_BRIEF_DIGEST = createHash('sha256')
  .update(GAME_IR_BRIEF)
  .digest('hex')
const GAME_IR_IDENTITY = {
  runId: 'transition-game-ir-run',
  taskId: 'game-ir-compile-task',
  publicationId: 'game-ir-publication',
  confirmedBriefDigest: GAME_IR_BRIEF_DIGEST,
  foundationRevision: REVISION,
  foundationReadyReceiptDigest: GAME_IR_DIGEST,
} as const
const GAME_IR_CHECKPOINT = {
  checkpointPath:
    '.beegame/ir/runs/transition-game-ir-run/checkpoints/phase4.json',
  checkpointDigest: GAME_IR_DIGEST,
} as const

function foundationReadyRun(): DeliveryRun {
  return {
    ...createTestDeliveryRun({
      runId: GAME_IR_IDENTITY.runId,
      projectId: 'game-ir-route-project',
      ownerId: 'game-ir-route-owner',
      confirmedBriefContext: GAME_IR_BRIEF,
    }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'running',
    foundationAuditState: auditReadyState(),
  }
}

function canonicalizeTransitionValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalizeTransitionValue)
  if (value === null || typeof value !== 'object') return value
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => [key, canonicalizeTransitionValue(entry)]),
  )
}

function gameIrReadyReceipt() {
  return {
    schemaVersion: 'game-ir-ready-receipt.v1',
    taskId: GAME_IR_IDENTITY.taskId,
    publicationId: GAME_IR_IDENTITY.publicationId,
    gameIrSchemaVersion: 'game-ir.v1',
    foundationRevision: REVISION,
    foundationReceiptDigest: GAME_IR_DIGEST,
    manifestDigest: GAME_IR_DIGEST,
    moduleDigests: {
      balance: GAME_IR_DIGEST,
      gameplay: GAME_IR_DIGEST,
      'implementation-verification': GAME_IR_DIGEST,
      presentation: GAME_IR_DIGEST,
      'resource-realization': GAME_IR_DIGEST,
      'world-scene': GAME_IR_DIGEST,
    },
    sourceMapDigests: {
      balance: GAME_IR_DIGEST,
      gameplay: GAME_IR_DIGEST,
      'implementation-verification': GAME_IR_DIGEST,
      presentation: GAME_IR_DIGEST,
      'resource-realization': GAME_IR_DIGEST,
      'world-scene': GAME_IR_DIGEST,
    },
    dependencyGraphDigest: GAME_IR_DIGEST,
    committedPath: '.beegame/ir/game-ir.v1/revisions/rev-1/COMMITTED.json',
  } as const
}

function gameIrReadyReceiptDigest(): string {
  return createHash('sha256')
    .update(JSON.stringify(canonicalizeTransitionValue(gameIrReadyReceipt())))
    .digest('hex')
}

describe('Game IR and Checklist bridge transitions', () => {
  test('routes Foundation READY into the one durable Game IR compilation phase', () => {
    const next = transitionDeliveryRun(foundationReadyRun(), {
      type: 'game_ir_compilation_started',
      identity: GAME_IR_IDENTITY,
    } as never)

    expect(next).toMatchObject({
      phase: 'GAME_IR_COMPILATION',
      documentStep: undefined,
      status: 'running',
      gameIrState: { status: 'compiling', identity: GAME_IR_IDENTITY },
    })
  })

  test('commits a checkpoint and only then admits Game IR ready state', () => {
    const compiling = transitionDeliveryRun(foundationReadyRun(), {
      type: 'game_ir_compilation_started',
      identity: GAME_IR_IDENTITY,
    } as never)
    const checkpointed = transitionDeliveryRun(compiling, {
      type: 'game_ir_checkpoint_committed',
      checkpoint: GAME_IR_CHECKPOINT,
      expectedPreviousCheckpoint: undefined,
    } as never)
    expect(checkpointed.gameIrState).toMatchObject({
      status: 'compiling',
      latestCheckpoint: GAME_IR_CHECKPOINT,
    })

    const readyReceipt = gameIrReadyReceipt()
    const ready = transitionDeliveryRun(checkpointed, {
      type: 'game_ir_ready',
      state: {
        status: 'ready',
        identity: GAME_IR_IDENTITY,
        checkpoint: GAME_IR_CHECKPOINT,
        readyReceipt,
        readyReceiptDigest: createHash('sha256')
          .update(JSON.stringify(canonicalizeTransitionValue(readyReceipt)))
          .digest('hex'),
      },
    } as never)
    expect(ready).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_DRAFTING',
      gameIrState: { status: 'ready', checkpoint: GAME_IR_CHECKPOINT },
    })
  })

  test('atomically consumes the completed compiler dispatch when committing a checkpoint', () => {
    const compiling = transitionDeliveryRun(foundationReadyRun(), {
      type: 'game_ir_compilation_started',
      identity: GAME_IR_IDENTITY,
    } as never)
    const terminal = {
      ...compiling,
      activeDispatch: {
        dispatchId: 'game-ir-terminal',
        workerType: 'game-ir-compiler',
        phase: 'GAME_IR_COMPILATION',
        taskId: GAME_IR_IDENTITY.taskId,
        revision: GAME_IR_IDENTITY.foundationRevision,
        status: 'completed',
        startedAt: '2026-09-02T00:00:00.000Z',
        finishedAt: '2026-09-02T00:01:00.000Z',
        terminalResult: { status: 'completed' },
      },
      gameIrState: {
        ...compiling.gameIrState!,
        diagnosticRef: 'stale-diagnostic',
        diagnostic: {
          phase: 'GAME_IR_COMPILATION',
          step: 'phase4/gameplay/projection',
          taskId: GAME_IR_IDENTITY.taskId,
          workerType: 'game-ir-compiler',
          reasonCode: 'compilation',
          expected: 'canonical projection',
          actual: 'previous retry',
          diagnosticRef: 'stale-diagnostic',
          recoveryAction: 'retry',
        },
        progressIdentity: {
          inputDigest: GAME_IR_DIGEST,
          diagnosticDigest: GAME_IR_DIGEST,
          candidateDigest: GAME_IR_DIGEST,
          checkpointJournalDigest: GAME_IR_DIGEST,
          terminalDigest: GAME_IR_DIGEST,
        },
      },
    } as DeliveryRun

    const checkpointed = transitionDeliveryRun(terminal, {
      type: 'game_ir_checkpoint_committed',
      checkpoint: GAME_IR_CHECKPOINT,
      expectedPreviousCheckpoint: undefined,
    } as never)

    expect(checkpointed.activeDispatch).toBeUndefined()
    expect(checkpointed.gameIrState).toEqual({
      status: 'compiling',
      identity: GAME_IR_IDENTITY,
      latestCheckpoint: GAME_IR_CHECKPOINT,
    })
  })

  test('advances checkpoints with compare-and-swap and keeps repeats idempotent', () => {
    const compiling = transitionDeliveryRun(foundationReadyRun(), {
      type: 'game_ir_compilation_started',
      identity: GAME_IR_IDENTITY,
    } as never)
    const first = transitionDeliveryRun(compiling, {
      type: 'game_ir_checkpoint_committed',
      checkpoint: GAME_IR_CHECKPOINT,
      expectedPreviousCheckpoint: undefined,
    } as never)
    const nextCheckpoint = {
      checkpointPath:
        '.beegame/ir/runs/transition-game-ir-run/checkpoints/phase5.json',
      checkpointDigest: 'd'.repeat(64),
    }
    const second = transitionDeliveryRun(first, {
      type: 'game_ir_checkpoint_committed',
      checkpoint: nextCheckpoint,
      expectedPreviousCheckpoint: GAME_IR_CHECKPOINT,
    } as never)
    expect(second.gameIrState).toMatchObject({
      status: 'compiling',
      latestCheckpoint: nextCheckpoint,
    })
    const repeated = transitionDeliveryRun(second, {
      type: 'game_ir_checkpoint_committed',
      checkpoint: nextCheckpoint,
      expectedPreviousCheckpoint: GAME_IR_CHECKPOINT,
    } as never)
    expect(repeated.gameIrState).toMatchObject(second.gameIrState!)
    expect(() =>
      transitionDeliveryRun(second, {
        type: 'game_ir_checkpoint_committed',
        checkpoint: {
          checkpointPath:
            '.beegame/ir/runs/transition-game-ir-run/checkpoints/phase6.json',
          checkpointDigest: 'e'.repeat(64),
        },
        expectedPreviousCheckpoint: GAME_IR_CHECKPOINT,
      } as never),
    ).toThrow()
    expect(() =>
      transitionDeliveryRun(second, {
        type: 'game_ir_checkpoint_committed',
        checkpoint: {
          checkpointPath:
            '.beegame/ir/runs/transition-game-ir-run/checkpoints/phase6.json',
          checkpointDigest: 'e'.repeat(64),
        },
        expectedPreviousCheckpoint: undefined,
      } as never),
    ).toThrow()
  })

  test('requires the bridge step before entering resource preparation', () => {
    const run: DeliveryRun = {
      ...foundationReadyRun(),
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      gameIrState: {
        status: 'ready' as const,
        identity: GAME_IR_IDENTITY,
        checkpoint: GAME_IR_CHECKPOINT,
        readyReceipt: gameIrReadyReceipt(),
        readyReceiptDigest: createHash('sha256')
          .update(
            JSON.stringify(canonicalizeTransitionValue(gameIrReadyReceipt())),
          )
          .digest('hex'),
      },
    } as unknown as DeliveryRun

    expect(() =>
      transitionDeliveryRun(run, {
        type: 'resource_preparation_required',
      }),
    ).toThrow()

    const bridging = transitionDeliveryRun(run, {
      type: 'checklist_bridge_started',
      identity: {
        runId: run.runId,
        taskId: 'bridge-task',
        checklistPublicationDigest: GAME_IR_DIGEST,
        gameIrReadyReceiptDigest: gameIrReadyReceiptDigest(),
      },
    } as never)
    expect(bridging).toMatchObject({
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'CHECKLIST_BRIDGE',
      checklistBridgeState: { status: 'bridging' },
    })
  })
})
