import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createFoundationReviewState } from './foundation-review-state'
import {
  createFoundationRemediationStateFromAuthority,
  recordFoundationRemediationDispatch,
} from './foundation-remediation'
import { transitionDeliveryRun } from './transition'

const revision = 'a'.repeat(64)

describe('delivery workflow retry', () => {
  test('allows the bounded second repair but locks the final verification', () => {
    const base = createTestDeliveryRun({
      projectId: 'bounded-review-retry',
      ownerId: 'owner-bounded-review-retry',
    })
    const completedVerification = (attempt: number) => ({
      ...base,
      status: 'needs_action' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      foundationReviewState: {
        ...createFoundationReviewState({
          mode: 'verification' as const,
          revision,
          attempt,
          priorReviewPath: '.beegame/reviews/foundation/prior/review.json',
          priorReviewDigest: 'b'.repeat(64),
        }),
        status: 'completed' as const,
        verdict: 'NEEDS_REVISION' as const,
      },
    })

    const retried = transitionDeliveryRun(completedVerification(2), {
      type: 'retry',
    })
    expect(retried.status).toBe('running')
    expect(retried.foundationReviewState?.status).toBe('completed')
    expect(() =>
      transitionDeliveryRun(completedVerification(3), { type: 'retry' }),
    ).toThrow('bounded remediation limit')
  })

  test('preserves committed review lanes and resets every uncommitted lane', () => {
    const base = createTestDeliveryRun({
      projectId: 'review-retry',
      ownerId: 'owner-review-retry',
    })
    const review = createFoundationReviewState({ mode: 'initial', revision })
    const run = {
      ...base,
      status: 'stopped' as const,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'FOUNDATION_REVIEW' as const,
      revision: { ...base.revision, document: revision },
      blockedReason: 'user stopped workflow',
      foundationReviewState: {
        ...review,
        status: 'failed' as const,
        failureReason: 'interrupted review lanes',
        reports: review.reports.map(report =>
          report.role === 'core-design'
            ? {
                ...report,
                status: 'completed' as const,
                digest: 'b'.repeat(64),
              }
            : report.role === 'technical-assets'
              ? { ...report, status: 'running' as const }
              : report.role === 'presentation'
                ? {
                    ...report,
                    status: 'failed' as const,
                    failureReason: 'interrupted',
                  }
                : report,
        ),
      },
    }

    const retried = transitionDeliveryRun(run, { type: 'retry' })

    expect(retried.foundationReviewState?.reports.map(report => report.status)).toEqual([
      'completed',
      'pending',
      'pending',
      'pending',
    ])
    expect(retried.foundationReviewState?.reports[0]?.digest).toBe('b'.repeat(64))
    expect(retried.foundationReviewState?.reports[1]?.dispatch).toBeUndefined()
    expect(retried.foundationReviewState?.reports[2]?.failureReason).toBeUndefined()
  })

  test('restarts an interrupted remediation as a fresh transaction', () => {
    const base = createTestDeliveryRun({
      projectId: 'remediation-retry',
      ownerId: 'owner-remediation-retry',
    })
    const sourceDigest = 'c'.repeat(64)
    const remediation = recordFoundationRemediationDispatch(
      createFoundationRemediationStateFromAuthority({
        reviewPath: '.beegame/reviews/foundation/review.json',
        reviewDigest: 'b'.repeat(64),
        sourceRevision: revision,
        affectedPaths: ['docs/GDD.md'],
      }),
      'gdd',
      {
        dispatchId: 'interrupted-remediation',
        workerType: 'document-author',
        phase: 'DOCUMENT_DRAFTING',
        taskId: 'foundation-remediation:gdd',
        revision,
        status: 'running',
        startedAt: new Date().toISOString(),
        request: {
          dispatchId: 'interrupted-remediation',
          runId: base.runId,
          ownerId: base.ownerId,
          projectId: base.projectId,
          workspacePath: '/workspace',
          workerType: 'document-author',
          phase: 'DOCUMENT_DRAFTING',
          taskId: 'foundation-remediation:gdd',
          revision,
          contract: { remediation: { sourceDigest } },
        },
      },
    )
    const retried = transitionDeliveryRun(
      {
        ...base,
        phase: 'DOCUMENT_DRAFTING',
        status: 'stopped',
        blockedReason: 'user stopped workflow',
        foundationRemediationState: remediation,
      },
      { type: 'retry' },
    )

    expect(retried.foundationRemediationState?.lanes[0]).toMatchObject({
      status: 'pending',
      sourceDigest,
    })
    expect(
      retried.foundationRemediationState?.lanes[0]?.dispatch,
    ).toBeUndefined()
  })
})
