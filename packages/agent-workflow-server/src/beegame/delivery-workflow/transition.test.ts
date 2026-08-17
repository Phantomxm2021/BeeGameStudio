import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { createFoundationReviewState } from './foundation-review-state'
import { transitionDeliveryRun } from './transition'

const revision = 'a'.repeat(64)

describe('delivery workflow retry', () => {
  test('preserves committed review lanes and resets every uncommitted lane', () => {
    const base = createTestDeliveryRun({
      projectId: 'review-retry',
      ownerId: 'owner-review-retry',
    })
    const review = createFoundationReviewState({ revision })
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
})
