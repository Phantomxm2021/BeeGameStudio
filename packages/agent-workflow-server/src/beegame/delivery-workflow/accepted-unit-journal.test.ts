import { describe, expect, test } from 'bun:test'
import { createTestDeliveryRun } from '../../__tests__/delivery-workflow-test-helpers'
import { deriveAcceptedWorkflowUnits } from './accepted-unit-journal'

describe('accepted workflow unit journal', () => {
  test('does not duplicate Reviewer semantics into accepted-unit events', () => {
    const previous = createTestDeliveryRun({
      runId: 'journal-review',
      projectId: 'project',
      ownerId: 'owner',
      foundationDraftComplete: true,
    })
    const next = {
      ...previous,
      phase: 'DOCUMENT_REVIEW' as const,
      documentStep: 'CHECKLIST_DRAFTING' as const,
      documentReviewState: {
        ...previous.documentReviewState,
        approvals: {
          foundation: {
            scope: 'foundation' as const,
            revision: previous.revision.document,
            reportPath: `.beegame/reviews/foundation/${previous.revision.document}/review.json`,
            reportDigest: 'a'.repeat(64),
            approvedAt: previous.updatedAt,
          },
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(previous, next)).toEqual([])
  })

  test('keeps resource receipts as operational accepted units', () => {
    const previous = createTestDeliveryRun({
      runId: 'journal-resource',
      projectId: 'project',
      ownerId: 'owner',
    })
    const next = {
      ...previous,
      phase: 'RESOURCE_PREPARATION' as const,
      resourceProductionState: {
        currentTask: 'RESOURCE_CONTENT' as const,
        inventoryReceipt: {
          revision: 'inventory-revision',
          bindings: [
            { requirementId: 'requirement', resourceIds: ['resource'] },
          ],
          catalogObserved: true,
          acceptedAt: previous.updatedAt,
        },
      },
    }

    expect(deriveAcceptedWorkflowUnits(previous, next)).toEqual([
      expect.objectContaining({
        kind: 'resource-inventory',
        unitId: 'resource:inventory',
      }),
    ])
  })
})
