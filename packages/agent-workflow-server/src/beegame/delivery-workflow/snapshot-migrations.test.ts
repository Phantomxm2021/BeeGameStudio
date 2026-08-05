import { describe, expect, test } from 'bun:test'
import {
  COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
  FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
} from './types'
import { migrateWorkflowSnapshot } from './snapshot-migrations'
import {
  createAcceptedComprehensiveReview,
  createTestDeliveryRun,
} from '../../__tests__/delivery-workflow-test-helpers'

const RETIRED_PENDING_CHECK_ID = 'retired_pending_check'

function activeCycle(value: unknown) {
  return (
    value as {
      documentReviewState: { activeCycle: unknown }
    }
  ).documentReviewState.activeCycle as {
    requiredCheckIds: string[]
    completedCheckIds: string[]
  }
}

function activeDispatch(value: unknown) {
  return value as {
    activeDispatch: {
      request: { contract: { currentCheckIds: string[] } }
    }
  }
}

function resourceEvidence(value: unknown) {
  return (value as { evidence: { resourcePreparation: unknown } }).evidence
    .resourcePreparation as { status: string }
}

function version11Snapshot() {
  const initial = createTestDeliveryRun({
    runId: 'migration-run',
    projectId: 'migration-project',
    ownerId: 'migration-owner',
    checklistApproved: true,
  })
  const comprehensive = createAcceptedComprehensiveReview()
  const requiredCheckIds: string[] = [
    ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
    RETIRED_PENDING_CHECK_ID,
  ]
  const completedCheckIds = [...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS]
  return {
    ...initial,
    schemaVersion: 11,
    phase: 'DOCUMENT_REVIEW' as const,
    documentStep: 'COMPREHENSIVE_REVIEW' as const,
    revision: { ...initial.revision, resource: 'resource-revision' },
    evidence: {
      resourcePreparation: {
        path: '.beegame/workflow/evidence/resource-gate.json',
        kind: 'resource_preparation' as const,
        revision: 'resource-revision',
        status: 'passed' as const,
        observedAt: '2026-08-05T00:00:00.000Z',
      },
    },
    resourceProductionState: { currentTask: 'RESOURCE_GATE' as const },
    documentReviewState: {
      ...initial.documentReviewState,
      activeCycle: {
        cycleId: 'comprehensive-cycle',
        originScope: 'complete' as const,
        scope: 'complete' as const,
        mode: 'initial' as const,
        sourceRevision: 'resource-revision',
        requiredCheckIds,
        completedCheckIds,
        checks: comprehensive.checks.slice(0, completedCheckIds.length),
        checkEvidenceDigests: {},
        findings: [],
        acceptedSemanticResult: false,
        changedPaths: [],
        sourceArtifactDigests: {},
      },
    },
    activeDispatch: {
      dispatchId: 'review-dispatch',
      workerType: 'document-reviewer' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      revision: 'resource-revision',
      status: 'running' as const,
      startedAt: '2026-08-05T00:00:00.000Z',
      request: {
        dispatchId: 'review-dispatch',
        runId: initial.runId,
        ownerId: initial.ownerId,
        projectId: initial.projectId,
        workspacePath: '/synthetic/workspace',
        workerType: 'document-reviewer' as const,
        phase: 'DOCUMENT_REVIEW' as const,
        revision: 'resource-revision',
        contract: {
          requiredCheckIds,
          currentCheckIds: ['resource_semantic_fitness'],
        },
      },
    },
  }
}

describe('workflow snapshot migrations', () => {
  test('migrates a version-11 comprehensive review without replaying completed checks', () => {
    const result = migrateWorkflowSnapshot(version11Snapshot())

    expect(result.migratedFrom).toBe(11)
    expect(result.value).toMatchObject({ schemaVersion: 12 })
    expect(activeCycle(result.value).requiredCheckIds).toEqual([
      ...COMPREHENSIVE_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    expect(activeCycle(result.value).completedCheckIds).toEqual([
      ...FOUNDATION_DOCUMENT_REVIEW_CHECK_IDS,
    ])
    expect(activeDispatch(result.value).activeDispatch.request.contract.currentCheckIds).toEqual([
      'resource_semantic_fitness',
    ])
    expect(resourceEvidence(result.value).status).toBe('passed')
  })

  test('rejects an unknown completed check without changing the source snapshot', () => {
    const snapshot = version11Snapshot()
    ;(snapshot.documentReviewState.activeCycle!.completedCheckIds as string[]).push(
      RETIRED_PENDING_CHECK_ID,
    )
    const sourceBytes = JSON.stringify(snapshot)

    expect(() => migrateWorkflowSnapshot(snapshot)).toThrow(
      expect.objectContaining({ code: 'ambiguous_completed_unit' }),
    )
    expect(JSON.stringify(snapshot)).toBe(sourceBytes)
  })
})
