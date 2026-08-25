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
  type FoundationRevisionState,
} from './types'

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
      needsAction: 'foundation fact extraction is not part of Task 4A',
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
      needsAction: 'foundation fact extraction is not part of Task 4A',
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
    },
  })
}

function revisionState(): FoundationRevisionState {
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
  }
  return {
    authority: {
      issueAuthority: { kind: 'review', reviewDigest: DIGEST, issueRegistryDigest: DIGEST },
      derivedDigests: { sectionIndex: DIGEST, factStore: DIGEST, manifest: DIGEST },
      documentDigests: CANONICAL_FOUNDATION_DOCUMENTS.map(path => ({ path, digest: DIGEST })),
    },
    roundBefore: { documentRevision: 'document-rev', issueRegistryDigest: DIGEST },
    revision: REVISION,
    round: 2,
    phase: 'semantic_recheck',
    status: 'needs_action',
    phaseStartedAt: OLD_PHASE,
    knownIssueIds: ['issue-0'],
    tasks: [semanticTask, documentTask],
  }
}

function revisionRun(state: FoundationRevisionState): DeliveryRun {
  return {
    ...createTestDeliveryRun({ projectId: 'transition-retry-revision', ownerId: 'transition-owner' }),
    phase: 'DOCUMENT_REVIEW',
    documentStep: 'FOUNDATION_REVIEW',
    status: 'needs_action',
    blockedReason: 'revision worker needs attention',
    foundationRevisionState: state,
  }
}

function completedRevisionState(): FoundationRevisionState {
  const state = revisionState()
  return {
    ...state,
    status: 'completed',
    tasks: state.tasks.map(task => {
      if (task.kind === 'semantic-recheck') {
        return {
          ...task,
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
    const before = run.foundationRevisionState!
    const retried = transitionDeliveryRun(run, { type: 'retry' })
    const state = retried.foundationRevisionState!

    expect(retried.status).toBe('running')
    expect(retried.blockedReason).toBeUndefined()
    expect(state.tasks[0]).toMatchObject({ kind: 'semantic-recheck', status: 'pending' })
    expect(state.tasks[0]?.failureReason).toBeUndefined()
    expect(state.tasks[1]).toEqual(before.tasks[1])
    expect(state.phase).toBe(before.phase)
    expect(state.round).toBe(before.round)
    expect(state.authority).toEqual(before.authority)
    expect(state.phaseStartedAt).toBe(OLD_PHASE)

    const dualRun: DeliveryRun = {
      ...createTestDeliveryRun({ projectId: 'transition-retry-dual', ownerId: 'transition-owner' }),
      phase: 'DOCUMENT_REVIEW',
      documentStep: 'FOUNDATION_REVIEW',
      status: 'needs_action',
      blockedReason: 'revision worker needs attention',
      foundationAuditState: auditState({}, false),
      foundationRevisionState: revisionState(),
    }
    const auditBefore = dualRun.foundationAuditState!
    const dualRetry = transitionDeliveryRun(dualRun, { type: 'retry' })
    const dualRevision = dualRetry.foundationRevisionState!

    expect(dualRetry.status).toBe('running')
    expect(dualRetry.foundationAuditState).toEqual(auditBefore)
    expect(dualRevision.tasks[0]).toMatchObject({ kind: 'semantic-recheck', status: 'pending' })
    expect(dualRevision.tasks[1]).toMatchObject({ kind: 'document-revision', status: 'needs_action' })
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
      (task): task is Extract<FoundationRevisionState['tasks'][number], { kind: 'semantic-recheck' }> => task.kind === 'semantic-recheck',
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
    const resultPathBefore = resultPathRun.foundationRevisionState!.tasks
    const resultPathRetry = transitionDeliveryRun(resultPathRun, { type: 'retry' })
    expect(resultPathRetry.status).toBe('needs_action')
    expect(resultPathRetry.blockedReason).toBe(resultPathRun.blockedReason)
    expect(resultPathRetry.foundationRevisionState?.tasks).toEqual(resultPathBefore)

    for (const [label, run] of [
      ['audit_ready', auditRun(auditReadyState())],
      ['completed revision', revisionRun(completedRevisionState())],
    ] as const) {
      const retried = transitionDeliveryRun(run, { type: 'retry' })
      expect(retried.status, label).toBe('running')
      expect(retried.blockedReason, label).toBeUndefined()
    }
  })
})
