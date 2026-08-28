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
import {
  CANONICAL_FOUNDATION_DOCUMENTS,
  type DeliveryRun,
} from './types'
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
  overrides: Partial<Extract<FoundationAuditState['tasks'][number], { kind: 'document-facts' }>> = {},
  includeSecondTask = true,
): FoundationAuditState {
  const seed = createFoundationAuditState({
    revision: REVISION,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
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
      ...(includeSecondTask ? [{
        taskId: 'facts-1',
        kind: 'document-facts',
        revision: REVISION,
        packetDigest: DIGEST,
        factKeyCount: 1,
        modelTier: 'fast',
        status: 'needs_action',
        attempt: 0,
        failureReason: MODEL_REASON,
      }] : []),
    ],
  })
}

function auditRun(state: FoundationAuditState): DeliveryRun {
  return {
    ...createTestDeliveryRun({ projectId: 'transition-retry', ownerId: 'transition-owner' }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    blockedReason: 'foundation worker needs attention',
    foundationAuditState: state,
  }
}

function semanticAuditState(
  overrides: Partial<Extract<FoundationAuditState['tasks'][number], { kind: 'semantic' }>> = {},
): FoundationAuditState {
  const seed = createFoundationAuditState({
    revision: REVISION,
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
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
      status: index === 0 ? 'needs_action' as const : 'pending' as const,
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
      if (task.kind !== 'semantic') throw new Error('audit-ready fixture requires semantic tasks')
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
      source: { documentPath: 'docs/GDD.md' as const, sectionId: 'vision', heading: 'Vision', startLine: 1, endLine: 1, digest: DIGEST },
      expected: 'expected',
      actual: 'actual',
      remediation: { kind: 'patch' as const, documentPath: 'docs/GDD.md' as const, sectionIds: ['vision'] },
    } satisfies AuditIssue,
  }
  const documentTask = {
    taskId: 'document-revision-0',
    kind: 'document-revision' as const,
    revision: REVISION,
    round: 2 as const,
    packetPath: foundationRevisionPacketPath(REVISION, 2, 'document-revision-0'),
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
    documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
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
      issueAuthority: { kind: 'review', reviewDigest: DIGEST, issueRegistryDigest: DIGEST },
      derivedDigests: { sectionIndex: DIGEST, factStore: DIGEST, manifest: DIGEST },
      documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
    },
    roundBefore: { documentRevision: 'document-rev', issueRegistryDigest: DIGEST, issueAuthority: { kind: 'review', reviewDigest: DIGEST, issueRegistryDigest: DIGEST } },
    revision: REVISION,
    round: 2,
    status: 'semantic_recheck',
    phaseStartedAt: OLD_PHASE,
    issueSummary: { total: 1, blocker: 0, high: 1, medium: 0, low: 0 },
    activeBundleId: 'revision-bundle-2',
    revisionBundles: [{
      bundleId: 'revision-bundle-2',
      status: 'active' as const,
      round: 2,
      baseDocumentRevision: REVISION,
      baseDocumentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
      remediationDigest: DIGEST,
      taskIds: [semanticTask.taskId, documentTask.taskId],
      frozenTaskIds: [],
    }],
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
    ...createTestDeliveryRun({ projectId: 'transition-retry-revision', ownerId: 'transition-owner' }),
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
          workerType: task.kind === 'document-revision' ? 'foundation-document-reviser' as const : 'foundation-semantic-reviewer' as const,
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
          resultPath: foundationRevisionSemanticResultPath(task.revision, task.round, task.taskId),
          resultDigest: DIGEST,
        }
      }
      if (task.kind !== 'document-revision') throw new Error('completed fixture requires document revisions')
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
    expect(state.tasks.every(task => task.failureReason === undefined)).toBe(true)
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
    expect(state.tasks[0]).toMatchObject({ kind: 'semantic-recheck', status: 'pending' })
    expect(state.tasks[0]?.failureReason).toBeUndefined()
    expect(state.tasks[1]).toEqual(before.tasks[1])
    expect(state.status).toBe(before.status)
    expect(state.round).toBe(before.round)
    expect(state.authority).toEqual(before.authority)
    expect(state.phaseStartedAt).toBe(OLD_PHASE)

  })

  test('revives a document revision at attempt 2 on ordinary retry', () => {
    const seed = revisionState()
    const documentTask = seed.tasks.find(task => task.kind === 'document-revision')!
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
        taskIds: bundle.taskIds.filter(taskId => before.tasks.some(task => task.taskId === taskId && task.kind === 'document-revision')),
      })),
    }
    const retried = transitionDeliveryRun(revisionRun(documentOnly), { type: 'retry' })

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
    const retried = transitionDeliveryRun({
      ...revisionRun(planning),
      blockedReason: 'foundation revision planning materialization failed: transient store error',
    }, { type: 'retry' })
    expect(retried.status).toBe('running')
    expect(retried.foundationAuditState?.status).toBe('planning')

  })

  test('does not retry ineligible foundation failures', () => {
    const cases = [
      { label: 'attempt 1', override: { attempt: 1 } },
      { label: 'usage', override: { usage: USAGE } },
      { label: 'integrity failure', override: { failureReason: 'foundation fact terminal identity mismatch' } },
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

    const admittedRun = auditRun(semanticAuditState({
      failureReason: 'foundation semantic balanced model is not configured',
      admittedResult: {
        checkId: FOUNDATION_SEMANTIC_CHECKS[0]!.checkId,
        packetIdentity: DIGEST,
        outcome: 'UNDECIDABLE',
        reason: 'requires a fresh semantic result',
      },
    }))
    const admittedBefore = admittedRun.foundationAuditState!.tasks
    const admittedRetry = transitionDeliveryRun(admittedRun, { type: 'retry' })
    expect(admittedRetry.status).toBe('needs_action')
    expect(admittedRetry.blockedReason).toBe(admittedRun.blockedReason)
    expect(admittedRetry.foundationAuditState?.tasks).toEqual(admittedBefore)

    const resultPathState = revisionState()
    const resultPathTask = resultPathState.tasks.find(
      (task): task is Extract<FoundationAuditState['tasks'][number], { kind: 'semantic-recheck' }> => task.kind === 'semantic-recheck',
    )!
    resultPathState.tasks = resultPathState.tasks.map(task => task.taskId === resultPathTask.taskId
      ? {
          ...resultPathTask,
          resultPath: foundationRevisionSemanticResultPath(
            resultPathTask.revision,
            resultPathTask.round,
            resultPathTask.taskId,
          ),
        }
      : task)
    const resultPathRun = revisionRun(resultPathState)
    const resultPathBefore = resultPathRun.foundationAuditState!.tasks
    const resultPathRetry = transitionDeliveryRun(resultPathRun, { type: 'retry' })
    expect(resultPathRetry.status).toBe('needs_action')
    expect(resultPathRetry.blockedReason).toBe(resultPathRun.blockedReason)
    expect(resultPathRetry.foundationAuditState?.tasks).toEqual(resultPathBefore)

    for (const [label, run] of [
      ['audit_ready', auditRun(auditReadyState())],
      ['round-closing revision', revisionRun({ ...completedRevisionState(), status: 'round_closing' })],
    ] as const) {
      const retried = transitionDeliveryRun(run, { type: 'retry' })
      expect(retried.status, label).toBe('running')
      expect(retried.blockedReason, label).toBeUndefined()
    }
  })
})
